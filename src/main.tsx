import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { href, openDemo, readLock, storedMode, useRoute, type Workspace } from './app';
import type { LockRecord } from './core/lock';
import { Editor } from './ui/Editor';
import { Import, Lock, Setup } from './ui/Gate';
import { Icon } from './ui/icons';
import { stamp, Toasts } from './ui/kit';
import { Home, NoteView, Search, Settings, Shelf } from './ui/screens';
import { Inbox } from './ui/inbox';
import { Now, Waiting } from './ui/now';
import { isCapture } from './ui/work';
import './styles.css';

/** After this long in the background the key is dropped and the lock screen returns. */
const RELOCK_MS = 10 * 60_000;
const IDLE_MS = 15 * 60_000;

function Nav({ active }: { active: string }) {
  const items = [
    ['home', 'いま', href.home(), 'home'],
    ['inbox', 'インボックス', href.inbox(), 'inbox'],
    ['search', '探す', href.search(), 'search'],
  ];
  return (
    <nav className="tabbar">
      {items.map(([k, label, to, icon]) => (
        <a key={k} href={to} className={active === k ? 'on' : ''}>
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

type Boot = { s: 'loading' } | { s: 'setup' } | { s: 'locked'; record: LockRecord } | { s: 'ready'; ws: Workspace } | { s: 'error'; error: string };

function App() {
  const [boot, setBoot] = useState<Boot>({ s: 'loading' });
  const [imported, setImported] = useState(false);
  const route = useRoute();

  const start = async () => {
    try {
      if (storedMode() === 'demo') return setBoot({ s: 'ready', ws: await openDemo() });
      const record = await readLock();
      setBoot(record ? { s: 'locked', record } : { s: 'setup' });
    } catch (e) {
      setBoot({ s: 'error', error: String(e) });
    }
  };
  useEffect(() => void start(), []);

  useEffect(() => {
    if (boot.s !== 'ready' || !boot.ws.key) return;
    let hiddenAt = 0;
    let touchedAt = Date.now();
    const on = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RELOCK_MS) location.reload();
      // Coming back counts as activity; the idle clock covers time spent in front only.
      else touchedAt = Date.now();
    };
    // Also drop the key when the app is left open in front without being touched.
    const touch = () => (touchedAt = Date.now());
    const idle = setInterval(() => !document.hidden && Date.now() - touchedAt > IDLE_MS && location.reload(), 30_000);
    // input/composition cover dictation and IME, which may not fire keydown.
    const events = ['pointerdown', 'keydown', 'scroll', 'input', 'compositionupdate', 'touchstart'] as const;
    document.addEventListener('visibilitychange', on);
    for (const e of events) addEventListener(e, touch, { passive: true, capture: true });
    return () => {
      document.removeEventListener('visibilitychange', on);
      for (const e of events) removeEventListener(e, touch, { capture: true });
      clearInterval(idle);
    };
  }, [boot]);

  // Refresh on launch and whenever the app comes back to the front, whatever screen is showing.
  useEffect(() => {
    if (boot.s !== 'ready') return;
    const { ws } = boot;
    const { vault } = ws;
    let running = false;
    // Captures (memo / clip / request) that could not be sent are sent as soon as possible:
    // sending is what 関 asked for. Edits to existing notes wait for an explicit save.
    const resend = () => {
      for (const d of ws.saves.unsaved())
        // "unknown" means 保存 was already pressed; captures were meant to be sent the moment they were made.
        if (d.state === 'unknown' || (d.state === 'editing' && d.body.trim() && isCapture(ws, d))) void ws.saves.save(d.path);
    };
    const refresh = (launch = false) => {
      if (document.hidden && !launch) return;
      resend();
      if (running || (vault.syncedAt && Date.now() - vault.syncedAt < 3 * 60_000)) return;
      running = true;
      vault.sync().then(
        () => (running = false),
        () => (running = false),
      );
    };
    refresh(true);
    const later = () => refresh();
    document.addEventListener('visibilitychange', later);
    addEventListener('online', later);
    return () => {
      document.removeEventListener('visibilitychange', later);
      removeEventListener('online', later);
    };
  }, [boot]);

  // "#/new": a fresh memo in the memo folder, named the way the vault already names them.
  useEffect(() => {
    if (boot.s !== 'ready' || route.name !== 'new') return;
    const { ws } = boot;
    let name = stamp();
    while (ws.vault.entries.has(`${ws.places.memos}/${name}.md`)) name = String(Number(name) + 1);
    location.replace(href.edit(`${ws.places.memos}/${name}.md`));
  }, [boot, route]);

  useEffect(() => {
    if (route.name !== 'note' && route.name !== 'edit') window.scrollTo(0, 0);
  }, [route]);

  const ready = (ws: Workspace) => setBoot({ s: 'ready', ws });
  let screen;
  if (boot.s === 'loading') screen = <div className="gate center" />;
  else if (boot.s === 'error') screen = <p className="quiet pad">起動できませんでした：{boot.error}</p>;
  else if (boot.s === 'setup') screen = <Setup onReady={ready} />;
  else if (boot.s === 'locked') screen = <Lock record={boot.record} onReady={ready} onWiped={() => setBoot({ s: 'setup' })} />;
  else if (!boot.ws.mock && !boot.ws.vault.syncedAt && !imported) screen = <Import ws={boot.ws} onDone={() => setImported(true)} />;
  else {
    const { ws } = boot;
    const full = route.name === 'note' || route.name === 'edit' || route.name === 'new';
    screen = (
      <div className={'app' + (full ? ' full' : '')}>
        {route.name === 'home' && <Now ws={ws} />}
        {route.name === 'read' && <Home ws={ws} />}
        {route.name === 'inbox' && <Inbox ws={ws} tab={route.tab} />}
        {route.name === 'waiting' && <Waiting ws={ws} />}
        {route.name === 'search' && <Search ws={ws} q={route.q} />}
        {route.name === 'shelf' && <Shelf key={route.path} ws={ws} path={route.path} />}
        {route.name === 'note' && <NoteView key={route.path} ws={ws} path={route.path} anchor={route.anchor} />}
        {route.name === 'edit' && <Editor key={route.path} ws={ws} path={route.path} />}
        {route.name === 'settings' && <Settings ws={ws} onReset={() => location.reload()} />}
        {!full && <Nav active={route.name} />}
      </div>
    );
  }
  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}

// Never run inside someone else's frame (a meta CSP cannot set frame-ancestors).
if (window.top !== window.self) {
  document.body.textContent = 'このページは単独で開いてください。';
  throw new Error('framed');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('./sw.js');
void navigator.storage?.persist?.().catch(() => {});
