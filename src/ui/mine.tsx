import { href, useVersion, type Position, type Workspace } from '../app';
import type { NoteMeta } from '../core/note';
import { Icon } from './icons';
import { ago, minutes, usePins } from './kit';
import { NoteRow, SyncButton, usePositions } from './screens';
import { useClips, useJobs } from './work';

const STATE: Record<string, string> = { queued: '順番待ち', running: '進めています', done: 'できた', failed: '止まった', vetoed: '止めた' };

/** Everything that is 関's own: what he threw in, what he asked for, what he was reading, what he pinned. */
export function Mine({ ws }: { ws: Workspace }) {
  const v = useVersion(ws.vault);
  const positions = usePositions(ws, v);
  const { pins } = usePins(ws);
  const clips = useClips(ws);
  const jobs = useJobs(ws).filter((j) => j.origin.startsWith('vault-mobile'));
  const memos = ws.vault.latestIn(ws.places.memos, 3);
  const reading = [...positions]
    .filter(([, p]) => p.ratio > 0.03 && p.ratio < 0.96)
    .map(([path, p]) => ({ meta: ws.vault.metas.get(path), p }))
    .filter((x): x is { meta: NoteMeta; p: Position } => !!x.meta)
    .sort((a, b) => b.p.at - a.p.at)
    .slice(0, 4);
  const pinned = pins.map((p) => ws.vault.metas.get(p)).filter((m): m is NoteMeta => !!m);

  return (
    <main className="page">
      <header className="home-head">
        <h1>Mine</h1>
        <a className="icon-btn" href={href.settings()} aria-label="設定">
          <Icon name="gear" />
        </a>
      </header>

      <section className="block">
        <div className="label-row">
          <h2 className="label">頼んだもの</h2>
        </div>
        {jobs.length ? (
          jobs.slice(0, 5).map((j) => {
            const art = j.artifacts.find((a) => a.endsWith('.md') && !a.includes('/jobs/'));
            const ask = (j.prompt.match(/## 依頼\n([^\n]+)/)?.[1] ?? j.slug.replace(/^mobile-/, '')).slice(0, 50);
            return (
              <a key={j.id} className="row" href={art && ws.vault.note(art) ? href.note(art) : href.note(j.path)}>
                <span className="row-main">
                  <span className="row-title">{ask}</span>
                  <span className="row-meta">
                    <span className={'chip state-' + j.status}>{STATE[j.status]}</span>
                    {ago(j.finished || j.created.slice(0, 19))}
                  </span>
                </span>
              </a>
            );
          })
        ) : (
          <p className="quiet">まだありません。下の ＋ から「トトに頼む」で渡せます。</p>
        )}
      </section>

      <section className="block">
        <div className="label-row">
          <h2 className="label">メモ</h2>
          <a href={href.inbox('memo')}>すべて</a>
        </div>
        {memos.length ? memos.map((m) => <NoteRow key={m.path} meta={m} />) : <p className="quiet">まだありません。</p>}
      </section>

      <section className="block">
        <div className="label-row">
          <h2 className="label">クリップ</h2>
          <a href={href.inbox('clip')}>すべて</a>
        </div>
        {clips.length ? (
          clips.slice(0, 3).map((c) => (
            <a key={c.path} className="row" href={href.note(c.path)}>
              <span className="row-main">
                <span className="row-title">{c.title}</span>
                <span className="row-meta">
                  <span className="chip">{c.host}</span>
                  {c.processed ? 'トトが読んだ' : 'まだリンクだけ'}
                </span>
              </span>
            </a>
          ))
        ) : (
          <p className="quiet">まだありません。URL をコピーして ＋ の「クリップ」で残せます。</p>
        )}
      </section>

      {reading.length > 0 && (
        <section className="block">
          <h2 className="label">読みかけ</h2>
          {reading.map(({ meta, p }) => (
            <NoteRow key={meta.path} meta={meta} right={`あと${minutes(meta.chars * (1 - p.ratio)).replace('約', '')}`} />
          ))}
        </section>
      )}

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
        <div className="group">
          <div className="group-row">
            <Icon name="cloud" size={20} />
            <span className="grow">{ws.vault.syncedAt ? `${ago(ws.vault.syncedAt)}に最新にしました` : 'まだ取り込んでいません'}</span>
            <SyncButton ws={ws} compact />
          </div>
        </div>
      </section>
    </main>
  );
}
