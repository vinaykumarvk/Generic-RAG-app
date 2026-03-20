# IntelliRAG Python Worker — ingestion pipeline
FROM python:3.11-slim

# Install system dependencies (OCR + legacy DOC text extraction)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    antiword \
    libpq-dev \
    poppler-utils \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/worker/src/ ./src/

RUN mkdir -p /app/uploads && useradd -m worker && chown -R worker:worker /app
USER worker

EXPOSE 8080
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
