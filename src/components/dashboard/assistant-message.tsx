import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, ArrowUpRight, Check, Copy, FileText, Sparkles } from 'lucide-react';

/** Plain text of a React node (used to decide whether a table cell is a number). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

const NUMERIC = /^(KES\s*)?[-+]?[\d,]+(\.\d+)?\s*(%|M|B|KES)?$/i;

/**
 * "- **Label:** value" bullets become a two-column row (label | value), which is how the
 * assistant lays out the facts of a cluster. Other bullets stay normal list items.
 */
function ListItem({ children }: { children?: ReactNode }) {
  const parts = Children.toArray(children);
  const first = parts[0];
  // Plain elements keep their tag name as the element type; custom ones carry it on the hast "node"
  const tagOf = (el: unknown): string | undefined => {
    if (!isValidElement<{ node?: { tagName?: string } }>(el)) return undefined;
    return typeof el.type === 'string' ? el.type : el.props.node?.tagName;
  };
  const isStrong = tagOf(first) === 'strong';
  const hasNestedList = parts.some((p) => ['ul', 'ol'].includes(tagOf(p) ?? ''));
  if (isStrong && !hasNestedList) {
    const label = textOf((first as { props: { children?: ReactNode } }).props.children).replace(/:\s*$/, '');
    const rest = parts.slice(1);
    if (typeof rest[0] === 'string') rest[0] = rest[0].replace(/^\s*:?\s*/, '');
    if (label && label.length <= 60) {
      return (
        <li className="ai-kv">
          <span className="ai-k">{label}</span>
          <span className="ai-v">{rest}</span>
        </li>
      );
    }
  }
  return <li>{children}</li>;
}

const components: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
  h4: ({ children }) => <h3>{children}</h3>,
  hr: () => null,
  img: () => null,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  li: ({ children }) => <ListItem>{children}</ListItem>,
  table: ({ children }) => (
    <div className="ai-table-wrap">
      <table>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={NUMERIC.test(textOf(children).trim()) ? 'num' : undefined}>{children}</th>,
  td: ({ children }) => <td className={NUMERIC.test(textOf(children).trim()) ? 'num' : undefined}>{children}</td>,
};

export function AssistantMessage({
  content, sources = [], error = false, onSelect,
}: {
  content: string;
  sources?: string[] | undefined;
  error?: boolean | undefined;
  onSelect: (applicationNumber: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: ignore */
    }
  }

  return (
    <article className={`ai-card ${error ? 'ai-card-error' : ''}`}>
      <header className="ai-card-head">
        <span className="ai-avatar" aria-hidden="true">
          {error ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
        </span>
        <strong>{error ? 'Assistant unavailable' : 'KJET Assistant'}</strong>
        {!error && (
          <button type="button" className="ai-copy" onClick={copy} aria-label="Copy answer" title="Copy answer">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}
      </header>

      <div className="ai-md">
        {error ? <p>{content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>}
      </div>

      {sources.length > 0 && (
        <footer className="ai-sources">
          <span className="ai-sources-label">
            <FileText size={12} />
            {sources.length === 1 ? 'Source' : `${sources.length} sources`}
          </span>
          <div className="ai-chips">
            {sources.slice(0, 12).map((s) => (
              <button key={s} type="button" className="ai-chip" onClick={() => onSelect(s)} title="Open cluster profile">
                {s}
                <ArrowUpRight size={11} />
              </button>
            ))}
            {sources.length > 12 && <span className="ai-more">+{sources.length - 12} more</span>}
          </div>
        </footer>
      )}
    </article>
  );
}
