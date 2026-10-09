FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-impress \
        libreoffice-calc \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        libjpeg62-turbo \
        libffi8 \
        shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN groupadd --system renderer \
    && useradd --system --gid renderer --home-dir /home/renderer renderer \
    && chown -R renderer:renderer /app /home/renderer
USER renderer

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
