import { AuthError, ConflictError, RejectedError, TransportError, type VaultRemote } from '../remote/types';
import type { Store } from './storage';
import { fromEditable, toEditable, type TextShape } from './text';

/**
 * editing  — local text may differ from the base; nothing in flight
 * saving   — `pending` is on the wire
 * unknown  — `pending` was sent but we do not know whether it landed
 * conflict — the remote moved away from `baseSha`; a person must decide
 */
export type SaveState = 'editing' | 'saving' | 'unknown' | 'conflict';

export type Draft = {
  remote: string;
  path: string;
  /** The version this edit started from. Every write is compare-and-swap on it. */
  baseSha: string;
  baseText: string;
  shape: TextShape;
  body: string;
  updatedAt: number;
  state: SaveState;
  pending?: { body: string; baseSha: string };
  /** On conflict: what the remote holds now. null means the file was deleted or moved. */
  latest?: { sha: string; text: string } | null;
  error?: string;
  savedAt?: number;
  /** Made by a one-tap capture (memo, clip, request): sending it is what was asked, so it is re-sent on its own. */
  capture?: boolean;
};

export type DraftView = Draft & { dirty: boolean; persisted: boolean; storageError?: string };
export type SaveResult = 'saved' | 'unchanged' | 'conflict' | 'unknown' | 'auth' | 'rejected' | 'storage' | 'none';

const SEP = '\u0000';

/** A new file has the empty base: it is "still at base" while it does not exist. */
const atBase = (latest: { sha: string } | null, base: string) => (latest ? latest.sha === base : base === '');

export class SaveCoordinator {
  private sessions = new Map<string, Draft>();
  private persisted = new Map<string, boolean>();
  private storageErrors = new Map<string, string>();
  private chains = new Map<string, Promise<unknown>>();
  private writes = new Map<string, Promise<boolean>>();
  private seq = new Map<string, number>();
  private listeners = new Set<() => void>();
  version = 0;
  onSaved?: (path: string, sha: string, raw: string) => void;

  constructor(
    private remote: VaultRemote,
    private store: Store,
    private now = () => Date.now(),
  ) {}

  private key(path: string) {
    return this.remote.id + SEP + path;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Restore drafts of this remote only; drafts bound to another repo/account are never sent here. */
  async load() {
    for (const [key, d] of await this.store.all<Draft>('drafts')) {
      if (!key.startsWith(this.remote.id + SEP) || d.remote !== this.remote.id) continue;
      // A write that was in flight when the app closed has an unknown outcome.
      if (d.state === 'saving') d.state = 'unknown';
      this.sessions.set(d.path, d);
      this.persisted.set(d.path, true);
    }
    this.emit();
  }

  private clean(d: Draft) {
    return d.state === 'editing' && !d.pending && d.body === d.baseText;
  }

  /**
   * Persist or forget the session on the device. Writes for one path stay ordered,
   * and only the latest call may report "persisted". Resolves false when storage failed.
   */
  private persist(path: string): Promise<boolean> {
    const d = this.sessions.get(path);
    if (!d) return Promise.resolve(true);
    const n = (this.seq.get(path) ?? 0) + 1;
    this.seq.set(path, n);
    this.persisted.set(path, false);
    const snapshot = structuredClone(d);
    const remove = this.clean(d);
    const prev = this.writes.get(path) ?? Promise.resolve(true);
    const next = prev
      .then(() => (remove ? this.store.del('drafts', this.key(path)) : this.store.put('drafts', this.key(path), snapshot)))
      .then(
        () => {
          if (this.seq.get(path) === n && this.sessions.get(path) === d) {
            this.persisted.set(path, true);
            this.storageErrors.delete(path);
          }
          return true;
        },
        (e: unknown) => {
          this.persisted.set(path, false);
          this.storageErrors.set(path, e instanceof Error ? e.message : String(e));
          return false;
        },
      )
      .finally(() => this.emit());
    this.writes.set(path, next);
    return next;
  }

  /** Start (or resume) editing from the cached version of a file. */
  begin(path: string, base: { sha: string; raw: string }, opts: { capture?: boolean } = {}) {
    const existing = this.sessions.get(path);
    if (existing) return existing;
    const { body, shape } = toEditable(base.raw);
    const d: Draft = { remote: this.remote.id, path, baseSha: base.sha, baseText: body, shape, body, updatedAt: this.now(), state: 'editing', ...(opts.capture ? { capture: true } : {}) };
    this.sessions.set(path, d);
    this.persisted.set(path, true);
    this.emit();
    return d;
  }

  view(path: string): DraftView | undefined {
    const d = this.sessions.get(path);
    if (!d) return undefined;
    return { ...d, dirty: !this.clean(d), persisted: this.persisted.get(path) ?? false, storageError: this.storageErrors.get(path) };
  }
  /** Drafts that still hold something the remote does not have. */
  unsaved() {
    return [...this.sessions.values()].filter((d) => !this.clean(d)).map((d) => this.view(d.path)!);
  }

  edit(path: string, body: string) {
    const d = this.sessions.get(path);
    if (!d || d.state === 'conflict' || d.body === body) return Promise.resolve();
    d.body = body;
    d.updatedAt = this.now();
    this.emit();
    return this.persist(path);
  }

  /** Close an editor without changes. Dirty sessions stay as drafts. */
  close(path: string) {
    const d = this.sessions.get(path);
    if (d && this.clean(d)) {
      this.sessions.delete(path);
      this.persisted.delete(path);
      this.emit();
    }
  }

  /** Throw away local changes (and any conflict) for this file. */
  async discard(path: string) {
    await this.chains.get(path);
    this.sessions.delete(path);
    this.persisted.delete(path);
    this.storageErrors.delete(path);
    await this.writes.get(path);
    await this.store.del('drafts', this.key(path)).catch(() => {});
    this.emit();
  }

  /** Saves for one path run strictly one after another. */
  save(path: string): Promise<SaveResult> {
    const prev = this.chains.get(path) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.run(path));
    this.chains.set(path, next);
    return next;
  }

  /**
   * After a conflict the person decides the text. The new base is the version they
   * looked at, so a further change elsewhere is caught again instead of overwritten.
   */
  async resolve(path: string, body: string) {
    const d = this.sessions.get(path);
    if (!d || d.state !== 'conflict' || !d.latest) return 'none' as const;
    d.baseSha = d.latest.sha;
    d.baseText = d.latest.text;
    d.body = body;
    d.latest = undefined;
    d.error = undefined;
    d.state = 'editing';
    d.updatedAt = this.now();
    await this.persist(path);
    return this.save(path);
  }

  private async fail(d: Draft, state: SaveState, error?: string) {
    d.state = state;
    d.error = error;
    await this.persist(d.path);
  }

  private async confirm(d: Draft, sent: string, sha: string) {
    d.baseSha = sha;
    d.baseText = sent;
    d.pending = undefined;
    d.error = undefined;
    d.state = 'editing';
    d.savedAt = this.now();
    this.onSaved?.(d.path, sha, fromEditable(sent, d.shape));
    await this.persist(d.path);
  }

  private async toConflict(d: Draft, latest: { sha: string; text: string } | null) {
    d.pending = undefined;
    d.latest = latest ? { sha: latest.sha, text: toEditable(latest.text).body } : null;
    await this.fail(d, 'conflict', latest ? 'ほかの場所で更新されています' : 'ファイルが移動または削除されています');
  }

  /** Find out whether a write with an unknown outcome landed. Read-only. */
  private async verify(d: Draft): Promise<SaveResult | 'continue'> {
    const p = d.pending;
    if (!p) return 'continue';
    let latest;
    try {
      latest = await this.remote.file(d.path);
    } catch (e) {
      await this.fail(d, 'unknown', e instanceof Error ? e.message : String(e));
      return e instanceof AuthError ? 'auth' : 'unknown';
    }
    if (latest && latest.text === fromEditable(p.body, d.shape)) {
      await this.confirm(d, p.body, latest.sha);
      return 'continue';
    }
    if (atBase(latest, p.baseSha)) {
      d.pending = undefined;
      d.state = 'editing';
      return 'continue';
    }
    await this.toConflict(d, latest);
    return 'conflict';
  }

  private async run(path: string): Promise<SaveResult> {
    const d = this.sessions.get(path);
    if (!d) return 'none';
    if (d.state === 'conflict') return 'conflict';
    if (d.state === 'unknown') {
      const before = d.savedAt;
      const r = await this.verify(d);
      if (r !== 'continue') return r;
      if (d.body === d.baseText) {
        await this.persist(path);
        return d.savedAt !== before ? 'saved' : 'unchanged';
      }
    }
    if (d.body === d.baseText) return 'unchanged';

    const sent = d.body;
    const base = d.baseSha;
    const raw = fromEditable(sent, d.shape);
    d.state = 'saving';
    d.pending = { body: sent, baseSha: base };
    d.error = undefined;
    // Without a stored in-flight marker a reload could not tell that this write may have landed.
    if (!(await this.persist(path))) {
      d.state = 'editing';
      d.pending = undefined;
      d.error = '端末に保存できないため送信を止めました';
      this.emit();
      return 'storage';
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.remote.put(path, raw, base, `mobile: ${path}`);
        await this.confirm(d, sent, r.sha);
        return 'saved';
      } catch (e) {
        if (e instanceof ConflictError) {
          let latest;
          try {
            latest = await this.remote.file(path);
          } catch (inner) {
            await this.fail(d, 'unknown', inner instanceof Error ? inner.message : String(inner));
            return 'unknown';
          }
          // The branch head moved but this file did not: the swap is still safe to retry once.
          if (atBase(latest, base) && attempt === 0) continue;
          if (latest && latest.text === raw) {
            await this.confirm(d, sent, latest.sha);
            return 'saved';
          }
          await this.toConflict(d, latest);
          return 'conflict';
        }
        if (e instanceof AuthError || e instanceof RejectedError) {
          d.pending = undefined;
          await this.fail(d, 'editing', e.message);
          return e instanceof AuthError ? 'auth' : 'rejected';
        }
        await this.fail(d, 'unknown', e instanceof TransportError ? e.message : String(e));
        return 'unknown';
      }
    }
  }
}
