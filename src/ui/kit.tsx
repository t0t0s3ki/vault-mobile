import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Workspace } from '../app';
import { Icon } from './icons';

/* ——— toast ——— */
type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'info'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let seq = 0;
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const t = { id: ++seq, text, tone, action };
  toasts = [...toasts.slice(-1), t];
  toastListeners.forEach((f) => f());
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x.id !== t.id);
      toastListeners.forEach((f) => f());
    },
    action ? 6000 : 2600,
  );
}
export function Toasts() {
  const list = useSyncExternalStore(
    (f) => (toastListeners.add(f), () => void toastListeners.delete(f)),
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast toast-' + t.tone}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                toastListeners.forEach((f) => f());
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ——— bottom sheet ——— */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ——— reading preferences (per device, not sensitive) ——— */
export type ReadPrefs = { font: 'mincho' | 'gothic'; size: number; airy: boolean };
const PREFS = 'vault-mobile.read';
const defaults: ReadPrefs = { font: 'mincho', size: 17, airy: false };
let prefs: ReadPrefs = (() => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS) || '{}') };
  } catch {
    return defaults;
  }
})();
const prefListeners = new Set<() => void>();
export function setPrefs(p: Partial<ReadPrefs>) {
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    /* kept for this session */
  }
  prefListeners.forEach((f) => f());
}
export function usePrefs() {
  return useSyncExternalStore(
    (f) => (prefListeners.add(f), () => void prefListeners.delete(f)),
    () => prefs,
  );
}

/* ——— pins (sealed with the rest of the device data) ——— */
export function usePins(ws: Workspace) {
  const key = ws.remote.id + '\u0000pins';
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    ws.store.get<string[]>('meta', key).then((p) => setPins(p ?? []), () => {});
  }, [key]);
  const toggle = async (path: string) => {
    const next = pins.includes(path) ? pins.filter((p) => p !== path) : [path, ...pins];
    setPins(next);
    await ws.store.put('meta', key, next).catch(() => toast('ピンを保存できませんでした', 'bad'));
  };
  return { pins, toggle };
}

/* ——— words ——— */
export function ago(iso: string | number) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (!Number.isFinite(t)) return '';
  const now = new Date();
  const d = new Date(t);
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (typeof iso === 'number' || (typeof iso === 'string' && iso.includes('T'))) {
    const m = Math.round((now.getTime() - t) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    if (days === 0) return `${Math.round(m / 60)}時間前`;
  }
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  return `${d.getMonth() + 1}/${d.getDate()}` + (d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '');
}

export function minutes(chars: number) {
  const m = Math.max(1, Math.round(chars / 600));
  return `約${m}分`;
}

/** "1001_試作アプリ" → number and name, so lists read as names. */
export function splitNumber(name: string) {
  const m = name.match(/^(\d{2,5})[_\s-]+(.+)$/);
  return m ? { num: m[1], name: m[2] } : { num: '', name };
}

export function today() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 ${'日月火水木金土'[d.getDay()]}曜日`;
}

export function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}
