import { stringify } from 'yaml';
import { splitFrontmatter, type NoteMeta } from './note';

/**
 * Same file Atelier writes (server/clips.ts), so Atelier's clip shelf and the
 * inbox-triage skill's Clips step (grab.py full-text fetch) pick it up as is.
 * The phone only keeps what it was given: URL, title, a note, a quote.
 */
export const CLIPS = '01_Inbox/Clips';

export function clipUrl(value: string) {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  return u.href;
}

/** Same page regardless of #fragment and utm_*. */
export function clipIdentity(value: string) {
  try {
    const u = new URL(value);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    return u.href;
  } catch {
    return value;
  }
}

/** First http(s) URL in pasted text (share sheets often paste "title\nurl"). */
export function findUrl(text: string) {
  const m = text.match(/https?:\/\/[^\s<>"'）」]+/);
  return m ? clipUrl(m[0]) : null;
}

export function newClip(input: { url: string; title?: string; note?: string; excerpt?: string }, now: Date, rand: string) {
  const url = clipUrl(input.url);
  if (!url) throw new Error('http / https の URL を入れてください');
  const iso = now.toISOString();
  const title = (input.title?.trim() || new URL(url).hostname).replace(/[\r\n]+/g, ' ');
  const front = stringify({
    type: 'clip',
    tags: ['clip'],
    status: 'inbox',
    source: url,
    created: iso.slice(0, 10),
    captured_at: iso,
    atelier_clip: true,
    capture_note: input.note?.trim() ?? '',
    captured_via: 'vault-mobile',
  });
  const note = input.note?.trim();
  const excerpt = input.excerpt?.trim();
  const text =
    '---\n' + front + '---\n# ' + title + '\n\n' + url + '\n' + (note ? '\n## メモ\n\n' + note + '\n' : '') + (excerpt ? '\n## 抜粋\n\n' + excerpt + '\n' : '');
  return { path: `${CLIPS}/${iso.replace(/[:.]/g, '-')}_${rand}.md`, text, url };
}

export type ClipInfo = { path: string; title: string; url: string; note: string; created: string; processed: boolean; host: string };

export function readClip(meta: NoteMeta, raw: string): ClipInfo | null {
  if (!meta.path.startsWith(CLIPS + '/') && !meta.tags.includes('clip')) return null;
  const { data, body } = splitFrontmatter(raw);
  const url = clipUrl(String(data.source ?? data.url ?? '')) ?? '';
  let host = '';
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    /* no host */
  }
  const status = String(data.status ?? '');
  return {
    path: meta.path,
    title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() || meta.title,
    url,
    note: typeof data.capture_note === 'string' ? data.capture_note : '',
    created: String(data.captured_at ?? data.created ?? meta.updated ?? ''),
    // Fetched and written up by an agent (seed/sapling/processed) vs. still just a link.
    processed: !['inbox', ''].includes(status) || !!data.fetched_date || !!data.processed_date,
    host,
  };
}
