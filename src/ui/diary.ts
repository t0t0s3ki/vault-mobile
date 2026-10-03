import type { Workspace } from '../app';
import { addToDiary, dayOf, diaryLine, diaryPath } from '../core/diary';
import { editRemote } from '../core/writes';

/** Diary lines waiting for a signal. Sealed with the rest of the device data. */
type Pending = { at: string; line: string };
const key = (ws: Workspace) => ws.remote.id + '\u0000diary-queue';

async function send(ws: Workspace, p: Pending) {
  const d = new Date(p.at);
  const path = diaryPath(d);
  const day = `## ${dayOf(d)}`;
  return editRemote(
    ws.remote,
    ws.vault,
    path,
    (raw) => addToDiary(raw, d, p.line),
    // Already there under that day's heading: a lost response must not add it twice.
    (raw) => {
      const lines = raw.split(/\r?\n/);
      const h = lines.findIndex((l) => l.trim() === day);
      if (h < 0) return false;
      const next = lines.findIndex((l, i) => i > h && /^#{1,2}\s/.test(l));
      return lines.slice(h, next < 0 ? undefined : next).includes(p.line);
    },
    `mobile: 日記の原料 ${dayOf(d)}`,
  );
}

/** Write one entry now; if it cannot be sent, keep it and send it later. */
export async function captureDiary(ws: Workspace, words: string, emoji: string) {
  const p: Pending = { at: new Date().toISOString(), line: diaryLine(words, emoji) };
  const r = await send(ws, p);
  if (r.ok) return 'saved' as const;
  if (!r.retry) return r.reason;
  const queue = (await ws.store.get<Pending[]>('meta', key(ws)).catch(() => undefined)) ?? [];
  await ws.store.put('meta', key(ws), [...queue, p]);
  return 'queued' as const;
}

/** Called when the app comes to the front or the connection returns. */
export async function flushDiary(ws: Workspace) {
  const queue = (await ws.store.get<Pending[]>('meta', key(ws)).catch(() => undefined)) ?? [];
  if (!queue.length) return;
  const left: Pending[] = [];
  for (const p of queue) if (!(await send(ws, p)).ok) left.push(p);
  await ws.store.put('meta', key(ws), left).catch(() => {});
}
