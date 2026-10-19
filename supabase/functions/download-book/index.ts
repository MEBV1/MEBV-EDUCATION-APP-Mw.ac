import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyDocument,
  getDriveDocument
} from "../_shared/drive-documents.ts";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "https://mebv-education-app-mw-malawi.pages.dev"
]);
const allowedRequestHeaders = new Set([
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-supabase-api-version"
]);

function corsHeadersFor(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": [...allowedRequestHeaders].join(", "),
    "Access-Control-Expose-Headers": "Content-Disposition, X-Download-Request-Id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function preflightResponse(request: Request) {
  const origin = request.headers.get("Origin");
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const validPreflight = origin !== null &&
    allowedOrigins.has(origin) &&
    requestedMethod === "POST" &&
    requestedHeaders.every((header) => allowedRequestHeaders.has(header));
  return new Response(null, {
    status: validPreflight ? 204 : 403,
    headers: corsHeadersFor(request)
  });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const googleApiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY") || "";
const maxDownloadBytes = 250 * 1024 * 1024;

const googleWorkspaceDownloadMime: Record<string, { mime: string; extension: string }> = {
  gdoc: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx"
  },
  gslides: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx"
  },
  gsheets: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx"
  }
};

class DownloadError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({
      ...Object.fromEntries(corsHeadersFor(request)),
      "Content-Type": "application/json"
    })
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractDriveFileId(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "drive.google.com" &&
      hostname !== "docs.google.com" &&
      hostname !== "drive.usercontent.google.com") {
      return null;
    }
    const pathMatch = url.pathname.match(
      /\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/i
    );
    const queryId = url.searchParams.get("id");
    const fileId = pathMatch?.[1] || queryId;
    return fileId && /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
}

function safeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180) || "book-download";
}

function createDriveDownloadUrl(fileId: string, extension: string) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
  );
  const exportDetails = googleWorkspaceDownloadMime[extension];
  if (exportDetails) {
    url.pathname += "/export";
    url.searchParams.set("mimeType", exportDetails.mime);
  } else {
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
  }
  url.searchParams.set("key", googleApiKey);
  return url;
}

async function readGoogleError(response: Response) {
  const payload = await response.json().catch(() => null);
  const message = typeof payload?.error?.message === "string"
    ? payload.error.message.replaceAll(googleApiKey, "[redacted]")
    : `Google Drive returned HTTP ${response.status}.`;
  return message;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (origin && !allowedOrigins.has(origin)) {
    return json(request, { success: false, error: "This origin is not allowed to use book downloads." }, 403);
  }
  if (request.method !== "POST") {
    return json(request, { success: false, error: "Method not allowed." }, 405);
  }

  let reservationActive = false;
  let serviceClient: ReturnType<typeof createClient> | null = null;
  let requestId = "";
  let bookId = "";
  let visitorId: string | null = null;
  let userId: string | null = null;
  let reservationAttempted = false;

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new DownloadError(401, "Authentication is required to start a download.");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new DownloadError(503, "Supabase download authentication is not configured.");
    }

    if (token !== supabaseAnonKey) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      const { data: { user }, error } = await userClient.auth.getUser(token);
      if (error || !user) throw new DownloadError(401, "Your login session is invalid or expired.");
      userId = user.id;
    }

    if (!serviceRoleKey) {
      throw new DownloadError(503, "Server-side book download tracking is not configured.");
    }
    serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const body = await request.json().catch(() => null);
    bookId = String(body?.bookId || "").trim();
    requestId = String(body?.requestId || "").trim();
    visitorId = userId ? null : String(body?.visitorId || "").trim();
    const action = String(body?.action || "download");

    if (!isUuid(bookId)) throw new DownloadError(400, "A valid book ID is required.");
    if (!isUuid(requestId)) throw new DownloadError(400, "A valid download request ID is required.");
    if (!userId && !isUuid(visitorId || "")) {
      throw new DownloadError(400, "A valid anonymous visitor ID is required.");
    }

    if (action === "complete") {
      const { error } = await serviceClient.rpc("complete_book_download", {
        p_request_id: requestId,
        p_book_id: bookId,
        p_user_id: userId,
        p_visitor_id: visitorId
      });
      if (error) throw new DownloadError(500, "The completed download could not be recorded.");
      return json(request, { success: true });
    }
    if (action === "fail") {
      const { error } = await serviceClient.rpc("fail_book_download", {
        p_request_id: requestId,
        p_user_id: userId,
        p_visitor_id: visitorId
      });
      if (error) throw new DownloadError(500, "The failed download could not be cleared.");
      return json(request, { success: true });
    }
    if (action !== "download") throw new DownloadError(400, "Unsupported download action.");

    const { data: book, error: bookError } = await serviceClient
      .from("books")
      .select("id,title,download_url")
      .eq("id", bookId)
      .maybeSingle();
    if (bookError) throw new DownloadError(500, "The book record could not be loaded.");
    if (!book) throw new DownloadError(404, "The requested book was not found.");

    const fileId = extractDriveFileId(String(book.download_url || ""));
    if (!fileId) {
      throw new DownloadError(415, "This book does not have a supported Google Drive download link.");
    }
    if (!googleApiKey) {
      throw new DownloadError(503, "Google Drive downloads are not configured. Set GOOGLE_API_KEY or GOOGLE_DRIVE_API_KEY in Supabase secrets.");
    }

    let metadata;
    try {
      metadata = await getDriveDocument(fileId, googleApiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Drive file is inaccessible.";
      const status = /returned HTTP 404/i.test(message) ? 404
        : /inaccessible|returned HTTP 403/i.test(message) ? 403
        : 502;
      throw new DownloadError(status, message);
    }

    const classification = classifyDocument(metadata.name, metadata.mimeType);
    if (!classification.supported) {
      throw new DownloadError(415, classification.reason);
    }
    if (metadata.size > maxDownloadBytes) {
      throw new DownloadError(413, "This file exceeds the 250 MB download limit.");
    }

    reservationAttempted = true;
    const { data: reserved, error: reserveError } = await serviceClient.rpc(
      "begin_book_download",
      {
        p_request_id: requestId,
        p_book_id: bookId,
        p_user_id: userId,
        p_visitor_id: visitorId
      }
    );
    if (reserveError) throw new DownloadError(500, "The download could not be authorized.");
    if (reserved === "duplicate") {
      reservationAttempted = false;
      throw new DownloadError(409, "This download request has already been used.");
    }
    if (reserved === "limit") {
      reservationAttempted = false;
      throw new DownloadError(
        429,
        "You have used your 3 free downloads. Please log in or register to continue.",
        "FREE_DOWNLOAD_LIMIT_REACHED"
      );
    }
    if (reserved !== "reserved") {
      throw new DownloadError(500, "The download authorization returned an invalid status.");
    }
    reservationActive = true;

    let driveResponse: Response;
    try {
      driveResponse = await fetch(
        createDriveDownloadUrl(fileId, classification.extension),
        { signal: AbortSignal.timeout(240_000) }
      );
    } catch {
      throw new DownloadError(502, `Google Drive could not start the download for ${metadata.name}.`);
    }
    if (!driveResponse.ok) {
      const message = await readGoogleError(driveResponse);
      const status = driveResponse.status === 403 ? 403
        : driveResponse.status === 404 ? 404
        : 502;
      throw new DownloadError(status, `Google Drive file is inaccessible: ${message}`);
    }

    const contentType = driveResponse.headers.get("content-type") || metadata.mimeType;
    if (/^(?:text\/html|application\/json)/i.test(contentType)) {
      throw new DownloadError(502, `Google Drive returned an access page instead of ${metadata.name}.`);
    }
    const contentLength = Number(driveResponse.headers.get("content-length") || 0);
    if (contentLength > maxDownloadBytes) {
      throw new DownloadError(413, "This file exceeds the 250 MB download limit.");
    }
    if (!driveResponse.body) {
      throw new DownloadError(502, `Google Drive returned no file content for ${metadata.name}.`);
    }

    const exportDetails = googleWorkspaceDownloadMime[classification.extension];
    const extension = exportDetails?.extension || classification.extension;
    const rawName = metadata.name.replace(/\.[^.]+$/, "");
    const filename = safeFilename(`${rawName}.${extension}`);
    const reader = driveResponse.body.getReader();
    const downloadServiceClient = serviceClient;
    if (!downloadServiceClient) {
      throw new DownloadError(503, "Server-side book download tracking is not configured.");
    }
    let streamedBytes = 0;
    let reservationClosed = false;
    const releaseReservation = async () => {
      if (reservationClosed) return;
      reservationClosed = true;
      const { error } = await downloadServiceClient.rpc("fail_book_download", {
        p_request_id: requestId,
        p_user_id: userId,
        p_visitor_id: visitorId
      });
      if (error) console.error("[BOOK DOWNLOAD] Could not release failed download reservation.");
    };

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const { data: marked, error } = await downloadServiceClient.rpc(
              "mark_book_download_streamed",
              {
                p_request_id: requestId,
                p_user_id: userId,
                p_visitor_id: visitorId
              }
            );
            if (error || !marked) {
              throw new Error("The completed file stream could not be confirmed.");
            }
            controller.close();
            return;
          }
          streamedBytes += value.byteLength;
          if (streamedBytes > maxDownloadBytes) {
            await reader.cancel();
            await releaseReservation();
            controller.error(new Error("File exceeds the 250 MB download limit."));
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          await releaseReservation();
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await reader.cancel();
        } finally {
          await releaseReservation();
        }
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...Object.fromEntries(corsHeadersFor(request)),
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Download-Request-Id": requestId
      }
    });
  } catch (error) {
    if ((reservationActive || reservationAttempted) && serviceClient && requestId) {
      try {
        await serviceClient.rpc("fail_book_download", {
          p_request_id: requestId,
          p_user_id: userId,
          p_visitor_id: visitorId
        });
      } catch {
        console.error("[BOOK DOWNLOAD] Could not release the failed download reservation.");
      }
    }
    const status = error instanceof DownloadError ? error.status : 500;
    const message = error instanceof Error ? error.message : "The book could not be downloaded.";
    if (!(error instanceof DownloadError)) {
      console.error("[BOOK DOWNLOAD] Unexpected download failure:", message);
    }
    return json(request, {
      success: false,
      error: message,
      ...(error instanceof DownloadError && error.code ? { code: error.code } : {})
    }, status);
  }
});
