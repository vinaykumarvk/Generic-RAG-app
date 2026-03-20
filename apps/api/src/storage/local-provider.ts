/**
 * Local filesystem storage provider — for development.
 */

import fs from "node:fs";
import path from "node:path";
import type { StorageProvider } from "./storage-provider";

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async upload(workspaceId: string, docId: string, ext: string, data: Buffer): Promise<{ filePath: string }> {
    const wsDir = path.join(this.baseDir, workspaceId);
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true });
    }
    const filePath = path.join(wsDir, `${docId}${ext}`);
    fs.writeFileSync(filePath, data);
    return { filePath };
  }

  async download(filePath: string): Promise<Buffer> {
    return fs.readFileSync(filePath);
  }

  async delete(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async getSignedUrl(filePath: string): Promise<string> {
    // Local dev: return file:// URL
    return `file://${path.resolve(filePath)}`;
  }
}
