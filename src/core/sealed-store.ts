import type { Key } from './lock';
import type { Bucket, Store } from './storage';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Encrypts every value and hashes every key before it reaches IndexedDB.
 * Record layout: [4-byte JSON length][JSON {k, v | blob}][blob bytes].
 */
export class SealedStore implements Store {
  constructor(
    private inner: Store,
    private key: Key,
  ) {}

  private async pack(k: string, v: unknown) {
    const blob = v instanceof Blob ? v : undefined;
    const head = enc.encode(JSON.stringify(blob ? { k, blob: blob.type } : { k, v }));
    const tail = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
    const out = new Uint8Array(4 + head.length + tail.length);
    new DataView(out.buffer).setUint32(0, head.length);
    out.set(head, 4);
    out.set(tail, 4 + head.length);
    return this.key.seal(out);
  }
  private async unpack(sealed: Uint8Array): Promise<[string, unknown]> {
    const raw = await this.key.open(sealed);
    const n = new DataView(raw.buffer, raw.byteOffset).getUint32(0);
    const head = JSON.parse(dec.decode(raw.subarray(4, 4 + n))) as { k: string; v?: unknown; blob?: string };
    if (head.blob !== undefined) return [head.k, new Blob([raw.slice(4 + n) as BlobPart], { type: head.blob })];
    return [head.k, head.v];
  }
  private tag(bucket: Bucket, k: string) {
    return this.key.tag(bucket + '\u0000' + k);
  }

  async get<T>(bucket: Bucket, k: string) {
    const sealed = await this.inner.get<Uint8Array>(bucket, await this.tag(bucket, k));
    if (!sealed) return undefined;
    const [kk, v] = await this.unpack(sealed);
    return kk === k ? (v as T) : undefined;
  }
  async put(bucket: Bucket, k: string, v: unknown) {
    await this.inner.put(bucket, await this.tag(bucket, k), await this.pack(k, v));
  }
  async del(bucket: Bucket, k: string) {
    await this.inner.del(bucket, await this.tag(bucket, k));
  }
  async all<T>(bucket: Bucket) {
    const rows = await this.inner.all<Uint8Array>(bucket);
    const out: [string, T][] = [];
    for (const [, sealed] of rows) {
      try {
        out.push((await this.unpack(sealed)) as [string, T]);
      } catch {
        // A record sealed with another key (e.g. after re-creating the lock) is unreadable; skip it.
      }
    }
    return out;
  }
  async putMany(bucket: Bucket, rows: [string, unknown][], remove: string[] = []) {
    const packed: [string, unknown][] = [];
    for (const [k, v] of rows) packed.push([await this.tag(bucket, k), await this.pack(k, v)]);
    const gone = await Promise.all(remove.map((k) => this.tag(bucket, k)));
    await this.inner.putMany(bucket, packed, gone);
  }
}
