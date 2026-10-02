import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { href } from '../app';
import { parseLink, splitFrontmatter } from '../core/note';
import type { Vault } from '../core/vault';

/** Strip what Obsidian hides (comments, block ids) without touching code fences. */
function prepare(raw: string) {
  const { body } = splitFrontmatter(raw);
  return body
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$)/m)
    .map((part, i) => (i % 2 ? part : part.replace(/%%[\s\S]*?%%/g, '').replace(/[ \t]\^[\w-]+[ \t]*$/gm, '')))
    .join('');
}

export function slug(text: string) {
  return 'h-' + text.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Callouts, wikilinks, embeds and ==highlights== as mdast nodes. Code is never rewritten. */
function obsidian() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === 'code' || node.type === 'inlineCode') return;
      if (node.type === 'blockquote') {
        const first = node.children?.[0]?.children?.[0];
        const m = first?.type === 'text' && first.value.match(/^\[!([\w-]+)\]([+-])?[ \t]*([^\n]*)(?:\n|$)/);
        if (m) {
          const kind = m[1].toLowerCase();
          node.data = {
            hName: m[2] ? 'details' : 'aside',
            hProperties: { className: `callout callout-${kind}`, ...(m[2] === '+' ? { open: true } : {}) },
          };
          first.value = first.value.slice(m[0].length);
          node.children.unshift({
            type: 'paragraph',
            data: { hName: m[2] ? 'summary' : 'div', hProperties: { className: 'callout-title' } },
            children: [{ type: 'text', value: m[3] || kind }],
          });
        }
      }
      if (!node.children) return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== 'text') {
          visit(child);
          return [child];
        }
        const value = child.value as string;
        const re = /(!?)\[\[([^\]\n]+)\]\]|==([^=\n]+)==/g;
        const out: any[] = [];
        let at = 0,
          m: RegExpExecArray | null;
        while ((m = re.exec(value))) {
          if (m.index > at) out.push({ type: 'text', value: value.slice(at, m.index) });
          if (m[2]) {
            const l = parseLink(m[2]);
            out.push({
              type: 'link',
              url: (m[1] ? 'embed:' : 'wiki:') + encodeURIComponent(m[2]),
              children: [{ type: 'text', value: l.label || l.target + (l.anchor && !m[1] ? ' › ' + l.anchor : '') }],
            });
          } else out.push({ type: 'emphasis', data: { hName: 'mark' }, children: [{ type: 'text', value: m[3] }] });
          at = m.index + m[0].length;
        }
        if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
        return out.length ? out : [child];
      });
    };
    visit(tree);
  };
}

function useObjectUrl(load: () => Promise<Blob>, key: string) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true,
      made = '';
    load().then(
      (b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      },
      () => alive && setError(true),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);
  return { url, error };
}

function VaultImage({ vault, target, from, size }: { vault: Vault; target: string; from: string; size?: string }) {
  const entry = vault.resolveFile(target, from);
  const { url, error } = useObjectUrl(() => (entry ? vault.image(entry) : Promise.reject()), entry?.sha ?? target);
  if (!entry) return <span className="missing">画像が見つかりません：{target}</span>;
  if (error) return <span className="missing">画像を読み込めませんでした（オフライン？）：{target}</span>;
  const width = size && /^\d+/.test(size) ? Number(size.split('x')[0]) : undefined;
  return url ? <img src={url} alt={target} style={width ? { width, maxWidth: '100%' } : undefined} /> : <span className="img-wait" />;
}

/** External images would tell another server what is being read. Load only on request. */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
  const [on, setOn] = useState(false);
  if (on) return <img src={src} alt={alt} referrerPolicy="no-referrer" />;
  return (
    <button className="ext-img" onClick={() => setOn(true)}>
      外部の画像を読み込む
      <small>{new URL(src, location.href).host}</small>
    </button>
  );
}

const CODE_LABEL: Record<string, string> = {
  dataview: 'Dataview（原文表示）',
  dataviewjs: 'DataviewJS（原文表示）',
  tasks: 'Tasks クエリ（原文表示）',
  mermaid: 'Mermaid（原文表示）',
};

function text(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(text).join('');
  if (children && typeof children === 'object' && 'props' in children) return text((children as any).props.children);
  return '';
}

export function Markdown({ raw, path, vault }: { raw: string; path: string; vault: Vault }) {
  const source = useMemo(() => prepare(raw), [raw]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, obsidian]}
      urlTransform={(url) => (url.startsWith('wiki:') || url.startsWith('embed:') ? url : defaultUrlTransform(url))}
      components={{
        a({ href: url = '', children }) {
          if (url.startsWith('embed:')) {
            const inner = decodeURIComponent(url.slice(6));
            const l = parseLink(inner);
            if (vault.isImage(l.target)) return <VaultImage vault={vault} target={l.target} from={path} size={l.label} />;
            const to = vault.resolve(l.target, path);
            return to ? (
              <a className="wiki embed" href={href.note(to, l.anchor)}>
                ↳ {children}
              </a>
            ) : (
              <span className="wiki unresolved">{children}</span>
            );
          }
          if (url.startsWith('wiki:')) {
            const l = parseLink(decodeURIComponent(url.slice(5)));
            const to = vault.resolve(l.target, path);
            return to ? (
              <a className="wiki" href={href.note(to, l.anchor)}>
                {children}
              </a>
            ) : (
              <span className="wiki unresolved" title="まだないノート">
                {children}
              </span>
            );
          }
          if (!url) return <span>{children}</span>;
          if (url.startsWith('#')) return <a href={href.note(path, url.slice(1))}>{children}</a>;
          return (
            <a href={url} target="_blank" rel="noopener noreferrer" className="external">
              {children}
            </a>
          );
        },
        img({ src = '', alt = '' }) {
          if (/^https?:/i.test(String(src))) return <ExternalImage src={String(src)} alt={alt} />;
          return <VaultImage vault={vault} target={String(src)} from={path} />;
        },
        h1: ({ children }) => <h1 id={slug(text(children))}>{children}</h1>,
        h2: ({ children }) => <h2 id={slug(text(children))}>{children}</h2>,
        h3: ({ children }) => <h3 id={slug(text(children))}>{children}</h3>,
        h4: ({ children }) => <h4 id={slug(text(children))}>{children}</h4>,
        table: ({ children }) => (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        ),
        pre({ children }) {
          const code = (children as any)?.props;
          const lang = /language-([\w-]+)/.exec(code?.className ?? '')?.[1] ?? '';
          return (
            <div className={'code' + (CODE_LABEL[lang] ? ' code-query' : '')}>
              {CODE_LABEL[lang] && <div className="code-label">{CODE_LABEL[lang]}</div>}
              <pre>{children}</pre>
            </div>
          );
        },
        input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly tabIndex={-1} />,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
