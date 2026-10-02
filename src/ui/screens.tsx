import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { href, remoteFor, setMode, useVersion, wipeDevice, type Position, type Workspace } from '../app';
import { splitFrontmatter, type NoteMeta } from '../core/note';
import { writable } from '../core/vault';
import { Markdown, slug } from './Markdown';

const fmtDate = (s: string) => (s ? s.slice(0, 10).replace(/-/g, '.') : '');

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  if (m < 60 * 24) return `${Math.round(m / 60)}時間前`;
  return `${Math.round(m / 1440)}日前`;
}

function NoteRow({ meta, sub }: { meta: NoteMeta; sub?: string }) {
  return (
    <a className="row" href={href.note(meta.path)}>
      <span className="row-title">{meta.title}</span>
      <span className="row-sub">{sub ?? meta.folder.split('/').slice(-1)[0]}</span>
    </a>
  );
}

export function SyncLine({ ws }: { ws: Workspace }) {
  useVersion(ws.vault);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async () => {
    setError(undefined);
    setBusy('確認中…');
    try {
      await ws.vault.sync((d, t) => t && setBusy(`取得中 ${d}/${t}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  useEffect(() => {
    if (!ws.vault.syncedAt || Date.now() - ws.vault.syncedAt > 5 * 60_000) void run();
  }, []);
  return (
    <div className={'sync' + (error ? ' sync-error' : '')}>
      <span>
        {busy ?? (error ? `更新できませんでした：${error}（端末の写しを表示中）` : ws.vault.syncedAt ? `更新：${ago(ws.vault.syncedAt)}` : '未取得')}
      </span>
      <button onClick={run} disabled={!!busy}>
        最新にする
      </button>
    </div>
  );
}

export function Home({ ws }: { ws: Workspace }) {
  useVersion(ws.vault);
  useVersion(ws.saves);
  const [positions, setPositions] = useState<[string, Position][]>([]);
  useEffect(() => {
    ws.store.all<Position>('positions').then(setPositions, () => {});
  }, []);
  const prefix = ws.remote.id + '\u0000';
  const continuing = positions
    .filter(([k, p]) => k.startsWith(prefix) && p.ratio > 0.02 && p.ratio < 0.97)
    .map(([k, p]) => ({ meta: ws.vault.metas.get(k.slice(prefix.length)), p }))
    .filter((x): x is { meta: NoteMeta; p: Position } => !!x.meta)
    .sort((a, b) => b.p.at - a.p.at)
    .slice(0, 4);
  const drafts = ws.saves.unsaved();
  const projects = ws.vault.folder(ws.projects).folders;
  const recent = ws.vault.recent(8);

  return (
    <main className="page home">
      <header className="home-head">
        <h1>Vault</h1>
        <a className="search-pill" href={href.search()}>
          ノートを探す
        </a>
      </header>
      <SyncLine ws={ws} />

      {drafts.length > 0 && (
        <section className="block drafts">
          <h2>まだ送っていない編集</h2>
          {drafts.map((d) => (
            <a key={d.path} className="row" href={href.edit(d.path)}>
              <span className="row-title">{ws.vault.metas.get(d.path)?.title ?? d.path}</span>
              <span className={'badge badge-' + d.state}>
                {{ editing: '下書き', saving: '送信中', unknown: '確認が必要', conflict: '競合' }[d.state]}
              </span>
            </a>
          ))}
        </section>
      )}

      {continuing.length > 0 && (
        <section className="block">
          <h2>続きから</h2>
          <div className="cards">
            {continuing.map(({ meta, p }) => (
              <a key={meta.path} className="card" href={href.note(meta.path)}>
                <span className="card-title">{meta.title}</span>
                <span className="card-sub">{meta.folder.split('/').slice(-1)[0]}</span>
                <span className="progress">
                  <span style={{ width: `${Math.round(p.ratio * 100)}%` }} />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h2>最近更新</h2>
        {recent.map((m) => (
          <NoteRow key={m.path} meta={m} sub={fmtDate(m.updated)} />
        ))}
      </section>

      <section className="block">
        <h2>プロジェクト</h2>
        {projects.map((f) => (
          <a key={f.path} className="row" href={href.shelf(f.path)}>
            <span className="row-title">{f.name.replace(/^\d+_/, '')}</span>
            <span className="row-sub">{f.count}</span>
          </a>
        ))}
      </section>
    </main>
  );
}

export function Search({ ws, q }: { ws: Workspace; q: string }) {
  useVersion(ws.vault);
  const [query, setQuery] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!q) input.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => history.replaceState(null, '', href.search(query)), 300);
    return () => clearTimeout(t);
  }, [query]);
  const hits = useMemo(() => ws.vault.search(query), [query, ws.vault.version]);
  return (
    <main className="page">
      <div className="search-bar">
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          placeholder="タイトル・別名・本文"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {query && !hits.length && <p className="empty">見つかりませんでした</p>}
      {!query && <p className="empty">タイトル、別名（aliases）、見出し、本文の順に探します。端末の写しを探すのでオフラインでも使えます。</p>}
      {hits.map((h) => (
        <a key={h.meta.path} className="row hit" href={href.note(h.meta.path)}>
          <span className="row-title">{h.meta.title}</span>
          <span className="row-sub">{h.meta.folder}</span>
          {h.snippet && h.score < 4000 && <span className="snippet">{h.snippet}</span>}
        </a>
      ))}
    </main>
  );
}

export function Shelf({ ws, path }: { ws: Workspace; path: string }) {
  useVersion(ws.vault);
  const { folders, notes } = ws.vault.folder(path);
  const crumbs = path ? path.split('/') : [];
  return (
    <main className="page">
      <nav className="crumbs">
        <a href={href.shelf('')}>棚</a>
        {crumbs.map((c, i) => (
          <a key={i} href={href.shelf(crumbs.slice(0, i + 1).join('/'))}>
            {c}
          </a>
        ))}
      </nav>
      {folders.map((f) => (
        <a key={f.path} className="row folder" href={href.shelf(f.path)}>
          <span className="row-title">{f.name}</span>
          <span className="row-sub">{f.count}</span>
        </a>
      ))}
      {notes.map((m) => (
        <NoteRow key={m.path} meta={m} sub={fmtDate(m.updated)} />
      ))}
      {!folders.length && !notes.length && <p className="empty">ノートがありません</p>}
    </main>
  );
}

export function NoteView({ ws, path, anchor }: { ws: Workspace; path: string; anchor: string }) {
  useVersion(ws.vault);
  useVersion(ws.saves);
  const note = ws.vault.note(path);
  const meta = ws.vault.metas.get(path);
  const draft = ws.saves.view(path);
  const scroller = useRef<HTMLElement>(null);
  const posKey = ws.remote.id + '\u0000' + path;
  const [showTitle, setShowTitle] = useState(false);

  // Restore the reading position, or jump to the linked heading.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !note) return;
    if (anchor) {
      document.getElementById(slug(anchor))?.scrollIntoView();
      return;
    }
    let alive = true;
    ws.store.get<Position>('positions', posKey).then((p) => {
      if (alive && p && p.ratio > 0.02) el.scrollTop = p.ratio * (el.scrollHeight - el.clientHeight);
    });
    return () => {
      alive = false;
    };
  }, [path, anchor, !!note]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setShowTitle(el.scrollTop > 120);
      clearTimeout(t);
      t = setTimeout(() => {
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0) void ws.store.put('positions', posKey, { ratio: el.scrollTop / max, at: Date.now() }).catch(() => {});
      }, 400);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      el.removeEventListener('scroll', on);
      clearTimeout(t);
    };
  }, [path]);

  if (!note || !meta)
    return (
      <main className="page">
        <p className="empty">このノートは端末の写しにありません。「最新にする」を試してください。</p>
        <a href={href.home()}>ホームへ</a>
      </main>
    );

  const fm = splitFrontmatter(note.raw);
  const hasH1 = /^#\s+/m.test(fm.body.trimStart().split('\n')[0] ?? '');
  const backlinks = ws.vault.backlinks(path);
  const canEdit = writable(path);

  return (
    <div className="reader">
      <header className="bar">
        <button className="icon" onClick={() => history.back()} aria-label="戻る">
          ‹
        </button>
        <span className={'bar-title' + (showTitle ? ' on' : '')}>{meta.title}</span>
        {canEdit ? (
          <a className="bar-action" href={href.edit(path)}>
            {draft?.dirty ? '下書きあり' : '編集'}
          </a>
        ) : (
          <span className="bar-note">読むだけ</span>
        )}
      </header>
      <main className="note" ref={scroller}>
        <article>
          <a className="folder-link" href={href.shelf(meta.folder)}>
            {meta.folder || 'Vault'}
          </a>
          {!hasH1 && <h1>{meta.title}</h1>}
          <div className="meta-line">
            {meta.updated && <span>{fmtDate(meta.updated)}</span>}
            {meta.status && <span>{meta.status}</span>}
            {meta.tags.map((t) => (
              <a key={t} href={href.search('#' + t)} className="tag">
                #{t}
              </a>
            ))}
          </div>
          {fm.error && <p className="warn">{fm.error}。原文はそのまま残しています。</p>}
          {fm.yaml && (
            <details className="props">
              <summary>プロパティ</summary>
              <pre>{fm.yaml}</pre>
            </details>
          )}
          <Markdown raw={note.raw} path={path} vault={ws.vault} />
          {backlinks.length > 0 && (
            <section className="backlinks">
              <h2>このノートへのリンク</h2>
              {backlinks.map((m) => (
                <NoteRow key={m.path} meta={m} />
              ))}
            </section>
          )}
        </article>
      </main>
    </div>
  );
}

function TokenSwap({ ws }: { ws: Workspace }) {
  const [token, setToken] = useState('');
  const [state, setState] = useState<string>();
  if (!ws.config) return null;
  const swap = async () => {
    setState('確かめています…');
    const next = { ...ws.config!, token: token.trim() };
    try {
      await remoteFor(next).tree();
      await ws.store.put('meta', 'config', next);
      setState('入れ替えました。開き直します');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setState('入れ替えませんでした：' + (e as Error).message);
    }
  };
  return (
    <details className="alt">
      <summary>トークンを入れ替える</summary>
      <label className="field">
        新しいトークン
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <button disabled={!token.trim()} onClick={swap}>
        確かめて入れ替える
      </button>
      {state && <p className="hint">{state}</p>}
    </details>
  );
}

export function Settings({ ws, onReset }: { ws: Workspace; onReset: () => void }) {
  const mock = ws.mock;
  const [, force] = useState(0);
  const [path, setPath] = useState('04_Think/読み心地.md');
  const act = (fn: () => void) => () => {
    fn();
    force((n) => n + 1);
  };
  const wipe = async () => {
    const n = ws.saves.unsaved().length;
    if (!confirm(`この端末のデータを消します。${n ? `送っていない編集が${n}件あり、それも消えます。` : ''}GitHub の Vault には触りません。続けますか？`)) return;
    await wipeDevice();
    onReset();
  };
  return (
    <main className="page">
      <h1 className="page-title">設定</h1>
      <section className="block">
        <h2>接続先</h2>
        <p className="row-static">{ws.remote.label}</p>
        {mock ? (
          <div className="buttons">
            <button
              onClick={() => {
                setMode(undefined);
                onReset();
              }}
            >
              デモをやめて GitHub につなぐ
            </button>
          </div>
        ) : (
          <>
            <p className="hint">トークン・ノートの写し・下書きは端末の中で暗号化しています。10分以上アプリを離れると鍵がかかります。</p>
            <div className="buttons">
              <button onClick={() => location.reload()}>今すぐ鍵をかける</button>
            </div>
            <TokenSwap ws={ws} />
          </>
        )}
      </section>
      <section className="block">
        <h2>この端末</h2>
        <div className="buttons">
          <button onClick={wipe}>この端末のデータを消す</button>
        </div>
      </section>
      {mock && (
        <section className="block">
          <h2>失敗を起こす（デモ用）</h2>
          <p className="hint">次の保存で起きる失敗を予約します。保存・競合・復帰の動きを確かめるためのものです。</p>
          <div className="buttons">
            <button onClick={act(() => mock.inject('offline'))}>次の保存を通信断にする</button>
            <button onClick={act(() => mock.inject('lost-response'))}>次の保存の応答を消す</button>
            <button onClick={act(() => mock.inject('conflict-race'))}>次の保存の直前に別端末が更新</button>
          </div>
          <p className="hint">予約中：{mock.pendingFaults().join('、') || 'なし'}</p>
          <label className="field">
            対象ノート
            <select value={path} onChange={(e) => setPath(e.target.value)}>
              {[...ws.vault.metas.keys()].filter(writable).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <div className="buttons">
            <button
              onClick={act(() =>
                mock.externalEdit(path, (mock.peek(path) ?? '') + '\n> [!info] 別エージェントの追記\n> デモで差し込んだ更新。\n'),
              )}
            >
              別エージェントが更新した
            </button>
            <button onClick={act(() => mock.remove(path))}>このノートが移動・削除された</button>
          </div>
          <p className="hint">デモのVaultはアプリを開き直すと元に戻ります。端末の下書きは残ります。</p>
        </section>
      )}
    </main>
  );
}
