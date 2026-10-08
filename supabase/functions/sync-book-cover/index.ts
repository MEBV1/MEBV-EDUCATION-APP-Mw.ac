import { createClient } from "npm:@supabase/supabase-js@2";

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
const maxPreviewBytes = 10 * 1024 * 1024;

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

function getDriveFileId(value: string) {
  try {
    const url = new URL(value);
    const pathMatch = url.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/i);
    const queryId = url.searchParams.get("id");
    const fileId = pathMatch?.[1] || queryId;
    return fileId && /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
}

function isPersistentPreviewUrl(value: string, bookId: string) {
  try {
    const url = new URL(value);
    return url.origin === new URL(supabaseUrl).origin &&
      url.pathname.startsWith(`/storage/v1/object/public/${storageBucket}/books/covers/${bookId}.`);
  } catch {
    return false;
  }
}

async function driveErrorMessage(response: Response, apiKey: string) {
  const payload = await response.json().catch(() => null);
  const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
  return message ? message.replaceAll(apiKey, "[redacted]") : `Google Drive API returned HTTP ${response.status}.`;
}

Deno.serve(async (request) => {
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
      .select("id,title,download_url,cover_url")
      .eq("id", bookId)
      .maybeSingle();
    if (bookError) throw new CoverSyncError(500, `Could not read book record: ${bookError.message}`);
    if (!book) throw new CoverSyncError(404, "Book record was not found.");

    const currentCover = String(book.cover_url || "");
    if (isPersistentPreviewUrl(currentCover, bookId)) {
      try {
        const existingPreview = await fetch(currentCover, { method: "HEAD" });
        if (existingPreview.ok && (existingPreview.headers.get("content-type") || "").startsWith("image/")) {
          return json({ success: true, status: "already_valid", coverUrl: currentCover });
        }
      } catch (error) {
        console.warn("[BOOK COVER SYNC] Stored preview could not be checked; attempting regeneration:", book.id, error);
      }
    }

    const fileId = getDriveFileId(String(book.download_url || ""));
    if (!fileId) throw new CoverSyncError(422, "Google Drive file ID could not be extracted from this book's download link.");

    const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!apiKey) throw new CoverSyncError(500, "Google Drive API credential is not configured.");

    const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    metadataUrl.searchParams.set("key", apiKey);
    metadataUrl.searchParams.set("fields", "id,name,mimeType,thumbnailLink");
    const metadataResponse = await fetch(metadataUrl);
    if (!metadataResponse.ok) {
      const message = await driveErrorMessage(metadataResponse, apiKey);
      throw new CoverSyncError(metadataResponse.status === 404 ? 404 : metadataResponse.status === 403 ? 403 : 502, `Could not access Drive file: ${message}`);
    }

    const metadata = await metadataResponse.json();
    if (!metadata.thumbnailLink) {
      throw new CoverSyncError(422, `First-page preview is unavailable for ${metadata.name || book.title} (${metadata.mimeType || "unknown format"}).`);
    }

    const thumbnailUrl = String(metadata.thumbnailLink).replace(/=s\d+$/i, "=s1600");
    const previewResponse = await fetch(thumbnailUrl);
    if (!previewResponse.ok) {
      throw new CoverSyncError(502, `Google Drive could not generate a preview for ${metadata.name || book.title}.`);
    }

    const contentType = (previewResponse.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new CoverSyncError(422, `Google Drive returned an unsupported preview format for ${metadata.name || book.title}.`);
    }
    const previewBytes = new Uint8Array(await previewResponse.arrayBuffer());
    if (!previewBytes.length || previewBytes.length > maxPreviewBytes) {
      throw new CoverSyncError(422, `Preview for ${metadata.name || book.title} is empty or exceeds the 10 MB limit.`);
    }

    const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `books/covers/${bookId}.${extension}`;
    const { error: uploadError } = await serviceClient.storage
      .from(storageBucket)
      .upload(path, previewBytes, { contentType, cacheControl: "31536000", upsert: true });
    if (uploadError) throw new CoverSyncError(500, `Could not store the generated preview in the ${storageBucket} bucket: ${uploadError.message}`);

    const coverUrl = serviceClient.storage.from(storageBucket).getPublicUrl(path).data.publicUrl;
    const { error: updateError } = await serviceClient
      .from("books")
      .update({ cover_url: coverUrl })
      .eq("id", bookId);
    if (updateError) throw new CoverSyncError(500, `Could not save the preview URL: ${updateError.message}`);

    return json({ success: true, status: "synced", coverUrl });
  } catch (error) {
    const status = error instanceof CoverSyncError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Book cover synchronization failed.";
    if (!(error instanceof CoverSyncError)) console.error("[BOOK COVER SYNC] Unexpected error:", error);
    return json({ success: false, error: message }, status);
  }
});
