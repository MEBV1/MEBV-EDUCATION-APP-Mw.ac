export type SupportedDocumentExtension =
  | "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx"
  | "odt" | "ods" | "odp" | "epub" | "txt" | "rtf"
  | "jpg" | "jpeg" | "png" | "webp" | "gif"
  | "gdoc" | "gslides" | "gsheets";

export interface DriveDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
}

export interface RenderedDocument {
  coverBase64: string;
  coverMimeType: "image/png" | "image/jpeg";
  text: string;
}

export class DocumentRendererError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type DocumentClassification =
  | { supported: true; extension: SupportedDocumentExtension; reason: "" }
  | { supported: false; extension: string; reason: string };

const supportedMimeByExtension: Record<SupportedDocumentExtension, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/x-ole-storage"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ppt: ["application/vnd.ms-powerpoint", "application/x-ole-storage"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xls: ["application/vnd.ms-excel", "application/x-ole-storage"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
  epub: ["application/epub+zip"],
  txt: ["text/plain"],
  rtf: ["application/rtf", "text/rtf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  gdoc: ["application/vnd.google-apps.document"],
  gslides: ["application/vnd.google-apps.presentation"],
  gsheets: ["application/vnd.google-apps.spreadsheet"]
};

const googleExportMime: Partial<Record<SupportedDocumentExtension, string>> = {
  gdoc: "application/pdf",
  gslides: "application/pdf",
  gsheets: "application/pdf"
};

const googleWorkspaceExtensions: SupportedDocumentExtension[] = ["gdoc", "gslides", "gsheets"];

export function documentMimeForExtension(extension: SupportedDocumentExtension) {
  return supportedMimeByExtension[extension][0];
}

export function classifyDocument(name: string, mimeType: string): DocumentClassification {
  const extension = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase() as SupportedDocumentExtension;
  const normalizedMime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const mimeExtension = (Object.entries(supportedMimeByExtension)
    .find(([, supportedMimes]) => supportedMimes.includes(normalizedMime))?.[0] || "") as SupportedDocumentExtension | "";
  const isGoogleWorkspaceFile = mimeExtension === "gdoc" || mimeExtension === "gslides" || mimeExtension === "gsheets";
  const resolvedExtension = isGoogleWorkspaceFile ? mimeExtension : extension || mimeExtension;

  if (!resolvedExtension || !supportedMimeByExtension[resolvedExtension]) {
    return { supported: false, extension: resolvedExtension, reason: `Unsupported format: ${normalizedMime || extension || "unknown MIME type"}` };
  }

  if (normalizedMime && normalizedMime !== "application/octet-stream" &&
    !supportedMimeByExtension[resolvedExtension].includes(normalizedMime)) {
    return {
      supported: false,
      extension: resolvedExtension,
      reason: `File extension .${resolvedExtension} does not match MIME type ${normalizedMime}.`
    };
  }

  return { supported: true, extension: resolvedExtension, reason: "" };
}

export async function getDriveDocument(fileId: string, apiKey: string): Promise<DriveDocument> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "id,name,mimeType,size,webViewLink");
  url.searchParams.set("supportsAllDrives", "true");

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch (error) {
    const message = error instanceof Error ? error.message.replaceAll(apiKey, "[redacted]") : "Network request failed.";
    throw new Error(`Google Drive file metadata request failed: ${message}`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const googleMessage = typeof payload?.error?.message === "string"
      ? payload.error.message.replaceAll(apiKey, "[redacted]")
      : `Google Drive API returned HTTP ${response.status}.`;
    const status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502;
    throw new Error(status === 404 || status === 403
      ? `Google Drive file is inaccessible: ${googleMessage}`
      : `Google Drive file metadata request failed: ${googleMessage}`);
  }

  const file = await response.json();
  return {
    id: String(file.id || fileId),
    name: String(file.name || ""),
    mimeType: String(file.mimeType || "application/octet-stream").toLowerCase(),
    size: Number(file.size) || 0,
    webViewLink: String(file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`)
  };
}

export async function downloadDriveDocument(file: DriveDocument, apiKey: string, extension: SupportedDocumentExtension) {
  if (file.size > 25 * 1024 * 1024) throw new Error("File exceeds the 25 MB processing limit.");
  const action = googleExportMime[extension] ? "/export" : "";
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}${action}`);
  url.searchParams.set("key", apiKey);
  if (googleExportMime[extension]) {
    url.searchParams.set("mimeType", googleExportMime[extension]!);
  } else {
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (error) {
    const message = error instanceof Error ? error.message.replaceAll(apiKey, "[redacted]") : "Network request failed.";
    throw new Error(`Google Drive file download failed: ${message}`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message.replaceAll(apiKey, "[redacted]")
      : `Google Drive returned HTTP ${response.status}.`;
    throw new Error(`Google Drive file is inaccessible: ${message}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Google Drive returned an empty file.");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("File exceeds the 25 MB processing limit.");
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("text/html")) {
    throw new Error("Google Drive returned an access page instead of the document. Check file sharing permissions.");
  }
  return {
    bytes,
    filename: googleWorkspaceExtensions.includes(extension)
      ? `${file.name.replace(/\.[^.]+$/, "")}.pdf`
      : file.name,
    contentType: googleExportMime[extension] || (
      file.mimeType === "application/octet-stream" ? documentMimeForExtension(extension) : file.mimeType
    )
  };
}

export async function renderDocument(
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<RenderedDocument> {
  const rendererUrl = Deno.env.get("DOCUMENT_RENDERER_URL")?.replace(/\/+$/, "");
  const rendererToken = Deno.env.get("DOCUMENT_RENDERER_TOKEN");
  if (!rendererUrl || !rendererToken) {
    throw new DocumentRendererError(503, "Document renderer is not configured. Set DOCUMENT_RENDERER_URL and DOCUMENT_RENDERER_TOKEN for the self-hosted renderer.");
  }

  const form = new FormData();
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
  const response = await fetch(`${rendererUrl}/render`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rendererToken}` },
    body: form,
    signal: AbortSignal.timeout(60000)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Renderer returned HTTP ${response.status}.`;
    const status = response.status === 400 ? 422
      : [413, 415, 422, 503].includes(response.status) ? response.status
      : 502;
    const safeMessage = response.status === 401 || response.status === 403
      ? "Document renderer authentication failed. Verify that DOCUMENT_RENDERER_TOKEN matches the renderer configuration."
      : message;
    throw new DocumentRendererError(status, safeMessage);
  }

  if (typeof payload?.cover_base64 !== "string" || !payload.cover_base64) {
    throw new DocumentRendererError(502, "Document renderer returned no first-page image.");
  }
  if (payload.cover_base64.length > 14 * 1024 * 1024) {
    throw new DocumentRendererError(502, "Generated first-page image exceeds the processing limit.");
  }

  const coverMimeType = payload.cover_mime_type;
  if (coverMimeType !== "image/png" && coverMimeType !== "image/jpeg") {
    throw new DocumentRendererError(502, "Document renderer returned an unsupported preview image format.");
  }

  return {
    coverBase64: payload.cover_base64,
    coverMimeType,
    text: typeof payload.text === "string" ? payload.text : ""
  };
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
