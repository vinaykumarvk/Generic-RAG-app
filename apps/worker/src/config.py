"""Worker configuration from environment variables."""

import os

OPENAI_KEY = (os.getenv("OPEN_AI_API_KEY") or os.getenv("OPENAI_API_KEY", "")).strip()
GEMINI_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("gemini_api_key", "")).strip()


def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


class Config:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    STORAGE_BASE_DIR: str = os.getenv("STORAGE_BASE_DIR", "./uploads")
    POLL_INTERVAL_S: int = int(os.getenv("WORKER_POLL_INTERVAL_S", "2"))
    POLLER_THREADS: int = max(1, int(os.getenv("WORKER_POLLER_THREADS", "4")))
    BATCH_SIZE: int = int(os.getenv("WORKER_BATCH_SIZE", "5"))
    MAX_RETRIES: int = int(os.getenv("WORKER_MAX_RETRIES", "3"))
    JOB_LOCK_TIMEOUT_MINUTES: int = max(1, int(os.getenv("WORKER_JOB_LOCK_TIMEOUT_MINUTES", "30")))
    JOB_STALE_REAPER_BATCH_SIZE: int = max(1, int(os.getenv("WORKER_JOB_STALE_REAPER_BATCH_SIZE", "100")))
    DB_POOL_MAXCONN: int = max(5, int(os.getenv("WORKER_DB_POOL_MAXCONN", str(max(5, POLLER_THREADS * 3)))))
    MAX_FILE_BYTES: int = int(os.getenv("STORAGE_MAX_FILE_BYTES", "104857600"))
    PDF_SPLIT_THRESHOLD_BYTES: int = int(os.getenv("PDF_SPLIT_THRESHOLD_BYTES", "20971520"))  # 20 MB, 0 = disabled
    CHUNK_SIZE_TOKENS: int = int(os.getenv("CHUNK_SIZE_TOKENS", "512"))
    CHUNK_OVERLAP_TOKENS: int = int(os.getenv("CHUNK_OVERLAP_TOKENS", "50"))
    CHUNK_OVERLAP: float = float(os.getenv("CHUNK_OVERLAP", "0.12"))
    CHUNKING_STRATEGY: str = os.getenv("CHUNKING_STRATEGY", "fixed")
    SEMANTIC_SIMILARITY_THRESHOLD: float = float(os.getenv("SEMANTIC_SIMILARITY_THRESHOLD", "0.3"))
    EMBEDDING_DIMENSIONS: int = int(os.getenv("OLLAMA_EMBEDDING_DIMENSIONS", "1536"))

    # LLM provider: "openai" or "ollama"
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "openai" if OPENAI_KEY else "ollama")

    # Ollama
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "")
    OLLAMA_CHAT_MODEL: str = os.getenv("OLLAMA_CHAT_MODEL", "qwen3:35b")
    OLLAMA_EMBEDDING_MODEL: str = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

    # OpenAI
    OPENAI_API_KEY: str = OPENAI_KEY
    OPENAI_CHAT_MODEL: str = os.getenv("OPEN_AI_MODEL", "gpt-4o")
    OPENAI_EMBEDDING_MODEL: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")

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
    KG_CONCURRENCY: int = max(1, int(os.getenv("KG_CONCURRENCY", "8")))
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

    # District-court translation
    TRANSLATION_PROVIDER: str = os.getenv("TRANSLATION_PROVIDER", "disabled").strip().lower()
    TRANSLATION_TARGET_LANGUAGE: str = os.getenv("TRANSLATION_TARGET_LANGUAGE", "en").strip().lower()
    TRANSLATION_OPENAI_MODEL: str = os.getenv(
        "TRANSLATION_OPENAI_MODEL",
        os.getenv("TRANSLATION_MODEL", OPENAI_CHAT_MODEL),
    ).strip()
    TRANSLATION_PROJECT_ID: str = os.getenv(
        "TRANSLATION_PROJECT_ID",
        os.getenv("GOOGLE_CLOUD_PROJECT", os.getenv("GCS_PROJECT_ID", "")),
    )
    TRANSLATION_LOCATION: str = os.getenv("TRANSLATION_LOCATION", "global")
    TRANSLATION_MODEL: str = os.getenv("TRANSLATION_MODEL", "")
    TRANSLATION_PROVIDER_VERSION: str = os.getenv("TRANSLATION_PROVIDER_VERSION", "")
    TRANSLATION_GLOSSARY_PATH: str = os.getenv(
        "TRANSLATION_GLOSSARY_PATH",
        "/app/config/legal_translation_glossary.yaml",
    )
    TRANSLATION_GLOSSARY_VERSION: str = os.getenv(
        "TRANSLATION_GLOSSARY_VERSION",
        "district-legal-glossary-v1",
    )
    TRANSLATION_MIN_CONFIDENCE: float = float(os.getenv("TRANSLATION_MIN_CONFIDENCE", "0.70"))
    TRANSLATION_MAX_CHARS_PER_SEGMENT: int = int(os.getenv("TRANSLATION_MAX_CHARS_PER_SEGMENT", "24000"))
    TRANSLATION_BATCH_SIZE: int = int(os.getenv("TRANSLATION_BATCH_SIZE", "8"))
    TRANSLATION_REQUIRED_FOR_NON_ENGLISH: bool = _env_bool("TRANSLATION_REQUIRED_FOR_NON_ENGLISH", "true")
    TRANSLATION_AUTO_APPROVE: bool = _env_bool("TRANSLATION_AUTO_APPROVE", "false")
    INDICTRANS2_URL: str = os.getenv("INDICTRANS2_URL", "")

    # District-court judgment acquisition
    DISTRICT_ACQUISITION_ENABLED: bool = _env_bool("DISTRICT_ACQUISITION_ENABLED", "false")
    DISTRICT_ACQUISITION_THREADS: int = max(1, int(os.getenv("DISTRICT_ACQUISITION_THREADS", "1")))
    DISTRICT_ACQUISITION_POLL_INTERVAL_S: int = int(os.getenv("DISTRICT_ACQUISITION_POLL_INTERVAL_S", "5"))
    DISTRICT_ACQUISITION_LOCK_TIMEOUT_MINUTES: int = max(1, int(os.getenv("DISTRICT_ACQUISITION_LOCK_TIMEOUT_MINUTES", "30")))
    DISTRICT_ACQUISITION_STALE_REAPER_BATCH_SIZE: int = max(1, int(os.getenv("DISTRICT_ACQUISITION_STALE_REAPER_BATCH_SIZE", "100")))
    INDIAN_KANOON_API_TOKEN: str = os.getenv("INDIAN_KANOON_API_TOKEN", "").strip()
    INDIAN_KANOON_BASE_URL: str = os.getenv("INDIAN_KANOON_BASE_URL", "https://api.indiankanoon.org").strip().rstrip("/")
    INDIAN_KANOON_TIMEOUT_S: int = int(os.getenv("INDIAN_KANOON_TIMEOUT_S", "30"))
    ECOURTS_DIRECT_FETCH_ENABLED: bool = _env_bool("ECOURTS_DIRECT_FETCH_ENABLED", "false")
    ECOURTS_DIRECT_PDF_URL_TEMPLATE: str = os.getenv("ECOURTS_DIRECT_PDF_URL_TEMPLATE", "").strip()
    ECOURTS_TIMEOUT_S: int = int(os.getenv("ECOURTS_TIMEOUT_S", "45"))

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
