# IntelliRAG Python Worker — ingestion pipeline
FROM python:3.11-slim

# Install system dependencies (Tesseract for OCR, poppler for PDF)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
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
