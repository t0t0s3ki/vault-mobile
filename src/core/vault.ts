import type { RemoteEntry, VaultRemote } from '../remote/types';
import { basename, META_VERSION, noteMeta, outgoing, parseLink, type NoteMeta } from './note';
import type { Store } from './storage';

/** `meta` is derived from `raw` and cached so opening the app does not re-parse every note. */
type Cached = { sha: string; raw: string; meta?: NoteMeta };
const MAX_NOTE_BYTES = 2_000_000;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** Same exclusions as Atelier: other workspaces and build output are not part of the Vault. */
export function included(path: string) {
  const parts = path.split('/');
  return !parts.some((p) => p.startsWith('.') || ['node_modules', 'dist', 'build', '_dev', 'Dev', 'okujo-workspace'].includes(p));
}

/** Files with their own update procedure (Tasks, Work State, generated views). Read here, edit elsewhere. */
export function writable(path: string) {
  return (
    path.endsWith('.md') &&
    !/^(00_Cockpit\/(state|changes|jobs|org_state)\/|00_Cockpit\/(Tasks(?:_.*)?|Done|Delegated|Decisions|active|WorkModel[^/]*)\.|AGENTS\.md$|CLAUDE\.md$|\.claude\/|Views\/)/i.test(path)
  );
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

export type SearchHit = { meta: NoteMeta; score: number; snippet: string };

/**
 * The device-side copy of the branch. Text is cached by blob id, so a resync only
 * downloads what changed. Everything here can be rebuilt from the remote.
 */
export class Vault {
  entries = new Map<string, RemoteEntry>();
  private notes = new Map<string, Cached>();
  metas = new Map<string, NoteMeta>();
  private byName = new Map<string, string[]>();
  private byAlias = new Map<string, string[]>();
  private files = new Map<string, string[]>();
  private links?: Map<string, Set<string>>;
  private lower = new Map<string, string>();
  commit = '';
  syncedAt = 0;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(
    private remote: VaultRemote,
    private store: Store,
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }
  private k(path: string) {
    return this.remote.id + '\u0000' + path;
  }

  async loadCache() {
    const meta = await this.store.get<{ commit: string; syncedAt: number; entries: RemoteEntry[] }>('meta', this.k('tree'));
    if (meta) {
      this.commit = meta.commit;
      this.syncedAt = meta.syncedAt;
      this.entries = new Map(meta.entries.map((e) => [e.path, e]));
    }
    const prefix = this.remote.id + '\u0000';
    for (const [key, v] of await this.store.all<Cached>('notes'))
      if (key.startsWith(prefix)) this.notes.set(key.slice(prefix.length), v);
    this.rebuild();
  }

  /** Pull the branch. Only changed blobs are downloaded. */
  async sync(progress?: (done: number, total: number) => void) {
    const { commit, entries } = await this.remote.tree();
    const kept = entries.filter((e) => included(e.path));
    const md = kept.filter((e) => e.path.endsWith('.md') && e.size <= MAX_NOTE_BYTES);
    const missing = md.filter((e) => this.notes.get(e.path)?.sha !== e.sha);
    const live = new Set(md.map((e) => e.path));
    const gone = [...this.notes.keys()].filter((p) => !live.has(p));
    const total = missing.length;
    progress?.(0, total);
    for (let i = 0; i < missing.length; i += 400) {
      const batch = missing.slice(i, i + 400);
      const texts = await this.remote.texts(batch.map((e) => e.sha));
      const rows: [string, Cached][] = [];
      for (const e of batch) {
        const raw = texts.get(e.sha);
        if (raw === undefined) continue;
        const v = { sha: e.sha, raw, meta: noteMeta(e.path, raw) };
        this.notes.set(e.path, v);
        rows.push([this.k(e.path), v]);
      }
      await this.store.putMany('notes', rows);
      progress?.(Math.min(i + batch.length, total), total);
    }
    for (const p of gone) this.notes.delete(p);
    if (gone.length) await this.store.putMany('notes', [], gone.map((p) => this.k(p)));
    this.entries = new Map(kept.map((e) => [e.path, e]));
    this.commit = commit;
    this.syncedAt = Date.now();
    await this.store.put('meta', this.k('tree'), { commit, syncedAt: this.syncedAt, entries: kept });
    this.rebuild();
    return { downloaded: total, removed: gone.length };
  }

  private rebuild() {
    this.metas.clear();
    this.byName.clear();
    this.byAlias.clear();
    this.files.clear();
    this.lower.clear();
    this.links = undefined;
    const add = (m: Map<string, string[]>, key: string, path: string) => {
      const k = norm(key);
      m.set(k, [...(m.get(k) ?? []), path]);
    };
    for (const [path, v] of this.notes) {
      const meta = v.meta?.path === path && v.meta.v === META_VERSION ? v.meta : noteMeta(path, v.raw);
      this.metas.set(path, meta);
      add(this.byName, meta.name, path);
      meta.aliases.forEach((a) => add(this.byAlias, a, path));
    }
    for (const path of this.entries.keys()) add(this.files, path.split('/').pop()!, path);
    this.emit();
  }

  note(path: string) {
    return this.notes.get(path);
  }

  /** Called after a successful save so the cache reflects the new blob without a full sync. */
  async applySaved(path: string, sha: string, raw: string) {
    const v = { sha, raw, meta: noteMeta(path, raw) };
    this.notes.set(path, v);
    this.entries.set(path, { path, sha, size: raw.length });
    await this.store.put('notes', this.k(path), v);
    this.rebuild();
  }

  /** Re-read one file (after a conflict was settled by taking the latest). */
  async refreshOne(path: string) {
    const f = await this.remote.file(path);
    if (f) return this.applySaved(path, f.sha, f.text);
    this.notes.delete(path);
    this.entries.delete(path);
    await this.store.del('notes', this.k(path));
    this.rebuild();
  }

  /** Obsidian-style resolution: path, then file name, then alias. Ties prefer the linking note's folder. */
  resolve(target: string, from?: string): string | undefined {
    const t = target.replace(/^\.?\//, '').replace(/\.md$/i, '');
    if (!t) return undefined;
    const exact = t + '.md';
    if (this.notes.has(exact)) return exact;
    const pick = (paths: string[] | undefined) => {
      if (!paths?.length) return undefined;
      if (paths.length === 1) return paths[0];
      const dir = from?.slice(0, from.lastIndexOf('/')) ?? '';
      const same = paths.find((p) => p.slice(0, p.lastIndexOf('/')) === dir);
      return same ?? [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    };
    if (t.includes('/')) {
      const suffix = norm('/' + exact);
      const hits = (this.byName.get(norm(basename(t))) ?? []).filter((p) => norm('/' + p).endsWith(suffix));
      if (hits.length) return pick(hits);
    }
    return pick(this.byName.get(norm(basename(t)))) ?? pick(this.byAlias.get(norm(t)));
  }

  /** Embedded files (images): exact path, relative to the note, or by file name anywhere. */
  resolveFile(target: string, from?: string) {
    let t = target;
    try {
      t = decodeURIComponent(target);
    } catch {
      /* a literal % in the file name */
    }
    t = t.replace(/^\.?\//, '');
    if (this.entries.has(t)) return this.entries.get(t);
    const dir = from?.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const rel = dir ? `${dir}/${t}` : t;
    if (this.entries.has(rel)) return this.entries.get(rel);
    const paths = this.files.get(norm(t.split('/').pop()!));
    return paths?.length ? this.entries.get(paths[0]) : undefined;
  }

  isImage(path: string) {
    return IMAGE.test(path);
  }

  async image(entry: RemoteEntry) {
    const key = this.k('img:' + entry.sha);
    const cached = await this.store.get<Blob>('images', key).catch(() => undefined);
    if (cached) return cached;
    const blob = await this.remote.bytes(entry.sha, entry.path);
    await this.store.put('images', key, blob).catch(() => {});
    return blob;
  }

  backlinks(path: string) {
    if (!this.links) {
      this.links = new Map();
      for (const [from, v] of this.notes)
        for (const t of outgoing(v.raw)) {
          const to = this.resolve(t, from);
          if (!to || to === from) continue;
          if (!this.links.has(to)) this.links.set(to, new Set());
          this.links.get(to)!.add(from);
        }
    }
    return [...(this.links.get(path) ?? [])].map((p) => this.metas.get(p)!).filter(Boolean);
  }

  /** Metadata first (title, file name, alias, heading); body text only breaks ties and fills the tail. */
  search(query: string, limit = 60): SearchHit[] {
    const phrase = norm(query.trim()).replace(/\s+/g, ' ');
    if (!phrase) return [];
    const terms = phrase.split(' ');
    const out: SearchHit[] = [];
    for (const meta of this.metas.values()) {
      const title = norm(meta.title),
        name = norm(meta.name),
        aliases = meta.aliases.map(norm),
        heads = norm(meta.headings.join(' '));
      const all = (s: string) => terms.every((t) => s.includes(t));
      let score = 0;
      if (title === phrase || name === phrase) score = 10000;
      else if (aliases.includes(phrase)) score = 9500;
      else if (title.includes(phrase) || name.includes(phrase)) score = 9000;
      else if (aliases.some((a) => a.includes(phrase))) score = 8500;
      else if (all(title + ' ' + name)) score = 8000;
      else if (all(aliases.join(' '))) score = 7000;
      else if (all(norm(meta.tags.map((t) => '#' + t).join(' ')))) score = 5000;
      else if (all(heads)) score = 4000;
      let snippet = '';
      let body = this.lower.get(meta.path);
      if (body === undefined) {
        body = norm(this.notes.get(meta.path)!.raw);
        this.lower.set(meta.path, body);
      }
      const at = body.indexOf(terms[0]);
      if (!score && at >= 0 && all(body)) score = 1000 + Math.min(terms.length * 100, 500);
      if (!score) continue;
      if (at >= 0) {
        const raw = this.notes.get(meta.path)!.raw;
        snippet = raw
          .slice(Math.max(0, at - 30), at + 70)
          .replace(/\s+/g, ' ')
          .trim();
      }
      out.push({ meta, score, snippet });
    }
    return out
      .sort((a, b) => b.score - a.score || b.meta.updated.localeCompare(a.meta.updated) || a.meta.path.localeCompare(b.meta.path))
      .slice(0, limit);
  }

  /** Newest first by declared or file-name date. Logs and procedure-owned files stay out of the way. */
  recent(limit = 12, exclude: string[] = []) {
    return [...this.metas.values()]
      .filter((m) => m.updated && writable(m.path) && !m.path.startsWith('AI_Inbox/') && !exclude.some((x) => m.path.startsWith(x + '/')))
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, limit);
  }

  /** Notes directly in one folder, newest first. */
  latestIn(folder: string, limit = 5) {
    return [...this.metas.values()]
      .filter((m) => m.folder === folder && !m.name.startsWith('_') && m.chars > 0)
      .sort((a, b) => b.updated.localeCompare(a.updated) || b.name.localeCompare(a.name))
      .slice(0, limit);
  }

  /** Immediate children of a folder: sub-folders with note counts, then notes. */
  folder(dir: string) {
    const prefix = dir ? dir + '/' : '';
    const folders = new Map<string, number>();
    const notes: NoteMeta[] = [];
    for (const meta of this.metas.values()) {
      if (!meta.path.startsWith(prefix)) continue;
      const rest = meta.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) notes.push(meta);
      else folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
    }
    return {
      folders: [...folders].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([name, count]) => ({ name, path: prefix + name, count })),
      notes: notes.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name, 'ja')),
    };
  }
}

export { parseLink };
