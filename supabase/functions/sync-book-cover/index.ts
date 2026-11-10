import { createClient } from "npm:@supabase/supabase-js@2";
import {
  base64ToBytes,
  classifyDocument,
  downloadDriveDocument,
  DocumentRendererError,
  getDriveDocument,
  renderDocument
} from "../_shared/drive-documents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedRoles = ["admin", "super_admin", "content_manager"];
const storageBucket = "cms_assets";
const maxPreviewBytes = 4 * 1024 * 1024;
const failedCoverStates = new Set([
  "unavailable",
  "failed",
  "preview_unavailable",
  "cover_failed",
  "cover_unavailable"
]);

class CoverSyncError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function getDriveFileId(value: string) {
  const rawValue = value.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(rawValue)) return rawValue;
  try {
    const url = new URL(rawValue);
    if (!["drive.google.com", "docs.google.com", "drive.usercontent.google.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }
    const pathMatch = url.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/i);
    const queryId = url.searchParams.get("id");
    const fileId = pathMatch?.[1] || queryId;
    return fileId && /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
}

function needsCoverSynchronization(value: unknown) {
  const coverUrl = String(value || "").trim();
  if (!coverUrl || failedCoverStates.has(coverUrl.toLowerCase())) return true;
  try {
    const url = new URL(coverUrl);
    return url.protocol !== "https:" ||
      url.origin === new URL(supabaseUrl).origin ||
      /(?:^|\/)(?:logo|icon)\.(?:png|jpe?g|webp)$/i.test(url.pathname) ||
      (url.hostname.toLowerCase() === "drive.google.com" && /\/thumbnail(?:$|\/)/i.test(url.pathname));
  } catch {
    return true;
  }
}

async function isValidStoredCover(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" ||
      url.origin !== new URL(supabaseUrl).origin ||
      /(?:^|\/)(?:logo|icon)\.(?:png|jpe?g|webp)$/i.test(url.pathname) ||
      /drive\.google\.com\/thumbnail/i.test(url.hostname + url.pathname)) {
      return false;
    }
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000)
    });
    return response.ok && (response.headers.get("content-type") || "").toLowerCase().startsWith("image/");
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  let fileName = "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new CoverSyncError(401, "Authentication required.");
    if (!supabaseUrl || !supabaseAnonKey) throw new CoverSyncError(500, "Supabase authentication is not configured on the server.");

    const token = authorization.replace(/^Bearer\s+/i, "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) throw new CoverSyncError(401, "Invalid authentication token.");

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile || !allowedRoles.includes(profile.role)) {
      throw new CoverSyncError(403, "Administrator access required.");
    }

    if (!serviceRoleKey) throw new CoverSyncError(500, "SUPABASE_SERVICE_ROLE_KEY is not configured for cover storage.");
    const body = await request.json().catch(() => null);
    const bookId = String(body?.bookId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw new CoverSyncError(400, "A valid book ID is required.");

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: book, error: bookError } = await serviceClient
      .from("books")
      .select("id,title,download_url,drive_url,drive_file_id,cover_url")
      .eq("id", bookId)
      .maybeSingle();
    if (bookError) throw new CoverSyncError(500, `Could not read book record: ${bookError.message}`);
    if (!book) throw new CoverSyncError(404, "Book record was not found.");

    const currentCover = String(book.cover_url || "");

    const fileId = getDriveFileId(String(book.drive_file_id || "")) ||
      getDriveFileId(String(book.drive_url || "")) ||
      getDriveFileId(String(book.download_url || ""));
    if (!fileId) throw new CoverSyncError(422, "Google Drive file ID could not be extracted from this book's download link.");

    const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!apiKey) throw new CoverSyncError(500, "Google Drive API credential is not configured.");

    const metadata = await getDriveDocument(fileId, apiKey, true);
    fileName = metadata.name;
    const sourceVersion = metadata.md5Checksum || metadata.modifiedTime || "";
    let sourceChanged = false;
    if (currentCover && await isValidStoredCover(currentCover)) {
      const currentUrl = new URL(currentCover);
      const savedSourceVersion = currentUrl.searchParams.get("source");
      if (!savedSourceVersion || !sourceVersion || savedSourceVersion === sourceVersion) {
        return json({ success: true, status: "already_valid", coverUrl: currentCover });
      }
      sourceChanged = true;
    }
    if (!needsCoverSynchronization(currentCover) && !sourceChanged) {
      return json({
        success: true,
        status: "not_missing",
        message: "An existing cover URL is present but could not be verified; it was left unchanged."
      });
    }
    const classification = classifyDocument(metadata.name, metadata.mimeType);
    if (!classification.supported) {
      throw new CoverSyncError(415, classification.reason);
    }

    const source = await downloadDriveDocument(metadata, apiKey, classification.extension);
    const rendered = await renderDocument(source.bytes, source.filename, source.contentType);
    const previewBytes = base64ToBytes(rendered.coverBase64);
    if (!previewBytes.length || previewBytes.length > maxPreviewBytes) {
      throw new CoverSyncError(422, `Generated preview for ${metadata.name || book.title} is empty or exceeds the 4 MB limit.`);
    }

    const { data: currentRecord, error: currentRecordError } = await serviceClient
      .from("books")
      .select("cover_url")
      .eq("id", bookId)
      .maybeSingle();
    if (currentRecordError) {
      throw new CoverSyncError(500, `Could not recheck the book cover before saving: ${currentRecordError.message}`);
    }
    if (!currentRecord) throw new CoverSyncError(404, "Book record was not found.");
    const coverBeforeUpdateValue = currentRecord.cover_url;
    const coverBeforeUpdate = String(coverBeforeUpdateValue || "");
    let latestSourceChanged = false;
    if (coverBeforeUpdate && await isValidStoredCover(coverBeforeUpdate)) {
      const latestUrl = new URL(coverBeforeUpdate);
      const latestSourceVersion = latestUrl.searchParams.get("source");
      if (!latestSourceVersion || !sourceVersion || latestSourceVersion === sourceVersion) {
        return json({ success: true, status: "already_valid", coverUrl: coverBeforeUpdate });
      }
      latestSourceChanged = true;
    }
    if (!needsCoverSynchronization(coverBeforeUpdate) && !latestSourceChanged) {
      return json({
        success: true,
        status: "not_missing",
        message: "The book's cover state changed during processing; the existing value was left unchanged."
      });
    }

    const contentType = rendered.coverMimeType;
    const contentHash = await sha256Hex(previewBytes);
    const extension = contentType === "image/jpeg" ? "jpg" : "png";
    const path = `books/covers/${bookId}/${contentHash}.${extension}`;
    const { data: publicUrlData } = serviceClient.storage.from(storageBucket).getPublicUrl(path);
    const coverUrlObject = new URL(publicUrlData.publicUrl);
    if (sourceVersion) coverUrlObject.searchParams.set("source", sourceVersion);
    const coverUrl = coverUrlObject.toString();

    const sameContentAsCurrent = (() => {
      if (!coverBeforeUpdate) return false;
      try {
        return new URL(coverBeforeUpdate).pathname.endsWith(`/${contentHash}.${extension}`);
      } catch {
        return false;
      }
    })();
    if (sameContentAsCurrent) {
      return json({ success: true, status: "already_valid", coverUrl: coverBeforeUpdate });
    }

    if (!await isValidStoredCover(coverUrl)) {
      const { error: uploadError } = await serviceClient.storage
        .from(storageBucket)
        .upload(path, previewBytes, {
          contentType,
          cacheControl: "31536000",
          upsert: false
        });
      if (uploadError && !await isValidStoredCover(coverUrl)) {
        throw new CoverSyncError(500, `Cover generated successfully but storage upload failed: ${uploadError.message}`);
      }
    }

    if (coverBeforeUpdate === coverUrl) {
      return json({ success: true, status: "already_valid", coverUrl });
    }
    let updateQuery = serviceClient
      .from("books")
      .update({ cover_url: coverUrl })
      .eq("id", bookId);
    updateQuery = coverBeforeUpdateValue === null
      ? updateQuery.is("cover_url", null)
      : updateQuery.eq("cover_url", coverBeforeUpdateValue);
    const { data: updatedBook, error: updateError } = await updateQuery
      .select("id")
      .maybeSingle();
    if (updateError) throw new CoverSyncError(500, `Could not save the preview URL: ${updateError.message}`);
    if (!updatedBook) {
      const { data: latestRecord, error: latestRecordError } = await serviceClient
        .from("books")
        .select("cover_url")
        .eq("id", bookId)
        .maybeSingle();
      if (latestRecordError) throw new CoverSyncError(500, `Could not verify the saved preview: ${latestRecordError.message}`);
      if (!latestRecord) throw new CoverSyncError(404, "Book record was not found.");
      const latestCover = String(latestRecord.cover_url || "");
      if (latestCover && await isValidStoredCover(latestCover)) {
        return json({ success: true, status: "already_valid", coverUrl: latestCover });
      }
      return json({
        success: true,
        status: "not_missing",
        message: "The book's cover state changed during processing; the existing value was left unchanged."
      });
    }

    return json({ success: true, status: "synced", coverUrl, file_name: metadata.name });
  } catch (error) {
    const status = error instanceof CoverSyncError || error instanceof DocumentRendererError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Book cover synchronization failed.";
    if (!(error instanceof CoverSyncError) && !(error instanceof DocumentRendererError)) {
      console.error("[BOOK COVER SYNC] Unexpected error:", error);
    }
    return json({ success: false, error: message, file_name: fileName || null }, status);
  }
});
