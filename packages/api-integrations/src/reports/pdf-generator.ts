import PDFDocument from "pdfkit";

export interface ReportSection {
  type: "text" | "table" | "keyValue";
  title?: string;
  content?: string;
  rows?: string[][];
  headers?: string[];
  entries?: Array<{ label: string; value: string }>;
}

export interface ReportTemplate {
  header: {
    title: string;
    subtitle?: string;
    logoPath?: string;
    department?: string;
    generatedBy?: string;
    generatedAt?: string;
    referenceNumber?: string;
  };
  sections: ReportSection[];
  footer?: {
    text?: string;
    confidentiality?: string;
    pageNumbers?: boolean;
  };
  watermark?: string;
}

export interface PdfGeneratorConfig {
  defaultFont?: string;
  defaultFontSize?: number;
  pageMargins?: { top: number; bottom: number; left: number; right: number };
}

export function createPdfGenerator(config: PdfGeneratorConfig = {}) {
  const {
    defaultFontSize = 10,
    pageMargins = { top: 50, bottom: 50, left: 50, right: 50 },
  } = config;

  function generate(template: ReportTemplate): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "A4",
        margins: pageMargins,
        bufferPages: true,
      });

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      const { header } = template;
      if (header.department) {
        doc.fontSize(8).fillColor("#666666").text(header.department, { align: "center" });
        doc.moveDown(0.3);
      }
      doc.fontSize(18).fillColor("#1a1a1a").text(header.title, { align: "center" });
      if (header.subtitle) {
        doc.fontSize(12).fillColor("#444444").text(header.subtitle, { align: "center" });
      }
      doc.moveDown(0.5);

      if (header.referenceNumber || header.generatedAt || header.generatedBy) {
        doc.fontSize(8).fillColor("#888888");
        const metaParts: string[] = [];
        if (header.referenceNumber) metaParts.push(`Ref: ${header.referenceNumber}`);
        if (header.generatedBy) metaParts.push(`By: ${header.generatedBy}`);
        if (header.generatedAt) metaParts.push(`Date: ${header.generatedAt}`);
        doc.text(metaParts.join("  |  "), { align: "center" });
      }

      doc.moveDown(1);
      doc.moveTo(pageMargins.left, doc.y).lineTo(doc.page.width - pageMargins.right, doc.y).stroke("#cccccc");
      doc.moveDown(1);

      // Watermark
      if (template.watermark) {
        const pages = doc.bufferedPageRange();
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          doc.save();
          doc.fontSize(48).fillColor("#eeeeee").opacity(0.3);
          doc.translate(doc.page.width / 2, doc.page.height / 2);
          doc.rotate(-45, { origin: [0, 0] });
          doc.text(template.watermark, -150, -20, { align: "center" });
          doc.restore();
        }
        // Switch back to the last page for continued content
        doc.switchToPage(pages.start + pages.count - 1);
      }

      // Sections
      for (const section of template.sections) {
        if (section.title) {
          doc.fontSize(13).fillColor("#222222").text(section.title);
          doc.moveDown(0.3);
          doc.moveTo(doc.x, doc.y).lineTo(doc.x + 150, doc.y).stroke("#dddddd");
          doc.moveDown(0.5);
        }

        doc.fontSize(defaultFontSize).fillColor("#333333").opacity(1);

        switch (section.type) {
          case "text":
            if (section.content) {
              doc.text(section.content, { lineGap: 2 });
            }
            break;

          case "keyValue":
            if (section.entries) {
              for (const entry of section.entries) {
                const startY = doc.y;
                doc.font("Helvetica-Bold").text(`${entry.label}:`, pageMargins.left, startY, { continued: false, width: 180 });
                doc.font("Helvetica").text(entry.value, pageMargins.left + 185, startY, { width: doc.page.width - pageMargins.left - pageMargins.right - 185 });
                doc.moveDown(0.2);
              }
            }
            break;

          case "table":
            if (section.headers && section.rows) {
              const colCount = section.headers.length;
              const tableWidth = doc.page.width - pageMargins.left - pageMargins.right;
              const colWidth = tableWidth / colCount;

              // Header row
              doc.font("Helvetica-Bold").fontSize(9);
              const headerY = doc.y;
              doc.rect(pageMargins.left, headerY - 2, tableWidth, 16).fill("#f0f0f0");
              doc.fillColor("#222222");
              for (let c = 0; c < colCount; c++) {
                doc.text(section.headers[c], pageMargins.left + c * colWidth + 4, headerY, { width: colWidth - 8 });
              }
              doc.y = headerY + 16;

              // Data rows
              doc.font("Helvetica").fontSize(defaultFontSize).fillColor("#333333");
              for (const row of section.rows) {
                const rowY = doc.y;
                // Check if we need a new page
                if (rowY > doc.page.height - pageMargins.bottom - 20) {
                  doc.addPage();
                }
                const currentY = doc.y;
                for (let c = 0; c < Math.min(row.length, colCount); c++) {
                  doc.text(row[c] || "", pageMargins.left + c * colWidth + 4, currentY, { width: colWidth - 8 });
                }
                doc.y = currentY + 14;
              }
            }
            break;
        }

        doc.moveDown(1);
      }

      // Footer
      if (template.footer) {
        const pages = doc.bufferedPageRange();
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          const footerY = doc.page.height - pageMargins.bottom + 10;

          if (template.footer.confidentiality) {
            doc.fontSize(7).fillColor("#999999").opacity(1)
              .text(template.footer.confidentiality, pageMargins.left, footerY, { align: "center", width: doc.page.width - pageMargins.left - pageMargins.right });
          }

          if (template.footer.pageNumbers) {
            doc.fontSize(8).fillColor("#888888")
              .text(`Page ${i - pages.start + 1} of ${pages.count}`, pageMargins.left, footerY + 12, { align: "right", width: doc.page.width - pageMargins.left - pageMargins.right });
          }

          if (template.footer.text) {
            doc.fontSize(7).fillColor("#999999")
              .text(template.footer.text, pageMargins.left, footerY + 12, { align: "left", width: doc.page.width - pageMargins.left - pageMargins.right });
          }
        }
      }

      doc.end();
    });
  }

  return { generate };
}
