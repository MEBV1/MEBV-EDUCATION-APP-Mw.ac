import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyDocument } from "../_shared/drive-documents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedRoles = ["admin", "super_admin", "content_manager"];

class FolderScanError extends Error {
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

function extractFolderId(value: string) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/\/drive\/folders\/([A-Za-z0-9_-]+)/i);
    if (match?.[1]) return match[1];
    const queryId = parsed.searchParams.get("id");
    if (queryId && /^[A-Za-z0-9_-]{10,}$/.test(queryId)) return queryId;
  } catch (_) {
    // Not a valid URL; fall through to regex parsing.
  }

  const direct = trimmed.match(/(?:\/drive\/folders\/|[?&]id=)([A-Za-z0-9_-]{10,})/i)?.[1];
  if (direct) return direct;

  const bare = trimmed.match(/^[A-Za-z0-9_-]{10,}$/)?.[0];
  return bare || null;
}

function isGoogleDriveFolderUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (hostname === "drive.google.com" || hostname.endsWith(".drive.google.com")) && /\/drive\/folders\//i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

async function listFolderFiles(folderId: string) {
  const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!apiKey) {
    throw new FolderScanError(500, "Google Drive API credentials are not configured on the server. Required: GOOGLE_API_KEY (or GOOGLE_DRIVE_API_KEY) for a public/accessible Drive folder scan.");
  }

  let allFiles: Array<Record<string, unknown>> = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      key: apiKey,
      q: `'${folderId}' in parents and trashed=false`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields: "nextPageToken, files(id,name,mimeType,size,webViewLink,webContentLink)",
      pageSize: "1000"
    });

    if (pageToken) params.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: {
          "User-Agent": "MEBV-Drive-Scanner/1.0"
        },
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.replaceAll(apiKey, "[redacted]") : "Network request failed.";
      throw new FolderScanError(502, `Google Drive API request failed: ${message}`);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const googleMessage = typeof payload?.error?.message === "string"
        ? payload.error.message.replaceAll(apiKey, "[redacted]")
        : "";
      const message = googleMessage
        ? `Google Drive API request failed (HTTP ${response.status}): ${googleMessage}`
        : `Google Drive API request failed with HTTP ${response.status}. Check the folder sharing settings and server-side API key configuration.`;
      throw new FolderScanError(response.status === 404 ? 404 : response.status === 403 ? 403 : 502, message);
    }

    const payload = await response.json().catch(() => ({}));
    const files = Array.isArray((payload as any).files) ? (payload as any).files : [];
    allFiles = allFiles.concat(files.filter((file: any) => file && file.id && file.name && file.mimeType !== "application/vnd.google-apps.folder"));
    pageToken = (payload as any).nextPageToken || "";
  } while (pageToken);
  return allFiles;
}

Deno.serve(async (request) => {
  console.log("[SCAN FOLDER] Function invoked");

  if (request.method === "OPTIONS") {
    console.log("[SCAN FOLDER] CORS OPTIONS request handled");
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    console.log("[SCAN FOLDER] Non-POST request rejected");
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    console.log("[SCAN FOLDER] Request received");

    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      console.error("[SCAN FOLDER] Authentication missing");
      return json({ success: false, error: "Authentication required" }, 401);
    }

    console.log("[SCAN FOLDER] Authentication checked");

    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user } } = await client.auth.getUser(token);
    if (!user) {
      console.error("[SCAN FOLDER] Invalid authentication token");
      return json({ success: false, error: "Invalid authentication token" }, 401);
    }

    const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !allowedRoles.includes(profile.role)) {
      console.error("[SCAN FOLDER] Administrator verification failed");
      return json({ success: false, error: "Administrator access required" }, 403);
    }

    const body = await request.json().catch(() => null);
    console.log("[SCAN FOLDER] Request body parsed");

    const folderUrl = String(body?.folderUrl || body?.folder_url || "").trim();
    console.log("[SCAN FOLDER] Folder URL received", folderUrl ? "yes" : "no");

    const folderId = extractFolderId(folderUrl) || String(body?.folderId || "").trim();
    console.log("[SCAN FOLDER] Folder ID extracted", folderId ? "yes" : "no");

    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
      console.error("[SCAN FOLDER] Folder ID missing or invalid");
      return json({ success: false, error: "Enter a valid Google Drive folder link." }, 400);
    }

    if (folderUrl && !/^[A-Za-z0-9_-]{10,}$/.test(folderUrl) && !isGoogleDriveFolderUrl(folderUrl)) {
      console.error("[SCAN FOLDER] Folder URL format invalid");
      return json({ success: false, error: "Enter a valid Google Drive folder link, for example: https://drive.google.com/drive/folders/FOLDER_ID" }, 400);
    }

    const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY");
    console.log("[SCAN FOLDER] Google credential checked", apiKey ? "present" : "missing");

    if (!apiKey) {
      console.error("[SCAN FOLDER] Google Drive API credential is not configured");
      return json({ success: false, error: "Google Drive API credential is not configured" }, 500);
    }

    const files = await listFolderFiles(folderId);
    const normalizedFiles = files.map((file: any) => {
      const name = String(file.name || "Untitled document");
      const mimeType = String(file.mimeType || "application/octet-stream");
      const classification = classifyDocument(name, mimeType);
      return {
        id: String(file.id || ""),
        name,
        mimeType,
        extension: classification.extension,
        size: Number(file.size) || 0,
        webViewLink: String(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`),
        webContentLink: String(file.webContentLink || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`),
        supported: classification.supported,
        reason: classification.reason
      };
    });

    return json({
      success: true,
      folderId,
      files: normalizedFiles,
      totalFiles: normalizedFiles.length,
      supportedCount: normalizedFiles.filter((file) => file.supported).length,
      unsupportedCount: normalizedFiles.filter((file) => !file.supported).length
    }, 200);
  } catch (error) {
    console.error("[SCAN FOLDER] Unexpected error:", error);
    const status = error instanceof FolderScanError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Folder scan failed.";
    return json({ success: false, error: message }, status);
  }
});