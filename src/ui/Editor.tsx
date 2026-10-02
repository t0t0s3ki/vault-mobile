import { useEffect, useMemo, useRef, useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import type { DraftView } from '../core/save';
import { editableShape, lineDiff } from '../core/text';
import { writable } from '../core/vault';

function status(d: DraftView, where: string, result?: string) {
  if (d.storageError) return { tone: 'bad', text: '端末に下書きを保存できていません' };
  switch (d.state) {
    case 'saving':
      return { tone: 'busy', text: '送信中…' };
    case 'unknown':
      return { tone: 'warn', text: '届いたか確認できていません' };
    case 'conflict':
      return { tone: 'bad', text: '競合しています' };
  }
  if (d.error) return { tone: 'bad', text: d.error };
  if (d.dirty) return { tone: 'idle', text: d.persisted ? '下書き保存済み・未送信' : '下書きを保存中…' };
  if (result === 'saved' || d.savedAt) return { tone: 'ok', text: `${where}に保存しました` };
  return { tone: 'idle', text: '変更なし' };
}

export function Editor({ ws, path }: { ws: Workspace; path: string }) {
  useVersion(ws.saves);
  useVersion(ws.vault);
  const cached = ws.vault.note(path);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<string>();
  const [restored, setRestored] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!cached || !writable(path) || (!ws.saves.view(path) && !editableShape(cached.raw))) return;
    const existing = ws.saves.view(path);
    if (existing?.dirty) setRestored(true);
    ws.saves.begin(path, { sha: cached.sha, raw: cached.raw });
    setReady(true);
    return () => ws.saves.close(path);
  }, [path, !!cached]);

  // Retry a write with an unknown outcome when the connection comes back. Verification is read-first.
  useEffect(() => {
    const on = () => {
      if (ws.saves.view(path)?.state === 'unknown') void ws.saves.save(path).then(setResult);
    };
    addEventListener('online', on);
    return () => removeEventListener('online', on);
  }, [path]);

  const d = ws.saves.view(path);
  if (cached && !d && !editableShape(cached.raw))
    return (
      <main className="page">
        <p className="empty">改行コードが混ざっているため、行末を壊さずに編集できません。PCで直してください。</p>
        <a href={href.note(path)}>読む画面へ戻る</a>
      </main>
    );
  if (!writable(path))
    return (
      <main className="page">
        <p className="empty">このファイルには専用の更新手順があるため、ここでは編集しません。</p>
        <a href={href.note(path)}>読む画面へ戻る</a>
      </main>
    );
  if (!cached && !d)
    return (
      <main className="page">
        <p className="empty">端末の写しにないノートです。</p>
      </main>
    );
  if (!ready || !d) return null;

  const s = status(d, ws.mock ? 'デモVault' : 'GitHub', result);
  const save = async () => setResult(await ws.saves.save(path));

  if (d.state === 'conflict') return <Conflict ws={ws} d={d} onDone={setResult} />;

  return (
    <div className="editor">
      <header className="bar">
        <a className="bar-close" href={href.note(path)} onClick={(e) => (e.preventDefault(), history.back())}>
          閉じる
        </a>
        <span className={'save-state tone-' + s.tone}>{s.text}</span>
        <button className="bar-action primary" onClick={save} disabled={d.state === 'saving' || (!d.dirty && d.state === 'editing')}>
          {d.state === 'unknown' ? '確かめて再送' : '保存'}
        </button>
      </header>
      {restored && d.dirty && (
        <div className="banner">
          前回の下書きを復元しました。
          <button
            onClick={async () => {
              await ws.saves.discard(path);
              setRestored(false);
              ws.saves.begin(path, { sha: cached!.sha, raw: cached!.raw });
            }}
          >
            破棄して元に戻す
          </button>
        </div>
      )}
      {d.state === 'unknown' && (
        <div className="banner warn">
          保存の応答を受け取れませんでした。「確かめて再送」で、届いていたかを先に確認してから必要なときだけ送り直します。
        </div>
      )}
      <textarea
        ref={area}
        className="source"
        value={d.body}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => void ws.saves.edit(path, e.target.value)}
      />
      <footer className="editor-foot">{path}</footer>
    </div>
  );
}

function Conflict({ ws, d, onDone }: { ws: Workspace; d: DraftView; onDone: (r: string) => void }) {
  const [tab, setTab] = useState<'diff' | 'mine' | 'latest' | 'base'>('diff');
  const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const latest = d.latest;
  const diff = useMemo(() => (latest ? lineDiff(latest.text, d.body) : []), [latest?.text, d.body]);
  const copy = () => navigator.clipboard?.writeText(d.body).catch(() => {});

  if (latest === null)
    return (
      <div className="editor">
        <header className="bar">
          <span className="save-state tone-bad">移動または削除されています</span>
        </header>
        <div className="conflict">
          <p>このノートは別の場所で移動・削除されました。手元の本文は端末に残っています。ここから作り直すことはしません。</p>
          <div className="buttons">
            <button onClick={copy}>手元の本文をコピー</button>
            <button
              onClick={async () => {
                await ws.saves.discard(d.path);
                await ws.vault.refreshOne(d.path).catch(() => {});
                location.hash = href.home();
              }}
            >
              手元の本文を破棄
            </button>
          </div>
          <pre className="plain">{d.body}</pre>
        </div>
      </div>
    );

  return (
    <div className="editor">
      <header className="bar">
        <span className="save-state tone-bad">ほかの場所で更新されています</span>
      </header>
      <div className="conflict">
        <p>読んだあとに、別の端末かエージェントがこのノートを更新しました。上書きはしていません。最新を見たうえで、残す本文を決めてください。</p>
        <div className="tabs">
          {(
            [
              ['diff', '差分'],
              ['mine', '手元'],
              ['latest', '最新'],
              ['base', '読んだ時点'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'diff' && (
          <div className="diff">
            <p className="hint">
              <span className="d-del">赤＝最新にしかない行</span> <span className="d-add">緑＝手元にしかない行</span>
            </p>
            {diff.map((l, i) =>
              l.kind === 'same' ? null : (
                <div key={i} className={l.kind === 'add' ? 'd-add' : 'd-del'}>
                  {l.kind === 'add' ? '+ ' : '− '}
                  {l.text || ' '}
                </div>
              ),
            )}
          </div>
        )}
        {tab === 'mine' && <pre className="plain">{d.body}</pre>}
        {tab === 'latest' && <pre className="plain">{latest!.text}</pre>}
        {tab === 'base' && <pre className="plain">{d.baseText}</pre>}

        <h3>残す本文</h3>
        <div className="buttons">
          <button onClick={() => setText(latest!.text)}>最新から始める</button>
          <button onClick={() => setText(d.body)}>手元から始める</button>
        </div>
        <textarea className="source resolve" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="buttons">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              onDone(await ws.saves.resolve(d.path, text));
              setBusy(false);
            }}
          >
            この本文で保存
          </button>
          <button
            onClick={async () => {
              await ws.saves.discard(d.path);
              await ws.vault.refreshOne(d.path).catch(() => {});
              history.back();
            }}
          >
            手元を捨てて最新にする
          </button>
        </div>
        <p className="hint">保存の直前にもう一度、最新が変わっていないかを確かめます。</p>
      </div>
    </div>
  );
}
