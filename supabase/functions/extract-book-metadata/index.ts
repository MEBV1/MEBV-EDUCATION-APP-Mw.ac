import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyDocument,
  downloadDriveDocument,
  getDriveDocument,
  renderDocument
} from "../_shared/drive-documents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedRoles = ["admin", "super_admin", "content_manager"];

class ExtractionError extends Error {
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

function driveId(value: string) {
  try {
    const url = new URL(value);
    if (!["drive.google.com", "docs.google.com"].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/i);
    const id = match?.[1] || url.searchParams.get("id");
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
  } catch {
    return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : null;
  }
}

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function titleFromFilename(filename: string) {
  return filename
    .replace(/\.(pdf|docx?|pptx?|xlsx?|odt|ods|odp|epub|txt|rtf|jpe?g|png|webp|gif)$/i, "")
    .replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleFromContent(text: string, filename: string) {
  const match = text.match(/(?:book\s+)?title\s*[:\-]\s*([^\n]{3,150})/i);
  return match?.[1] ? clean(match[1]) : titleFromFilename(filename);
}

function authorFrom(text: string) {
  const patterns = [
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
  return "";
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
  const patterns: [RegExp, string][] = [
    [/\bform\s+one\b/i, "Form 1"], [/\bform\s+two\b/i, "Form 2"],
    [/\bform\s+three\b/i, "Form 3"], [/\bform\s+four\b/i, "Form 4"],
    [/\bf1\b|\bform\s*1\b/i, "Form 1"], [/\bf2\b|\bform\s*2\b/i, "Form 2"],
    [/\bf3\b|\bform\s*3\b/i, "Form 3"], [/\bf4\b|\bform\s*4\b/i, "Form 4"],
    [/\bjce\b/i, "JCE"], [/\bmsce\b/i, "MSCE"]
  ];
  for (let number = 1; number <= 12; number += 1) {
    patterns.push([new RegExp(`\\bstandard\\s+${number}\\b`, "i"), `Standard ${number}`]);
  }
  for (const [pattern, value] of patterns) if (pattern.test(source)) return value;
  return "";
}

function publisherFrom(text: string) {
  const match = text.match(/(?:publisher|published\s+by|publishing\s+company|published\s+and\s+distributed\s+by)\s*[:\-]?\s*([^\n]{2,150})/i);
  if (match?.[1]) return clean(match[1]).replace(/[|•].*$/g, "").trim();
  const organization = text.match(/\b(?:ministry\s+of|government\s+of|malawi\s+institute|national\s+curriculum)\b[^\n]{0,120}/i);
  return organization?.[0] ? clean(organization[0]) : "";
}

function isbnFrom(text: string) {
  const match = text.match(/\bISBN(?:-1[03])?\s*[:\-]?\s*((?:97[89][\s-]?)?[0-9][0-9Xx](?:[\s-]?[0-9Xx]){8,16})\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function yearFrom(text: string) {
  const patterns = [
    /(?:copyright|published|first\s+published|edition|©)\D{0,30}(19\d{2}|20\d{2})/i,
    /(19\d{2}|20\d{2})\D{0,20}(?:edition|copyright|published)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
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
  return "";
}

function languageFrom(text: string) {
  if (/\bChichewa\b/i.test(text)) return "Chichewa";
  if (/\bTumbuka\b/i.test(text)) return "Tumbuka";
  if (/\bYao\b/i.test(text)) return "Yao";
  if (/\bFrench\b/i.test(text)) return "French";
  return "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new ExtractionError(401, "Authentication required.");

    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error: userError } = await client.auth.getUser(token);
    if (userError || !user) throw new ExtractionError(401, "Invalid authentication token.");

    const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (profileError || !profile || !allowedRoles.includes(profile.role)) {
      throw new ExtractionError(403, "Administrator access required.");
    }

    const body = await request.json().catch(() => null);
    const driveUrl = String(body?.driveUrl || body?.download_url || body?.drive_url || "").trim();
    const fileId = driveId(driveUrl) || driveId(String(body?.fileId || body?.drive_file_id || ""));
    if (!fileId) throw new ExtractionError(400, "Enter a valid Google Drive, Docs, Slides, or Sheets link.");

    const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!apiKey) throw new ExtractionError(500, "Google Drive API credential is not configured.");

    const file = await getDriveDocument(fileId, apiKey);
    const classification = classifyDocument(file.name, file.mimeType);
    if (!classification.supported) throw new ExtractionError(415, classification.reason);

    const source = await downloadDriveDocument(file, apiKey, classification.extension);
    const rendered = await renderDocument(source.bytes, source.filename, source.contentType);
    const fullText = clean(rendered.text);
    const firstPage = clean(fullText.slice(0, 5000));
    const title = titleFromContent(firstPage, file.name);

    return json({
      success: true,
      file_id: file.id,
      file_name: file.name,
      mime_type: file.mimeType,
      file_size: file.size || null,
      extension: classification.extension,
      drive_url: file.webViewLink,
      cover_url: null,
      metadata: {
        title,
        author: authorFrom(firstPage),
        subject: subjectFrom(title, firstPage),
        educational_level: levelFrom(title, firstPage),
        publisher: publisherFrom(firstPage),
        isbn: isbnFrom(fullText),
        year_published: yearFrom(fullText),
        edition: editionFrom(fullText),
        language: languageFrom(firstPage)
      }
    });
  } catch (error) {
    const status = error instanceof ExtractionError ? error.status : 422;
    const message = error instanceof Error ? error.message : "Book information could not be extracted.";
    if (!(error instanceof ExtractionError)) console.error("[BOOK METADATA] Processing error:", error);
    return json({ success: false, error: message }, status);
  }
});
