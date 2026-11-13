import { useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { findUrl } from '../core/clips';
import { splitFrontmatter, type NoteMeta } from '../core/note';
import { Icon } from './icons';
import { ago, toast } from './kit';
import { captureClip, useClips } from './work';

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Day heading for the memo stream, in the same words as kit.today(). */
function dayLabel(day: string) {
  const now = new Date();
  if (day === ymdOf(now)) return '今日';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === ymdOf(yesterday)) return '昨日';
  if (!day) return '日付なし';
  const d = new Date(day + 'T00:00:00');
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${'日月火水木金土'[d.getDay()]}曜日`;
  return d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年 ${base}` : base;
}

/** HH:mm when the memo's stamp carries a time, nothing when only the day is known. */
function timeOf(updated: string) {
  return updated.match(/T(\d{2}:\d{2})/)?.[1] ?? '';
}

type MemoGroup = { day: string; items: NoteMeta[] };

/** Group the newest-first list by day, keeping its order: new days first, new memos first within a day. */
function groupMemos(memos: NoteMeta[]): MemoGroup[] {
  const groups: MemoGroup[] = [];
  for (const m of memos) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(m.updated) ? m.updated.slice(0, 10) : '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return groups;
}

/** What the owner threw in from the phone: memos and clips. Newest first, nothing to "finish". */
export function Inbox({ ws, tab }: { ws: Workspace; tab: string }) {
  useVersion(ws.vault);
  const clips = useClips(ws);
  const memos = ws.vault.latestIn(ws.places.memos, 40);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const isClips = tab === 'clip';

  const add = async (text: string) => {
    const u = findUrl(text);
    if (!u) return toast('URL が見つかりませんでした', 'info');
    if (clips.some((c) => c.url === u)) return toast('このURLはもうクリップしてあります', 'info');
    setBusy(true);
    const { r } = await captureClip(ws, { url: u });
    setBusy(false);
    if (r === 'saved') {
      setUrl('');
      toast(`クリップしました。全文は${ws.names.agent}があとで取ります`, 'ok');
    } else toast('この端末に保存しました。電波が戻ったら送ります', 'bad');
  };
  const paste = async () => {
    try {
      await add(await navigator.clipboard.readText());
    } catch {
      toast('入力欄を長押しして「ペースト」してください', 'info');
    }
  };

  return (
    <main className="page">
      <header className="shelf-head">
        <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
          <Icon name="back" />
        </button>
        <div>
          <nav className="crumbs">
            <a href={href.mine()}>Mine</a>
          </nav>
          <h1>{isClips ? 'クリップ' : 'メモ'}</h1>
        </div>
      </header>
      <div className="seg">
        <a className={!isClips ? 'on' : ''} href={href.inbox('memo')}>
          メモ
        </a>
        <a className={isClips ? 'on' : ''} href={href.inbox('clip')}>
          クリップ
        </a>
      </div>

      {!isClips && (
        <section className="block">
          {memos.length ? (
            groupMemos(memos).map((g) => (
              <div key={g.day || 'none'} className="stream-day">
                <h2 className="label">{dayLabel(g.day)}</h2>
                {g.items.map((m) => {
                  const body = splitFrontmatter(ws.vault.note(m.path)?.raw ?? '').body.trim();
                  const time = timeOf(m.updated);
                  return (
                    <a key={m.path} className="bubble" href={href.note(m.path)}>
                      <span className="bubble-text">{body || m.title}</span>
                      {time && <span className="bubble-time">{time}</span>}
                    </a>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="quiet">まだありません。「いま」の入力欄から、思いついたことを書けます。</p>
          )}
          <p className="quiet small">{ws.places.memos} に1枚ずつ残り、{ws.names.agent}があとで仕分けます。</p>
        </section>
      )}

      {isClips && (
        <section className="block">
          <div className="paste-row">
            <input className="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL を貼る" inputMode="url" autoCapitalize="off" />
            {url ? (
              <button className="btn primary" disabled={busy} onClick={() => add(url)}>
                追加
              </button>
            ) : (
              <button className="btn" disabled={busy} onClick={paste}>
                <Icon name="paste" size={18} /> 貼り付け
              </button>
            )}
          </div>
          <p className="quiet small">Safari などで「共有 → コピー」してから、ここで貼り付け。</p>
          {clips.map((c) => (
            <div key={c.path} className="row clip">
              <a className="row-main" href={href.note(c.path)}>
                <span className="row-title">{c.title}</span>
                {c.note && <span className="row-excerpt">{c.note}</span>}
                <span className="row-meta">
                  <span className="chip">{c.host}</span>
                  {c.processed ? `${ws.names.agent}が読んだ` : 'まだリンクだけ'} · {ago(c.created.slice(0, 19))}
                </span>
              </a>
              {c.url && (
                <a className="icon-btn" href={c.url} target="_blank" rel="noopener noreferrer" aria-label="元のページを開く">
                  <Icon name="external" size={18} />
                </a>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
