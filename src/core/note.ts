import { parse } from 'yaml';

/** Split frontmatter without rewriting it. A broken block is reported, not "fixed". */
export function splitFrontmatter(raw: string) {
  const text = raw.replace(/^﻿/, '');
  const m = text.match(/^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/);
  if (!m) return { yaml: '', data: {} as Record<string, unknown>, body: text, error: /^---\r?\n/.test(text) ? 'プロパティの終端（---）がありません' : undefined };
  try {
    const data = parse(m[1], { logLevel: 'error' }) ?? {};
    return { yaml: m[1], data: typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: text.slice(m[0].length) };
  } catch (e) {
    return { yaml: m[1], data: {}, body: text.slice(m[0].length), error: 'YAMLを読めませんでした：' + (e as Error).message.split('\n')[0] };
  }
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);

export type NoteMeta = {
  path: string;
  name: string;
  folder: string;
  title: string;
  aliases: string[];
  tags: string[];
  updated: string;
  status: string;
  headings: string[];
  /** First lines of prose, for list previews. */
  excerpt: string;
  /** Body length in characters, for reading time. */
  chars: number;
  v: number;
};

export const META_VERSION = 5;

/** Plain text of the first paragraphs: no markup, links reduced to their label. */
export function excerptOf(body: string, max = 90) {
  const out: string[] = [];
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    const t = line.trim();
    if (fence || !t || /^(#|\||---|<|!\[\[|%%|\[!|>\s*\[!)/.test(t)) continue;
    out.push(
      t
        .replace(/^>\s?/, '')
        .replace(/^([-*+]|\d+\.)\s+(\[.\]\s+)?/, '')
        .replace(/!?\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a.split('#')[0])
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`=~]|%%.*?%%/g, ''),
    );
    if (out.join(' ').length >= max) break;
  }
  const s = out.join(' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function basename(path: string) {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

/** 202609251123 / 20260925 / 2026-09-25… at the start of a file name. */
export function dateFromName(name: string) {
  const m = name.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[_T-]?(\d{2})(\d{2}))?/);
  if (!m || Number(m[2]) > 12 || Number(m[3]) > 31) return '';
  return `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? `T${m[4]}:${m[5]}` : '');
}

/** A memo's first line as a title: up to the first sentence break, at most about one line on a phone. */
function memoTitle(first: string) {
  const cut = first.search(/[。：:？?！!]/);
  if (cut > 0 && cut <= 30) return first.slice(0, cut);
  return first.length > 28 ? first.slice(0, 28) + '…' : first;
}

export function noteMeta(path: string, raw: string): NoteMeta {
  const { data, body } = splitFrontmatter(raw);
  const name = basename(path);
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const declared = String(data.updated ?? data.modified ?? data.created ?? data.date ?? '').slice(0, 19);
  const updated = /^\d{4}-\d{2}-\d{2}/.test(declared) ? declared : dateFromName(name);
  // Unique-note names are timestamps; the first line says what the memo is about.
  const stamp = /^\d{8,14}$/.test(name);
  const first = body
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim())
    .find((l) => l && !l.startsWith('```'));
  return {
    path,
    name,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    title:
      typeof data.title === 'string' && data.title
        ? data.title
        : h1 && h1.length < 80
          ? h1
          : stamp && first
            ? memoTitle(first)
            : name,
    aliases: list(data.aliases),
    tags: list(data.tags).map((t) => t.replace(/^#/, '')),
    updated,
    status: typeof data.status === 'string' ? data.status : '',
    headings: [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim()),
    // When the first line became the title, the preview starts after it.
    excerpt: excerptOf(stamp && first && !h1 && !data.title ? body.slice(body.indexOf(first) + first.length) : body),
    chars: body.length,
    v: META_VERSION,
  };
}

/** `[[target#heading|label]]` → parts. `^block` refs keep the note and drop the anchor. */
export function parseLink(inner: string) {
  const [dest, label] = inner.split('|');
  const [target, anchor = ''] = dest.split('#');
  return { target: target.trim(), anchor: anchor.replace(/^\^/, '').trim(), label: (label ?? '').trim() };
}

/** Wikilink targets in the body, ignoring code and comments. */
export function outgoing(raw: string): string[] {
  const body = splitFrontmatter(raw)
    .body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, '');
  const out = new Set<string>();
  for (const m of body.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const t = parseLink(m[1]).target;
    if (t) out.add(t);
  }
  return [...out];
}
