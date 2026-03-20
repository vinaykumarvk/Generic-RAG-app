/**
 * Storage factory — reads STORAGE_PROVIDER env var to instantiate the correct backend.
 */

export type { StorageProvider } from "./storage-provider";
export { LocalStorageProvider } from "./local-provider";
export { GcsStorageProvider } from "./gcs-provider";

import type { StorageProvider } from "./storage-provider";
import { LocalStorageProvider } from "./local-provider";
import { GcsStorageProvider } from "./gcs-provider";

export function createStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || "local";

  if (provider === "gcs") {
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      throw new Error("GCS_BUCKET env var is required when STORAGE_PROVIDER=gcs");
    }
    return new GcsStorageProvider(bucket, process.env.GCS_PROJECT_ID);
  }

  const baseDir = process.env.STORAGE_BASE_DIR || "./uploads";
  return new LocalStorageProvider(baseDir);
}
