import base64
import hmac
import io
import logging
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
import warnings
from pathlib import Path

from ebooklib import ITEM_DOCUMENT, ITEM_IMAGE, epub
from fastapi import FastAPI, HTTPException, File, Header, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
import pytesseract
from weasyprint import HTML
from bs4 import BeautifulSoup

warnings.simplefilter("error", Image.DecompressionBombWarning)

app = FastAPI()
logger = logging.getLogger("document-renderer")
MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_PREVIEW_SIZE = 4 * 1024 * 1024
MAX_PREVIEW_DIMENSIONS = (900, 1273)
MAX_SOURCE_PIXELS = 40_000_000
MAX_ARCHIVE_FILES = 1000
MAX_ARCHIVE_SIZE = 100 * 1024 * 1024
TOKEN = os.environ.get("DOCUMENT_RENDERER_TOKEN", "")

EXTENSION_MIMES = {
    "pdf": {"application/pdf"},
    "doc": {"application/msword", "application/x-ole-storage"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "ppt": {"application/vnd.ms-powerpoint", "application/x-ole-storage"},
    "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    "xls": {"application/vnd.ms-excel", "application/x-ole-storage"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    "odt": {"application/vnd.oasis.opendocument.text"},
    "ods": {"application/vnd.oasis.opendocument.spreadsheet"},
    "odp": {"application/vnd.oasis.opendocument.presentation"},
    "epub": {"application/epub+zip"},
    "txt": {"text/plain"},
    "rtf": {"application/rtf", "text/rtf"},
    "jpg": {"image/jpeg"},
    "jpeg": {"image/jpeg"},
    "png": {"image/png"},
    "webp": {"image/webp"},
    "gif": {"image/gif"},
    "zip": {
        "application/zip",
        "application/x-zip-compressed",
        "application/x-zip",
        "multipart/x-zip",
    },
}

def error(status: int, message: str):
    return JSONResponse({"success": False, "error": message}, status_code=status)


def detect_format(filename: str, content_type: str, data: bytes) -> str:
    extension = Path(filename).suffix.lower().lstrip(".")
    normalized = content_type.lower().split(";", 1)[0].strip()
    if not extension and normalized in EXTENSION_MIMES["zip"]:
        extension = "zip"
    elif not extension and normalized == "application/octet-stream" and zipfile.is_zipfile(io.BytesIO(data)):
        extension = "zip"
    if extension not in EXTENSION_MIMES:
        raise ValueError(f"Unsupported format: {content_type or extension or 'unknown MIME type'}")
    if normalized and normalized != "application/octet-stream" and normalized not in EXTENSION_MIMES[extension]:
        raise ValueError(f"File extension .{extension} does not match MIME type {normalized}.")

    if extension in {"jpg", "jpeg", "png", "webp", "gif"}:
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
                detected = Image.MIME.get(image.format or "")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError(f"Image content is invalid: {exc}") from exc
        if detected not in EXTENSION_MIMES[extension]:
            raise ValueError(f"Image content does not match the .{extension} extension.")
        return extension

    if extension == "pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("PDF content is invalid or does not match the .pdf extension.")
        return extension

    if extension in {"doc", "ppt", "xls"}:
        if not data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
            raise ValueError(f"Legacy {extension.upper()} content is invalid or does not match its extension.")
        return extension

    if extension == "txt":
        if b"\x00" in data[:4096]:
            raise ValueError("Text content contains binary data.")
        return extension

    if extension == "rtf":
        if not data.lstrip().startswith(b"{\\rtf"):
            raise ValueError("RTF content is invalid or does not match the .rtf extension.")
        return extension

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items = archive.infolist()
            if len(items) > MAX_ARCHIVE_FILES:
                raise ValueError("Archive contains too many files to process.")
            if sum(item.file_size for item in items) > MAX_ARCHIVE_SIZE:
                raise ValueError("Expanded document exceeds the 100 MB processing limit.")
            if extension == "zip":
                if not any(not item.is_dir() for item in items):
                    raise ValueError("ZIP archive contains no files.")
                corrupt_file = archive.testzip()
                if corrupt_file:
                    raise ValueError(f"ZIP archive contains corrupt data: {Path(corrupt_file).name}.")
                return extension

            names = {item.filename for item in items}
            if extension == "docx" and "word/document.xml" not in names:
                raise ValueError("DOCX archive does not contain a document body.")
            if extension == "pptx" and not any(name.startswith("ppt/slides/slide") for name in names):
                raise ValueError("PPTX archive does not contain slides.")
            if extension == "xlsx" and "xl/workbook.xml" not in names:
                raise ValueError("XLSX archive does not contain a workbook.")
            if extension in {"odt", "ods", "odp"}:
                media_type = archive.read("mimetype").decode("ascii").strip()
                expected = next(iter(EXTENSION_MIMES[extension]))
                if media_type != expected:
                    raise ValueError(f"OpenDocument content does not match the .{extension} extension.")
            if extension == "epub":
                media_type = archive.read("mimetype").decode("ascii").strip()
                if media_type != "application/epub+zip":
                    raise ValueError("EPUB archive is missing its required MIME declaration.")
    except (zipfile.BadZipFile, KeyError, UnicodeDecodeError, RuntimeError) as exc:
        raise ValueError(f"{extension.upper()} document archive is invalid: {exc}") from exc
    return extension


def extract_zip_document(data: bytes) -> tuple[str, str, bytes]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in archive.infolist():
                if item.is_dir() or item.file_size > MAX_FILE_SIZE:
                    continue
                if (item.external_attr >> 16) & 0o170000 == stat.S_IFLNK:
                    continue
                filename = Path(item.filename).name
                extension = Path(filename).suffix.lower().lstrip(".")
                if extension not in EXTENSION_MIMES or extension == "zip":
                    continue
                document = archive.read(item)
                content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                try:
                    detect_format(filename, content_type, document)
                except ValueError:
                    continue
                return filename, extension, document
    except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise ValueError(f"ZIP archive could not be processed: {exc}") from exc
    raise ValueError("ZIP archive contains no supported, valid document to preview.")


def run_command(command: list[str], failure_message: str, timeout: int = 60):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{failure_message} (conversion timed out).") from exc
    if result.returncode != 0:
        detail = re.sub(r"\s+", " ", result.stderr or result.stdout).strip()[:400]
        raise RuntimeError(f"{failure_message}{': ' + detail if detail else '.'}")


def image_preview(data: bytes, preserve_text: bool = False) -> tuple[bytes, str]:
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > MAX_SOURCE_PIXELS:
                raise RuntimeError("Source image exceeds the 40-megapixel preview limit.")
            original.seek(0)
            image = ImageOps.exif_transpose(original)
            image.thumbnail(MAX_PREVIEW_DIMENSIONS, Image.Resampling.LANCZOS)
            image = image.convert("RGB")

            grayscale_histogram = image.convert("L").histogram()
            light_background_ratio = sum(grayscale_histogram[240:]) / (image.width * image.height)
            preserve_lossless = preserve_text or light_background_ratio >= 0.45

            def encode_png(source: Image.Image) -> bytes:
                target = io.BytesIO()
                source.save(target, format="PNG", optimize=True)
                return target.getvalue()

            png_bytes = encode_png(image)
            if preserve_lossless:
                preview_bytes, preview_mime = png_bytes, "image/png"
            else:
                target = io.BytesIO()
                image.save(target, format="JPEG", quality=86, optimize=True, progressive=True)
                jpeg_bytes = target.getvalue()
                if len(jpeg_bytes) <= len(png_bytes) * 0.8:
                    preview_bytes, preview_mime = jpeg_bytes, "image/jpeg"
                else:
                    preview_bytes, preview_mime = png_bytes, "image/png"

            while len(preview_bytes) > MAX_PREVIEW_SIZE and min(image.size) > 720:
                resized_dimensions = (
                    max(1, int(image.width * 0.85)),
                    max(1, int(image.height * 0.85))
                )
                image = image.resize(resized_dimensions, Image.Resampling.LANCZOS)
                png_bytes = encode_png(image)
                if preserve_lossless:
                    preview_bytes, preview_mime = png_bytes, "image/png"
                else:
                    target = io.BytesIO()
                    image.save(target, format="JPEG", quality=86, optimize=True, progressive=True)
                    jpeg_bytes = target.getvalue()
                    if len(jpeg_bytes) <= len(png_bytes) * 0.8:
                        preview_bytes, preview_mime = jpeg_bytes, "image/jpeg"
                    else:
                        preview_bytes, preview_mime = png_bytes, "image/png"

            if len(preview_bytes) > MAX_PREVIEW_SIZE:
                raise RuntimeError("Optimized preview exceeds the 4 MB storage limit.")
            return preview_bytes, preview_mime
    except RuntimeError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise RuntimeError(f"Unable to decode the document image: {exc}") from exc


def image_text(data: bytes) -> str:
    try:
        with Image.open(io.BytesIO(data)) as image:
            return pytesseract.image_to_string(image, lang="eng", config="--psm 6", timeout=15)[:500_000]
    except (OSError, RuntimeError, pytesseract.TesseractError) as exc:
        logger.warning("OCR could not extract image text: %s", exc)
        return ""


def epub_to_pdf(source: Path, output: Path):
    try:
        book = epub.read_epub(str(source), options={"ignore_ncx": True})
    except Exception as exc:
        raise RuntimeError(f"Unable to read EPUB document: {exc}") from exc

    cover = None
    for _value, attributes in book.get_metadata("OPF", "cover"):
        cover_id = attributes.get("content")
        cover_item = book.get_item_with_id(cover_id) if cover_id else None
        if cover_item and cover_item.get_type() == ITEM_IMAGE:
            cover = cover_item.get_content()
            break
    for item in book.get_items():
        if item.get_type() == ITEM_IMAGE and (
            "cover-image" in (getattr(item, "properties", None) or []) or
            "cover" in item.get_name().lower() or "cover" in item.get_id().lower()
        ):
            cover = cover or item.get_content()
            break
    if cover:
        result = image_preview(cover)
        return result[0], result[1], image_text(cover)

    documents = []
    for item_id, linear in book.spine:
        item = book.get_item_with_id(item_id)
        if linear != "no" and item and item.get_type() == ITEM_DOCUMENT:
            documents.append(item)
    if not documents:
        documents = [item for item in book.get_items_of_type(ITEM_DOCUMENT) if item.get_content()]
    if not documents:
        raise RuntimeError("EPUB has no cover image or readable first content page.")

    content = documents[0].get_content()
    soup = BeautifulSoup(content, "html.parser")
    for image in soup.find_all("img"):
        source_ref = image.get("src", "")
        item = book.get_item_with_href(source_ref)
        if item and item.get_type() == ITEM_IMAGE:
            mime = mimetypes.guess_type(item.get_name())[0] or "image/png"
            image["src"] = f"data:{mime};base64,{base64.b64encode(item.get_content()).decode('ascii')}"
            image.attrs.pop("srcset", None)
        else:
            image.decompose()
    for tag in soup.find_all(True):
        tag.attrs.pop("style", None)
        for attribute in list(tag.attrs):
            if attribute.lower().startswith("on"):
                tag.attrs.pop(attribute, None)
    for link in soup.find_all(["script", "style", "link", "audio", "video", "iframe", "object", "embed", "svg", "base"]):
        link.decompose()
    body = soup.body or soup
    html = (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "@page{size:A4;margin:18mm}body{font-family:serif;font-size:12pt;line-height:1.5}"
        "img{max-width:100%;max-height:240mm;object-fit:contain}p{orphans:3;widows:3}"
        "</style></head><body>" + str(body) + "</body></html>"
    )
    try:
        HTML(string=html).write_pdf(str(output))
    except Exception as exc:
        raise RuntimeError(f"Unable to render the first EPUB content page: {exc}") from exc
    return None


def render_pdf_page(pdf_path: Path, output_prefix: Path) -> bytes:
    run_command(
        ["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-png", "-scale-to", str(MAX_PREVIEW_DIMENSIONS[1]), str(pdf_path), str(output_prefix)],
        "Unable to render the first page"
    )
    rendered = output_prefix.with_suffix(".png")
    if not rendered.is_file():
        raise RuntimeError("PDF renderer did not produce a first-page image.")
    return rendered.read_bytes()


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        result = subprocess.run(
            ["pdftotext", "-f", "1", "-l", "12", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, timeout=30, check=False
        )
    except subprocess.TimeoutExpired:
        logger.warning("PDF text extraction timed out; returning the rendered preview without extracted text.")
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout[:500_000]


@app.get("/health")
def health():
    required = ["libreoffice", "pdftoppm", "pdftotext", "tesseract"]
    missing = [name for name in required if shutil.which(name) is None]
    return {"ok": not missing, "missing": missing}


@app.post("/render")
async def render(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    if not TOKEN:
        return error(503, "DOCUMENT_RENDERER_TOKEN is not configured on the renderer.")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not hmac.compare_digest(supplied, TOKEN):
        return error(401, "Renderer authentication failed.")

    data = await file.read(MAX_FILE_SIZE + 1)
    if not data:
        return error(400, "Uploaded document is empty.")
    if len(data) > MAX_FILE_SIZE:
        return error(413, "File exceeds the 25 MB processing limit.")

    filename = Path(file.filename or "document").name
    content_type = file.content_type or ""
    try:
        extension = detect_format(filename, content_type, data)
        source_format = extension
        if extension == "zip":
            filename, extension, data = extract_zip_document(data)
        if extension in {"jpg", "jpeg", "png", "webp", "gif"}:
            image_bytes, image_mime = image_preview(data)
            text = image_text(data)
        else:
            with tempfile.TemporaryDirectory(prefix="mebv-render-") as temporary:
                work = Path(temporary)
                source = work / f"source.{extension}"
                source.write_bytes(data)
                pdf_path = work / "source.pdf"

                if extension == "epub":
                    epub_cover = epub_to_pdf(source, pdf_path)
                    if epub_cover:
                        image_bytes, image_mime, text = epub_cover
                        return {
                            "success": True,
                            "cover_base64": base64.b64encode(image_bytes).decode("ascii"),
                            "cover_mime_type": image_mime,
                            "text": text,
                            "rendered_from": "embedded-epub-cover"
                        }
                elif extension != "pdf":
                    run_command(
                        ["libreoffice", "-env:UserInstallation=file://" + str(work / "lo-profile"),
                         "--headless", "--convert-to", "pdf", "--outdir", str(work), str(source)],
                        f"Unable to convert {extension.upper()} to PDF"
                    )
                    generated_pdf = work / f"source.pdf"
                    if not generated_pdf.is_file():
                        matches = list(work.glob("source*.pdf"))
                        if not matches:
                            raise RuntimeError(f"Unable to convert {extension.upper()} to PDF: no PDF was produced.")
                        generated_pdf = matches[0]
                    pdf_path = generated_pdf

                rendered_page = render_pdf_page(pdf_path, work / "first-page")
                text = extract_pdf_text(pdf_path)
                if not text.strip():
                    text = image_text(rendered_page)
                image_bytes, image_mime = image_preview(
                    rendered_page,
                    preserve_text=bool(re.search(r"[A-Za-z]{3,}", text))
                )

        if len(image_bytes) > MAX_PREVIEW_SIZE:
            raise RuntimeError("Generated preview exceeds the 4 MB storage limit.")
        return {
            "success": True,
            "cover_base64": base64.b64encode(image_bytes).decode("ascii"),
            "cover_mime_type": image_mime,
            "text": text,
            "rendered_from": source_format
        }
    except ValueError as exc:
        return error(415, str(exc))
    except (RuntimeError, OSError) as exc:
        return error(422, str(exc))
