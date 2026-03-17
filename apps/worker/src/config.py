"""Worker configuration from environment variables."""

import os


class Config:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgres://intellirag:intellirag@localhost:5432/intellirag")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_EMBEDDING_MODEL: str = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
    STORAGE_BASE_DIR: str = os.getenv("STORAGE_BASE_DIR", "./uploads")
    POLL_INTERVAL_S: int = int(os.getenv("WORKER_POLL_INTERVAL_S", "2"))
    BATCH_SIZE: int = int(os.getenv("WORKER_BATCH_SIZE", "5"))
    MAX_RETRIES: int = int(os.getenv("WORKER_MAX_RETRIES", "3"))
    MAX_FILE_BYTES: int = int(os.getenv("STORAGE_MAX_FILE_BYTES", "52428800"))
    CHUNK_SIZE_TOKENS: int = int(os.getenv("CHUNK_SIZE_TOKENS", "700"))
    CHUNK_OVERLAP: float = float(os.getenv("CHUNK_OVERLAP", "0.12"))
    EMBEDDING_DIMENSIONS: int = int(os.getenv("OLLAMA_EMBEDDING_DIMENSIONS", "768"))

    ALLOWED_MIME_TYPES: set = {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "text/markdown",
        "text/csv",
    }


config = Config()
