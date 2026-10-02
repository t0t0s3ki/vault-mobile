import { useMemo, useRef, useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { findUrl } from '../core/clips';
import { daysUntil, promisesDue, setTaskDone, buttons as allButtons, type Spark, type Task, type TaskBoard } from '../core/tasks';
import { toggleTaskLine } from '../core/writes';
import { Icon } from './icons';
import { ago, Sheet, toast, today } from './kit';
import { Markdown } from './Markdown';
import { captureClip, captureJob, captureMemo, TASKS_PATH, useActivity, useBoard, useJobs, type LogEntry } from './work';

const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Only the near deadline gets a countdown; anything else is just a date. No red, no "overdue". */
function when(due: string) {
  const n = daysUntil(due);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n > 1 && n <= 7) return `あと${n}日`;
  const d = new Date(due + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}

/** Can this be done from a phone in a few minutes? Asking, replying, booking, sending a request. */
const PHONE = /聞く|連絡|返す|返信|相談|依頼を出す|頼む|伝える|取り直す|送る|予約|申請|確定|決める|押す/;
const DESK = /コード|実装|起票|確認する・約|SQL|設定する|検証/;

export function pickButtons(board: TaskBoard, limit = 3) {
  return allButtons(board)
    .map((t) => ({ t, score: (PHONE.test(t.text) ? 2 : 0) - (DESK.test(t.text) ? 2 : 0) + (t.minutes && t.minutes <= 10 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || (a.t.minutes || 99) - (b.t.minutes || 99))
    .slice(0, limit)
    .map((x) => x.t);
}

function sparkOfDay(sparks: Spark[]) {
  if (!sparks.length) return null;
  const d = new Date();
  return sparks[(d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate()) % sparks.length];
}

/* ——— capture ——— */

function Capture({ ws }: { ws: Workspace }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'idle' | 'ask'>('idle');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const done = (msg: string) => {
    setText('');
    setMode('idle');
    toast(msg, 'ok');
  };
  const failed = (r: string) =>
    toast(r === 'unknown' || r === 'storage' ? '電波が戻ったら自動で送ります（この端末に保存済み）' : '送れませんでした。ホームの「まだ送っていない」から送り直せます', 'bad');

  const memo = async () => {
    if (!text.trim()) return area.current?.focus();
    setBusy(true);
    const r = await captureMemo(ws, text);
    setBusy(false);
    r === 'saved' ? done('メモにしました') : (setText(''), failed(r));
  };
  const ask = async (kind: 'research' | 'draft') => {
    setBusy(true);
    const { r, id } = await captureJob(ws, text, kind);
    setBusy(false);
    if (r === 'saved') {
      done(`トトに渡しました（${id}）。毎時30分に始まります`);
      void dispatch(ws, id);
    } else (setText(''), setMode('idle'), failed(r));
  };
  const clip = async () => {
    let src = text;
    if (!findUrl(src)) {
      try {
        src = await navigator.clipboard.readText();
      } catch {
        return toast('URL を貼り付けてから押してください', 'info');
      }
    }
    const url = findUrl(src);
    if (!url) return toast('URL が見つかりませんでした', 'info');
    const note = text.replace(url, '').trim();
    const dup = [...ws.vault.metas.values()].some((m) => m.path.startsWith('01_Inbox/Clips/') && ws.vault.note(m.path)?.raw.includes(url));
    if (dup) return toast('このURLはもうクリップしてあります', 'info');
    setBusy(true);
    const { r } = await captureClip(ws, { url, note: note && note !== url ? note : undefined });
    setBusy(false);
    r === 'saved' ? done('クリップしました。全文はトトがあとで取ります') : (setText(''), failed(r));
  };

  return (
    <section className="capture">
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="思いついたこと・頼みたいこと"
        rows={text ? Math.min(6, text.split('\n').length + 1) : 1}
        enterKeyHint="enter"
      />
      {mode === 'ask' ? (
        <div className="capture-actions">
          <button className="chip-btn" onClick={() => setMode('idle')}>
            戻る
          </button>
          <button className="chip-btn strong" disabled={busy || !text.trim()} onClick={() => ask('research')}>
            調べてまとめて
          </button>
          <button className="chip-btn strong" disabled={busy || !text.trim()} onClick={() => ask('draft')}>
            下書きして
          </button>
        </div>
      ) : (
        <div className="capture-actions">
          <button className="chip-btn strong" disabled={busy} onClick={memo}>
            <Icon name="pencil" size={16} /> メモ
          </button>
          <button className="chip-btn" disabled={busy || !text.trim()} onClick={() => setMode('ask')}>
            <Icon name="send" size={16} /> トトに頼む
          </button>
          <button className="chip-btn" disabled={busy} onClick={clip}>
            <Icon name="link" size={16} /> クリップ
          </button>
        </div>
      )}
      {mode === 'ask' && <p className="capture-hint">結果は thinking にノート1枚で返ります。外への送信や発言はしません。</p>}
    </section>
  );
}

/** Start the hourly runner now instead of waiting for :30. Needs Actions permission on the token; silent if not. */
async function dispatch(ws: Workspace, id: string) {
  const r = ws.remote as { dispatchJob?: (id: string) => Promise<boolean> };
  if (!r.dispatchJob) return;
  if (await r.dispatchJob(id).catch(() => false)) toast('いま始めました', 'ok');
}

/* ——— task sheet: "状況どうやっけ" ——— */

/** 3-character pieces of the meaningful part of a task (kana particles alone are too common to count). */
function grams(text: string) {
  const s = text.replace(/[（(][^）)]*[）)]|[「」『』、。・\s:：/]|[\p{Emoji_Presentation}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    if (!/^[\p{Script=Hiragana}]+$/u.test(g)) out.add(g);
  }
  return [...out];
}

export function lastMention(ws: Workspace, task: Task) {
  const links = [...(task.raw + '\n' + task.sub.join('\n')).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].split('/').pop()!).filter((k) => k.length >= 4);
  const g = grams(task.text);
  const logs = [...ws.vault.entries.keys()].filter((p) => /^AI_Inbox\/session_log\/\d{8}\.md$/.test(p)).sort().reverse().slice(0, 21);
  // Best section across three weeks, not the first loose hit: a wrong "status" is worse than none.
  let best: { path: string; part: string; score: number } | null = null;
  logs.forEach((path, age) => {
    const raw = ws.vault.note(path)?.raw ?? '';
    for (const part of raw.split(/^(?=##\s)/m)) {
      if (!part.startsWith('##')) continue;
      const head = part.slice(0, part.indexOf('\n') + 1 || part.length);
      // Routine roll-ups (cron, sweeps) mention every task; they say nothing about this one.
      if (/cron|Routine|スイープ|棚卸し|まとめて|一覧/.test(head)) continue;
      let score = 0;
      const inHead = g.filter((x) => head.includes(x)).length;
      if (inHead >= 3 && inHead / Math.min(g.length, 12) >= 0.35) score = 0.6 + inHead / 40;
      else if (part.length < 2500 && links.some((k) => part.includes(k))) score = 0.5;
      else if (g.length) {
        const inBody = g.filter((x) => part.includes(x)).length;
        if (inBody >= 6 && inBody / g.length >= 0.5 && part.length < 2500) score = 0.46;
      }
      score -= age * 0.01;
      if (score >= 0.45 && (!best || score > best.score)) best = { path, part, score };
    }
  });
  if (!best) return null;
  const { path, part } = best as { path: string; part: string };
  const head = part.match(/^##\s+(.+)$/m)?.[1] ?? '';
  const body = part.replace(/^##.*$/m, '').trim().split('\n').filter(Boolean).slice(0, 3).join('\n');
  return { path, day: path.slice(-11, -3), head, body };
}

export function TaskSheet({ ws, task, onClose }: { ws: Workspace; task: Task | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const mention = useMemo(() => (task ? lastMention(ws, task) : null), [task]);
  if (!task) return null;
  const links = [...(task.raw + '\n' + task.sub.join('\n')).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]);
  const linked = links.map((l) => ws.vault.resolve(l, TASKS_PATH)).filter((p): p is string => !!p);
  const firstLinked = linked[0] ? ws.vault.metas.get(linked[0]) : undefined;
  const complete = async () => {
    setBusy(true);
    const r = await toggleTaskLine(ws.remote, ws.vault, TASKS_PATH, task.raw, true, ymd());
    setBusy(false);
    if (r.ok) {
      toast('完了にしました。Done への移動は夜の便がやります', 'ok', {
        label: '取り消す',
        run: () => void toggleTaskLine(ws.remote, ws.vault, TASKS_PATH, setTaskDone(task.raw, true, ymd())!, false, ymd()),
      });
      onClose();
    } else toast(r.reason, 'bad');
  };
  const askAbout = async () => {
    setBusy(true);
    const ctx = [task.raw, ...task.sub.map((s) => '\t' + s)].join('\n');
    const { r, id } = await captureJob(ws, `この件の状況をまとめて、次に関がやる1手を1つ提案して：${task.text}`, 'research', `Tasks.md の行（読んだ時点）:\n${ctx}`);
    setBusy(false);
    if (r === 'saved') {
      toast(`トトに渡しました（${id}）`, 'ok');
      void dispatch(ws, id);
      onClose();
    } else toast('この端末に保存しました。電波が戻ったら送ります', 'bad');
  };
  return (
    <Sheet open onClose={onClose} title="状況">
      <div className="task-sheet">
        <p className="ts-kind">
          {task.area} {task.kind === 'promise' ? '約束' : task.kind === 'button' ? '押すだけ' : ''}
          {task.due && <span> · {when(task.due)}まで</span>}
          {task.waiting && <span> · 待ち：{task.waiting}</span>}
        </p>
        <h3 className="ts-title">{task.text}</h3>
        {task.sub.length > 0 && (
          <div className="ts-sub">
            <Markdown raw={task.sub.map((s) => '- ' + s).join('\n')} path={TASKS_PATH} vault={ws.vault} />
          </div>
        )}
        {mention && (
          <a className="ts-mention" href={href.note(mention.path, mention.head)} onClick={onClose}>
            <span className="label">関係しそうな記録 · {mention.day.slice(4, 6)}/{mention.day.slice(6)}</span>
            <strong>{mention.head.replace(/〔[^〕]+〕/g, '')}</strong>
            <span className="ts-mention-body">{mention.body.slice(0, 140)}</span>
          </a>
        )}
        {firstLinked && (
          <a className="ts-linked" href={href.note(firstLinked.path)} onClick={onClose}>
            <Icon name="note" size={18} />
            <span>
              <strong>{firstLinked.title}</strong>
              {firstLinked.excerpt && <small>{firstLinked.excerpt}</small>}
            </span>
          </a>
        )}
        <div className="ts-actions">
          {!task.waiting && (
            <button className="btn primary" disabled={busy} onClick={complete}>
              <Icon name="check" size={18} /> 終わった
            </button>
          )}
          <button className="btn" disabled={busy} onClick={askAbout}>
            <Icon name="send" size={18} /> トトに頼む
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** One Spark, no list: the rule says Sparks are not lined up or counted. */
function SparkCard({ ws, spark }: { ws: Workspace; spark: Spark }) {
  const raw = ws.vault.note(TASKS_PATH)?.raw.split(/\r?\n/)[spark.line - 1] ?? '';
  const link = raw.match(/\[\[([^\]|#]+)/)?.[1];
  const to = link ? ws.vault.resolve(link, TASKS_PATH) : undefined;
  const title = spark.text.replace(/\s—\s.*$/, '');
  return to ? (
    <a className="spark" href={href.note(to)}>
      <span>{title}</span>
      <small>{ws.vault.metas.get(to)?.title} を開く</small>
    </a>
  ) : (
    <div className="spark">
      <span>{title}</span>
    </div>
  );
}

/* ——— the "now" home ——— */

function Activity({ ws, items }: { ws: Workspace; items: LogEntry[] }) {
  if (!items.length) return null;
  return (
    <div className="activity">
      {items.map((a, i) => (
        <a key={i} className="act" href={href.note(a.path, a.anchor)}>
          <span className={'who who-' + (a.who || 'none').toLowerCase()} title={a.who}>
            {{ Thoth: 'ト', Technē: 'テ', Techne: 'テ', Crow: 'ク' }[a.who] ?? (a.who ? a.who.slice(0, 1) : '・')}
          </span>
          <span className="act-title">{a.title}</span>
        </a>
      ))}
      {ws.vault.metas.get(items[0].path) && (
        <a className="more" href={href.note(items[0].path)}>
          今日の記録をぜんぶ読む
        </a>
      )}
    </div>
  );
}

export function Now({ ws }: { ws: Workspace }) {
  useVersion(ws.saves);
  const board = useBoard(ws);
  const jobs = useJobs(ws);
  const activity = useActivity(ws, 4);
  const [open, setOpen] = useState<Task | null>(null);

  const promises = promisesDue(board, 60).slice(0, 4);
  const press = pickButtons(board);
  const pressMinutes = press.reduce((n, t) => n + (t.minutes || 0), 0);
  const spark = sparkOfDay(board.sparks);
  const drafts = ws.saves.unsaved();
  const dayAgo = Date.now() - 36 * 3600_000;
  const results = jobs.filter((j) => (j.status === 'done' || j.status === 'failed') && j.finished && Date.parse(j.finished) > dayAgo);
  const asked = jobs.filter((j) => (j.status === 'queued' || j.status === 'running') && j.origin.startsWith('vault-mobile'));
  const noTasks = !!ws.vault.syncedAt && !ws.vault.note(TASKS_PATH);

  return (
    <main className="page now">
      <header className="home-head">
        <div>
          <p className="date">{today()}</p>
          <h1>いま</h1>
        </div>
        <a className="icon-btn" href={href.settings()} aria-label="設定">
          <Icon name="gear" />
        </a>
      </header>

      <Capture ws={ws} />

      {drafts.length > 0 && (
        <div className="notice">
          <Icon name="cloud" size={18} />
          <div>
            <strong>まだ送っていないものが{drafts.length}件</strong>
            {drafts.slice(0, 3).map((d) => (
              <a key={d.path} href={href.edit(d.path)}>
                {ws.vault.metas.get(d.path)?.title ?? d.body.split('\n').find(Boolean)?.slice(0, 30) ?? d.path.split('/').pop()}
                <small>{{ editing: '未送信', saving: '送信中', unknown: '確認待ち', conflict: '競合' }[d.state]}</small>
              </a>
            ))}
          </div>
        </div>
      )}

      {promises.length > 0 && (
        <section className="block">
          <h2 className="label">次の約束</h2>
          <div className="cards-list">
            {promises.map((t) => (
              <button key={t.line} className="task-card" onClick={() => setOpen(t)}>
                <span className="tc-when">{when(t.due)}</span>
                <span className="tc-text">
                  <span className="tc-area">{t.area}</span>
                  {t.text}
                </span>
                {t.sub[0] && <span className="tc-last">{t.sub[0].replace(/^[📡🔄✅⚠️🗣️📬📊📨🆕\s]+/u, '').slice(0, 70)}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {(results.length > 0 || asked.length > 0 || activity.length > 0) && (
        <section className="block">
          <h2 className="label">トトたち</h2>
          {results.map((j) => {
            const art = j.artifacts.find((a) => a.endsWith('.md'));
            return (
              <a key={j.id} className={'result' + (j.status === 'failed' ? ' failed' : '')} href={art ? href.note(art) : href.note(j.path)}>
                <Icon name={j.status === 'failed' ? 'alert' : 'check'} size={18} />
                <span>
                  <strong>{j.status === 'failed' ? '止まった：' : 'できた：'}{(j.prompt.match(/## 依頼\n([^\n]+)/)?.[1] ?? j.slug).slice(0, 40)}</strong>
                  <small>{j.status === 'failed' ? `${j.failure || '途中'}で止まりました` : j.unknowns ? `未確認：${j.unknowns.slice(0, 40)}` : ago(j.finished)}</small>
                </span>
              </a>
            );
          })}
          {asked.length > 0 && (
            <p className="quiet small">
              頼んだもの {asked.length}件 · {asked.some((j) => j.status === 'running') ? 'いま進めています' : '毎時30分に始まります'}
            </p>
          )}
          <Activity ws={ws} items={activity} />
        </section>
      )}

      {press.length > 0 && (
        <section className="block">
          <div className="label-row">
            <h2 className="label">押すだけ</h2>
            {pressMinutes > 0 && <span className="quiet small">合わせて約{pressMinutes}分</span>}
          </div>
          {press.map((t) => (
            <button key={t.line} className="press" onClick={() => setOpen(t)}>
              <span className="tc-area">{t.area}</span>
              <span className="press-text">{t.text}</span>
            </button>
          ))}
        </section>
      )}

      {spark && (
        <section className="block">
          <h2 className="label">移動中に</h2>
          <SparkCard ws={ws} spark={spark} />
        </section>
      )}

      {noTasks && <p className="quiet">Tasks.md（{TASKS_PATH}）が見つかりませんでした。ほかの場所にあるときは設定から教えてください。</p>}

      <nav className="now-links">
        <a href={href.waiting()}>相手のボール</a>
        <a href={href.inbox()}>書いたメモ・クリップ</a>
        <a href={href.search()}>探す</a>
      </nav>

      <TaskSheet ws={ws} task={open} onClose={() => setOpen(null)} />
    </main>
  );
}

/** Off the home screen on purpose: other people's balls are not 関's to-do. */
export function Waiting({ ws }: { ws: Workspace }) {
  const board = useBoard(ws);
  const [open, setOpen] = useState<Task | null>(null);
  return (
    <main className="page">
      <header className="shelf-head">
        <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
          <Icon name="back" />
        </button>
        <div>
          <h1>相手のボール</h1>
        </div>
      </header>
      <p className="quiet">相手が動く番のもの。返事が来たら、トトが ⏸ を外します。</p>
      {board.waiting.map((t) => (
        <button key={t.line} className="press" onClick={() => setOpen(t)}>
          <span className="tc-area">{t.area}</span>
          <span className="press-text">
            <strong>{t.waiting.split('・')[0]}</strong> {t.waiting.split('・').slice(1).join('・')}
            <small>{t.text}</small>
          </span>
        </button>
      ))}
      <TaskSheet ws={ws} task={open} onClose={() => setOpen(null)} />
    </main>
  );
}
