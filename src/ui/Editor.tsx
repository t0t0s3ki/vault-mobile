import { useEffect, useMemo, useRef, useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { isNewDraft, takeSeed, withFront } from '../core/drafts';
import type { DraftView } from '../core/save';
import { editableShape, lineDiff } from '../core/text';
import { writable } from '../core/vault';
import { Icon } from './icons';
import { toast } from './kit';

function status(d: DraftView, where: string) {
  if (d.storageError) return { tone: 'bad', text: '端末に保存できていません' };
  switch (d.state) {
    case 'saving':
      return { tone: 'busy', text: '送っています…' };
    case 'unknown':
      return { tone: 'warn', text: '届いたか未確認' };
    case 'conflict':
      return { tone: 'bad', text: '競合しています' };
  }
  if (d.error) return { tone: 'bad', text: d.error };
  if (d.dirty) return { tone: 'idle', text: d.persisted ? 'この端末に保存済み' : '保存中…' };
  if (d.savedAt) return { tone: 'ok', text: `${where}に保存しました` };
  return { tone: 'idle', text: '' };
}

/** Follow the on-screen keyboard so the toolbar sits right above it. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return inset;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Editor({ ws, path }: { ws: Workspace; path: string }) {
  useVersion(ws.saves);
  useVersion(ws.vault);
  const cached = ws.vault.note(path);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const inset = useKeyboardInset();
  const isNew = !cached;
  const isDraft = isNew && isNewDraft(ws.places.drafts, path);

  useEffect(() => {
    const existing = ws.saves.view(path);
    if (existing) {
      if (existing.dirty && cached) setRestored(true);
      setReady(true);
    } else if (cached && writable(path) && editableShape(cached.raw)) {
      ws.saves.begin(path, { sha: cached.sha, raw: cached.raw });
      setReady(true);
    } else if (!cached && writable(path) && /^\d{12,14}\.md$/.test(path.slice(ws.places.memos.length + 1)) && path.startsWith(ws.places.memos + '/')) {
      // Only a memo named like the vault's memos, directly in the memo folder, may be created from a link.
      // A path in the memo folder that does not exist yet is a new memo; the first save creates it.
      ws.saves.begin(path, { sha: '', raw: '' });
      setReady(true);
    } else if (!cached && writable(path) && isNewDraft(ws.places.drafts, path)) {
      // Same rule for a long-form draft: only today's "無題" name, directly in the drafts folder.
      ws.saves.begin(path, { sha: '', raw: '' });
      const seed = takeSeed();
      if (seed) void ws.saves.edit(path, seed);
      setReady(true);
    }
    return () => ws.saves.close(path);
  }, [path]);

  // Start at the end: on a phone most edits are additions.
  useEffect(() => {
    const el = area.current;
    if (!ready || !el) return;
    if (isNew) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [ready]);

  // A write with an unknown outcome is re-checked (read first) when the connection returns.
  useEffect(() => {
    const on = () => {
      if (ws.saves.view(path)?.state === 'unknown') void ws.saves.save(path);
    };
    addEventListener('online', on);
    return () => removeEventListener('online', on);
  }, [path]);

  const d = ws.saves.view(path);
  const back = () => (history.length > 1 ? history.back() : (location.hash = href.home()));

  if (cached && !d && !editableShape(cached.raw))
    return <Blocked text="改行コードが混ざっているため、行末を壊さずに編集できません。PC で直してください。" path={path} />;
  if (!writable(path)) return <Blocked text="このファイルには専用の更新手順があるので、ここでは編集しません。" path={path} />;
  if (!ready || !d) return <Blocked text="このノートは端末の写しにありません。" path={path} />;

  const where = ws.mock ? 'デモ Vault' : 'GitHub';
  const s = status(d, where);
  const save = async () => {
    // A new draft gets the desk app's frontmatter on its first save; the editor shows only the text.
    if (isDraft) await ws.saves.edit(path, withFront(ws.saves.view(path)!.body));
    const r = await ws.saves.save(path);
    if (r === 'saved') {
      toast(`${where}に保存しました`, 'ok');
      if (isNew) location.replace(href.note(path));
      else back();
    }
  };

  if (d.state === 'conflict') return <Conflict ws={ws} d={d} />;

  const insert = (prefix: string, wrap?: [string, string]) => {
    const el = area.current!;
    const { selectionStart: a, selectionEnd: b, value } = el;
    let next: string, caret: number;
    if (wrap) {
      next = value.slice(0, a) + wrap[0] + value.slice(a, b) + wrap[1] + value.slice(b);
      caret = a + wrap[0].length + (b - a);
    } else {
      const lineStart = value.lastIndexOf('\n', a - 1) + 1;
      next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      caret = a + prefix.length;
    }
    void ws.saves.edit(path, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const toEnd = () => {
    const el = area.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  };

  const canSave = d.state === 'unknown' || (d.dirty && d.state === 'editing');

  return (
    <div className="editor">
      <header className="bar">
        <button className="icon-btn" onClick={back} aria-label={d.dirty ? '閉じる（書きかけはこの端末に残る）' : '閉じる'}>
          <Icon name="back" />
        </button>
        <span className="bar-center">
          <span className="bar-title on">{isDraft ? '新しい原稿' : isNew ? '新しいメモ' : ws.vault.metas.get(path)?.title}</span>
          {s.text && <span className={'save-state tone-' + s.tone}>{s.text}</span>}
        </span>
        <button className="pill-btn" onClick={save} disabled={!canSave || d.state === 'saving'}>
          {d.state === 'unknown' ? '確かめて送る' : '保存'}
        </button>
      </header>
      {restored && d.dirty && (
        <div className="banner">
          前回の書きかけを戻しました。
          <button
            onClick={async () => {
              await ws.saves.discard(path);
              setRestored(false);
              ws.saves.begin(path, { sha: cached!.sha, raw: cached!.raw });
            }}
          >
            捨てて元に戻す
          </button>
        </div>
      )}
      {d.state === 'unknown' && (
        <div className="banner warn">保存の返事が届きませんでした。「確かめて送る」で、届いていたかを先に確かめます。届いていなければ送り直します。</div>
      )}
      {d.error && d.state === 'editing' && <div className="banner warn">{d.error}</div>}
      <textarea
        ref={area}
        className="source"
        value={d.body}
        placeholder={isDraft ? 'じっくり書く。閉じても書きかけはこの端末に残ります' : isNew ? '思いついたことを書く。最初の行が題名になります' : ''}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e) => void ws.saves.edit(path, e.target.value)}
        style={{ paddingBottom: inset + 64 }}
      />
      <div className="kbd-bar" style={{ bottom: inset }}>
        <button onClick={() => insert('- [ ] ')} aria-label="タスク">
          <Icon name="task" size={20} />
        </button>
        <button onClick={() => insert('- ')} aria-label="箇条書き">
          <Icon name="bullet" size={20} />
        </button>
        <button onClick={() => insert('## ')} aria-label="見出し">
          <Icon name="heading" size={20} />
        </button>
        <button onClick={() => insert('', ['[[', ']]'])} aria-label="リンク">
          <Icon name="link" size={20} />
        </button>
        <button onClick={() => insert('', [todayIso(), ''])} aria-label="今日の日付">
          <Icon name="calendar" size={20} />
        </button>
        <button onClick={toEnd} aria-label="末尾へ">
          末尾
        </button>
      </div>
    </div>
  );
}

function Blocked({ text, path }: { text: string; path: string }) {
  return (
    <main className="page">
      <header className="shelf-head">
        <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
          <Icon name="back" />
        </button>
      </header>
      <p className="quiet">{text}</p>
      <a className="btn" href={href.note(path)}>
        読む画面へ
      </a>
    </main>
  );
}

function Conflict({ ws, d }: { ws: Workspace; d: DraftView }) {
  const [tab, setTab] = useState<'diff' | 'mine' | 'latest'>('diff');
  const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const latest = d.latest;
  const diff = useMemo(() => (latest ? lineDiff(latest.text, d.body) : []), [latest?.text, d.body]);
  const copy = () => navigator.clipboard?.writeText(d.body).then(() => toast('手元の本文をコピーしました', 'ok'), () => toast('コピーできませんでした', 'bad'));

  if (latest === null)
    return (
      <div className="editor">
        <header className="bar">
          <span className="bar-center">
            <span className="bar-title on">移動または削除されています</span>
          </span>
        </header>
        <div className="conflict">
          <p>このノートは、書いているあいだに別の場所で移動か削除をされました。手元の本文はこの端末に残っています。</p>
          <div className="buttons">
            <button className="btn primary" onClick={copy}>
              手元の本文をコピー
            </button>
            <button
              className="btn"
              onClick={async () => {
                await ws.saves.discard(d.path);
                await ws.vault.refreshOne(d.path).catch(() => {});
                location.hash = href.home();
              }}
            >
              手元を捨てる
            </button>
          </div>
          <pre className="plain">{d.body}</pre>
        </div>
      </div>
    );

  return (
    <div className="editor">
      <header className="bar">
        <span className="bar-center">
          <span className="bar-title on">ほかの場所で更新されています</span>
        </span>
      </header>
      <div className="conflict">
        <p>書いているあいだに、別の端末かエージェントがこのノートを更新しました。上書きはしていません。違いを見て、残す本文を決めてください。</p>
        <div className="seg">
          {(
            [
              ['diff', '違い'],
              ['mine', '手元'],
              ['latest', '最新'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'diff' && (
          <div className="diff">
            <p className="quiet">
              <span className="d-del">赤＝最新にだけある行</span> <span className="d-add">緑＝手元にだけある行</span>
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

        <h3>残す本文</h3>
        <div className="buttons">
          <button className="btn" onClick={() => setText(latest!.text)}>
            最新から始める
          </button>
          <button className="btn" onClick={() => setText(d.body)}>
            手元から始める
          </button>
        </div>
        <textarea className="source resolve" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="buttons">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await ws.saves.resolve(d.path, text);
              setBusy(false);
              if (r === 'saved') toast('保存しました', 'ok');
            }}
          >
            この本文で保存
          </button>
          <button
            className="btn"
            onClick={async () => {
              await ws.saves.discard(d.path);
              await ws.vault.refreshOne(d.path).catch(() => {});
              history.back();
            }}
          >
            手元を捨てて最新にする
          </button>
        </div>
        <p className="quiet">保存の直前にもう一度、最新が変わっていないかを確かめます。</p>
      </div>
    </div>
  );
}
