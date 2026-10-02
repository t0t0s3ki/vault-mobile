/**
 * Reads Tasks.md the way the vault's own rule defines it (.claude/rules/tasks.md):
 *  - 🔥 holds 📜 Promises and 🔘 buttons; ⏸ marks "the other side has the ball"
 *  - ⚡ Spark is a menu, not a list to finish
 *  - 🧊 is Thoth's memory and is not shown, except its ⏸ waiting subsection
 * Nothing here decides priority; it only sorts what the file already says.
 */

export type TaskKind = 'promise' | 'button' | 'other';
export type Task = {
  /** 1-based line in the file, at read time. Writes re-find the line by its text. */
  line: number;
  raw: string;
  done: boolean;
  kind: TaskKind;
  text: string;
  area: string;
  due: string;
  waiting: string;
  agent: boolean;
  question: boolean;
  minutes: number;
  section: string;
  sub: string[];
};

export type Spark = { line: number; text: string; sub: string[] };
export type TaskBoard = { active: Task[]; waiting: Task[]; sparks: Spark[]; routines: Task[] };

const AREAS = ['💻', '🛒', '🏢', '🏠', '💰', '📦', '🎯', '🌐', '🗂️', '🧩', '📊'];
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

/** Readable text of a task line: markers and bookkeeping dates removed, emphasis unwrapped. */
export function cleanTask(s: string) {
  return s
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(new RegExp(`\\s*[➕⏳✅🛫]\\s*${DATE}`, 'gu'), '')
    .replace(new RegExp(`\\s*📅\\s*${DATE}`, 'gu'), '')
    .replace(/\s*⏸\s*\S*/u, '')
    .replace(/^(?:\s*(?:📜|🔘|🤖|❓))+/u, '')
    .replace(/\s*🤖\s*$/u, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a.split('/').pop())
    .trim();
}

function areaOf(s: string) {
  const body = s
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(/^(?:\s*(?:📜|🔘|🤖|❓|⏸\s*\S*))+\s*/u, '');
  return AREAS.find((a) => body.startsWith(a)) ?? '';
}

function stripArea(text: string, area: string) {
  return area && text.startsWith(area) ? text.slice(area.length).trim() : text;
}

export function parseTasks(raw: string): TaskBoard {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const board: TaskBoard = { active: [], waiting: [], sparks: [], routines: [] };
  let top = '';
  let section = '';
  let current: { sub: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h2 = l.match(/^##\s+(.+)$/);
    const h3 = l.match(/^#{3,4}\s+(.+)$/);
    if (h2) {
      top = h2[1];
      section = '';
      current = null;
      continue;
    }
    if (h3) {
      section = h3[1].replace(/\[\[[^\]]*\]\]/g, '').replace(/\s*\/\s*$/, '').trim();
      current = null;
      continue;
    }
    // Indented lines belong to the item above (progress notes, links, sub-steps).
    if (/^(\t| {2,})\S/.test(l) && current) {
      current.sub.push(l.trim());
      continue;
    }
    if (!l.trim() || l.startsWith('>')) {
      if (!l.trim()) current = current; // blank lines inside a list keep the owner
      else current = null;
      continue;
    }
    const inActive = top.includes('🔥');
    const inSpark = top.includes('⚡');
    const inIce = top.includes('🧊');
    const inRoutine = top.includes('🔁');
    const isTask = /^[-*+]\s+\[[ xX]\]/.test(l);

    if (inSpark && /^[-*+]\s+/.test(l)) {
      const s: Spark = { line: i + 1, text: cleanTask(l.replace(/^[-*+]\s+/, '')).replace(/^⚡\s*/u, ''), sub: [] };
      board.sparks.push(s);
      current = s;
      continue;
    }
    if (!isTask) {
      current = null;
      continue;
    }
    const area = areaOf(l);
    const t: Task = {
      line: i + 1,
      raw: l,
      done: /^[-*+]\s+\[[xX]\]/.test(l),
      kind: /📜/u.test(l) ? 'promise' : /🔘/u.test(l) || section.includes('🔘') ? 'button' : 'other',
      text: stripArea(cleanTask(l), area),
      area,
      due: l.match(new RegExp(`📅\\s*${DATE}`, 'u'))?.[1] ?? '',
      // "⏸ 相手・待っているもの" is one token by the rule's format.
      waiting: (l.match(/⏸\s*(\S+)/u)?.[1] ?? '').trim(),
      agent: /🤖/u.test(l),
      question: /❓/u.test(l),
      minutes: Number(l.match(/(?:約|各)?(\d{1,3})\s*分/)?.[1] ?? 0),
      section,
      sub: [],
    };
    current = t;
    if (inActive) (t.waiting || /⏸/u.test(l) ? board.waiting : board.active).push(t);
    else if (inIce && (section.includes('⏸') || /⏸/u.test(l))) board.waiting.push(t);
    else if (inRoutine) board.routines.push(t);
  }
  return board;
}

/** What is 関's to do next: open items in 🔥 that are not waiting on someone else and not Thoth's. */
export function mine(board: TaskBoard) {
  return board.active.filter((t) => !t.done && !(t.agent && t.kind === 'other'));
}

export function daysUntil(date: string, today = new Date()) {
  const d = new Date(date + 'T00:00:00');
  const t = new Date(today.toDateString());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

/** Promises with a real deadline inside the window (or already past), nearest first. */
export function promisesDue(board: TaskBoard, withinDays = 14, today = new Date()) {
  return mine(board)
    .filter((t) => t.kind === 'promise' && t.due && daysUntil(t.due, today) <= withinDays)
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function buttons(board: TaskBoard) {
  return mine(board).filter((t) => t.kind === 'button');
}

/** Flip one task's checkbox the way the Tasks plugin does (✅ date on completion). */
export function setTaskDone(line: string, done: boolean, today: string) {
  const m = line.match(/^(\s*[-*+]\s+\[)([ xX])(\].*)$/);
  if (!m) return null;
  if (done) {
    const rest = m[3].replace(new RegExp(`\\s*✅\\s*${DATE}`, 'u'), '').replace(/\s+$/, '');
    return `${m[1]}x${rest} ✅ ${today}`;
  }
  return `${m[1]} ${m[3].replace(new RegExp(`\\s*✅\\s*${DATE}`, 'u'), '')}`;
}

/**
 * Apply a toggle to whatever the file holds now. The task is found by its exact
 * line text, so another agent's edits elsewhere in the file are kept. If that
 * line no longer exists once (moved, rewritten, duplicated), nothing is changed.
 */
export function applyToggle(raw: string, original: string, done: boolean, today: string): { text: string } | { error: string } {
  const crlf = raw.includes('\r\n');
  const bom = raw.startsWith('﻿');
  const lines = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const want = original.replace(/\r$/, '');
  const hits = lines.map((l, i) => (l === want ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) {
    // Already in the wanted state (e.g. the first attempt landed): treat as success.
    const target = setTaskDone(want, done, today);
    if (target && lines.filter((l) => l.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, '') === target.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, '')).length === 1)
      return { text: raw };
    return { error: hits.length ? '同じ行が複数あるので書き換えませんでした' : 'この行は別の場所で書き換えられていました' };
  }
  const next = setTaskDone(lines[hits[0]], done, today);
  if (!next) return { error: 'タスクの行ではありません' };
  lines[hits[0]] = next;
  const joined = lines.join('\n');
  return { text: (bom ? '﻿' : '') + (crlf ? joined.replace(/\n/g, '\r\n') : joined) };
}
