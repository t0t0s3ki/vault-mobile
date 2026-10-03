import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { href } from '../app';
import { parseLink } from '../core/note';
import { isViewable, type Vault } from '../core/vault';

const blank = (s: string) => s.replace(/[^\n]/g, '');

/**
 * Hide what Obsidian hides (frontmatter, comments, block ids) but keep every
 * line where it was, so a rendered line number points at the same source line.
 */
export function prepare(raw: string) {
  let text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const fm = text.match(/^---\n(?:[\s\S]*?\n)?---(?:\n|$)/);
  if (fm) text = blank(fm[0]) + text.slice(fm[0].length);
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((part, i) => (i % 2 ? part : part.replace(/%%[\s\S]*?%%/g, blank).replace(/[ \t]\^[\w-]+[ \t]*$/gm, '')))
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
  if (error) return <span className="missing">画像はオンラインのときに読み込みます：{target.split('/').pop()}</span>;
  const width = size && /^\d+/.test(size) ? Number(size.split('x')[0]) : undefined;
  return url ? <img src={url} alt={target} style={width ? { width, maxWidth: '100%' } : undefined} /> : <span className="img-wait" />;
}

/** External images would tell another server what is being read. Load only on request. */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
  const [on, setOn] = useState(false);
  if (on) return <img src={src} alt={alt} referrerPolicy="no-referrer" />;
  let host = '';
  try {
    host = new URL(src).host;
  } catch {
    /* shown without host */
  }
  return (
    <button className="ext-img" onClick={() => setOn(true)}>
      外部の画像を読み込む
      <small>{host}</small>
    </button>
  );
}

const CODE_LABEL: Record<string, string> = {
  dataview: 'Dataview — スマホでは原文を表示',
  dataviewjs: 'DataviewJS — スマホでは原文を表示',
  tasks: 'Tasks クエリ — スマホでは原文を表示',
  mermaid: 'Mermaid — スマホでは原文を表示',
  base: 'Bases — スマホでは原文を表示',
};

function text(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(text).join('');
  if (children && typeof children === 'object' && 'props' in children) return text((children as any).props.children);
  return '';
}

export type TaskToggle = (line: number, checked: boolean) => void;

function MarkdownImpl({ raw, path, vault, onTask, pending }: { raw: string; path: string; vault: Vault; onTask?: TaskToggle; pending?: Map<number, boolean> }) {
  const source = useMemo(() => prepare(raw), [raw]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, obsidian]}
      urlTransform={(url) => (url.startsWith('wiki:') || url.startsWith('embed:') ? url : defaultUrlTransform(url))}
      components={{
        a({ href: url = '', children }) {
          if (url.startsWith('embed:')) {
            const l = parseLink(decodeURIComponent(url.slice(6)));
            if (vault.isImage(l.target)) return <VaultImage vault={vault} target={l.target} from={path} size={l.label} />;
            const html = isViewable(l.target) ? vault.resolveFile(l.target, path) : undefined;
            if (html)
              return (
                <a className="wiki embed" href={href.file(html.path)}>
                  {children}
                </a>
              );
            const to = vault.resolve(l.target, path);
            return to ? (
              <a className="wiki embed" href={href.note(to, l.anchor)}>
                {children}
              </a>
            ) : (
              <span className="wiki unresolved">{children}</span>
            );
          }
          if (url.startsWith('wiki:')) {
            const l = parseLink(decodeURIComponent(url.slice(5)));
            const html = isViewable(l.target) ? vault.resolveFile(l.target, path) : undefined;
            if (html)
              return (
                <a className="wiki" href={href.file(html.path)}>
                  {children}
                </a>
              );
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
          // A relative link to an HTML file in the vault ("[資料](report.html)") opens it here.
          if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && isViewable(url.split('#')[0])) {
            const file = vault.resolveFile(url.split('#')[0], path);
            if (file) return <a href={href.file(file.path)}>{children}</a>;
          }
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
        input: () => null,
        li({ node, children, className }) {
          if (!String(className ?? '').includes('task-list-item')) return <li className={className}>{children}</li>;
          const box = (node as any)?.children?.find((c: any) => c.tagName === 'input');
          const line = (node as any)?.position?.start?.line as number | undefined;
          const checked = line !== undefined && pending?.has(line) ? pending.get(line)! : !!box?.properties?.checked;
          return (
            <li className={'task' + (checked ? ' done' : '') + (line !== undefined && pending?.has(line) ? ' busy' : '')}>
              <button
                className="task-box"
                role="checkbox"
                aria-checked={checked}
                aria-label={checked ? '完了を外す' : '完了にする'}
                disabled={!onTask || line === undefined}
                onClick={() => line !== undefined && onTask?.(line, !checked)}
              >
                {checked && (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
              <div className="task-body">{children}</div>
            </li>
          );
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

export const Markdown = memo(MarkdownImpl);

/** Flip `- [ ]` ↔ `- [x]` on one source line. Returns null when that line is not a task. */
export function toggleTaskLine(body: string, line: number, checked: boolean) {
  const lines = body.split('\n');
  const l = lines[line - 1];
  if (l === undefined) return null;
  const m = l.match(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/);
  if (!m) return null;
  lines[line - 1] = m[1] + (checked ? 'x' : ' ') + m[3] + l.slice(m[0].length);
  return lines.join('\n');
}
