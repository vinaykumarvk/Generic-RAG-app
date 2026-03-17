import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Packer,
} from "docx";
import type { ReportTemplate } from "./pdf-generator";

export function createDocxGenerator() {
  async function generate(template: ReportTemplate): Promise<Buffer> {
    const children: (Paragraph | Table)[] = [];

    // Header
    if (template.header.department) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: template.header.department, size: 16, color: "666666" })],
      }));
    }

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: template.header.title, bold: true, size: 32 })],
    }));

    if (template.header.subtitle) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: template.header.subtitle, size: 22, color: "444444" })],
      }));
    }

    const metaParts: string[] = [];
    if (template.header.referenceNumber) metaParts.push(`Ref: ${template.header.referenceNumber}`);
    if (template.header.generatedBy) metaParts.push(`By: ${template.header.generatedBy}`);
    if (template.header.generatedAt) metaParts.push(`Date: ${template.header.generatedAt}`);
    if (metaParts.length > 0) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: metaParts.join("  |  "), size: 16, color: "888888" })],
      }));
    }

    children.push(new Paragraph({ children: [] })); // spacer

    // Sections
    for (const section of template.sections) {
      if (section.title) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: section.title, bold: true, size: 24 })],
        }));
      }

      switch (section.type) {
        case "text":
          if (section.content) {
            children.push(new Paragraph({
              children: [new TextRun({ text: section.content, size: 20 })],
            }));
          }
          break;

        case "keyValue":
          if (section.entries) {
            for (const entry of section.entries) {
              children.push(new Paragraph({
                children: [
                  new TextRun({ text: `${entry.label}: `, bold: true, size: 20 }),
                  new TextRun({ text: entry.value, size: 20 }),
                ],
              }));
            }
          }
          break;

        case "table":
          if (section.headers && section.rows) {
            const borderStyle = {
              style: BorderStyle.SINGLE,
              size: 1,
              color: "cccccc",
            };
            const borders = {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            };

            const headerRow = new TableRow({
              children: section.headers.map((h) =>
                new TableCell({
                  borders,
                  width: { size: Math.floor(100 / section.headers!.length), type: WidthType.PERCENTAGE },
                  children: [new Paragraph({
                    children: [new TextRun({ text: h, bold: true, size: 18 })],
                  })],
                })
              ),
            });

            const dataRows = section.rows.map((row) =>
              new TableRow({
                children: row.map((cell) =>
                  new TableCell({
                    borders,
                    children: [new Paragraph({
                      children: [new TextRun({ text: cell || "", size: 18 })],
                    })],
                  })
                ),
              })
            );

            children.push(new Table({
              rows: [headerRow, ...dataRows],
              width: { size: 100, type: WidthType.PERCENTAGE },
            }));
          }
          break;
      }

      children.push(new Paragraph({ children: [] })); // spacer
    }

    // Footer
    if (template.footer?.confidentiality) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: template.footer.confidentiality, size: 14, color: "999999", italics: true })],
      }));
    }

    const doc = new Document({
      sections: [{ children }],
    });

    return await Packer.toBuffer(doc);
  }

  return { generate };
}
