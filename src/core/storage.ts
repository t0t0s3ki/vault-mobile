/** Key-value persistence on the device. IndexedDB in the browser, a Map in tests. */
export type Bucket = 'notes' | 'drafts' | 'meta' | 'positions' | 'images';

export interface Store {
  get<T>(bucket: Bucket, key: string): Promise<T | undefined>;
  put(bucket: Bucket, key: string, value: unknown): Promise<void>;
  del(bucket: Bucket, key: string): Promise<void>;
  all<T>(bucket: Bucket): Promise<[string, T][]>;
  putMany(bucket: Bucket, rows: [string, unknown][], remove?: string[]): Promise<void>;
}

export class MemoryStore implements Store {
  data = new Map<string, Map<string, unknown>>();
  failWrites = false;
  private b(bucket: Bucket) {
    if (!this.data.has(bucket)) this.data.set(bucket, new Map());
    return this.data.get(bucket)!;
  }
  async get<T>(bucket: Bucket, key: string) {
    return structuredClone(this.b(bucket).get(key)) as T | undefined;
  }
  async put(bucket: Bucket, key: string, value: unknown) {
    if (this.failWrites) throw new Error('端末に保存できませんでした');
    this.b(bucket).set(key, structuredClone(value));
  }
  async del(bucket: Bucket, key: string) {
    if (this.failWrites) throw new Error('端末に保存できませんでした');
    this.b(bucket).delete(key);
  }
  async all<T>(bucket: Bucket) {
    return [...this.b(bucket)].map(([k, v]) => [k, structuredClone(v)] as [string, T]);
  }
  async putMany(bucket: Bucket, rows: [string, unknown][], remove: string[] = []) {
    if (this.failWrites) throw new Error('端末に保存できませんでした');
    for (const [k, v] of rows) this.b(bucket).set(k, structuredClone(v));
    for (const k of remove) this.b(bucket).delete(k);
  }
}

const BUCKETS: Bucket[] = ['notes', 'drafts', 'meta', 'positions', 'images'];

export class IdbStore implements Store {
  private db: Promise<IDBDatabase>;
  constructor(name = 'vault-mobile') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => BUCKETS.forEach((b) => req.result.createObjectStore(b));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async tx<T>(bucket: Bucket, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void) {
    const db = await this.db;
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(bucket, mode);
      const req = run(t.objectStore(bucket));
      t.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('端末に保存できませんでした'));
    });
  }
  get<T>(bucket: Bucket, key: string) {
    return this.tx<T | undefined>(bucket, 'readonly', (s) => s.get(key));
  }
  put(bucket: Bucket, key: string, value: unknown) {
    return this.tx<void>(bucket, 'readwrite', (s) => void s.put(value, key));
  }
  del(bucket: Bucket, key: string) {
    return this.tx<void>(bucket, 'readwrite', (s) => void s.delete(key));
  }
  async all<T>(bucket: Bucket) {
    const db = await this.db;
    return new Promise<[string, T][]>((resolve, reject) => {
      const out: [string, T][] = [];
      const req = db.transaction(bucket).objectStore(bucket).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push([String(c.key), c.value as T]);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
  putMany(bucket: Bucket, rows: [string, unknown][], remove: string[] = []) {
    return this.tx<void>(bucket, 'readwrite', (s) => {
      for (const [k, v] of rows) s.put(v, k);
      for (const k of remove) s.delete(k);
    });
  }
}
