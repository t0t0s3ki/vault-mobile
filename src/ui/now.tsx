import { BrandMark } from './BrandMark';
import { useEffect, useMemo, useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { splitFrontmatter } from '../core/note';
import { askOf, profileUrl, readMembers, slackDomain, type Person } from '../core/people';
import { buttons as allButtons, latestNote, thisWeek, type Spark, type Task, type TaskBoard } from '../core/tasks';
import { completeTask, undoComplete } from '../core/writes';
import { TaskRow, when } from './task-row';
import { Icon } from './icons';
import { ago, Sheet, toast, today } from './kit';
import { Markdown } from './Markdown';
import { openPlus, setContext } from './plus';
import { captureJob, TASKS_PATH, useBoard, useJobs } from './work';

const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Doable from a bus seat in a few minutes: asking, replying, booking, requesting. */
const PHONE = /聞く|連絡|返す|返信|伝える|取り直す|送る|予約|申請|依頼を出す|頼む|確定する/;
/** Needs a desk, or belongs to a set meeting ("10/5 朝礼で相談"): not a bus button. */
const NOT_NOW = /コード|実装|起票|SQL|検証|設定する|\d{1,2}\/\d{1,2}|朝礼|定例|会議で|MTGで|1on1で|[月火水木金]曜?）?で/;

export function pickButtons(board: TaskBoard, limit = 3) {
  return allButtons(board)
    .filter((t) => !NOT_NOW.test(t.text))
    .map((t) => ({ t, score: (PHONE.test(t.text) ? 2 : 0) + (t.minutes && t.minutes <= 10 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || (a.t.minutes || 99) - (b.t.minutes || 99))
    .slice(0, limit)
    .map((x) => x.t);
}

/** Sparks for the ride are the talking-and-thinking kind (tasks.md: 夜・移動中は問答・思想系). */
const RIDE = /問答|思想|考え|深掘|言語化|対話|壁打ち|書きたい|エッセイ|振り返|問い/;
function sparkOfDay(sparks: Spark[]) {
  const ride = sparks.filter((s) => RIDE.test(s.text));
  if (!ride.length) return null;
  const d = new Date();
  return ride[(d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate()) % ride.length];
}

function usePeople(ws: Workspace) {
  const v = useVersion(ws.vault);
  return useMemo(() => {
    const people: Person[] = [];
    const texts: string[] = [];
    for (const m of ws.vault.metas.values()) {
      const raw = ws.vault.note(m.path)?.raw ?? '';
      if (/\|\s*Slack ID\s*\|/i.test(raw)) people.push(...readMembers(raw));
    }
    texts.push(ws.vault.note(TASKS_PATH)?.raw ?? '');
    return { people, domain: slackDomain(texts) };
  }, [v]);
}

/* ——— status sheet: "状況どうやっけ" ——— */

function grams(text: string) {
  const s = text.replace(/[（(][^）)]*[）)]|[「」『』、。・\s:：/]|[\p{Emoji_Presentation}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    if (!/^[\p{Script=Hiragana}]+$/u.test(g)) out.add(g);
  }
  return [...out];
}

/** The session-log section most likely about this task. A wrong "status" is worse than none. */
export function lastMention(ws: Workspace, task: Task) {
  const links = [...(task.raw + '\n' + task.sub.join('\n')).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].split('/').pop()!).filter((k) => k.length >= 4);
  const g = grams(task.text);
  const logs = [...ws.vault.entries.keys()].filter((p) => /^AI_Inbox\/session_log\/\d{8}\.md$/.test(p)).sort().reverse().slice(0, 21);
  let best: { path: string; part: string; score: number } | null = null;
  logs.forEach((path, age) => {
    const raw = ws.vault.note(path)?.raw ?? '';
    for (const part of raw.split(/^(?=##\s)/m)) {
      if (!part.startsWith('##')) continue;
      const head = part.slice(0, part.indexOf('\n') + 1 || part.length);
      // Routine roll-ups mention every task; they say nothing about this one.
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
  const { people, domain } = usePeople(ws);
  const mention = useMemo(() => (task ? lastMention(ws, task) : null), [task]);
  useEffect(() => {
    if (!task) return;
    setContext({ kind: 'task', task });
    return () => setContext(null);
  }, [task?.text]);
  if (!task) return null;
  const links = [...(task.raw + '\n' + task.sub.join('\n')).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]);
  const linked = links.map((l) => ws.vault.resolve(l, TASKS_PATH)).filter((p): p is string => !!p);
  const firstLinked = linked[0] ? ws.vault.metas.get(linked[0]) : undefined;
  const asking = askOf(task.text, people);

  const complete = async () => {
    setBusy(true);
    const r = await completeTask(ws.remote, ws.vault, TASKS_PATH, task.raw, ymd());
    setBusy(false);
    if (!r.ok) return toast(r.reason, 'bad');
    const written = r.line;
    toast('終わったことにしました', 'ok', {
      label: '取り消す',
      run: async () => {
        const u = await undoComplete(ws.remote, ws.vault, TASKS_PATH, written, task.raw);
        toast(u.ok ? '元に戻しました' : u.reason, u.ok ? 'ok' : 'bad');
      },
    });
    onClose();
  };
  const askAbout = async () => {
    setBusy(true);
    const ctx = [task.raw, ...task.sub.map((s) => '\t' + s)].join('\n');
    const { r } = await captureJob(ws, `この件の状況をまとめて、次の一手を2〜3の選択肢と推奨で出して：${task.text}`, 'research', ctx);
    setBusy(false);
    toast(r === 'saved' ? `${ws.names.agent}に渡しました。毎時30分ごろに始めます` : '電波が戻ったら自動で送ります', r === 'saved' ? 'ok' : 'bad');
    if (r === 'saved') onClose();
  };
  // Both must start inside the tap itself: Safari refuses clipboard and window.open after an await.
  const sendWords = () => {
    if (!asking) return;
    const url = asking.person ? profileUrl(domain, asking.person.id) : '';
    navigator.clipboard?.writeText(asking.words).then(
      () => toast('文面をコピーしました。Slack で貼り付けて送ってください', 'ok'),
      () => toast('コピーできませんでした', 'bad'),
    );
    if (url) window.open(url, '_blank', 'noopener');
  };

  const note = latestNote(task.sub);
  return (
    <Sheet open onClose={onClose} title="状況">
      <div className="task-sheet">
        <p className="ts-kind">
          {task.area} {task.kind === 'promise' ? '約束' : task.kind === 'button' ? '押すだけ' : ''}
          {task.due && <span> · {when(task.due)}まで</span>}
          {task.waiting && <span> · 待ち：{task.waiting}</span>}
        </p>
        <h3 className="ts-title">{task.text}</h3>
        {note && <p className="ts-latest">{note}</p>}
        {task.sub.length > 1 && (
          <details className="ts-more">
            <summary>これまでの経過（{task.sub.length}行）</summary>
            <div className="ts-sub">
              <Markdown raw={task.sub.map((s) => '- ' + s).join('\n')} path={TASKS_PATH} vault={ws.vault} />
            </div>
          </details>
        )}
        {mention && (
          <a className="ts-mention" href={href.note(mention.path, mention.head)}>
            <span className="label">関係しそうな記録 · {Number(mention.day.slice(4, 6))}/{Number(mention.day.slice(6))}</span>
            <strong>{mention.head.replace(/〔[^〕]+〕/g, '')}</strong>
            <span className="ts-mention-body">{mention.body.replace(/\*\*/g, '').slice(0, 140)}</span>
          </a>
        )}
        {firstLinked && (
          <a className="ts-linked" href={href.note(firstLinked.path)}>
            <Icon name="note" size={18} />
            <span>
              <strong>{firstLinked.title}</strong>
              {firstLinked.excerpt && <small>{firstLinked.excerpt}</small>}
            </span>
          </a>
        )}
        <div className="ts-actions">
          {asking && (
            <button className="btn primary wide" disabled={busy} onClick={sendWords}>
              <Icon name="paste" size={18} /> 文面をコピーして{asking.person && domain ? `${asking.who}さんの Slack を開く` : ''}
            </button>
          )}
          {!task.waiting && (
            <button className={'btn' + (asking ? '' : ' primary')} disabled={busy} onClick={complete}>
              <Icon name="check" size={18} /> 終わった
            </button>
          )}
          <button className="btn" disabled={busy} onClick={askAbout}>
            <Icon name="send" size={18} /> {ws.names.agent}にまとめてもらう
          </button>
          <button className="btn" onClick={openPlus}>
            <Icon name="plus" size={18} /> この件で投げる
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** One Spark, never a list: the rule says Sparks are not lined up or counted. */
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
      <small>思いついたら上の欄からメモに</small>
    </div>
  );
}

/** What a finished request says, in one line, without opening it. */
function resultLine(ws: Workspace, artifact?: string) {
  if (!artifact) return '';
  const raw = ws.vault.note(artifact)?.raw;
  if (!raw) return '';
  // Only the result's own one-line conclusion; another note's opening would read like an answer.
  const s = splitFrontmatter(raw).data.summary;
  return typeof s === 'string' ? s.slice(0, 80) : '';
}

/* ——— the "now" home ——— */

/** A task named in the URL (by its text), so the sheet survives a trip to a note and back. */
export function findTask(board: TaskBoard, text: string) {
  if (!text) return null;
  return [...board.active, ...board.waiting].find((t) => t.text === text) ?? null;
}

export function Now({ ws, taskText }: { ws: Workspace; taskText: string }) {
  useVersion(ws.saves);
  const board = useBoard(ws);
  const jobs = useJobs(ws);
  const open = findTask(board, taskText);
  const setOpen = (t: Task | null) => (t ? (location.hash = href.task(t.text)) : history.back());

  const promises = thisWeek(board).slice(0, 5);
  const press = pickButtons(board).filter((t) => !promises.includes(t));
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
        <div className="home-brand">
          <BrandMark size={40} />
          <div>
            <p className="date">{today()}</p>
            <h1>Now</h1>
          </div>
        </div>
        <a className="icon-btn" href={href.settings()} aria-label="設定">
          <Icon name="gear" />
        </a>
      </header>


      {drafts.length > 0 && (
        <div className="notice">
          <Icon name="cloud" size={18} />
          <div>
            <strong>まだ送れていないもの</strong>
            {drafts.slice(0, 3).map((d) => (
              <a key={d.path} href={href.edit(d.path)}>
                {ws.vault.metas.get(d.path)?.title ?? d.body.split('\n').find((l) => l.trim() && !l.startsWith('---') && !/^\w+:/.test(l))?.slice(0, 30) ?? d.path.split('/').pop()}
                <small>{{ editing: d.capture ? '電波待ち' : '書きかけ', saving: '送っています', unknown: '届いたか確認中', conflict: 'ほかと重なった' }[d.state]}</small>
              </a>
            ))}
          </div>
        </div>
      )}

      <a className="task-overview-link" href={href.tasks()}>
        <span><strong>タスクを見渡す</strong><small>約束・押すだけ・相手待ち</small></span>
        <span aria-hidden="true">→</span>
      </a>

      {promises.length > 0 && (
        <section className="block">
          <h2 className="label">今週の約束</h2>
          <div className="task-rows">
            {promises.map((t) => <TaskRow key={t.line} task={t} onOpen={() => setOpen(t)} />)}
          </div>
        </section>
      )}

      {(results.length > 0 || asked.length > 0) && (
        <section className="block">
          <h2 className="label">{ws.names.agent}たち</h2>
          {results.map((j) => {
            const art = j.artifacts.find((a) => a.endsWith('.md') && !a.includes('/jobs/'));
            const line = resultLine(ws, art);
            const ask = (j.prompt.match(/## 依頼\n([^\n]+)/)?.[1] ?? j.slug.replace(/^mobile-/, '')).slice(0, 40);
            return (
              <a key={j.id} className={'result' + (j.status === 'failed' ? ' failed' : '')} href={art ? href.note(art) : href.note(j.path)}>
                <Icon name={j.status === 'failed' ? 'alert' : 'check'} size={18} />
                <span>
                  <strong>{j.status === 'failed' ? `止まりました：${ask}` : line || ask}</strong>
                  <small>{j.status === 'failed' ? '開くと理由が見られます' : line ? ask : ago(j.finished)}</small>
                </span>
              </a>
            );
          })}
          {asked.length > 0 && (
            <p className="quiet small">頼んだもの {asked.length}件 · {asked.some((j) => j.status === 'running') ? 'いま進めています' : '毎時30分ごろに始めます'}</p>
          )}
        </section>
      )}

      {press.length > 0 && (
        <section className="block">
          <div className="label-row">
            <h2 className="label">いま押せること</h2>
            {pressMinutes > 0 && <span className="quiet small">合わせて約{pressMinutes}分</span>}
          </div>
          <div className="task-rows">
            {press.map((t) => <TaskRow key={t.line} task={t} onOpen={() => setOpen(t)} />)}
          </div>
        </section>
      )}

      {spark && (
        <section className="block">
          <h2 className="label">移動中に</h2>
          <SparkCard ws={ws} spark={spark} />
        </section>
      )}

      {noTasks && <p className="quiet">Tasks.md（{TASKS_PATH}）が見つかりませんでした。</p>}

      <nav className="now-links">
        <a href={href.waiting()}>相手のボール</a>
      </nav>

      <TaskSheet ws={ws} task={open} onClose={() => setOpen(null)} />
    </main>
  );
}

/** Off the home screen on purpose: other people's balls are not the owner's to-do. */
export function Waiting({ ws, taskText }: { ws: Workspace; taskText: string }) {
  const board = useBoard(ws);
  const open = findTask(board, taskText);
  const setOpen = (t: Task | null) => (t ? (location.hash = href.waitingTask(t.text)) : history.back());
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
      <p className="quiet">相手が動く番のもの。動きは{ws.names.agent}が拾います。</p>
      {board.waiting.map((t) => {
        const [who, ...what] = t.waiting.split('・');
        return (
          <button key={t.line} className="press" onClick={() => setOpen(t)}>
            <span className="tc-area">{t.area}</span>
            <span className="press-text">
              <strong>{who}</strong> {what.join('・')}
              {t.text !== what.join('・') && <small>{t.text}</small>}
            </span>
          </button>
        );
      })}
      <TaskSheet ws={ws} task={open} onClose={() => setOpen(null)} />
    </main>
  );
}
