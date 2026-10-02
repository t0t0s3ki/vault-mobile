import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockRemote } from '../src/remote/mock.ts';
import { MemoryStore } from '../src/core/storage.ts';
import { SaveCoordinator } from '../src/core/save.ts';

const NOTE = '---\ntitle: 試し\naliases: [テスト]\n---\n\n本文の一行目\n\n%% コメント %%\n```dataview\nLIST\n```\n';

async function setup(seed: Record<string, string> = { 'a.md': NOTE }) {
  const remote = new MockRemote(seed);
  const store = new MemoryStore();
  const saves = new SaveCoordinator(remote, store);
  await saves.load();
  const open = async (path: string) => {
    const f = (await remote.file(path))!;
    return saves.begin(path, { sha: f.sha, raw: f.text });
  };
  return { remote, store, saves, open };
}

test('通常保存：送った版を確定し、下書きを消す', async () => {
  const { remote, store, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + '追記\n');
  assert.equal((await store.all('drafts')).length, 1, '編集した時点で端末に下書きがある');
  assert.equal(await saves.save('a.md'), 'saved');
  assert.equal(remote.peek('a.md'), NOTE + '追記\n');
  assert.equal((await store.all('drafts')).length, 0);
  assert.equal(saves.view('a.md')!.dirty, false);
});

test('無変更の連打はcommitを増やさない', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'x');
  const results = await Promise.all([saves.save('a.md'), saves.save('a.md'), saves.save('a.md')]);
  assert.deepEqual(results, ['saved', 'unchanged', 'unchanged']);
  assert.equal(remote.commits.length, 1);
});

test('連続保存は順序を保つ', async () => {
  const { remote, saves, open } = await setup();
  remote.delayMs = 5;
  await open('a.md');
  await saves.edit('a.md', NOTE + '1');
  const first = saves.save('a.md');
  await new Promise((r) => setTimeout(r, 1)); // first request is on the wire
  await saves.edit('a.md', NOTE + '12');
  const second = saves.save('a.md');
  assert.deepEqual(await Promise.all([first, second]), ['saved', 'saved']);
  assert.equal(remote.peek('a.md'), NOTE + '12');
  assert.equal(remote.commits.length, 2);
});

test('保存中の追加編集は下書きとして残る', async () => {
  const { remote, store, saves, open } = await setup();
  remote.delayMs = 10;
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  const p = saves.save('a.md');
  await new Promise((r) => setTimeout(r, 2));
  await saves.edit('a.md', NOTE + 'AB');
  assert.equal(await p, 'saved');
  assert.equal(remote.peek('a.md'), NOTE + 'A', '成功応答は送った版だけ');
  const v = saves.view('a.md')!;
  assert.equal(v.dirty, true);
  assert.equal(v.body, NOTE + 'AB');
  assert.equal(v.baseText, NOTE + 'A');
  const [[, stored]] = await store.all<{ body: string }>('drafts');
  assert.equal(stored.body, NOTE + 'AB');
});

test('古いSHA：上書きせず、基準・手元・最新を残す。自動再送しない', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  remote.externalEdit('a.md', NOTE + '別エージェントの追記\n');
  await saves.edit('a.md', NOTE + '手元の追記\n');
  assert.equal(await saves.save('a.md'), 'conflict');
  assert.equal(remote.peek('a.md'), NOTE + '別エージェントの追記\n');
  const v = saves.view('a.md')!;
  assert.equal(v.state, 'conflict');
  assert.equal(v.baseText, NOTE);
  assert.equal(v.body, NOTE + '手元の追記\n');
  assert.equal(v.latest!.text, NOTE + '別エージェントの追記\n');
  assert.equal(await saves.save('a.md'), 'conflict', '解決するまで送らない');
  assert.equal(remote.commits.filter((c) => c.message !== 'external').length, 0);
});

test('解決後も、その後の更新を検査して保存する', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  remote.externalEdit('a.md', NOTE + 'B\n');
  await saves.edit('a.md', NOTE + 'A\n');
  await saves.save('a.md');
  remote.externalEdit('a.md', NOTE + 'B\nC\n');
  assert.equal(await saves.resolve('a.md', NOTE + 'A\nB\n'), 'conflict', '見た版より新しい更新を上書きしない');
  assert.equal(remote.peek('a.md'), NOTE + 'B\nC\n');
  assert.equal(await saves.resolve('a.md', NOTE + 'A\nB\nC\n'), 'saved');
  assert.equal(remote.peek('a.md'), NOTE + 'A\nB\nC\n');
});

test('移動・削除：上書きも再作成もせず、手元の本文を残す', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  remote.remove('a.md');
  await saves.edit('a.md', NOTE + 'A');
  assert.equal(await saves.save('a.md'), 'conflict');
  const v = saves.view('a.md')!;
  assert.equal(v.latest, null);
  assert.equal(v.body, NOTE + 'A');
  assert.equal(remote.peek('a.md'), undefined);
});

test('通信断：送れなかったら成功不明として残し、再試行で確かめてから送る', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  remote.inject('offline');
  assert.equal(await saves.save('a.md'), 'unknown');
  assert.equal(saves.view('a.md')!.state, 'unknown');
  assert.equal(await saves.save('a.md'), 'saved');
  assert.equal(remote.peek('a.md'), NOTE + 'A');
  assert.equal(remote.commits.length, 1);
});

test('保存成功後の応答消失：再試行は再送せず、届いていたことを確認する', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  remote.inject('lost-response');
  assert.equal(await saves.save('a.md'), 'unknown');
  assert.equal(await saves.save('a.md'), 'saved');
  assert.equal(remote.commits.length, 1, '二重commitしない');
  assert.equal(saves.view('a.md')!.dirty, false);
});

test('応答消失のあいだに別の更新が入ったら、再送せず比較に回す', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  remote.inject('offline');
  await saves.save('a.md');
  remote.externalEdit('a.md', NOTE + 'Z');
  assert.equal(await saves.save('a.md'), 'conflict');
  assert.equal(remote.peek('a.md'), NOTE + 'Z');
});

test('ブランチ先頭の競合でファイルが変わっていなければ1回だけ再試行する', async () => {
  const { remote, saves, open } = await setup({ 'a.md': NOTE, 'b.md': 'b' });
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  const put = remote.put.bind(remote);
  let calls = 0;
  remote.put = async (...args) => {
    if (calls++ === 0) {
      const { ConflictError } = await import('../src/remote/types.ts');
      throw new ConflictError();
    }
    return put(...args);
  };
  assert.equal(await saves.save('a.md'), 'saved');
  assert.equal(calls, 2);
});

test('再読込：下書きと基準を復元し、送信中だったものは成功不明として扱う', async () => {
  const { remote, store, saves, open } = await setup();
  remote.delayMs = 20;
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  remote.inject('lost-response');
  void saves.save('a.md');
  await new Promise((r) => setTimeout(r, 5));
  // The app is killed while the request is in flight.
  const reopened = new SaveCoordinator(remote, store);
  await reopened.load();
  const v = reopened.view('a.md')!;
  assert.equal(v.state, 'unknown');
  assert.equal(v.body, NOTE + 'A');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await reopened.save('a.md'), 'saved');
  assert.equal(remote.commits.length, 1);
});

test('別のrepoの下書きは読み込まない（認証し直しても送らない）', async () => {
  const { store, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  const other = new MockRemote({ 'a.md': NOTE }, 'mock:other');
  const elsewhere = new SaveCoordinator(other, store);
  await elsewhere.load();
  assert.equal(elsewhere.view('a.md'), undefined);
  assert.equal(elsewhere.unsaved().length, 0);
});

test('認証切れ：下書きを残し、送っていない扱いに戻す', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  const { AuthError } = await import('../src/remote/types.ts');
  const put = remote.put.bind(remote);
  remote.put = async () => {
    throw new AuthError();
  };
  assert.equal(await saves.save('a.md'), 'auth');
  const v = saves.view('a.md')!;
  assert.equal(v.state, 'editing');
  assert.equal(v.dirty, true);
  remote.put = put;
  assert.equal(await saves.save('a.md'), 'saved');
});

test('端末保存に失敗したら、下書き保存済みと表示しない', async () => {
  const { store, saves, open } = await setup();
  await open('a.md');
  store.failWrites = true;
  await saves.edit('a.md', NOTE + 'A');
  const v = saves.view('a.md')!;
  assert.equal(v.persisted, false);
  assert.ok(v.storageError);
});

test('CRLF・BOMのファイルは元の形のまま保存する', async () => {
  const raw = '﻿---\r\ntitle: x\r\n---\r\n本文\r\n';
  const { remote, saves, open } = await setup({ 'c.md': raw });
  const d = await open('c.md');
  assert.equal(d.body, '---\ntitle: x\n---\n本文\n');
  await saves.edit('c.md', d.body + '追記\n');
  await saves.save('c.md');
  assert.equal(remote.peek('c.md'), '﻿---\r\ntitle: x\r\n---\r\n本文\r\n追記\r\n');
});

test('未知の記法・YAMLはそのまま残る（ソース編集なので再シリアライズしない）', async () => {
  const raw = '---\nweird: &a {x: 1}\nref: *a\n---\n<?claude block s1?>\n> [!note]- 畳み\n> 中身 ^block1\n';
  const { remote, saves, open } = await setup({ 'w.md': raw });
  await open('w.md');
  await saves.edit('w.md', raw.replace('中身', '中身だよ'));
  await saves.save('w.md');
  assert.equal(remote.peek('w.md'), raw.replace('中身', '中身だよ'));
});

test('端末に送信中の印を残せなければ、送らない', async () => {
  const { remote, store, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  store.failWrites = true;
  assert.equal(await saves.save('a.md'), 'storage');
  assert.equal(remote.commits.length, 0);
  assert.equal(saves.view('a.md')!.body, NOTE + 'A');
});

test('版の不一致以外の拒否は競合にせず、下書きを残す', async () => {
  const { remote, saves, open } = await setup();
  await open('a.md');
  await saves.edit('a.md', NOTE + 'A');
  const { RejectedError } = await import('../src/remote/types.ts');
  remote.put = async () => {
    throw new RejectedError();
  };
  assert.equal(await saves.save('a.md'), 'rejected');
  assert.equal(saves.view('a.md')!.state, 'editing');
  assert.equal(saves.view('a.md')!.dirty, true);
});
