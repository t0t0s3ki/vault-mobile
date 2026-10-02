import { useMemo } from 'react';
import { useVersion, type Workspace } from '../app';
import { CLIPS, newClip, readClip, type ClipInfo } from '../core/clips';
import { readJob, requestJob, type JobInfo, type RequestKind } from '../core/jobs';
import { parseTasks, type TaskBoard } from '../core/tasks';
import { stamp } from './kit';

export const TASKS_PATH = '00_Cockpit/Tasks.md';
const LOGS = 'AI_Inbox/session_log';

const empty: TaskBoard = { active: [], waiting: [], sparks: [], routines: [] };

export function useBoard(ws: Workspace) {
  const v = useVersion(ws.vault);
  return useMemo(() => {
    const n = ws.vault.note(TASKS_PATH);
    return n ? parseTasks(n.raw) : empty;
  }, [v]);
}

export function useJobs(ws: Workspace) {
  const v = useVersion(ws.vault);
  return useMemo(() => {
    const out: JobInfo[] = [];
    for (const path of ws.vault.entries.keys()) {
      if (!path.startsWith('00_Cockpit/jobs/') || !path.includes('/JOB-')) continue;
      const n = ws.vault.note(path);
      const j = n && readJob(path, n.raw);
      if (j) out.push(j);
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }, [v]);
}

export type LogEntry = { path: string; title: string; who: string; anchor: string; day: string };

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** Section headings agents signed in today's (or the latest) session log: what moved while 関 was away. */
export function useActivity(ws: Workspace, limit = 6) {
  const v = useVersion(ws.vault);
  return useMemo(() => {
    const days = [...ws.vault.entries.keys()]
      .filter((p) => p.startsWith(LOGS + '/') && /\/\d{8}\.md$/.test(p))
      .sort()
      .reverse()
      .slice(0, 2);
    const out: LogEntry[] = [];
    for (const path of days) {
      const raw = ws.vault.note(path)?.raw ?? '';
      const day = path.slice(-11, -3);
      const heads = [...raw.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
      for (const h of heads.reverse()) {
        const who = h.match(/〔([^〕]+)〕/)?.[1] ?? '';
        out.push({ path, title: h.replace(/〔[^〕]+〕/g, '').trim(), who, anchor: h, day });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }, [v]);
}

export function today8() {
  return ymd(new Date());
}

export function useClips(ws: Workspace) {
  const v = useVersion(ws.vault);
  return useMemo(() => {
    const out: ClipInfo[] = [];
    for (const meta of ws.vault.metas.values()) {
      if (!meta.path.startsWith(CLIPS + '/')) continue;
      const n = ws.vault.note(meta.path);
      const c = n && readClip(meta, n.raw);
      if (c) out.push(c);
    }
    return out.sort((a, b) => b.created.localeCompare(a.created));
  }, [v]);
}

/* ——— capture: everything goes through the save coordinator, so it survives no signal ——— */

/** Only drafts made by a one-tap capture are re-sent on their own (a memo typed in the editor waits for 保存). */
export function isCapture(_ws: Workspace, d: { capture?: boolean; baseSha: string; path: string }) {
  if (d.capture) return true;
  // Drafts from the first builds had no flag. Clips and requests are only ever made by a capture;
  // memos are left out because the editor also starts new memos with an empty base.
  return d.baseSha === '' && (d.path.startsWith(CLIPS + '/') || d.path.startsWith('00_Cockpit/jobs/queued/'));
}

async function create(ws: Workspace, path: string, text: string) {
  ws.saves.begin(path, { sha: '', raw: '' }, { capture: true });
  await ws.saves.edit(path, text);
  let r = await ws.saves.save(path);
  // An automatic re-send can win the race between edit() and save(); the file is then already there.
  if (r === 'unchanged' && (ws.saves.view(path)?.savedAt || ws.vault.entries.has(path))) r = 'saved';
  if (r === 'saved') ws.saves.close(path);
  return r;
}

/** Create under a fresh name if the chosen one turned out to exist elsewhere; never resolve onto it. */
async function createFresh(ws: Workspace, make: () => { path: string; text: string }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = make();
    const r = await create(ws, f.path, f.text);
    if (r !== 'conflict') return { r, path: f.path };
    await ws.saves.discard(f.path);
  }
  return { r: 'conflict' as const, path: '' };
}

export function memoPath(ws: Workspace) {
  let name = stamp();
  while (ws.vault.entries.has(`${ws.places.memos}/${name}.md`) || ws.saves.view(`${ws.places.memos}/${name}.md`)) name = String(Number(name) + 1);
  return `${ws.places.memos}/${name}.md`;
}

export async function captureMemo(ws: Workspace, text: string) {
  let bump = 0;
  return (
    await createFresh(ws, () => {
      let path = memoPath(ws);
      for (let i = 0; i < bump; i++) path = path.replace(/(\d+)\.md$/, (_, n) => String(Number(n) + 1) + '.md');
      bump++;
      return { path, text: text.trim() + '\n' };
    })
  ).r;
}

export function captureClip(ws: Workspace, input: { url: string; title?: string; note?: string }) {
  return createFresh(ws, () => {
    const rand = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 8);
    return newClip(input, new Date(), rand);
  });
}

export async function captureJob(ws: Workspace, request: string, kind: RequestKind, context?: string) {
  const existing = [...ws.vault.entries.keys(), ...ws.saves.unsaved().map((d) => d.path)].filter((p) => p.startsWith('00_Cockpit/jobs/'));
  // IDs are numbered per day across all folders; a Job made on the PC since the last sync has another file
  // name, so a write conflict would not catch it. Look at the live list right before numbering.
  try {
    const { entries } = await ws.remote.tree();
    for (const e of entries) if (e.path.startsWith('00_Cockpit/jobs/')) existing.push(e.path);
  } catch {
    /* offline: numbered from the device copy, re-checked when it is sent */
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = requestJob({ request, kind, context, now: new Date(), existing });
    const r = await create(ws, j.path, j.text);
    // Same ID made elsewhere (PC, Actions) in the meantime: take the next number, never overwrite.
    if (r === 'conflict') {
      await ws.saves.discard(j.path);
      existing.push(j.path);
      continue;
    }
    return { r, id: j.id, output: j.output };
  }
  return { r: 'conflict' as const, id: '', output: '' };
}
