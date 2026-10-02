import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, toggleTaskLine } from '../src/ui/Markdown.tsx';
import { dateFromName, noteMeta } from '../src/core/note.ts';

test('表示用の下ごしらえは行の位置を変えない（チェックの行番号が原文と一致する）', () => {
  const raw = '---\ntitle: x\n---\n# 見出し\n%% 二行の\nコメント %%\n- [ ] やる ^blk\n';
  const out = prepare(raw);
  assert.equal(out.split('\n').length, raw.split('\n').length);
  assert.equal(out.split('\n')[6], '- [ ] やる');
  assert.ok(!out.includes('title: x') && !out.includes('コメント'));
});

test('チェックの切り替えは対象の1行だけを書き換える', () => {
  const body = '# t\n- [ ] A\n  - [x] B\n> - [ ] 引用の中\n1. [ ] 番号\nふつうの行';
  assert.equal(toggleTaskLine(body, 2, true), '# t\n- [x] A\n  - [x] B\n> - [ ] 引用の中\n1. [ ] 番号\nふつうの行');
  assert.equal(toggleTaskLine(body, 3, false)!.split('\n')[2], '  - [ ] B');
  assert.equal(toggleTaskLine(body, 4, true)!.split('\n')[3], '> - [x] 引用の中');
  assert.equal(toggleTaskLine(body, 5, true)!.split('\n')[4], '1. [x] 番号');
  assert.equal(toggleTaskLine(body, 6, true), null);
  assert.equal(toggleTaskLine(body, 99, true), null);
});

test('ユニークノートは1行目を題名に、ファイル名を日付にする', () => {
  const m = noteMeta('01_Inbox/_uniquenote/202609251123.md', '## 新人の育成方針について\n\n仕事ができる、とは？\n');
  assert.equal(m.title, '新人の育成方針について');
  assert.equal(m.updated, '2026-09-25T11:23');
  assert.equal(m.excerpt, '仕事ができる、とは？');
  assert.equal(dateFromName('2026-10-01_定例'), '2026-10-01');
  assert.equal(dateFromName('README'), '');
});
