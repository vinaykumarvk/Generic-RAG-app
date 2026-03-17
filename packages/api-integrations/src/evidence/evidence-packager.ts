import { createHash } from "node:crypto";
import archiver from "archiver";
import { PassThrough } from "node:stream";

export interface EvidenceItem {
  filename: string;
  data: Buffer;
  mimeType: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceManifest {
  caseId: string;
  exportedAt: string;
  exportedBy: string;
  itemCount: number;
  items: Array<{
    filename: string;
    mimeType: string;
    sha256: string;
    sizeBytes: number;
    metadata?: Record<string, unknown>;
  }>;
  manifestHash: string;
}

export function createEvidencePackager() {
  function computeHash(data: Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }

  async function packageEvidence(
    caseId: string,
    exportedBy: string,
    items: EvidenceItem[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const passthrough = new PassThrough();
      passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
      passthrough.on("end", () => resolve(Buffer.concat(chunks)));
      passthrough.on("error", reject);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", reject);
      archive.pipe(passthrough);

      const manifestItems: EvidenceManifest["items"] = [];

      for (const item of items) {
        const hash = computeHash(item.data);
        manifestItems.push({
          filename: item.filename,
          mimeType: item.mimeType,
          sha256: hash,
          sizeBytes: item.data.length,
          metadata: item.metadata,
        });
        archive.append(item.data, { name: `evidence/${item.filename}` });
      }

      const manifestContent: Omit<EvidenceManifest, "manifestHash"> = {
        caseId,
        exportedAt: new Date().toISOString(),
        exportedBy,
        itemCount: items.length,
        items: manifestItems,
      };

      const manifestJson = JSON.stringify(manifestContent, null, 2);
      const manifestHash = computeHash(Buffer.from(manifestJson, "utf-8"));

      const fullManifest: EvidenceManifest = {
        ...manifestContent,
        manifestHash,
      };

      archive.append(JSON.stringify(fullManifest, null, 2), { name: "manifest.json" });

      // Also include a hash list as plain text for easy verification
      const hashList = manifestItems
        .map((item) => `${item.sha256}  evidence/${item.filename}`)
        .join("\n");
      archive.append(hashList + "\n", { name: "SHA256SUMS.txt" });

      archive.finalize();
    });
  }

  function verifyManifest(manifest: EvidenceManifest, items: Map<string, Buffer>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const manifestItem of manifest.items) {
      const data = items.get(manifestItem.filename);
      if (!data) {
        errors.push(`Missing file: ${manifestItem.filename}`);
        continue;
      }
      const actualHash = computeHash(data);
      if (actualHash !== manifestItem.sha256) {
        errors.push(`Hash mismatch for ${manifestItem.filename}: expected ${manifestItem.sha256}, got ${actualHash}`);
      }
      if (data.length !== manifestItem.sizeBytes) {
        errors.push(`Size mismatch for ${manifestItem.filename}: expected ${manifestItem.sizeBytes}, got ${data.length}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  return { packageEvidence, verifyManifest, computeHash };
}
