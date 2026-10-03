import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Workspace } from '../app';
import { findUrl } from '../core/clips';
import { basename } from '../core/note';
import type { Task } from '../core/tasks';
import { Icon } from './icons';
import { Sheet, toast } from './kit';
import { captureClip, captureJob, captureMemo } from './work';

/**
 * What 関 is looking at right now. Screens set it; the ＋ sheet attaches it, so a thought
 * keeps the thing that prompted it (a memo gets "関連: [[note]]", a request gets the task line).
 */
export type Context = { kind: 'note'; path: string; title: string } | { kind: 'task'; task: Task } | null;
let current: Context = null;
const listeners = new Set<() => void>();
export function setContext(c: Context) {
  current = c;
  listeners.forEach((f) => f());
}
export function useContextValue() {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => void listeners.delete(f)),
    () => current,
  );
}

let opener: ((open: boolean) => void) | null = null;
export function openPlus() {
  opener?.(true);
}

function contextLabel(c: Context) {
  if (!c) return '';
  return c.kind === 'note' ? c.title : c.task.text;
}

export function PlusSheet({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'idle' | 'ask'>('idle');
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(true);
  const ctx = useContextValue();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    opener = (o) => {
      setOpen(o);
      setAttach(true);
      setMode('idle');
    };
    return () => void (opener = null);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => area.current?.focus(), 60);
  }, [open]);

  const used = attach ? ctx : null;
  const close = () => setOpen(false);
  const done = (msg: string) => {
    setText('');
    close();
    toast(msg, 'ok');
  };
  const failed = (r: string) => {
    setText('');
    close();
    toast(r === 'conflict' ? '送れませんでした。もう一度押してください' : '電波が戻ったら自動で送ります（この端末に残っています）', 'bad');
  };

  const memo = async () => {
    if (!text.trim()) return area.current?.focus();
    setBusy(true);
    const tail = used?.kind === 'note' ? `\n\n関連: [[${basename(used.path)}]]` : used?.kind === 'task' ? `\n\n関連: Tasks「${used.task.text.slice(0, 40)}」` : '';
    const r = await captureMemo(ws, text.trim() + tail);
    setBusy(false);
    r === 'saved' ? done('メモにしました') : failed(r);
  };
  const ask = async (kind: 'research' | 'draft') => {
    setBusy(true);
    const context =
      used?.kind === 'task'
        ? [used.task.raw, ...used.task.sub.map((s) => '\t' + s)].join('\n')
        : used?.kind === 'note'
          ? `見ていたノート: ${used.path}`
          : undefined;
    const { r } = await captureJob(ws, text, kind, context);
    setBusy(false);
    r === 'saved' ? done('トトに渡しました。毎時30分ごろに始めます') : failed(r);
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
    const { r } = await captureClip(ws, { url, note: note || undefined });
    setBusy(false);
    r === 'saved' ? done('クリップしました。中身はトトがあとで読みます') : failed(r);
  };

  return (
    <Sheet open={open} onClose={close} title="投げる">
      <div className="plus">
        {ctx && (
          <button className={'ctx-chip' + (attach ? ' on' : '')} onClick={() => setAttach(!attach)} aria-pressed={attach}>
            <Icon name={ctx.kind === 'note' ? 'note' : 'task'} size={15} />
            <span>{contextLabel(ctx).slice(0, 30)}</span>
            <small>{attach ? '添える' : '添えない'}</small>
          </button>
        )}
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'ask' ? 'トトに頼みたいこと' : '思いついたこと・頼みたいこと・URL'}
          rows={4}
        />
        {mode === 'ask' ? (
          <>
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
            <p className="capture-hint">できたら Now の「トトたち」に出ます。Vault の中を調べます（Slack とWeb検索は見られません）。外への送信はしません。</p>
          </>
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
      </div>
    </Sheet>
  );
}
