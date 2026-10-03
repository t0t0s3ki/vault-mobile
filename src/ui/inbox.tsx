import { useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { findUrl } from '../core/clips';
import { Icon } from './icons';
import { ago, toast } from './kit';
import { captureClip, useClips } from './work';

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
            memos.map((m) => (
              <a key={m.path} className="row" href={href.note(m.path)}>
                <span className="row-main">
                  <span className="row-title">{m.title}</span>
                  {m.excerpt && <span className="row-excerpt">{m.excerpt}</span>}
                  <span className="row-meta">{ago(m.updated)}</span>
                </span>
              </a>
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
