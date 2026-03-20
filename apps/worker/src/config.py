"""Worker configuration from environment variables."""

import os

OPENAI_KEY = (os.getenv("OPEN_AI_API_KEY") or os.getenv("OPENAI_API_KEY", "")).strip()
GEMINI_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("gemini_api_key", "")).strip()


class Config:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    STORAGE_BASE_DIR: str = os.getenv("STORAGE_BASE_DIR", "./uploads")
    POLL_INTERVAL_S: int = int(os.getenv("WORKER_POLL_INTERVAL_S", "2"))
    BATCH_SIZE: int = int(os.getenv("WORKER_BATCH_SIZE", "5"))
    MAX_RETRIES: int = int(os.getenv("WORKER_MAX_RETRIES", "3"))
    MAX_FILE_BYTES: int = int(os.getenv("STORAGE_MAX_FILE_BYTES", "104857600"))
    CHUNK_SIZE_TOKENS: int = int(os.getenv("CHUNK_SIZE_TOKENS", "512"))
    CHUNK_OVERLAP_TOKENS: int = int(os.getenv("CHUNK_OVERLAP_TOKENS", "50"))
    CHUNK_OVERLAP: float = float(os.getenv("CHUNK_OVERLAP", "0.12"))
    CHUNKING_STRATEGY: str = os.getenv("CHUNKING_STRATEGY", "fixed")
    SEMANTIC_SIMILARITY_THRESHOLD: float = float(os.getenv("SEMANTIC_SIMILARITY_THRESHOLD", "0.3"))
    EMBEDDING_DIMENSIONS: int = int(os.getenv("OLLAMA_EMBEDDING_DIMENSIONS", "768"))

    # LLM provider: "openai" or "ollama"
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "openai" if OPENAI_KEY else "ollama")

    # Ollama
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "")
    OLLAMA_CHAT_MODEL: str = os.getenv("OLLAMA_CHAT_MODEL", "qwen3:35b")
    OLLAMA_EMBEDDING_MODEL: str = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

    # OpenAI
    OPENAI_API_KEY: str = OPENAI_KEY
    OPENAI_CHAT_MODEL: str = os.getenv("OPEN_AI_MODEL", "gpt-4o")
    OPENAI_EMBEDDING_MODEL: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    # Gemini
    GEMINI_API_KEY: str = GEMINI_KEY
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # KG Extraction
    KG_LLM_PROVIDER: str = os.getenv(
        "KG_LLM_PROVIDER",
        "gemini" if GEMINI_KEY else "openai",
    )
    KG_MODEL_ID: str = os.getenv(
        "KG_MODEL_ID",
        GEMINI_MODEL if KG_LLM_PROVIDER == "gemini" else OPENAI_CHAT_MODEL,
    )
    KG_SIMILARITY_THRESHOLD: float = float(os.getenv("KG_SIMILARITY_THRESHOLD", "0.90"))
    KG_EXTRACTION_TEMPERATURE: float = float(os.getenv("KG_EXTRACTION_TEMPERATURE", "0.2"))
    KG_MAX_ENTITIES_FOR_RELS: int = int(os.getenv("KG_MAX_ENTITIES_FOR_RELS", "30"))
    KG_CONFIDENCE_THRESHOLD: float = float(os.getenv("KG_CONFIDENCE_THRESHOLD", "0.75"))

    # OCR confidence threshold for triggering OCR on native PDF pages
    OCR_NATIVE_CONFIDENCE_THRESHOLD: float = float(os.getenv("OCR_NATIVE_CONFIDENCE_THRESHOLD", "0.75"))
    # Threshold below which document is flagged for review
    OCR_REVIEW_THRESHOLD: float = float(os.getenv("OCR_REVIEW_THRESHOLD", "0.65"))

    # Metadata extraction
    METADATA_MANDATORY_FIELDS: list = os.getenv("METADATA_MANDATORY_FIELDS", "doc_type,station,sensitivity").split(",")

    # Timeouts
    XLSX_TIMEOUT_S: int = int(os.getenv("XLSX_TIMEOUT_S", "30"))

    # GCS / Storage
    GCS_BUCKET: str = os.getenv("GCS_BUCKET", "")
    GCS_PROJECT_ID: str = os.getenv("GCS_PROJECT_ID", "")

    # Document AI OCR
    DOCUMENT_AI_PROJECT_ID: str = os.getenv("DOCUMENT_AI_PROJECT_ID", "")
    DOCUMENT_AI_PROCESSOR_ID: str = os.getenv("DOCUMENT_AI_PROCESSOR_ID", "")
    DOCUMENT_AI_LOCATION: str = os.getenv("DOCUMENT_AI_LOCATION", "us")
    DOCUMENT_AI_CREDENTIALS_PATH: str = os.getenv(
        "DOCUMENT_AI_CREDENTIALS_PATH",
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS", ""),
    )
    OCR_PARALLEL_PAGES: int = int(os.getenv("OCR_PARALLEL_PAGES", "10"))
    OCR_CONFIDENCE_THRESHOLD: float = float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.7"))
    OCR_PAGE_TIMEOUT_S: int = int(os.getenv("OCR_PAGE_TIMEOUT_S", "120"))

    ALLOWED_MIME_TYPES: set = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/plain",
        "text/markdown",
        "text/csv",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/bmp",
        "image/gif",
        "image/webp",
    }


    @staticmethod
    def validate():
        """Validate required environment variables at startup — fail hard, never silently fallback."""
        required = ["DATABASE_URL"]
        if os.getenv("LLM_PROVIDER", Config.LLM_PROVIDER) == "ollama":
            required.append("OLLAMA_BASE_URL")
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                f"Ensure .env is loaded or variables are exported in your shell."
            )


config = Config()
