"""Storage abstraction — GCS or local filesystem."""

import os
import logging
import tempfile
from .config import config

logger = logging.getLogger(__name__)


class StorageClient:
    """Unified storage client that delegates to GCS or local filesystem."""

    def __init__(self):
        self.provider = os.getenv("STORAGE_PROVIDER", "local")
        self._gcs_client = None
        self._gcs_bucket = None

        if self.provider == "gcs":
            try:
                from google.cloud import storage
                self._gcs_client = storage.Client(project=os.getenv("GCS_PROJECT_ID"))
                bucket_name = os.getenv("GCS_BUCKET", "")
                if not bucket_name:
                    raise ValueError("GCS_BUCKET env var required when STORAGE_PROVIDER=gcs")
                self._gcs_bucket = self._gcs_client.bucket(bucket_name)
                logger.info(f"GCS storage initialized: bucket={bucket_name}")
            except ImportError:
                raise ImportError("google-cloud-storage is required for GCS provider")

    def download_to_temp(self, file_path: str) -> str:
        """Download a file to a temporary local path. Caller must clean up."""
        if self.provider == "gcs":
            return self._download_gcs(file_path)
        # Local: file_path is already a local path
        return file_path

    def _download_gcs(self, gcs_path: str) -> str:
        """Download from GCS to a temp file."""
        if not self._gcs_bucket:
            raise RuntimeError("GCS bucket not initialized")

        blob = self._gcs_bucket.blob(gcs_path)
        ext = os.path.splitext(gcs_path)[1]
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        blob.download_to_filename(tmp.name)
        tmp.close()
        logger.info(f"Downloaded gs://{self._gcs_bucket.name}/{gcs_path} to {tmp.name}")
        return tmp.name

    def upload_artifact(
        self,
        doc_id: str,
        artifact_name: str,
        content: bytes,
        content_type: str = "application/json",
    ) -> str:
        """Upload a conversion artifact (JSON, CSV) and return the storage path.

        Artifacts are stored at: artifacts/{doc_id}/{artifact_name}
        Supports both GCS and local storage providers. (FR-005/AC-02)
        """
        path = f"artifacts/{doc_id}/{artifact_name}"

        if self.provider == "gcs":
            return self._upload_artifact_gcs(path, content, content_type)

        return self._upload_artifact_local(path, content)

    def _upload_artifact_gcs(self, path: str, content: bytes, content_type: str) -> str:
        """Upload an artifact to GCS."""
        if not self._gcs_bucket:
            raise RuntimeError("GCS bucket not initialized")

        blob = self._gcs_bucket.blob(path)
        blob.upload_from_string(content, content_type=content_type)
        gcs_uri = f"gs://{self._gcs_bucket.name}/{path}"
        logger.info(f"Uploaded artifact to {gcs_uri}")
        return gcs_uri

    def _upload_artifact_local(self, path: str, content: bytes) -> str:
        """Upload an artifact to local filesystem."""
        base_dir = config.STORAGE_BASE_DIR
        full_path = os.path.join(base_dir, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        with open(full_path, "wb") as f:
            f.write(content)

        logger.info(f"Saved artifact to {full_path}")
        return path

    def cleanup_temp(self, temp_path: str, original_path: str):
        """Clean up temp file if it differs from original (i.e., was downloaded)."""
        if temp_path != original_path and os.path.exists(temp_path):
            os.unlink(temp_path)


storage_client = StorageClient()
