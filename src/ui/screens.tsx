import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as RTouchEvent } from 'react';
import { href, remoteFor, setMode, useVersion, wipeDevice, type Position, type Workspace } from '../app';
import { splitFrontmatter, type NoteMeta } from '../core/note';
import { toEditable } from '../core/text';
import { writable } from '../core/vault';
import { Icon } from './icons';
import { ago, minutes, setPrefs, Sheet, splitNumber, today, toast, usePins, usePrefs } from './kit';
import { Markdown, slug, toggleTaskLine } from './Markdown';

const folderLabel = (folder: string) => {
  const last = folder.split('/').pop() || 'Vault';
  return splitNumber(last.replace(/^_/, '')).name;
};

/* ——— shared rows ——— */

function NoteRow({ meta, right }: { meta: NoteMeta; right?: string }) {
  return (
    <a className="row" href={href.note(meta.path)}>
      <span className="row-main">
        <span className="row-title">{meta.title}</span>
        {meta.excerpt && <span className="row-excerpt">{meta.excerpt}</span>}
        <span className="row-meta">
          <span className="chip">{folderLabel(meta.folder)}</span>
          {right ?? ago(meta.updated)}
        </span>
      </span>
    </a>
  );
}

function usePositions(ws: Workspace, version: number) {
  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  useEffect(() => {
    const prefix = ws.remote.id + '\u0000';
    ws.store.all<Position>('positions').then(
      (rows) => setPositions(new Map(rows.filter(([k]) => k.startsWith(prefix)).map(([k, p]) => [k.slice(prefix.length), p]))),
      () => {},
    );
  }, [version]);
  return positions;
}

export function SyncButton({ ws, compact }: { ws: Workspace; compact?: boolean }) {
  useVersion(ws.vault);
  const [busy, setBusy] = useState<string>();
  const run = async (quiet = false) => {
    setBusy('確認中');
    try {
      const r = await ws.vault.sync((d, t) => t && setBusy(`${d}/${t}`));
      if (!quiet) toast(r.downloaded ? `${r.downloaded}件を更新しました` : '最新です', 'ok');
    } catch (e) {
      toast('更新できませんでした。端末の写しを表示しています', 'bad');
      console.warn(e);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <button className={'sync-btn' + (busy ? ' spinning' : '')} onClick={() => run()} disabled={!!busy} aria-label="最新にする">
      <Icon name="sync" size={18} />
      {!compact && <span>{busy ?? (ws.vault.syncedAt ? ago(ws.vault.syncedAt) : '未取得')}</span>}
    </button>
  );
}

/* ——— home ——— */

export function Home({ ws }: { ws: Workspace }) {
  const v = useVersion(ws.vault);
  useVersion(ws.saves);
  const positions = usePositions(ws, v);
  const { pins } = usePins(ws);

  const continuing = [...positions]
    .filter(([, p]) => p.ratio > 0.03 && p.ratio < 0.96)
    .map(([path, p]) => ({ meta: ws.vault.metas.get(path), p }))
    .filter((x): x is { meta: NoteMeta; p: Position } => !!x.meta)
    .sort((a, b) => b.p.at - a.p.at)
    .slice(0, 3);
  const drafts = ws.saves.unsaved();
  const memos = ws.vault.latestIn(ws.places.memos, 3);
  const fresh = ws.vault.recent(6, [ws.places.memos]);
  const projects = ws.vault.folder(ws.places.projects).folders;
  const pinned = pins.map((p) => ws.vault.metas.get(p)).filter((m): m is NoteMeta => !!m);
  const [hero, ...more] = continuing;

  return (
    <main className="page home">
      <header className="home-head">
        <div>
          <p className="date">{today()}</p>
          <h1>Vault</h1>
        </div>
        <SyncButton ws={ws} />
      </header>
      <a className="search-field" href={href.search()}>
        <Icon name="search" size={18} />
        ノートを探す
      </a>

      {drafts.length > 0 && (
        <section className="block">
          <div className="notice">
            <Icon name="alert" size={18} />
            <div>
              <strong>まだ送っていない編集が{drafts.length}件</strong>
              {drafts.map((d) => (
                <a key={d.path} href={href.edit(d.path)}>
                  {ws.vault.metas.get(d.path)?.title ?? d.path.split('/').pop()}
                  <small>{{ editing: '下書き', saving: '送信中', unknown: '届いたか未確認', conflict: '競合' }[d.state]}</small>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {hero && (
        <section className="block">
          <h2 className="label">続きから</h2>
          <a className="hero" href={href.note(hero.meta.path)}>
            <span className="hero-folder">{folderLabel(hero.meta.folder)}</span>
            <span className="hero-title">{hero.meta.title}</span>
            {hero.meta.excerpt && <span className="hero-excerpt">{hero.meta.excerpt}</span>}
            <span className="hero-foot">
              <span className="progress">
                <span style={{ width: `${Math.round(hero.p.ratio * 100)}%` }} />
              </span>
              あと{minutes(hero.meta.chars * (1 - hero.p.ratio)).replace('約', '')}
            </span>
          </a>
          {more.map(({ meta, p }) => (
            <a key={meta.path} className="row compact" href={href.note(meta.path)}>
              <span className="row-main">
                <span className="row-title">{meta.title}</span>
              </span>
              <span className="ring" style={{ ['--p' as string]: `${Math.round(p.ratio * 100)}%` }} />
            </a>
          ))}
        </section>
      )}

      <section className="block">
        <div className="label-row">
          <h2 className="label">メモ</h2>
          <a href={href.shelf(ws.places.memos)}>すべて</a>
        </div>
        {memos.length ? (
          <div className="memos">
            {memos.map((m) => (
              <a key={m.path} className="memo" href={href.note(m.path)}>
                <span className="memo-title">{m.title}</span>
                <span className="memo-excerpt">{m.excerpt}</span>
                <span className="memo-when">{ago(m.updated)}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="quiet">思いついたことは右下の「書く」から。{ws.places.memos} に1枚ずつ残ります。</p>
        )}
      </section>

      {pinned.length > 0 && (
        <section className="block">
          <h2 className="label">ピン</h2>
          <div className="pins">
            {pinned.map((m) => (
              <a key={m.path} className="pin" href={href.note(m.path)}>
                <Icon name="star" size={14} filled />
                {m.title}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h2 className="label">新しく置かれたもの</h2>
        {fresh.map((m) => (
          <NoteRow key={m.path} meta={m} />
        ))}
      </section>

      {projects.length > 0 && (
        <section className="block">
          <h2 className="label">プロジェクト</h2>
          <div className="tiles">
            {projects.map((f) => {
              const { num, name } = splitNumber(f.name);
              return (
                <a key={f.path} className="tile" href={href.shelf(f.path)}>
                  <span className="tile-name">{name}</span>
                  <span className="tile-meta">
                    {num && <span>{num}</span>}
                    <span>{f.count}件</span>
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}
      <a className="fab" href="#/new" aria-label="メモを書く">
        <Icon name="pencil" size={20} />
        書く
      </a>
    </main>
  );
}

/* ——— search ——— */

/**
 * Recent queries reveal what the notes are about, so they live in the sealed store
 * (not localStorage, which any page on the same origin could read).
 */
let recentQueries: string[] | null = null;
function useQueries(ws: Workspace) {
  const key = ws.remote.id + '\u0000queries';
  const [list, setList] = useState<string[]>(recentQueries ?? []);
  useEffect(() => {
    try {
      localStorage.removeItem('vault-mobile.queries'); // from the first versions
    } catch {
      /* nothing stored */
    }
    if (recentQueries) return;
    ws.store.get<string[]>('meta', key).then((q) => setList((recentQueries = q ?? [])), () => {});
  }, []);
  const remember = (q: string) => {
    if (!q.trim()) return;
    recentQueries = [q, ...(recentQueries ?? []).filter((x) => x !== q)].slice(0, 8);
    setList(recentQueries);
    void ws.store.put('meta', key, recentQueries).catch(() => {});
  };
  return { queries: list, rememberQuery: remember };
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="hit-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Search({ ws, q }: { ws: Workspace; q: string }) {
  const v = useVersion(ws.vault);
  const [query, setQuery] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const positions = usePositions(ws, v);
  useEffect(() => {
    if (!q) input.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => history.replaceState(null, '', href.search(query)), 300);
    return () => clearTimeout(t);
  }, [query]);
  const hits = useMemo(() => ws.vault.search(query), [query, v]);
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const named = hits.filter((h) => h.score >= 4000);
  const inBody = hits.filter((h) => h.score < 4000);
  const opened = [...positions]
    .sort((a, b) => b[1].at - a[1].at)
    .map(([p]) => ws.vault.metas.get(p))
    .filter((m): m is NoteMeta => !!m)
    .slice(0, 6);
  const { queries, rememberQuery } = useQueries(ws);
  const hit = (h: (typeof hits)[number]) => (
    <a key={h.meta.path} className="row" href={href.note(h.meta.path)} onClick={() => rememberQuery(query)}>
      <span className="row-main">
        <span className="row-title">
          <Highlight text={h.meta.title} terms={terms} />
        </span>
        {h.snippet && h.score < 4000 && (
          <span className="row-excerpt">
            <Highlight text={h.snippet} terms={terms} />
          </span>
        )}
        <span className="row-meta">
          <span className="chip">{folderLabel(h.meta.folder)}</span>
          {ago(h.meta.updated)}
        </span>
      </span>
    </a>
  );

  return (
    <main className="page">
      <div className="search-bar">
        <label className="search-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            placeholder="タイトル・別名・本文"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (rememberQuery(query), (e.target as HTMLInputElement).blur())}
          />
          {query && (
            <button className="icon-btn" onClick={() => (setQuery(''), input.current?.focus())} aria-label="消す">
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
      </div>
      {!query && (
        <>
          <nav className="now-links top">
            <a href={href.shelf('')}>
              <Icon name="shelf" size={18} /> 棚から探す
            </a>
            <a href={href.read()}>
              <Icon name="note" size={18} /> 読みかけ・ピン
            </a>
          </nav>
          {queries.length > 0 && (
            <section className="block">
              <h2 className="label">最近の検索</h2>
              <div className="pins">
                {queries.map((x) => (
                  <button key={x} className="pin" onClick={() => setQuery(x)}>
                    {x}
                  </button>
                ))}
              </div>
            </section>
          )}
          {opened.length > 0 && (
            <section className="block">
              <h2 className="label">最近開いた</h2>
              {opened.map((m) => (
                <NoteRow key={m.path} meta={m} />
              ))}
            </section>
          )}
          <p className="quiet">端末の写しを探すので、電波がなくても使えます。#タグ でも探せます。</p>
        </>
      )}
      {query && !hits.length && <p className="quiet">「{query}」は見つかりませんでした。言い方を変えるか、短くしてみてください。</p>}
      {named.length > 0 && (
        <section className="block">
          <h2 className="label">タイトル・別名</h2>
          {named.map(hit)}
        </section>
      )}
      {inBody.length > 0 && (
        <section className="block">
          <h2 className="label">本文</h2>
          {inBody.map(hit)}
        </section>
      )}
    </main>
  );
}

/* ——— shelf ——— */

export function Shelf({ ws, path }: { ws: Workspace; path: string }) {
  useVersion(ws.vault);
  const { folders, notes } = ws.vault.folder(path);
  const crumbs = path ? path.split('/') : [];
  const isMemos = path === ws.places.memos;
  return (
    <main className="page">
      {path ? (
        <header className="shelf-head">
          <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
            <Icon name="back" />
          </button>
          <div>
            <p className="crumbs">{crumbs.slice(0, -1).map((c) => splitNumber(c).name).join(' / ') || 'Vault'}</p>
            <h1>{folderLabel(path)}</h1>
          </div>
        </header>
      ) : (
        <header className="home-head">
          <h1>棚</h1>
        </header>
      )}
      {folders.length > 0 && (
        <section className="block">
          {folders.map((f) => {
            const { num, name } = splitNumber(f.name);
            return (
              <a key={f.path} className="row folder" href={href.shelf(f.path)}>
                <Icon name="folder" size={20} />
                <span className="row-main">
                  <span className="row-title">{name}</span>
                </span>
                <span className="row-side">
                  {num && <span className="num">{num}</span>}
                  {f.count}
                </span>
              </a>
            );
          })}
        </section>
      )}
      {notes.length > 0 && (
        <section className="block">
          {folders.length > 0 && <h2 className="label">ノート</h2>}
          {notes.map((m) => (
            <NoteRow key={m.path} meta={m} />
          ))}
        </section>
      )}
      {!folders.length && !notes.length && <p className="quiet">ノートがありません</p>}
      {isMemos && (
        <a className="fab" href="#/new" aria-label="メモを書く">
          <Icon name="pencil" size={20} />
          書く
        </a>
      )}
    </main>
  );
}

/* ——— reader ——— */

function ReadSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePrefs();
  return (
    <Sheet open={open} onClose={onClose} title="読みやすさ">
      <div className="seg">
        <button className={p.font === 'mincho' ? 'on' : ''} onClick={() => setPrefs({ font: 'mincho' })} style={{ fontFamily: 'var(--serif)' }}>
          明朝
        </button>
        <button className={p.font === 'gothic' ? 'on' : ''} onClick={() => setPrefs({ font: 'gothic' })}>
          ゴシック
        </button>
      </div>
      <div className="size-row">
        <button className="icon-btn" onClick={() => setPrefs({ size: Math.max(14, p.size - 1) })} aria-label="小さく">
          <span style={{ fontSize: 14 }}>あ</span>
        </button>
        <input type="range" min={14} max={22} value={p.size} onChange={(e) => setPrefs({ size: Number(e.target.value) })} aria-label="文字の大きさ" />
        <button className="icon-btn" onClick={() => setPrefs({ size: Math.min(22, p.size + 1) })} aria-label="大きく">
          <span style={{ fontSize: 22 }}>あ</span>
        </button>
      </div>
      <div className="seg">
        <button className={!p.airy ? 'on' : ''} onClick={() => setPrefs({ airy: false })}>
          行間ふつう
        </button>
        <button className={p.airy ? 'on' : ''} onClick={() => setPrefs({ airy: true })}>
          行間ひろめ
        </button>
      </div>
    </Sheet>
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
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sheet, setSheet] = useState<'toc' | 'type' | null>(null);
  const [pending, setPending] = useState<Map<number, boolean>>(new Map());
  const [heads, setHeads] = useState<{ id: string; text: string; level: number }[]>([]);
  const { pins, toggle: togglePin } = usePins(ws);
  const prefs = usePrefs();
  const swipe = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const [drag, setDrag] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !note) return;
    setHeads([...el.querySelectorAll('article h2, article h3')].map((h) => ({ id: h.id, text: h.textContent ?? '', level: h.tagName === 'H2' ? 2 : 3 })));
    if (anchor) {
      document.getElementById(slug(anchor))?.scrollIntoView();
      return;
    }
    let alive = true;
    ws.store.get<Position>('positions', posKey).then((p) => {
      if (alive && p && p.ratio > 0.02 && p.ratio < 0.98) el.scrollTop = p.ratio * (el.scrollHeight - el.clientHeight);
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
      const max = el.scrollHeight - el.clientHeight;
      setScrolled(el.scrollTop > 80);
      setProgress(max > 0 ? el.scrollTop / max : 1);
      clearTimeout(t);
      t = setTimeout(() => {
        if (max > 0) void ws.store.put('positions', posKey, { ratio: el.scrollTop / max, at: Date.now() }).catch(() => {});
      }, 400);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      el.removeEventListener('scroll', on);
      clearTimeout(t);
    };
  }, [path]);

  // iOS home-screen apps have no system back swipe; give the left edge one.
  const onTouchStart = (e: RTouchEvent) => {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, on: t.clientX < 28 };
  };
  const onTouchMove = (e: RTouchEvent) => {
    const s = swipe.current;
    if (!s?.on) return;
    const dx = e.touches[0].clientX - s.x,
      dy = Math.abs(e.touches[0].clientY - s.y);
    if (dy > 40 && dx < 30) return void (s.on = false), setDrag(0);
    setDrag(Math.max(0, dx));
  };
  const onTouchEnd = () => {
    if (swipe.current?.on && drag > 90) history.back();
    swipe.current = null;
    setDrag(0);
  };

  if (!note || !meta)
    return (
      <main className="page">
        <header className="shelf-head">
          <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
            <Icon name="back" />
          </button>
        </header>
        <p className="quiet">このノートは端末の写しにありません。ホームの更新ボタンで最新にしてから開いてください。</p>
      </main>
    );

  const fm = splitFrontmatter(note.raw);
  const hasH1 = /^#\s+/.test(fm.body.trimStart());
  const backlinks = ws.vault.backlinks(path);
  const canEdit = writable(path);
  const pinned = pins.includes(path);

  const onTask = async (line: number, checked: boolean) => {
    if (!canEdit) return toast('このファイルは専用の手順で更新するので、ここでは読むだけです', 'info');
    const cur = ws.saves.view(path);
    if (cur?.dirty) return toast('編集中の下書きがあります。先に編集画面で保存してください', 'info', { label: '開く', run: () => (location.hash = href.edit(path)) });
    const base = ws.vault.note(path)!;
    const next = toggleTaskLine(toEditable(base.raw).body, line, checked);
    if (next === null) return toast('この行は書き換えられませんでした', 'bad');
    setPending((m) => new Map(m).set(line, checked));
    ws.saves.begin(path, { sha: base.sha, raw: base.raw });
    await ws.saves.edit(path, next);
    const r = await ws.saves.save(path);
    setPending((m) => {
      const n = new Map(m);
      n.delete(line);
      return n;
    });
    if (r === 'saved') {
      ws.saves.close(path);
      toast(checked ? '完了にしました' : '完了を外しました', 'ok');
    } else if (r === 'conflict') toast('ほかの場所で更新されていました', 'bad', { label: '確かめる', run: () => (location.hash = href.edit(path)) });
    else toast('まだ送れていません。編集画面から送り直せます', 'bad', { label: '開く', run: () => (location.hash = href.edit(path)) });
  };

  return (
    <div className="reader" style={drag ? { transform: `translateX(${drag}px)`, transition: 'none' } : undefined} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <header className={'bar' + (scrolled ? ' raised' : '')}>
        <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
          <Icon name="back" />
        </button>
        <span className={'bar-title' + (scrolled ? ' on' : '')}>{meta.title}</span>
        <button className={'icon-btn' + (pinned ? ' on' : '')} onClick={() => togglePin(path)} aria-label={pinned ? 'ピンを外す' : 'ピンを付ける'}>
          <Icon name="star" filled={pinned} />
        </button>
        {heads.length >= 3 && (
          <button className="icon-btn" onClick={() => setSheet('toc')} aria-label="目次">
            <Icon name="list" />
          </button>
        )}
        <button className="icon-btn" onClick={() => setSheet('type')} aria-label="読みやすさ">
          <Icon name="type" />
        </button>
        {canEdit && (
          <a className={'icon-btn' + (draft?.dirty ? ' dot' : '')} href={href.edit(path)} aria-label="編集">
            <Icon name="pencil" />
          </a>
        )}
        <span className="read-progress" style={{ transform: `scaleX(${progress})` }} />
      </header>
      <main className="note" ref={scroller}>
        <article className={'font-' + prefs.font + (prefs.airy ? ' airy' : '')} style={{ ['--read-size' as string]: prefs.size + 'px' }}>
          <a className="crumb" href={href.shelf(meta.folder)}>
            {meta.folder.split('/').map((c) => splitNumber(c).name).join(' › ') || 'Vault'}
          </a>
          {!hasH1 && <h1>{meta.title}</h1>}
          <div className="meta-line">
            {meta.updated && <span>{ago(meta.updated)}</span>}
            <span>{minutes(meta.chars)}</span>
            {meta.status && <span>{meta.status}</span>}
            {!canEdit && <span>読むだけ</span>}
          </div>
          {fm.error && <p className="warn">{fm.error}。原文はそのまま残しています。</p>}
          <Markdown raw={note.raw} path={path} vault={ws.vault} onTask={onTask} pending={pending} />
          {(meta.tags.length > 0 || fm.yaml) && (
            <footer className="note-foot">
              {meta.tags.length > 0 && (
                <div className="pins">
                  {meta.tags.map((t) => (
                    <a key={t} href={href.search('#' + t)} className="pin">
                      #{t}
                    </a>
                  ))}
                </div>
              )}
              {fm.yaml && (
                <details className="props">
                  <summary>プロパティ</summary>
                  <pre>{fm.yaml}</pre>
                </details>
              )}
            </footer>
          )}
          {backlinks.length > 0 && (
            <section className="backlinks">
              <h2 className="label">このノートを参照している</h2>
              {backlinks.slice(0, 20).map((m) => (
                <NoteRow key={m.path} meta={m} />
              ))}
            </section>
          )}
        </article>
      </main>
      <Sheet open={sheet === 'toc'} onClose={() => setSheet(null)} title="目次">
        {heads.map((h) => (
          <button
            key={h.id}
            className={'toc-item lv' + h.level}
            onClick={() => {
              setSheet(null);
              document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            {h.text}
          </button>
        ))}
      </Sheet>
      <ReadSettings open={sheet === 'type'} onClose={() => setSheet(null)} />
    </div>
  );
}

/* ——— settings ——— */

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
    <details className="group-item">
      <summary>トークンを入れ替える</summary>
      <p className="quiet">期限が切れたときや、作り直したときに。</p>
      <input className="text" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="github_pat_…" />
      <button className="btn" disabled={!token.trim()} onClick={swap}>
        確かめて入れ替える
      </button>
      {state && <p className="quiet">{state}</p>}
    </details>
  );
}

function PlacesEdit({ ws }: { ws: Workspace }) {
  const [projects, setProjects] = useState(ws.places.projects);
  const [memos, setMemos] = useState(ws.places.memos);
  if (!ws.config) return null;
  const save = async () => {
    await ws.store.put('meta', 'config', { ...ws.config!, projects: projects.trim(), memos: memos.trim() });
    toast('保存しました。開き直します', 'ok');
    setTimeout(() => location.reload(), 600);
  };
  return (
    <details className="group-item">
      <summary>フォルダの場所</summary>
      <label className="field">
        メモを書く場所
        <input className="text" value={memos} onChange={(e) => setMemos(e.target.value)} autoCapitalize="off" autoCorrect="off" />
      </label>
      <label className="field">
        ホームに並べるプロジェクト
        <input className="text" value={projects} onChange={(e) => setProjects(e.target.value)} autoCapitalize="off" autoCorrect="off" />
      </label>
      <button className="btn" onClick={save}>
        保存
      </button>
    </details>
  );
}

export function Settings({ ws, onReset }: { ws: Workspace; onReset: () => void }) {
  useVersion(ws.vault);
  const mock = ws.mock;
  const [, force] = useState(0);
  const [path, setPath] = useState('04_Think/読み心地.md');
  const act = (fn: () => void) => () => {
    fn();
    force((n) => n + 1);
    toast('次の保存で起きます', 'info');
  };
  const wipe = async () => {
    const n = ws.saves.unsaved().length;
    if (!confirm(`この端末のデータを消します。${n ? `送っていない編集が${n}件あり、それも消えます。` : ''}GitHub の Vault には触りません。続けますか？`)) return;
    await wipeDevice();
    onReset();
  };
  return (
    <main className="page">
      <header className="home-head">
        <h1>設定</h1>
      </header>

      <section className="block">
        <h2 className="label">つないでいる Vault</h2>
        <div className="group">
          <div className="group-row">
            <Icon name={mock ? 'note' : 'cloud'} size={20} />
            <span className="grow">{ws.remote.label}</span>
          </div>
          <div className="group-row">
            <Icon name="clock" size={20} />
            <span className="grow">{ws.vault.syncedAt ? `${ago(ws.vault.syncedAt)}に更新・${ws.vault.metas.size}本` : 'まだ取り込んでいません'}</span>
            <SyncButton ws={ws} compact />
          </div>
          {!mock && <PlacesEdit ws={ws} />}
        </div>
      </section>

      {!mock && (
        <section className="block">
          <h2 className="label">鍵</h2>
          <div className="group">
            <p className="group-note">トークン・ノートの写し・下書きは、この端末の中で暗号化しています。10分アプリを離れると鍵がかかります。</p>
            <button className="group-row action" onClick={() => location.reload()}>
              <Icon name="lock" size={20} />
              <span className="grow">今すぐ鍵をかける</span>
            </button>
            <TokenSwap ws={ws} />
          </div>
        </section>
      )}

      {mock && (
        <section className="block">
          <h2 className="label">デモ：失敗を起こしてみる</h2>
          <div className="group">
            <p className="group-note">次の保存で起きることを予約します。予約中：{mock.pendingFaults().join('、') || 'なし'}</p>
            <button className="group-row action" onClick={act(() => mock.inject('offline'))}>
              <span className="grow">通信が切れる</span>
            </button>
            <button className="group-row action" onClick={act(() => mock.inject('lost-response'))}>
              <span className="grow">保存はされたが、応答が届かない</span>
            </button>
            <button className="group-row action" onClick={act(() => mock.inject('conflict-race'))}>
              <span className="grow">保存の直前に別の端末が更新する</span>
            </button>
            <label className="field pad">
              対象のノート
              <select value={path} onChange={(e) => setPath(e.target.value)}>
                {[...ws.vault.metas.keys()].filter(writable).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <button
              className="group-row action"
              onClick={() => {
                mock.externalEdit(path, (mock.peek(path) ?? '') + '\n> [!info] 別エージェントの追記\n> デモで差し込んだ更新。\n');
                toast('別エージェントが更新しました', 'info');
              }}
            >
              <span className="grow">いま別のエージェントが更新した</span>
            </button>
            <button
              className="group-row action"
              onClick={() => {
                mock.remove(path);
                toast('移動・削除しました', 'info');
              }}
            >
              <span className="grow">いま移動・削除された</span>
            </button>
          </div>
          <div className="group">
            <button
              className="group-row action"
              onClick={() => {
                setMode(undefined);
                onReset();
              }}
            >
              <Icon name="cloud" size={20} />
              <span className="grow">デモをやめて GitHub につなぐ</span>
            </button>
          </div>
        </section>
      )}

      <section className="block">
        <h2 className="label">この端末</h2>
        <div className="group">
          <button className="group-row action danger" onClick={wipe}>
            <span className="grow">この端末のデータを消す</span>
          </button>
        </div>
        <p className="quiet">GitHub の Vault は消えません。消したあとは、つなぎ直せば元に戻ります。</p>
      </section>
    </main>
  );
}
