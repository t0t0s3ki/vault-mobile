import { useState } from 'react';
import type { Workspace } from '../app';
import { splitFrontmatter } from '../core/note';
import { appendRemote } from '../core/writes';
import { Icon } from './icons';
import { toast } from './kit';
import { captureJob } from './work';

/**
 * A note Thoth wrote back for a phone request. Decided by where it is, not by what it says about
 * itself: any note could claim `type: mobile-request` to get a reply box.
 */
export function isResult(path: string, raw: string) {
  return /^00_Cockpit\/thinking\/スマホ依頼_\d{8}-\d{2,}_[^/]+\.md$/.test(path) && splitFrontmatter(raw).data.type === 'mobile-request';
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 関's answer to a result, kept in the result itself so the next agent (a chat session or the
 * morning run) finds it where the work is. "直して" also queues the next request.
 */
export function Reply({ ws, path }: { ws: Workspace; path: string }) {
  const [mode, setMode] = useState<'idle' | 'fix'>('idle');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const replied = /## 関の返事/.test(ws.vault.note(path)?.raw ?? '');

  const write = async (verdict: string, extra = '') => {
    setBusy(true);
    const block = `## 関の返事（スマホ・${stamp()}）\n\n- ${verdict}${text.trim() ? '：' + text.trim().replace(/\n+/g, ' ') : ''}${extra}`;
    const r = await appendRemote(ws.remote, ws.vault, path, block, `mobile: 返事 ${path}`);
    setBusy(false);
    if (r.ok) {
      setText('');
      setMode('idle');
    }
    return r;
  };

  const go = async () => {
    const r = await write('これで進めて');
    toast(r.ok ? '返しました。次に動くトトが拾います' : r.reason, r.ok ? 'ok' : 'bad');
  };
  const later = async () => {
    const r = await write('あとで');
    toast(r.ok ? '返しました' : r.reason, r.ok ? 'ok' : 'bad');
  };
  const fix = async () => {
    if (!text.trim()) return toast('どこを直してほしいか一言ください', 'info');
    setBusy(true);
    const { r, id } = await captureJob(ws, `前の結果を直して：${text.trim()}`, 'draft', `前の結果: ${path}（これを読んでから直す。前の結果は書き換えず、新しい1枚に書く）`);
    setBusy(false);
    if (r !== 'saved') return toast('電波が戻ったら自動で送ります', 'bad');
    const w = await write('直してほしい', `（→ ${id}）`);
    toast(w.ok ? 'トトに直しを頼みました' : 'トトには頼みました。返事の書き込みは失敗しました', w.ok ? 'ok' : 'bad');
  };

  return (
    <section className="reply">
      <h2 className="label">トトへの返事</h2>
      <p>{replied ? 'もう返事をしています。重ねて返すこともできます。' : 'このノートの末尾に書き足します。次に動くトトが拾います。'}</p>
      {mode === 'fix' ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="どこを、どう直してほしいか" rows={3} autoFocus />
          <div className="capture-actions">
            <button className="chip-btn" onClick={() => setMode('idle')}>
              戻る
            </button>
            <button className="chip-btn strong" disabled={busy} onClick={fix}>
              <Icon name="send" size={16} /> 直しを頼む
            </button>
          </div>
        </>
      ) : (
        <div className="capture-actions">
          <button className="chip-btn strong" disabled={busy} onClick={go}>
            <Icon name="check" size={16} /> これで進めて
          </button>
          <button className="chip-btn" disabled={busy} onClick={() => setMode('fix')}>
            直してほしい
          </button>
          <button className="chip-btn" disabled={busy} onClick={later}>
            あとで
          </button>
        </div>
      )}
    </section>
  );
}
