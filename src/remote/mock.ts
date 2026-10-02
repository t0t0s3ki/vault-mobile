import { ConflictError, TransportError, type RemoteEntry, type VaultRemote } from './types';

export type Fault = 'offline' | 'lost-response' | 'conflict-race';

function hash(text: string) {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

type Stored = { text?: string; bytes?: Uint8Array; type?: string };

/**
 * In-memory stand-in for a GitHub branch. Faults are queued and consumed by the
 * next write, so tests and the demo panel can reproduce each failure on purpose.
 */
export class MockRemote implements VaultRemote {
  readonly id: string;
  readonly label = 'デモ（ダミーVault）';
  private files = new Map<string, Stored>();
  private blobs = new Map<string, Stored>();
  private faults: Fault[] = [];
  commits: { path: string; message: string }[] = [];
  delayMs = 0;

  constructor(seed: Record<string, string | { bytes: Uint8Array; type: string }>, id = 'mock:demo') {
    this.id = id;
    for (const [path, value] of Object.entries(seed))
      typeof value === 'string' ? this.write(path, value) : this.writeBytes(path, value.bytes, value.type);
  }

  private shaOf(s: Stored) {
    return s.text !== undefined ? hash(s.text) : hash('bin:' + Array.from(s.bytes!).join(','));
  }
  private write(path: string, text: string) {
    const s = { text };
    this.files.set(path, s);
    this.blobs.set(this.shaOf(s), s);
    return this.shaOf(s);
  }
  private writeBytes(path: string, bytes: Uint8Array, type: string) {
    const s = { bytes, type };
    this.files.set(path, s);
    this.blobs.set(this.shaOf(s), s);
  }
  private async wait() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  /** Queue a failure for the next put(). */
  inject(fault: Fault) {
    this.faults.push(fault);
  }
  pendingFaults() {
    return [...this.faults];
  }
  /** Simulate another agent or device changing the branch. */
  externalEdit(path: string, text: string) {
    this.commits.push({ path, message: 'external' });
    return this.write(path, text);
  }
  remove(path: string) {
    this.files.delete(path);
  }
  peek(path: string) {
    return this.files.get(path)?.text;
  }

  async tree() {
    await this.wait();
    const entries: RemoteEntry[] = [...this.files].map(([path, s]) => ({
      path,
      sha: this.shaOf(s),
      size: s.text?.length ?? s.bytes!.length,
    }));
    return { commit: hash(entries.map((e) => e.path + e.sha).join('|')), entries };
  }
  async texts(shas: string[]) {
    await this.wait();
    const out = new Map<string, string>();
    for (const sha of shas) {
      const s = this.blobs.get(sha);
      if (s?.text !== undefined) out.set(sha, s.text);
    }
    return out;
  }
  async bytes(sha: string) {
    await this.wait();
    const s = this.blobs.get(sha);
    if (!s?.bytes) throw new TransportError('画像が見つかりません');
    return new Blob([s.bytes as BlobPart], { type: s.type });
  }
  async file(path: string) {
    await this.wait();
    const s = this.files.get(path);
    return s?.text === undefined ? null : { sha: this.shaOf(s), text: s.text };
  }
  async put(path: string, text: string, baseSha: string, message: string) {
    await this.wait();
    const fault = this.faults.shift();
    if (fault === 'offline') throw new TransportError();
    if (fault === 'conflict-race') this.externalEdit(path, (this.peek(path) ?? '') + '\n（別の端末の追記）\n');
    const current = this.files.get(path);
    // An empty base means "create": it must not exist yet.
    if (baseSha === '' ? current : !current || this.shaOf(current) !== baseSha) throw new ConflictError();
    const sha = this.write(path, text);
    this.commits.push({ path, message });
    if (fault === 'lost-response') throw new TransportError('応答が届きませんでした');
    return { sha };
  }
}
