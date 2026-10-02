import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Key, LockRecord } from './core/lock';
import { SaveCoordinator } from './core/save';
import { SealedStore } from './core/sealed-store';
import { IdbStore, type Store } from './core/storage';
import { Vault } from './core/vault';
import { demoVault } from './fixtures/demo';
import { GitHubRemote } from './remote/github';
import { MockRemote } from './remote/mock';
import type { VaultRemote } from './remote/types';

/** Everything that differs per person. Kept sealed on the device, never in the code. */
export type Config = { owner: string; repo: string; branch: string; token: string; projects: string; memos?: string };

/** Where things live in this vault. Defaults follow the PARA layout this app was first built for. */
export type Places = { projects: string; memos: string };
export const DEFAULT_PLACES: Places = { projects: '02_Projects', memos: '01_Inbox/_uniquenote' };

export type Workspace = {
  remote: VaultRemote;
  mock?: MockRemote;
  store: Store;
  vault: Vault;
  saves: SaveCoordinator;
  places: Places;
  /** GitHub mode only. */
  config?: Config;
  key?: Key;
};

export const DB = 'vault-mobile';
export const DEMO_DB = 'vault-mobile-demo';
const MODE = 'vault-mobile.mode';

export function storedMode(): 'demo' | 'github' | undefined {
  try {
    const m = localStorage.getItem(MODE);
    return m === 'demo' || m === 'github' ? m : undefined;
  } catch {
    return undefined;
  }
}
export function setMode(m: 'demo' | 'github' | undefined) {
  try {
    if (m) localStorage.setItem(MODE, m);
    else localStorage.removeItem(MODE);
  } catch {
    /* private mode: the choice is asked again next time */
  }
}

/** The plain store holds only the lock record (credential id, salts, a check value). */
export const plain = () => new IdbStore(DB);
export const readLock = () => plain().get<LockRecord>('meta', 'lock');

async function assemble(remote: VaultRemote, store: Store, places: Places, extra: Partial<Workspace> = {}): Promise<Workspace> {
  const vault = new Vault(remote, store);
  const saves = new SaveCoordinator(remote, store);
  saves.onSaved = (path, sha, raw) => void vault.applySaved(path, sha, raw);
  await vault.loadCache();
  await saves.load();
  return { remote, store, vault, saves, places, ...extra };
}

export function openDemo() {
  const mock = new MockRemote(demoVault);
  mock.delayMs = 250;
  return assemble(mock, new IdbStore(DEMO_DB), DEFAULT_PLACES, { mock });
}

export function remoteFor(config: Config) {
  return new GitHubRemote({ owner: config.owner, repo: config.repo, branch: config.branch }, async () => config.token);
}

export async function openGitHub(key: Key) {
  const store = new SealedStore(plain(), key);
  const config = await store.get<Config>('meta', 'config');
  if (!config) throw new Error('接続設定が見つかりません');
  const places = { projects: config.projects || DEFAULT_PLACES.projects, memos: config.memos || DEFAULT_PLACES.memos };
  return assemble(remoteFor(config), store, places, { config, key });
}

export async function saveConfig(key: Key, record: LockRecord, config: Config) {
  await new SealedStore(plain(), key).put('meta', 'config', config);
  await plain().put('meta', 'lock', record);
  setMode('github');
}

/** Delete everything this app stored on the device. The Vault on GitHub is untouched. */
export async function wipeDevice() {
  setMode(undefined);
  for (const name of [DB, DEMO_DB])
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
}

export function useVersion(source: { subscribe(fn: () => void): () => void; version: number }) {
  return useSyncExternalStore(
    (fn) => source.subscribe(fn),
    () => source.version,
  );
}

export type Route =
  | { name: 'home' }
  | { name: 'search'; q: string }
  | { name: 'shelf'; path: string }
  | { name: 'note'; path: string; anchor: string }
  | { name: 'edit'; path: string }
  | { name: 'settings' }
  | { name: 'new' }
  | { name: 'inbox'; tab: string }
  | { name: 'waiting' }
  | { name: 'read' };

export function parseRoute(hash: string): Route {
  const [head, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const tail = decodeURIComponent(rest.join('/'));
  switch (head) {
    case 'search':
      return { name: 'search', q: tail };
    case 'shelf':
      return { name: 'shelf', path: tail };
    case 'note': {
      const i = tail.indexOf('#');
      return i < 0 ? { name: 'note', path: tail, anchor: '' } : { name: 'note', path: tail.slice(0, i), anchor: tail.slice(i + 1) };
    }
    case 'edit':
      return { name: 'edit', path: tail };
    case 'new':
      return { name: 'new' };
    case 'inbox':
      return { name: 'inbox', tab: tail || 'memo' };
    case 'waiting':
      return { name: 'waiting' };
    case 'read':
      return { name: 'read' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export const href = {
  home: () => '#/',
  search: (q = '') => '#/search/' + encodeURIComponent(q),
  shelf: (path = '') => '#/shelf/' + encodeURIComponent(path),
  note: (path: string, anchor = '') => '#/note/' + encodeURIComponent(path + (anchor ? '#' + anchor : '')),
  edit: (path: string) => '#/edit/' + encodeURIComponent(path),
  settings: () => '#/settings',
  inbox: (tab = '') => '#/inbox/' + tab,
  waiting: () => '#/waiting',
  read: () => '#/read',
};

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export type Position = { ratio: number; at: number };
