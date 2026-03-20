import { Children, isValidElement, useMemo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
  citationMap?: Record<number, number>;
  showInlineCitations?: boolean;
}

function processContent(
  raw: string,
  citationMap?: Record<number, number>,
  showInline?: boolean,
): string {
  if (!showInline) {
    return raw.replace(/\[\d+\]/g, "");
  }
  if (!citationMap) return raw;
  return raw.replace(/\[(\d+)\]/g, (_, n) => {
    const mapped = citationMap[parseInt(n, 10)];
    return mapped ? `[${mapped}]` : "";
  });
}

const CITATION_RE = /\[(\d+)\]/g;

function renderTextWithCitations(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <sup
        key={match.index}
        className="inline-flex items-center justify-center min-w-[1.1rem] h-4 px-0.5 mx-0.5 text-[0.6rem] font-semibold rounded bg-primary-100 text-primary-700 align-super cursor-default"
      >
        {match[1]}
      </sup>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

function renderChildNodes(children: React.ReactNode): React.ReactNode {
  if (!Array.isArray(children)) {
    if (typeof children === "string") {
      return renderTextWithCitations(children);
    }
    return children;
  }
  return children.map((child, i) => {
    if (typeof child === "string") {
      return <span key={i}>{renderTextWithCitations(child)}</span>;
    }
    return child;
  });
}

interface ParsedMarkdownTable {
  headers: ReactNode[];
  rows: ReactNode[][];
}

function isHtmlElement(node: ReactNode, tag: string): node is ReactElement<{ children?: ReactNode }> {
  return isValidElement(node) && node.type === tag;
}

function parseMarkdownTable(children: ReactNode): ParsedMarkdownTable | null {
  const sections = Children.toArray(children);
  if (sections.length === 0) return null;

  const headerSection = sections.find((section) => isHtmlElement(section, "thead"));
  const bodySection = sections.find((section) => isHtmlElement(section, "tbody"));
  if (!headerSection || !bodySection) return null;

  const headerRow = Children.toArray(headerSection.props.children).find((row) =>
    isHtmlElement(row, "tr"),
  );
  if (!headerRow) return null;

  const headers = Children.toArray(headerRow.props.children)
    .filter((cell): cell is ReactElement<{ children?: ReactNode }> => isValidElement(cell))
    .map((cell) => cell.props.children as ReactNode);

  const rows = Children.toArray(bodySection.props.children)
    .filter((row): row is ReactElement<{ children?: ReactNode }> => isHtmlElement(row, "tr"))
    .map((row) =>
      Children.toArray(row.props.children)
        .filter((cell): cell is ReactElement<{ children?: ReactNode }> => isValidElement(cell))
        .map((cell) => cell.props.children as ReactNode),
    );

  if (headers.length === 0 || rows.length === 0) return null;

  return { headers, rows };
}

function isSimpleMarkdownTable(table: ParsedMarkdownTable | null): table is ParsedMarkdownTable {
  return !!table && table.headers.length > 0 && table.headers.length <= 3;
}

export function MarkdownContent({ content, citationMap, showInlineCitations }: MarkdownContentProps) {
  const processed = useMemo(
    () => processContent(content, citationMap, showInlineCitations),
    [content, citationMap, showInlineCitations],
  );

  return (
    <div className="max-w-none text-sm text-skin-base leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        children={processed}
        components={{
          /* ── Headers: bold, progressively larger ── */
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mt-5 mb-2.5 first:mt-0 border-b border-skin pb-1.5">
              {showInlineCitations ? renderChildNodes(children) : children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold mt-4 mb-2 first:mt-0">
              {showInlineCitations ? renderChildNodes(children) : children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-bold mt-3.5 mb-1.5 first:mt-0">
              {showInlineCitations ? renderChildNodes(children) : children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-bold mt-3 mb-1 first:mt-0 uppercase tracking-wide text-skin-muted">
              {showInlineCitations ? renderChildNodes(children) : children}
            </h4>
          ),
          /* ── Body text ── */
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">
              {showInlineCitations ? renderChildNodes(children) : children}
            </p>
          ),
          /* ── Lists ── */
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 leading-relaxed">
              {showInlineCitations ? renderChildNodes(children) : children}
            </li>
          ),
          /* ── Block elements ── */
          blockquote: ({ children }) => (
            <blockquote className="my-3 pl-4 border-l-3 border-primary-400 text-skin-muted italic bg-primary-50/30 py-2 pr-3 rounded-r-md">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-skin" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-skin-base">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          /* ── Tables ── */
          table: ({ children }) => {
            const parsed = parseMarkdownTable(children);

            if (isSimpleMarkdownTable(parsed)) {
              return (
                <div className="my-3">
                  <div className="md:hidden space-y-3">
                    {parsed.rows.map((row, rowIndex) => (
                      <article key={rowIndex} className="rounded-lg border border-skin bg-surface-alt p-3 space-y-2">
                        <dl className="space-y-2">
                          {parsed.headers.map((header, cellIndex) => (
                            <div key={cellIndex} className="space-y-1">
                              <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-skin-muted">
                                {header}
                              </dt>
                              <dd className="text-xs text-skin-base break-words">
                                {row[cellIndex] ?? <span className="text-skin-muted">—</span>}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </article>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto rounded-lg border border-skin">
                    <table className="min-w-full text-xs">{children}</table>
                  </div>
                </div>
              );
            }

            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-skin">
                <table className="min-w-full text-xs">{children}</table>
              </div>
            );
          },
          thead: ({ children }) => (
            <thead className="bg-surface-alt">{children}</thead>
          ),
          th: ({ children }) => (
            <th scope="col" className="px-3 py-2 text-left font-semibold text-skin-base">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-t border-skin">{children}</td>
          ),
          /* ── Code ── */
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="bg-surface-alt px-1.5 py-0.5 rounded text-xs font-mono text-primary-700">{children}</code>
            ) : (
              <pre className="bg-surface-alt p-4 rounded-lg overflow-x-auto text-xs my-3 border border-skin">
                <code className={`font-mono ${className || ""}`}>{children}</code>
              </pre>
            );
          },
          /* ── Links ── */
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline font-medium">
              {children}
            </a>
          ),
        }}
      />
    </div>
  );
}
