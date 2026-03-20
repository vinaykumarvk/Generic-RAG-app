/**
 * Google Cloud Storage provider — production file storage.
 * Path pattern: documents/{YYYY}/{MM}/{doc_id}/{filename}
 *
 * Encryption: GCS provides default AES-256-GCM server-side encryption.
 * For customer-managed encryption keys (CMEK), pass kmsKeyName in upload config.
 * See: https://cloud.google.com/storage/docs/encryption (FR-005/AC-04)
 */

import type { StorageProvider } from "./storage-provider";

interface GcsFileLike {
  save(data: Buffer, options: Record<string, unknown>): Promise<unknown>;
  download(): Promise<[Buffer]>;
  delete(): Promise<unknown>;
  getSignedUrl(options: { action: string; expires: number }): Promise<[string]>;
}

interface GcsBucketLike {
  file(path: string): GcsFileLike;
  setMetadata(metadata: Record<string, unknown>): Promise<unknown>;
}

type GcsStorage = { bucket(name: string): GcsBucketLike };

export class GcsStorageProvider implements StorageProvider {
  private bucket: string;
  private storage: GcsStorage | null = null;

  constructor(bucket: string, projectId?: string) {
    this.bucket = bucket;
    // Lazy-load @google-cloud/storage to avoid requiring it when not used
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Storage } = require("@google-cloud/storage");
      this.storage = new Storage({ projectId });
    } catch {
      throw new Error("@google-cloud/storage is required for GCS provider. Install with: npm install @google-cloud/storage");
    }
  }

  private getGcsPath(docId: string, filename: string): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    // FR-005/AC-01: Store under docId subdirectory with original filename
    return `documents/${yyyy}/${mm}/${docId}/${filename}`;
  }

  async upload(workspaceId: string, docId: string, filename: string, data: Buffer, kmsKeyName?: string): Promise<{ filePath: string; gcsUri: string }> {
    if (!this.storage) throw new Error("GCS storage not initialized");

    const gcsPath = `${workspaceId}/${this.getGcsPath(docId, filename)}`;
    const file = this.storage.bucket(this.bucket).file(gcsPath);

    await file.save(data, {
      resumable: false,
      ...(kmsKeyName ? { kmsKeyName } : {}),
      metadata: {
        metadata: {
          workspaceId,
          documentId: docId,
        },
      },
    });

    const gcsUri = `gs://${this.bucket}/${gcsPath}`;
    return { filePath: gcsPath, gcsUri };
  }

  async download(filePath: string): Promise<Buffer> {
    if (!this.storage) throw new Error("GCS storage not initialized");

    const file = this.storage.bucket(this.bucket).file(filePath);
    const [contents] = await file.download();
    return contents;
  }

  async delete(filePath: string): Promise<void> {
    if (!this.storage) throw new Error("GCS storage not initialized");

    const file = this.storage.bucket(this.bucket).file(filePath);
    try {
      await file.delete();
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async getSignedUrl(filePath: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.storage) throw new Error("GCS storage not initialized");

    const file = this.storage.bucket(this.bucket).file(filePath);
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
    });
    return url;
  }

  /**
   * Apply a GCS lifecycle policy to the bucket (FR-005/AC-03).
   *
   * Policy transitions:
   *   Standard  -> Nearline after 90 days
   *   Nearline  -> Coldline after 365 days
   *
   * Usage: apply via `gsutil lifecycle set ops/gcs-lifecycle.json gs://BUCKET`
   * or programmatically with this method.
   */
  async setLifecyclePolicy(): Promise<void> {
    if (!this.storage) throw new Error("GCS storage not initialized");

    const lifecycleRules = [
      {
        action: { type: "SetStorageClass" as const, storageClass: "NEARLINE" },
        condition: { age: 90, matchesStorageClass: ["STANDARD"] },
      },
      {
        action: { type: "SetStorageClass" as const, storageClass: "COLDLINE" },
        condition: { age: 365, matchesStorageClass: ["NEARLINE"] },
      },
    ];

    const bucket = this.storage.bucket(this.bucket);
    await bucket.setMetadata({
      lifecycle: { rule: lifecycleRules },
    });
  }
}
