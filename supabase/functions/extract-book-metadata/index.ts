import { createClient } from "npm:@supabase/supabase-js@2";
import { getDocument } from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import mammoth from "npm:mammoth@1.8.0";
import * as XLSX from "npm:xlsx@0.18.5";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedRoles = ["admin", "super_admin", "content_manager"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function driveId(url: string) {
  const match = url.match(/(?:\/file\/d\/|\/document\/d\/|\/presentation\/d\/|\/spreadsheets\/d\/|[?&]id=|\/uc\?export=download&id=)([-\w]{15,})/);
  return match?.[1] || url.match(/[-\w]{25,}/)?.[0] || null;
}

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.(pdf|docx?|pptx?|xlsx?|txt|rtf)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function authorFrom(text: string) {
  const patterns: [RegExp, string][] = [
    /(?:^|\n)\s*by\s+([^\n]{2,120})/i,
    /(?:^|\n)\s*authors?\s*[:\-]\s*([^\n]{2,120})/i,
    /(?:^|\n)\s*written\s+by\s+([^\n]{2,120})/i,
    /(?:^|\n)\s*prepared\s+by\s+([^\n]{2,120})/i,
    /(?:^|\n)\s*edited\s+by\s+([^\n]{2,120})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/[|•].*$/g, "").trim();
  }

  return "Not specified";
}

function subjectFrom(title: string, firstPage: string) {
  const subjects = ["Computer Studies", "Mathematics", "English", "Biology", "Chemistry", "Physics", "Geography", "History", "Agriculture"];
  for (const subject of subjects) {
    const pattern = new RegExp(`\\b${subject.replace(" ", "\\s+")}\\b`, "i");
    if (pattern.test(title) || pattern.test(firstPage)) return subject;
  }
  return "";
}

function levelFrom(title: string, firstPage: string) {
  const source = `${title}\n${firstPage}`;
  const patterns = [
    [/\bform\s+one\b/i, "Form 1"], [/\bform\s+two\b/i, "Form 2"],
    [/\bform\s+three\b/i, "Form 3"], [/\bform\s+four\b/i, "Form 4"],
    [/\bf1\b|\bform\s*1\b/i, "Form 1"], [/\bf2\b|\bform\s*2\b/i, "Form 2"],
    [/\bf3\b|\bform\s*3\b/i, "Form 3"], [/\bf4\b|\bform\s*4\b/i, "Form 4"],
    [/\bjce\b/i, "JCE"], [ /\bmsce\b/i, "MSCE"]
  ];
  for (let number = 1; number <= 12; number += 1) patterns.push([new RegExp(`\\bstandard\\s+${number}\\b`, "i"), `Standard ${number}`]);
  for (const [pattern, value] of patterns) if ((pattern as RegExp).test(source)) return value;
  return "";
}

function publisherFrom(text: string) {
  const match = text.match(/(?:publisher|published\s+by|publishing\s+company|published\s+and\s+distributed\s+by)\s*[:\-]?\s*([^\n]{2,150})/i);
  if (match?.[1]) return clean(match[1]).replace(/[|•].*$/g, "").trim();
  const organization = text.match(/\b(?:ministry\s+of|government\s+of|malawi\s+institute|national\s+curriculum)\b[^\n]{0,120}/i);
  return organization?.[0] ? clean(organization[0]) : "Not specified";
}

function isbnFrom(text: string) {
  const match = text.match(/\bISBN(?:-1[03])?\s*[:\-]?\s*((?:97[89][\s-]?)?[0-9][0-9Xx](?:[\s-]?[0-9Xx]){8,16})\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "Not specified";
}

function yearFrom(firstPage: string, fullText: string, info: Record<string, unknown>) {
  const patterns = [
    /(?:copyright|published|first\s+published|edition|©)\D{0,30}(19\d{2}|20\d{2})/i,
    /(19\d{2}|20\d{2})\D{0,20}(?:edition|copyright|published)/i
  ];
  for (const pattern of patterns) {
    const match = firstPage.match(pattern) || fullText.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  const metadataYear = String(info.CreationDate || info.ModDate || "").match(/(19\d{2}|20\d{2})/);
  return metadataYear ? Number(metadataYear[1]) : null;
}

function editionFrom(text: string) {
  const editions: [RegExp, string][] = [
    [/\bfirst\s+edition\b|\b1st\s+edition\b/i, "First Edition"],
    [/\bsecond\s+edition\b|\b2nd\s+edition\b/i, "Second Edition"],
    [/\bthird\s+edition\b|\b3rd\s+edition\b/i, "Third Edition"],
    [/\brevised\s+and\s+updated\s+edition\b/i, "Revised and Updated Edition"],
    [/\brevised\s+edition\b/i, "Revised Edition"],
    [/\bnew\s+edition\b/i, "New Edition"]
  ];
  for (const [pattern, value] of editions) if (pattern.test(text)) return value;
  return "Not specified";
}

function languageFrom(text: string) {
  if (/\bChichewa\b/i.test(text)) return "Chichewa";
  if (/\bTumbuka\b/i.test(text)) return "Tumbuka";
  if (/\bYao\b/i.test(text)) return "Yao";
  if (/\bFrench\b/i.test(text)) return "French";
  return "English";
}

function workspaceExport(url: string, fileId: string) {
  if (/docs\.google\.com\/document/i.test(url)) return { url: `https://docs.google.com/document/d/${fileId}/export?format=docx`, extension: "docx" };
  if (/docs\.google\.com\/presentation/i.test(url)) return { url: `https://docs.google.com/presentation/d/${fileId}/export/pptx`, extension: "pptx" };
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return { url: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`, extension: "xlsx" };
  return { url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`, extension: "" };
}

function extensionOf(filename: string, contentType: string, fallback: string) {
  const fromName = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("wordprocessingml")) return "docx";
  if (contentType.includes("presentationml")) return "pptx";
  if (contentType.includes("spreadsheetml")) return "xlsx";
  if (contentType.includes("text/plain")) return "txt";
  if (contentType.includes("rtf")) return "rtf";
  return fallback || "";
}

function extensionFromUrl(url: string) {
  try {
    return new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
  } catch (_) {
    return "";
  }
}

async function fetchDocument(sourceUrl: string, fileId: string) {
  const target = workspaceExport(sourceUrl, fileId);
  const url = target.url;
  let result = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  let bytes = new Uint8Array(await result.arrayBuffer());
  let contentType = result.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("pdf")) {
    const html = new TextDecoder().decode(bytes);
    const token = html.match(/confirm=([0-9A-Za-z_]+)&/i)?.[1] || html.match(/name="confirm"\s+value="([^"]+)"/i)?.[1];
    if (token) {
      result = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(token)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      bytes = new Uint8Array(await result.arrayBuffer());
      contentType = result.headers.get("content-type") || "";
    }
  }

  if (!result.ok || bytes.length === 0) {
    throw new Error("Google Drive did not return a readable public document.");
  }
  let filename = result.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] || "";
  if (!filename) {
    const page = await fetch(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`)
      .then(item => item.text())
      .catch(() => "");
    filename = page.match(/<title>([^<]+?)\s*-\s*Google Drive<\/title>/i)?.[1]?.trim() || "";
  }
  const extension = extensionOf(filename, contentType, target.extension || extensionFromUrl(sourceUrl));
  const mimeType = contentType.split(";")[0].trim() || "application/octet-stream";
  return { bytes, filename, extension, mimeType };
}

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 12); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str || "").join(" "));
  }
  const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
  return { firstPage: clean(pages[0] || ""), fullText: clean(pages.join("\n")), info: metadata.info || {} };
}

function stripRtf(value: string) {
  return clean(value.replace(/\\'[0-9a-f]{2}/gi, " ").replace(/\\[a-z]+\d* ?/gi, "").replace(/[{}]/g, ""));
}

async function zipXmlText(bytes: Uint8Array, names: string[]) {
  const zip = await JSZip.loadAsync(bytes);
  const values: string[] = [];
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("text");
    values.push(clean(xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")));
  }
  return values.join("\n");
}

async function documentText(bytes: Uint8Array, extension: string) {
  if (extension === "pdf") return pdfText(bytes);
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
    const text = clean(result.value || "");
    return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
  }
  if (extension === "pptx") {
    const text = await zipXmlText(bytes, ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]);
    return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
  }
  if (extension === "xlsx") {
    const workbook = XLSX.read(bytes, { type: "array" });
    const text = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\n");
    return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
  }
  if (extension === "txt") {
    const text = clean(new TextDecoder().decode(bytes));
    return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
  }
  if (extension === "rtf") {
    const text = stripRtf(new TextDecoder().decode(bytes));
    return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
  }
  if (["doc", "ppt", "xls"].includes(extension)) {
    const binaryText = new TextDecoder("latin1").decode(bytes)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    const strings = binaryText.match(/[A-Za-z][A-Za-z0-9 ,.'()&:/-]{3,}/g) || [];
    const text = clean(strings.join(" "));
    if (text) return { firstPage: text.slice(0, 5000), fullText: text, info: {} };
    throw new Error(`Legacy ${extension.toUpperCase()} text could not be extracted. Save the book and add metadata manually.`);
  }
  throw new Error(`Unsupported document type: ${extension || "unknown"}. Save the book and add metadata manually.`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);

    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await client.auth.getUser(token);
    if (!user) return json({ error: "Invalid authentication token" }, 401);

    const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !allowedRoles.includes(profile.role)) return json({ error: "Administrator access required" }, 403);

    const body = await request.json();
    const downloadUrl = String(body.download_url || "").trim();
    const fileId = driveId(downloadUrl);
    if (!fileId) return json({ error: "Enter a valid Google Drive, Docs, Slides, or Sheets link" }, 400);

    const downloaded = await fetchDocument(downloadUrl, fileId);
    const extracted = await documentText(downloaded.bytes, downloaded.extension);
    const fileName = downloaded.filename;
    const title = titleFromFilename(fileName);

    return json({
      file_id: fileId,
      file_name: fileName,
      mime_type: downloaded.mimeType,
      extension: downloaded.extension,
      cover_url: `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`,
      metadata: {
        title: title || "",
        author: authorFrom(extracted.firstPage),
        subject: subjectFrom(title, extracted.firstPage),
        educational_level: levelFrom(title, extracted.firstPage),
        publisher: publisherFrom(extracted.firstPage),
        isbn: isbnFrom(extracted.fullText),
        year_published: yearFrom(extracted.firstPage, extracted.fullText, extracted.info),
        edition: editionFrom(extracted.fullText),
        language: languageFrom(extracted.firstPage)
      }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Book information could not be extracted" }, 400);
  }
});
