import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassphraseLock, unlock, Key } from '../src/core/lock.ts';
import { SealedStore } from '../src/core/sealed-store.ts';
import { MemoryStore } from '../src/core/storage.ts';
import { MockRemote } from '../src/remote/mock.ts';
import { Vault } from '../src/core/vault.ts';
import { SaveCoordinator } from '../src/core/save.ts';
import { demoVault } from '../src/fixtures/demo.ts';

test('パスフレーズ：正しければ開き、違えば開かない', async () => {
  const { record } = await createPassphraseLock('correct horse battery', 1000);
  assert.ok(await unlock(record, 'correct horse battery'));
  await assert.rejects(unlock(record, 'wrong passphrase!!'), /違います/);
  await assert.rejects(createPassphraseLock('short'), /10文字/);
});

test('端末に置く値は暗号化され、キーにもパスが出ない', async () => {
  const inner = new MemoryStore();
  const key = await Key.fromSecret(crypto.getRandomValues(new Uint8Array(32)));
  const store = new SealedStore(inner, key);
  await store.put('notes', 'github:o/r@main\u000004_Think/読み心地.md', { sha: 's', raw: '秘密の本文' });
  await store.put('images', 'img', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  const dump = JSON.stringify([...inner.data].map(([b, m]) => [b, [...m].map(([k, v]) => [k, Array.from(v as Uint8Array)])]));
  assert.ok(!dump.includes('読み心地') && !dump.includes('04_Think'));
  const bytes = [...inner.data.get('notes')!.values()][0] as Uint8Array;
  assert.ok(!new TextDecoder().decode(bytes).includes('秘密'));
  assert.deepEqual(await store.get('notes', 'github:o/r@main\u000004_Think/読み心地.md'), { sha: 's', raw: '秘密の本文' });
  const img = (await store.get<Blob>('images', 'img'))!;
  assert.equal(img.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await img.arrayBuffer())], [1, 2, 3]);
});

test('別の鍵では読めない', async () => {
  const inner = new MemoryStore();
  const a = new SealedStore(inner, await Key.fromSecret(new Uint8Array(32).fill(1)));
  const b = new SealedStore(inner, await Key.fromSecret(new Uint8Array(32).fill(2)));
  await a.put('drafts', 'k', { body: 'x' });
  assert.equal(await b.get('drafts', 'k'), undefined);
  assert.deepEqual(await b.all('drafts'), []);
});

test('暗号化した保管でも、同期・検索・保存・下書きの復元が通る', async () => {
  const remote = new MockRemote(demoVault);
  const inner = new MemoryStore();
  const key = await Key.fromSecret(new Uint8Array(32).fill(7));
  const store = new SealedStore(inner, key);
  const vault = new Vault(remote, store);
  await vault.sync();
  const again = new Vault(remote, new SealedStore(inner, key));
  await again.loadCache();
  assert.equal(again.search('余白')[0].meta.path, '04_Think/余白の設計.md');
  const saves = new SaveCoordinator(remote, store);
  const f = again.note('04_Think/余白の設計.md')!;
  saves.begin('04_Think/余白の設計.md', { sha: f.sha, raw: f.raw });
  await saves.edit('04_Think/余白の設計.md', f.raw + 'x');
  const reopened = new SaveCoordinator(remote, new SealedStore(inner, key));
  await reopened.load();
  assert.equal(reopened.view('04_Think/余白の設計.md')!.body, f.raw + 'x');
  assert.equal(await reopened.save('04_Think/余白の設計.md'), 'saved');
});
