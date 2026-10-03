import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToDiary, diaryLine, diaryPath } from '../src/core/diary.ts';
import { MockRemote } from '../src/remote/mock.ts';
import { MemoryStore } from '../src/core/storage.ts';
import { Vault } from '../src/core/vault.ts';
import { captureDiary, flushDiary } from '../src/ui/diary.ts';

const MONTH = `---
type: note
tags: [life/日記]
created: 2026-10-03
updated: 2026-10-03
---

# 🌿 原料 2026-10

書き方は [[08_Life/09_日記/_原料/README|README]]。関の言葉のまま、要約せずに置く。

## 2026-10-03

- 🫙 「PMOは俺がさぼってるな～。」
`;

test('日記：今日の見出しの最後に、言葉のまま1行で足す', () => {
  const d = new Date('2026-10-03T21:00:00');
  const out = addToDiary(MONTH, d, diaryLine('バスで聴いた曲が\nよかった', '🎵'));
  assert.ok(out.endsWith('- 🫙 「PMOは俺がさぼってるな～。」\n- 🎵 バスで聴いた曲が よかった\n'));
  assert.equal(out.split('## 2026-10-03').length - 1, 1);
});

test('日記：今日の見出しが無ければ足し、他の日の段落は触らない', () => {
  const d = new Date('2026-10-04T08:00:00');
  const out = addToDiary(MONTH, d, diaryLine('朝の空気が冷たい'));
  assert.ok(out.startsWith(MONTH.trimEnd()));
  assert.ok(out.endsWith('\n\n## 2026-10-04\n\n- 朝の空気が冷たい\n'));
});

test('日記：途中の日に足しても、次の日の見出しより前に入る', () => {
  const two = MONTH + '\n## 2026-10-04\n\n- 次の日\n';
  const out = addToDiary(two, new Date('2026-10-03T23:00:00'), '- 追記');
  const i = out.indexOf('- 追記'),
    j = out.indexOf('## 2026-10-04');
  assert.ok(i > 0 && i < j);
});

test('日記：月のファイルが無ければ作り、通信できなければ端末に残して後で送る', async () => {
  const remote = new MockRemote({ 'a.md': 'x' });
  const vault = new Vault(remote, new MemoryStore());
  await vault.sync();
  const ws = { remote, vault, store: new MemoryStore() } as any;
  const path = diaryPath(new Date());
  assert.equal(await captureDiary(ws, '新しい月の最初', '🌏'), 'saved');
  assert.ok(remote.peek(path)!.includes('# 🌿 原料'));
  assert.ok(remote.peek(path)!.includes('- 🌏 新しい月の最初'));

  const file = remote.file.bind(remote);
  remote.file = async () => {
    const { TransportError } = await import('../src/remote/types.ts');
    throw new TransportError();
  };
  assert.equal(await captureDiary(ws, 'トンネルの中', ''), 'queued');
  remote.file = file;
  await flushDiary(ws);
  assert.ok(remote.peek(path)!.includes('- トンネルの中'));
  remote.inject('lost-response');
  await flushDiary(ws);
  assert.equal(remote.peek(path)!.split('- トンネルの中').length - 1, 1, '二重に入らない');
});
