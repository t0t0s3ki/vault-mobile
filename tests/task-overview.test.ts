import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from '../src/core/tasks.ts';
import { overviewGroups, taskFilter } from '../src/ui/task-overview.ts';
import { href, parseRoute } from '../src/app.ts';

const board = parseTasks(`## 🔥 アクティブ
- [ ] 📜 🏢 展示の準備を確認する 📅 2026-12-01
- [ ] 🔘 💻 URLを共有する
- [ ] 🤖 下書きを確認する
- [ ] 📜 ⏸ 窓口・回答 💻 見積もりを確認する
- [x] 📜 完了したもの
## 🧊 アイスボックス
- [ ] 📌 いつかの記憶
### ⏸ 待ち
- [ ] ⏸ 事務局・日程 🏢 予定を確認する
- [x] ⏸ 事務局・回答 🏢 完了済みの待ち
## ⚡ Spark
- ⚡ 思いつき
## 🔁 ルーチン
- [ ] 定期確認
`);

test('overview shows only unfinished active/waiting rows without inventing ownership', () => {
  const groups = overviewGroups(board, 'all', '');
  assert.deepEqual(groups.map((g) => g.tasks.length), [3, 2]);
  assert.equal(groups[0].tasks[2].text, '下書きを確認する');
  assert.equal(overviewGroups(board, 'waiting', '')[0].tasks.length, 2);
  assert.equal(overviewGroups(board, 'active', '')[0].tasks.length, 3);
  assert.equal(taskFilter('unknown'), 'all');
});

test('overview searches title, waiting party and due date; normalizes width and case', () => {
  assert.equal(overviewGroups(board, 'all', '窓口')[1].tasks.length, 1);
  assert.equal(overviewGroups(board, 'all', '展示 2026-12')[0].tasks.length, 1);
  assert.equal(overviewGroups(board, 'all', 'ｕｒｌ')[0].tasks.length, 1);
  assert.equal(overviewGroups(board, 'all', '記憶').flatMap((g) => g.tasks).length, 0);
  assert.equal(overviewGroups(board, 'all', '   ')[0].tasks.length, 3);
});

test('task routes preserve filters, special characters and exact source identity', () => {
  const raw = '- [ ] 📜 表題 / ? # % & + [[ノート]] 📅 2026-12-01';
  assert.deepEqual(parseRoute(href.tasks('waiting', '窓口 / A&B+100%', raw)), {
    name: 'tasks', filter: 'waiting', q: '窓口 / A&B+100%', task: raw,
  });
  assert.deepEqual(parseRoute('#/tasks'), { name: 'tasks', filter: 'all', q: '', task: '' });
  assert.deepEqual(parseRoute(href.task('従来の表題')), { name: 'home', task: '従来の表題' });
});
