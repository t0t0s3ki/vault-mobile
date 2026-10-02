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
};

export function basename(path: string) {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

export function noteMeta(path: string, raw: string): NoteMeta {
  const { data, body } = splitFrontmatter(raw);
  const name = basename(path);
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const updated = String(data.updated ?? data.modified ?? data.created ?? data.date ?? '').slice(0, 19);
  return {
    path,
    name,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    title: typeof data.title === 'string' && data.title ? data.title : h1 && h1.length < 80 ? h1 : name,
    aliases: list(data.aliases),
    tags: list(data.tags).map((t) => t.replace(/^#/, '')),
    updated: /^\d{4}-\d{2}-\d{2}/.test(updated) ? updated : '',
    status: typeof data.status === 'string' ? data.status : '',
    headings: [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim()),
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
