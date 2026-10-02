import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { href, openDemo, readLock, storedMode, useRoute, type Workspace } from './app';
import type { LockRecord } from './core/lock';
import { Editor } from './ui/Editor';
import { Lock, Setup } from './ui/Gate';
import { Home, NoteView, Search, Settings, Shelf } from './ui/screens';
import './styles.css';

/** After this long in the background the key is dropped and the lock screen returns. */
const RELOCK_MS = 10 * 60_000;

function Nav({ active }: { active: string }) {
  const items = [
    ['home', 'ホーム', href.home()],
    ['search', '探す', href.search()],
    ['shelf', '棚', href.shelf('')],
    ['settings', '設定', href.settings()],
  ];
  return (
    <nav className="tabbar">
      {items.map(([k, label, to]) => (
        <a key={k} href={to} className={active === k ? 'on' : ''}>
          {label}
        </a>
      ))}
    </nav>
  );
}

type Boot = { s: 'loading' } | { s: 'setup' } | { s: 'locked'; record: LockRecord } | { s: 'ready'; ws: Workspace } | { s: 'error'; error: string };

function App() {
  const [boot, setBoot] = useState<Boot>({ s: 'loading' });
  const route = useRoute();

  const start = async () => {
    try {
      const mode = storedMode();
      if (mode === 'demo') return setBoot({ s: 'ready', ws: await openDemo() });
      const record = await readLock();
      setBoot(record ? { s: 'locked', record } : { s: 'setup' });
    } catch (e) {
      setBoot({ s: 'error', error: String(e) });
    }
  };
  useEffect(() => void start(), []);

  // Drop the key after a while in the background. Drafts are already on the device, sealed.
  useEffect(() => {
    if (boot.s !== 'ready' || !boot.ws.key) return;
    let hiddenAt = 0;
    const on = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RELOCK_MS) location.reload();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [boot]);

  useEffect(() => {
    if (route.name !== 'note') window.scrollTo(0, 0);
  }, [route]);

  const ready = (ws: Workspace) => setBoot({ s: 'ready', ws });
  if (boot.s === 'loading') return <p className="empty">開いています…</p>;
  if (boot.s === 'error') return <p className="empty">起動できませんでした：{boot.error}</p>;
  if (boot.s === 'setup') return <Setup onReady={ready} />;
  if (boot.s === 'locked') return <Lock record={boot.record} onReady={ready} onWiped={() => setBoot({ s: 'setup' })} />;

  const { ws } = boot;
  const full = route.name === 'note' || route.name === 'edit';
  return (
    <div className={'app' + (full ? ' full' : '')}>
      {route.name === 'home' && <Home ws={ws} />}
      {route.name === 'search' && <Search ws={ws} q={route.q} />}
      {route.name === 'shelf' && <Shelf ws={ws} path={route.path} />}
      {route.name === 'note' && <NoteView key={route.path} ws={ws} path={route.path} anchor={route.anchor} />}
      {route.name === 'edit' && <Editor key={route.path} ws={ws} path={route.path} />}
      {route.name === 'settings' && <Settings ws={ws} onReset={() => location.reload()} />}
      {!full && <Nav active={route.name} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('./sw.js');
// Ask the browser not to evict the device copy under storage pressure.
void navigator.storage?.persist?.().catch(() => {});
