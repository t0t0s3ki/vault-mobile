import { useEffect, useRef, useState } from 'react';
import { href, useVersion, type Workspace } from '../app';
import { Icon } from './icons';
import { splitNumber } from './kit';
import { openPlus, setContext } from './plus';

/** Title from <title>, else the file name. */
function titleOf(html: string, path: string) {
  const t = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();
  return t || path.split('/').pop()!.replace(/\.html?$/i, '');
}

/**
 * One HTML file from the vault, shown in public/viewer.html inside an iframe sandboxed
 * without allow-same-origin: its scripts run under an opaque origin and cannot reach the
 * app's storage, token or page; the viewer's own policy blocks sending data out.
 */
export function FileView({ ws, path, builtIn }: { ws: Workspace; path: string; builtIn?: string }) {
  useVersion(ws.vault);
  const entry = ws.vault.entries.get(path);
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState<string>();
  const [scripts, setScripts] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (builtIn !== undefined) return setHtml(builtIn);
    if (!entry) return;
    let alive = true;
    setHtml(undefined);
    setError(undefined);
    ws.vault.fileText(entry).then(
      (t) => alive && setHtml(t),
      (e) => alive && setError(e instanceof Error && /通信|fetch|電波/.test(e.message) ? '電波が戻ったら開けます（一度開いたものは電波なしでも開けます）' : String(e?.message ?? e)),
    );
    return () => {
      alive = false;
    };
  }, [entry?.sha]);

  // Hand the document to exactly this frame, once it says it is ready. If it never does (a
  // browser that will not run scripts in an isolated frame), fall back to the still display.
  const [fellBack, setFellBack] = useState(false);
  useEffect(() => {
    if (html === undefined || !scripts) return;
    let ready = false;
    const on = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || !e.data?.viewerReady) return;
      ready = true;
      win.postMessage({ html }, '*');
    };
    addEventListener('message', on);
    const t = setTimeout(() => {
      if (!ready) {
        setFellBack(true);
        setScripts(false);
      }
    }, 3000);
    return () => {
      removeEventListener('message', on);
      clearTimeout(t);
    };
  }, [html, scripts]);

  const title = html ? titleOf(html, path) : path.split('/').pop()!.replace(/\.html?$/i, '');
  useEffect(() => {
    if (builtIn !== undefined) return;
    setContext({ kind: 'note', path, title });
    return () => setContext(null);
  }, [path, title]);

  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (
    <div className="reader file-view">
      <header className="bar raised">
        <button className="icon-btn" onClick={() => history.back()} aria-label="戻る">
          <Icon name="back" />
        </button>
        <span className="bar-center">
          <span className="bar-title on">{title}</span>
          <a className="crumb small" href={href.shelf(folder)}>
            {folder.split('/').map((c) => splitNumber(c).name).join(' › ') || 'Library'} · HTML
          </a>
        </span>
        <button className={'icon-btn' + (scripts ? '' : ' on')} onClick={() => setScripts(!scripts)} aria-label={scripts ? '動きを止めて表示' : '動きありで表示'}>
          <Icon name={scripts ? 'pause' : 'play'} />
        </button>
      </header>
      {!entry && builtIn === undefined && <p className="quiet pad">このファイルは端末の一覧にありません。最新にしてから開いてください。</p>}
      {entry && error && <p className="quiet pad">{error}</p>}
      {entry && !error && html === undefined && <p className="quiet pad">読み込んでいます…</p>}
      {fellBack && !scripts && <p className="banner warn">この端末では動きのある表示ができなかったので、止めた表示にしています。</p>}
      {html !== undefined && (
        <iframe
          key={scripts ? 'on' : 'off'}
          ref={frame}
          className="html-frame"
          title={title}
          src="./viewer.html"
          sandbox={scripts ? 'allow-scripts allow-popups allow-popups-to-escape-sandbox' : 'allow-popups allow-popups-to-escape-sandbox'}
          referrerPolicy="no-referrer"
          {...(scripts ? {} : { srcDoc: html })}
        />
      )}
      <button className="reader-plus" onClick={openPlus} aria-label="投げる（このファイルを添えて）">
        <Icon name="plus" size={24} />
      </button>
    </div>
  );
}
