/**
 * MIME type to lucide-react icon mapping for document type display.
 */

import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCode,
  File,
  type LucideIcon,
} from "lucide-react";

const MIME_ICON_MAP: Record<string, LucideIcon> = {
  "application/pdf": FileText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileText,
  "application/msword": FileText,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileSpreadsheet,
  "application/vnd.ms-excel": FileSpreadsheet,
  "text/csv": FileSpreadsheet,
  "text/plain": FileCode,
  "text/markdown": FileCode,
  "image/jpeg": FileImage,
  "image/png": FileImage,
  "image/tiff": FileImage,
  "image/bmp": FileImage,
  "image/gif": FileImage,
  "image/webp": FileImage,
};

const EXT_ICON_MAP: Record<string, LucideIcon> = {
  ".pdf": FileText,
  ".docx": FileText,
  ".doc": FileText,
  ".xlsx": FileSpreadsheet,
  ".xls": FileSpreadsheet,
  ".csv": FileSpreadsheet,
  ".txt": FileCode,
  ".md": FileCode,
  ".jpg": FileImage,
  ".jpeg": FileImage,
  ".png": FileImage,
  ".tiff": FileImage,
  ".bmp": FileImage,
  ".gif": FileImage,
  ".webp": FileImage,
};

export function getDocumentIcon(mimeType?: string, fileName?: string): LucideIcon {
  if (mimeType && MIME_ICON_MAP[mimeType]) {
    return MIME_ICON_MAP[mimeType];
  }
  if (fileName) {
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    if (EXT_ICON_MAP[ext]) return EXT_ICON_MAP[ext];
  }
  return File;
}
