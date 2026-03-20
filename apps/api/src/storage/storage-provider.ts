/**
 * Storage provider interface — abstracts file storage for GCS/local backends.
 */

export interface StorageProvider {
  /** Upload a file to storage. Returns the stored path/URI. */
  upload(workspaceId: string, docId: string, ext: string, data: Buffer): Promise<{ filePath: string; gcsUri?: string }>;

  /** Download a file from storage. */
  download(filePath: string): Promise<Buffer>;

  /** Delete a file from storage. */
  delete(filePath: string): Promise<void>;

  /** Get a signed/presigned URL for temporary access. */
  getSignedUrl(filePath: string, expiresInSeconds?: number): Promise<string>;
}
