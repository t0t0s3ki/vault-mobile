/**
 * Reads Tasks.md the way the vault's own rule defines it (.claude/rules/tasks.md):
 *  - 🔥 holds 📜 Promises and 🔘 buttons; ⏸ marks "the other side has the ball"
 *  - ⚡ Spark is a menu, not a list to finish
 *  - 🧊 is the agent's memory and is not shown, except its ⏸ waiting subsection
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

/**
 * "⏸ 相手・待っているもの" runs until the area emoji or a date marker. Real lines put spaces
 * inside it ("⏸ 伊藤さん・次回の枠の予約 🏢 …"), and some have no area emoji at all.
 */
const WAIT = /⏸\s*([^🛒🏢💻🏠💰📦🎯🌐🗂🧩📊📅⏳➕✅🤖❓🔁🛫]*)/u;

/** Readable text of a task line: markers and bookkeeping dates removed, emphasis unwrapped. */
export function cleanTask(s: string) {
  const waiting = s.match(WAIT)?.[1]?.trim() ?? '';
  let t = s
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(new RegExp(`\\s*[➕⏳✅🛫]\\s*${DATE}`, 'gu'), '')
    .replace(new RegExp(`\\s*📅\\s*${DATE}`, 'gu'), '')
    .replace(WAIT, ' ')
    .replace(/^(?:\s*(?:📜|🔘|🤖|❓|📌))+/u, '')
    .replace(/\s*🤖\s*$/u, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a.split('/').pop())
    .replace(/\s+/g, ' ')
    .trim();
  // Lines that are nothing but the waiting phrase: show what is awaited.
  if (!t && waiting) t = waiting.split('・').slice(1).join('・') || waiting;
  return t;
}

function areaOf(s: string) {
  const body = s
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(WAIT, '')
    .replace(/^(?:\s*(?:📜|🔘|🤖|❓|📌))+\s*/u, '');
  return AREAS.find((a) => body.startsWith(a)) ?? '';
}

/** Newest dated progress note under a task, without emoji, signature or link markup. */
export function latestNote(sub: string[], today = new Date()) {
  const now = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const dated = sub
    .map((s, i) => {
      const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      // M/D at the start of a note (" 9/30 返事あり"), not a ratio inside one ("2/3 完了" mid-line is rare but "2/3" alone is not a date).
      const md = s.match(/^[^\p{L}\p{N}]*(\d{1,2})\/(\d{1,2})(?![\d/])/u);
      let key = '';
      if (iso) key = `${iso[1]}${iso[2]}${iso[3]}`;
      else if (md && Number(md[1]) <= 12 && Number(md[2]) <= 31) {
        const mmdd = md[1].padStart(2, '0') + md[2].padStart(2, '0');
        // Year is not written: a date that would land in the future belongs to last year.
        key = (`${today.getFullYear()}${mmdd}` > now ? today.getFullYear() - 1 : today.getFullYear()) + mmdd;
      }
      return { s, i, key };
    })
    .filter((x) => x.key);
  const pick = dated.sort((a, b) => b.key.localeCompare(a.key) || b.i - a.i)[0];
  const s = pick?.s ?? sub.find((x) => !/^\[\[[^\]]+\]\]$/.test(x));
  if (!s) return '';
  return s
    .replace(/^[^\p{L}\p{N}［\[「（(]+/u, '')
    .replace(/〔[^〕]*〕/g, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a.split('/').pop())
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
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
      waiting: /⏸/u.test(l) ? (l.match(WAIT)?.[1] ?? '').trim() || '相手の返事' : '',
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

/** What is the owner's to do next: open items in 🔥 that are not waiting on someone else and not the agent's. */
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
/**
 * Replace exactly one line whose text is `from` with `to`, in whatever the file holds now.
 * Each line keeps its own ending (mixed CRLF/LF files stay as they are).
 * If `from` is gone but exactly one `to` is there, the change already landed: no-op.
 */
export function replaceLine(raw: string, from: string, to: string): { text: string } | { error: string } {
  const parts = raw.split(/(\r?\n)/); // [line, eol, line, eol, …]
  const strip = (l: string, i: number) => (i === 0 ? l.replace(/^﻿/, '') : l);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const want = from.replace(/\r$/, '');
  const hits = lines.map((l, i) => (strip(l, i) === want ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) {
    if (lines.filter((l, i) => strip(l, i) === to).length === 1) return { text: raw };
    return { error: 'この行は別の場所で書き換えられていました' };
  }
  if (hits.length > 1) return { error: '同じ行が複数あるので書き換えませんでした' };
  const at = hits[0] * 2;
  parts[at] = (at === 0 && parts[0].startsWith('﻿') ? '﻿' : '') + to;
  return { text: parts.join('') };
}

export function applyToggle(raw: string, original: string, done: boolean, today: string): { text: string; line: string } | { error: string } {
  const next = setTaskDone(original.replace(/\r$/, ''), done, today);
  if (!next) return { error: 'タスクの行ではありません' };
  const r = replaceLine(raw, original, next);
  return 'error' in r ? r : { text: r.text, line: next };
}

/**
 * This week's promises: the lines the agent already placed under "### ⏰ 今週…", plus any
 * promise elsewhere whose 📅 falls within the week. Order: dated first, then the file's order.
 */
export function thisWeek(board: TaskBoard, today = new Date()) {
  const seen = new Set<number>();
  const out: Task[] = [];
  for (const t of mine(board)) {
    const week = t.section.includes('⏰');
    const soon = t.kind === 'promise' && t.due && daysUntil(t.due, today) <= 7;
    if ((week && t.kind !== 'other') || soon || (week && t.kind === 'other' && !t.agent)) {
      if (!seen.has(t.line)) out.push(t), seen.add(t.line);
    }
  }
  return out.sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : a.line - b.line));
}
