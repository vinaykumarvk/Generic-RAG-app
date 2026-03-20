interface ExportCitation {
  displayIndex: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
}

/**
 * Generates a formatted HTML document from answer content + citations,
 * opens it in a hidden iframe, and triggers the browser print dialog
 * (which includes "Save as PDF" on all modern browsers).
 */
export function downloadAnswerAsPdf(
  content: string,
  citations: ExportCitation[],
  title?: string,
): void {
  // Strip raw [N] markers and clean up for print
  const cleanContent = content.replace(/\[\d+\]/g, "");

  // Convert basic markdown to HTML (lightweight — handles common patterns)
  const htmlBody = markdownToHtml(cleanContent);

  const referencesHtml = citations.length > 0
    ? `
      <hr />
      <h2>References</h2>
      <ol>
        ${citations.map((c) => `
          <li>
            <strong>${escapeHtml(c.document_title)}</strong>${c.page_number ? `, p.${c.page_number}` : ""}
            <br /><span class="excerpt">${escapeHtml(c.excerpt)}</span>
          </li>
        `).join("")}
      </ol>
    `
    : "";

  const pageTitle = title || "ADS Knowledge Agent — Answer";
  const now = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    @page { margin: 2cm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      max-width: 700px;
      margin: 0 auto;
      padding: 1rem;
    }
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .header h1 { font-size: 16pt; margin: 0 0 0.25rem 0; color: #1e40af; }
    .header .meta { font-size: 9pt; color: #6b7280; }
    h2 { font-size: 14pt; color: #1e40af; margin: 1.5rem 0 0.5rem; }
    h3 { font-size: 12pt; color: #1e40af; margin: 1.25rem 0 0.5rem; }
    h4 { font-size: 11pt; font-weight: 600; margin: 1rem 0 0.4rem; }
    p { margin: 0.5rem 0; }
    ul, ol { margin: 0.5rem 0; padding-left: 1.5rem; }
    li { margin: 0.25rem 0; }
    blockquote {
      border-left: 3px solid #2563eb;
      padding: 0.5rem 1rem;
      margin: 0.75rem 0;
      background: #f0f4ff;
      color: #374151;
      font-style: italic;
    }
    code {
      background: #f3f4f6;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 10pt;
      font-family: "SF Mono", Menlo, Consolas, monospace;
    }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 10pt; }
    th, td { border: 1px solid #d1d5db; padding: 0.4rem 0.75rem; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    hr { border: none; border-top: 1px solid #d1d5db; margin: 1.5rem 0; }
    .excerpt { font-size: 9pt; color: #6b7280; display: block; margin-top: 0.2rem; }
    ol li { margin-bottom: 0.75rem; }
    @media print {
      body { font-size: 10pt; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(pageTitle)}</h1>
    <div class="meta">Exported ${now}</div>
  </div>
  ${htmlBody}
  ${referencesHtml}
</body>
</html>`;

  // Create a hidden iframe, write the HTML, trigger print
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Wait for content to render, then print
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Clean up after dialog closes
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };
  // Fallback for onload not firing in some browsers
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Silently fail
    }
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1000);
  }, 500);
}

interface ConversationMessage {
  role: string;
  content: string;
  citations?: Array<{
    citation_index: number;
    document_title: string;
    page_number: number | null;
    excerpt: string;
  }>;
}

/**
 * Exports a full conversation (all Q&A pairs) as a printable PDF.
 */
export function downloadConversationAsPdf(
  messages: ConversationMessage[],
  title?: string,
): void {
  const pageTitle = title || "ADS Knowledge Agent — Conversation";
  const now = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const qaPairs: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      qaPairs.push(`<div class="question"><strong>Q:</strong> ${escapeHtml(msg.content)}</div>`);
    } else if (msg.role === "assistant") {
      const cleanContent = msg.content.replace(/\[\d+\]/g, "");
      const htmlBody = markdownToHtml(cleanContent);
      let citationsHtml = "";
      if (msg.citations && msg.citations.length > 0) {
        const refs = msg.citations
          .sort((a, b) => a.citation_index - b.citation_index)
          .map((c) => {
            const page = c.page_number ? `, p.${c.page_number}` : "";
            return `<li><strong>${escapeHtml(c.document_title)}</strong>${page}</li>`;
          });
        citationsHtml = `<div class="refs"><strong>References:</strong><ol>${refs.join("")}</ol></div>`;
      }
      qaPairs.push(`<div class="answer"><strong>A:</strong> ${htmlBody}${citationsHtml}</div>`);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    @page { margin: 2cm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11pt; line-height: 1.6; color: #1a1a1a;
      max-width: 700px; margin: 0 auto; padding: 1rem;
    }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 0.75rem; margin-bottom: 1.5rem; }
    .header h1 { font-size: 16pt; margin: 0 0 0.25rem 0; color: #1e40af; }
    .header .meta { font-size: 9pt; color: #6b7280; }
    .question { background: #eff6ff; border-left: 3px solid #2563eb; padding: 0.5rem 1rem; margin: 1rem 0 0.5rem; border-radius: 4px; }
    .answer { margin: 0.5rem 0 1.5rem 0; }
    .refs { font-size: 9pt; color: #6b7280; margin-top: 0.5rem; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; }
    .refs ol { margin: 0.25rem 0 0 1rem; padding: 0; }
    h2 { font-size: 14pt; color: #1e40af; } h3 { font-size: 12pt; color: #1e40af; }
    p { margin: 0.5rem 0; } ul, ol { margin: 0.5rem 0; padding-left: 1.5rem; }
    blockquote { border-left: 3px solid #2563eb; padding: 0.5rem 1rem; background: #f0f4ff; font-style: italic; }
    code { background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 10pt; }
    @media print { body { font-size: 10pt; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(pageTitle)}</h1>
    <div class="meta">Exported ${now} &middot; ${messages.filter(m => m.role === "user").length} questions</div>
  </div>
  ${qaPairs.join("\n")}
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => { document.body.removeChild(iframe); }, 1000);
  };
  setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* noop */ }
    setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1000);
  }, 500);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lightweight markdown → HTML converter for common patterns */
function markdownToHtml(md: string): string {
  let html = md;

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${escapeHtml(code.trim())}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);

  // Headers
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr />");

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Paragraphs — wrap remaining text blocks
  html = html.replace(/^(?!<[a-z])(.*\S.*)$/gm, "<p>$1</p>");

  // Clean up double-wrapped
  html = html.replace(/<p><(h[1-4]|ul|ol|li|blockquote|pre|hr)/g, "<$1");
  html = html.replace(/<\/(h[1-4]|ul|ol|li|blockquote|pre)><\/p>/g, "</$1>");

  return html;
}
