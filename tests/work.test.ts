import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { applyToggle, buttons, parseTasks, promisesDue, setTaskDone } from '../src/core/tasks.ts';
import { fmDump, fmParse, nextJobId, readJob, requestJob, slugify } from '../src/core/jobs.ts';
import { clipIdentity, findUrl, newClip, readClip } from '../src/core/clips.ts';
import { toggleTaskLine } from '../src/core/writes.ts';
import { MockRemote } from '../src/remote/mock.ts';
import { MemoryStore } from '../src/core/storage.ts';
import { Vault } from '../src/core/vault.ts';
import { noteMeta } from '../src/core/note.ts';

const TASKS = `# 📋 Tasks

## 🔥 アクティブ

> [!abstract] 注記
> 引用は読まない

### ⏰ 今週
- [ ] 📜 🏢 年間計画を佐藤さんと揃える 📅 2026-10-08 ⏳ 2026-10-03 ➕ 2026-09-08
\t📡 10/1 佐藤さんと 10/8 16:00 に再設定
\t[[計画ツール]]
- [ ] 📜 ⏸ CS・9/28の回答 💻 中止モーダルの文言を直す ➕ 2026-09-24
- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）
- [x] 📜 🛒 終わったもの ✅ 2026-10-02

### 🔘 押すだけ
- [ ] 💻 配信ツールの転送先変更を依頼する・約10分

## ⚡ Spark（衝動メニュー）
- ⚡ 関の思想総論を問答で深掘りする — [[関の思想総論]]
\t素材は同ノート

## 🧊 アイスボックス
- [ ] 📌 いつか見るもの
### ⏸ 待ち（相手ボール・自分は動けない）
- [ ] ⏸ 鈴木さん・日程連絡 🏢 鈴木さんの 勉強会
`;

test('Tasks：🔥 を約束・ボタン・返事待ちに分け、🧊 は待ち以外を出さない', () => {
  const b = parseTasks(TASKS);
  const today = new Date('2026-10-03T09:00:00');
  const due = promisesDue(b, 14, today);
  assert.equal(due.length, 1);
  assert.equal(due[0].text, '年間計画を佐藤さんと揃える');
  assert.equal(due[0].area, '🏢');
  assert.deepEqual(due[0].sub, ['📡 10/1 佐藤さんと 10/8 16:00 に再設定', '[[計画ツール]]']);
  assert.deepEqual(
    buttons(b).map((t) => [t.text, t.minutes]),
    [
      ['田中さんの1on1枠を取り直す（5分）', 5],
      ['配信ツールの転送先変更を依頼する・約10分', 10],
    ],
  );
  assert.deepEqual(
    b.waiting.map((t) => [t.waiting, t.text]),
    [
      ['CS・9/28の回答', '中止モーダルの文言を直す'],
      ['鈴木さん・日程連絡', '鈴木さんの 勉強会'],
    ],
  );
  assert.equal(b.sparks.length, 1);
  assert.ok(b.sparks[0].text.startsWith('関の思想総論を問答で深掘りする'));
  assert.ok(!JSON.stringify(b).includes('いつか見るもの'), '🧊 の Pin は出さない');
});

test('完了：Tasks plugin と同じ ✅ 日付を付け、外すと消す', () => {
  assert.equal(setTaskDone('- [ ] 🔘 押す', true, '2026-10-03'), '- [x] 🔘 押す ✅ 2026-10-03');
  assert.equal(setTaskDone('- [x] 🔘 押す ✅ 2026-10-03', false, '2026-10-03'), '- [ ] 🔘 押す');
  assert.equal(setTaskDone('ただの行', true, '2026-10-03'), null);
});

test('完了の書き込みは、最新の中で同じ行だけを書き換える（他の行の変更を残す）', () => {
  const line = '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）';
  const latest = TASKS.replace('### ⏰ 今週', '### ⏰ 今週\n- [ ] 📜 別のエージェントが足した行');
  const r = applyToggle(latest, line, true, '2026-10-03');
  assert.ok('text' in r);
  assert.ok(r.text.includes('- [ ] 📜 別のエージェントが足した行'));
  assert.ok(r.text.includes('- [x] 🔘 🏢 田中さんの1on1枠を取り直す（5分） ✅ 2026-10-03'));
  assert.equal(r.text.split('\n').length, latest.split('\n').length);
});

test('行が書き換えられていたら触らない。既に完了済みなら成功として扱う', () => {
  const line = '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）';
  const rewritten = TASKS.replace(line, '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（10/14 に入れた）');
  assert.ok('error' in applyToggle(rewritten, line, true, '2026-10-03'));
  const already = TASKS.replace(line, '- [x] 🔘 🏢 田中さんの1on1枠を取り直す（5分） ✅ 2026-10-03');
  const r = applyToggle(already, line, true, '2026-10-03');
  assert.ok('text' in r && r.text === already);
});

test('CRLF の Tasks.md でも行末を変えない', () => {
  const crlf = TASKS.replace(/\n/g, '\r\n');
  const r = applyToggle(crlf, '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）', true, '2026-10-03');
  assert.ok('text' in r);
  assert.equal((r.text.match(/\r\n/g) || []).length, (crlf.match(/\r\n/g) || []).length);
});

test('同時に別エージェントが Tasks.md を書いても、その変更を消さずに完了を載せる', async () => {
  const remote = new MockRemote({ '00_Cockpit/Tasks.md': TASKS });
  const vault = new Vault(remote, new MemoryStore());
  await vault.sync();
  const line = '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）';
  remote.inject('conflict-race');
  const r = await toggleTaskLine(remote, vault, '00_Cockpit/Tasks.md', line, true, '2026-10-03');
  assert.deepEqual(r, { ok: true });
  const now = remote.peek('00_Cockpit/Tasks.md')!;
  assert.ok(now.includes('（別の端末の追記）'), '割り込んだ追記が残る');
  assert.ok(now.includes('- [x] 🔘 🏢 田中さんの1on1枠を取り直す（5分） ✅ 2026-10-03'));
  assert.equal(vault.note('00_Cockpit/Tasks.md')!.raw, now, '端末の写しも最新に揃う');
});

test('応答が消えても二重に書かない', async () => {
  const remote = new MockRemote({ '00_Cockpit/Tasks.md': TASKS });
  const vault = new Vault(remote, new MemoryStore());
  await vault.sync();
  remote.inject('lost-response');
  const r = await toggleTaskLine(remote, vault, '00_Cockpit/Tasks.md', '- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）', true, '2026-10-03');
  assert.deepEqual(r, { ok: true });
  assert.equal(remote.commits.length, 1);
});

test('Job：jobs.py と同じ形で書き、ID は全状態のフォルダで重ならない', () => {
  const existing = ['00_Cockpit/jobs/done/JOB-20261003-01_a.md', '00_Cockpit/jobs/failed/JOB-20261003-02_b.md', '00_Cockpit/jobs/done/JOB-20261002-05_c.md'];
  assert.equal(nextJobId(existing, new Date('2026-10-03T08:00:00')), 'JOB-20261003-03');
  const j = requestJob({ request: 'Bitly の自社リダイレクト事例を調べて', kind: 'research', now: new Date('2026-10-03T08:15:00'), existing });
  assert.equal(j.id, 'JOB-20261003-03');
  assert.ok(j.path.startsWith('00_Cockpit/jobs/queued/JOB-20261003-03_mobile-'));
  const back = readJob(j.path, j.text)!;
  assert.equal(back.status, 'queued');
  assert.equal(back.kind, 'research');
  assert.ok(back.prompt.includes('Bitly の自社リダイレクト事例を調べて'));
  const fm = fmParse(j.text.split('\n').slice(1, j.text.split('\n').indexOf('---', 1)));
  assert.deepEqual(fm.write_scope, ['00_Cockpit/jobs/**', j.output]);
  assert.equal(fm.runner_hint, 'actions');
  assert.equal(fm.closes_origin, 'False');
  assert.equal(slugify('  Bitly / 事例: 調べ  '), 'Bitly-事例-調べ');
  assert.equal(fmDump({ a: 'x', b: ['y'], c: null, d: false }), '---\na: x\nb: ["y"]\nd: False\n---');
});

const PY_PARSER = '/path/to/vault/07_System/scripts/proposal.py';
test('Job：Vault の jobs.py が使う Python の読み手で読んでも同じ値になる', { skip: !existsSync(PY_PARSER) }, () => {
  const j = requestJob({ request: '会議の準備：論点を3つにまとめて\n「詰め」たい: 2点', kind: 'draft', context: 'Tasks.md の行', now: new Date('2026-10-03T08:15:00'), existing: [] });
  const code = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("p", ${JSON.stringify(PY_PARSER)})`,
    'p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)',
    'fm, body = p.split_frontmatter(sys.stdin.read())',
    'print(json.dumps(p.fm_parse(fm), ensure_ascii=False))',
  ].join('\n');
  const out = execFileSync('python', ['-c', code], { input: j.text, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const py = JSON.parse(out) as Record<string, string>;
  const ts = fmParse(j.text.split('\n').slice(1, j.text.split('\n').indexOf('---', 1)));
  assert.deepEqual(py, ts);
  assert.equal(py.id, j.id);
  assert.ok(py.prompt.includes('「詰め」たい: 2点'));
  assert.ok(py.verify.includes('grep -q "未確認"'));
});

test('クリップ：Atelier と同じ形で書き、貼った文から URL を拾う', () => {
  const c = newClip({ url: 'https://example.com/a?utm_source=x#top', title: '記事', note: 'あとで' }, new Date('2026-10-03T00:15:00Z'), 'abcd1234');
  assert.equal(c.path, '01_Inbox/Clips/2026-10-03T00-15-00-000Z_abcd1234.md');
  assert.ok(c.text.includes('atelier_clip: true'));
  assert.ok(c.text.includes('status: inbox'));
  assert.ok(c.text.includes('# 記事\n\nhttps://example.com/a?utm_source=x#top\n\n## メモ\n\nあとで'));
  const info = readClip(noteMeta(c.path, c.text), c.text)!;
  assert.equal(info.url, 'https://example.com/a?utm_source=x#top');
  assert.equal(info.processed, false);
  assert.equal(clipIdentity(info.url), 'https://example.com/a');
  assert.equal(findUrl('良い記事 https://x.com/a/status/1 です'), 'https://x.com/a/status/1');
  assert.equal(findUrl('URLなし'), null);
  assert.throws(() => newClip({ url: 'javascript:alert(1)' }, new Date(), 'x'));
});
