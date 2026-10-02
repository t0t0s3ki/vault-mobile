import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { applyToggle, buttons, latestNote, parseTasks, promisesDue, replaceLine, setTaskDone, thisWeek } from '../src/core/tasks.ts';
import { askOf, profileUrl, readMembers, slackDomain } from '../src/core/people.ts';
import { pickButtons } from '../src/ui/now.tsx';
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
  assert.equal(r.ok, true);
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
  assert.equal(r.ok, true);
  assert.equal(remote.commits.length, 1);
});

test('Job：jobs.py と同じ形で書き、ID は全状態のフォルダで重ならない', () => {
  const existing = ['00_Cockpit/jobs/done/JOB-20261003-01_a.md', '00_Cockpit/jobs/failed/JOB-20261003-02_b.md', '00_Cockpit/jobs/done/JOB-20261002-05_c.md'];
  assert.equal(nextJobId(existing, new Date('2026-10-03T08:00:00')), 'JOB-20261003-51', 'スマホは51番から');
  assert.equal(nextJobId([...existing, '00_Cockpit/jobs/queued/JOB-20261003-51_x.md'], new Date('2026-10-03T08:00:00')), 'JOB-20261003-52');
  const j = requestJob({ request: 'Bitly の自社リダイレクト事例を調べて', kind: 'research', now: new Date('2026-10-03T08:15:00'), existing });
  assert.equal(j.id, 'JOB-20261003-51');
  assert.ok(j.output.includes('20261003-51'), '出力ファイル名に Job ID が入る');
  assert.ok(j.path.startsWith('00_Cockpit/jobs/queued/JOB-20261003-51_mobile-'));
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
  assert.ok(py.verify.includes('^summary:'));
  assert.equal(py.runner_hint, 'actions', '--- 行で frontmatter が途中で切れない');
  assert.ok(py.write_scope);
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

test('待ちの句は空白を含んでも、領域の絵文字か日付の印で切る（実データの形）', () => {
  const b = parseTasks(`## 🔥 アクティブ
- [ ] 📜 ⏸ 高橋さん・旧店舗の設定と動作確認の報告 🛒 審査のあとの連携設定
- [ ] 📜 ⏸ 伊藤さん・次回の枠の予約 🏢 伊藤さん 勉強会 **次回を実施する** ➕ 2026-09-03
- [ ] ⏸ 渡辺さん・山本さんからの変更依頼待ち（表記の整理） ➕ 2026-08-18
- [ ] 📌 🏢 中村さん：手順を足す（相手ボール） ⏸ ➕ 2026-09-02
`);
  assert.deepEqual(
    b.waiting.map((t) => [t.waiting, t.text, t.area]),
    [
      ['高橋さん・旧店舗の設定と動作確認の報告', '審査のあとの連携設定', '🛒'],
      ['伊藤さん・次回の枠の予約', '伊藤さん 勉強会 次回を実施する', '🏢'],
      ['渡辺さん・山本さんからの変更依頼待ち（表記の整理）', '山本さんからの変更依頼待ち（表記の整理）', ''],
      ['相手の返事', '中村さん：手順を足す（相手ボール）', '🏢'],
    ],
  );
});

test('今週の約束は ⏰ 節の関の行をそのまま、補足は最新の日付の行を飾りなしで', () => {
  const b = parseTasks(`## 🔥 アクティブ
### ⏰ 今週〜10/8
- [ ] 📜 🏢 山本さんに返す（📅なし）
\t⬆️ 8/26 昇格〔Thoth〕
\t📡 2026-10-02 確認〔Crow〕：[9/30 の連絡](https://x.slack.com/archives/C1/p1) を見た
- [ ] 📜 ⏸ 相手・返事 💻 待っている件
### 💻 開発
- [ ] 📜 💻 来月のもの 📅 2026-11-01
- [ ] 📜 💻 近いもの 📅 2026-10-05
`);
  const w = thisWeek(b, new Date('2026-10-03T09:00:00'));
  assert.deepEqual(w.map((t) => t.text), ['近いもの', '山本さんに返す（📅なし）']);
  assert.equal(latestNote(w[1].sub), '2026-10-02 確認：9/30 の連絡 を見た');
});

test('押せること：場が決まっている用件と机の作業は外す', () => {
  const b = parseTasks(`## 🔥 アクティブ
- [ ] 🔘 🏢 来週の定例会（10/5 月）で「古い保存方式をやめる」を相談する
- [ ] 🔘 💻 外部ベンダー側のコードに鍵が含まれていないか確認する・約15分
- [ ] 🔘 🛒 佐藤さんに「この案でどう？」と聞く（2分）
`);
  assert.deepEqual(pickButtons(b).map((t) => t.text), ['佐藤さんに「この案でどう？」と聞く（2分）']);
});

test('聞く：名前と「」の文面を拾い、名簿から Slack の宛先を引く', () => {
  const people = readMembers('| 氏名 | 所属 | Slack ID |\n| --- | --- | --- |\n| 佐藤 太郎 | A部 | U0TEST00001 |\n| 高橋 次郎 | モール | D0TEST00002（DM） |');
  assert.deepEqual(people.map((p) => p.id), ['U0TEST00001', 'D0TEST00002']);
  const a = askOf('佐藤さんに「月別の件数、この案でどう？」と聞く（2分）', people)!;
  assert.equal(a.words, '月別の件数、この案でどう？');
  assert.equal(a.person?.id, 'U0TEST00001');
  assert.equal(profileUrl('example', 'U0TEST00001'), 'https://example.slack.com/team/U0TEST00001');
  assert.equal(profileUrl('example', 'D0TEST00002'), 'https://example.slack.com/archives/D0TEST00002');
  assert.equal(slackDomain(['なし', 'see https://teamx.slack.com/archives/C1']), 'teamx');
});

test('行の置き換え：混ざった改行はそのまま、既に済んでいれば何もしない、取り消しは元の行に戻す', () => {
  const raw = '﻿a\r\n- [ ] 🔘 押す  \nc\r\n';
  const r = replaceLine(raw, '- [ ] 🔘 押す  ', '- [x] 🔘 押す ✅ 2026-10-03');
  assert.ok('text' in r && r.text === '﻿a\r\n- [x] 🔘 押す ✅ 2026-10-03\nc\r\n');
  const again = replaceLine((r as { text: string }).text, '- [ ] 🔘 押す  ', '- [x] 🔘 押す ✅ 2026-10-03');
  assert.ok('text' in again && again.text === (r as { text: string }).text);
  const back = replaceLine((r as { text: string }).text, '- [x] 🔘 押す ✅ 2026-10-03', '- [ ] 🔘 押す  ');
  assert.ok('text' in back && back.text === raw, '末尾の空白まで元どおり');
  const dupDone = '- [x] 日報 ✅ 2026-10-02\n- [x] 日報 ✅ 2026-10-03\n';
  assert.ok('error' in replaceLine(dupDone, '- [ ] 日報', '- [x] 日報 ✅ 2026-10-03') === false);
  assert.ok('error' in replaceLine('- [ ] 日報\n- [ ] 日報\n', '- [ ] 日報', '- [x] 日報 ✅ 2026-10-03'), '同じ行が二つなら触らない');
  assert.ok('error' in replaceLine('- [x] 日報 ✅ 2026-10-02\n', '- [ ] 日報', '- [x] 日報 ✅ 2026-10-03'), '昨日の完了を今日の完了と見なさない');
});
