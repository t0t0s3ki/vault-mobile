import { useState, type ChangeEvent } from 'react';
import { openDemo, openGitHub, remoteFor, saveConfig, setMode, wipeDevice, type Config, type Workspace } from '../app';
import { createPassphraseLock, createPasskeyLock, passkeyAvailable, unlock, type LockRecord } from '../core/lock';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Setup({ onReady }: { onReady: (ws: Workspace) => void }) {
  const [step, setStep] = useState<'start' | 'connect' | 'lock'>('start');
  const [config, setConfig] = useState<Config>({ owner: '', repo: '', branch: 'main', token: '', projects: '02_Projects' });
  const [checked, setChecked] = useState<string>();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (k: keyof Config) => (e: ChangeEvent<HTMLInputElement>) => {
    setChecked(undefined);
    setConfig({ ...config, [k]: e.target.value.trim() });
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const check = () =>
    run(async () => {
      const remote = remoteFor(config);
      const { entries } = await remote.tree().catch(async (e: unknown) => {
        // Say which part failed: the token, the repository, the branch or the permission.
        throw new Error(await remote.diagnose().catch(() => msg(e)));
      });
      setChecked(`つながりました。Markdown ${entries.filter((e) => e.path.endsWith('.md')).length} 本`);
    });

  const finish = (make: () => Promise<{ record: LockRecord; key: import('../core/lock').Key }>) =>
    run(async () => {
      const { record, key } = await make();
      await saveConfig(key, record, config);
      onReady(await openGitHub(key));
    });

  if (step === 'start')
    return (
      <main className="page gate">
        <h1 className="page-title">Vault</h1>
        <p>GitHub にある Markdown の Vault を、この端末で読んで、直して、保存します。</p>
        <div className="buttons col">
          <button className="primary" onClick={() => setStep('connect')}>
            GitHub の Vault につなぐ
          </button>
          <button
            onClick={() =>
              run(async () => {
                setMode('demo');
                onReady(await openDemo());
              })
            }
          >
            ダミーの Vault で試す
          </button>
        </div>
        {error && <p className="warn">{error}</p>}
      </main>
    );

  if (step === 'connect')
    return (
      <main className="page gate">
        <h1 className="page-title">GitHub につなぐ</h1>
        <p className="hint">
          トークンは fine-grained personal access token を使います。対象のリポジトリ1つだけ、権限は Contents の Read and write
          だけにしてください。トークンはこの端末の中で暗号化して保管し、GitHub 以外には送りません。
        </p>
        <label className="field">
          持ち主（owner）
          <input value={config.owner} onChange={set('owner')} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="field">
          リポジトリ
          <input value={config.repo} onChange={set('repo')} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="field">
          ブランチ
          <input value={config.branch} onChange={set('branch')} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="field">
          ホームに出すプロジェクトのフォルダ
          <input value={config.projects} onChange={set('projects')} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="field">
          トークン
          <input type="password" value={config.token} onChange={set('token')} autoComplete="off" autoCapitalize="off" autoCorrect="off" />
        </label>
        <div className="buttons">
          <button onClick={() => setStep('start')}>戻る</button>
          <button disabled={busy || !config.owner || !config.repo || !config.token} onClick={check}>
            {busy ? '確かめています…' : '接続を確かめる'}
          </button>
          <button className="primary" disabled={!checked} onClick={() => setStep('lock')}>
            次へ
          </button>
        </div>
        {checked && <p className="ok-line">{checked}</p>}
        {error && <p className="warn">{error}</p>}
      </main>
    );

  return (
    <main className="page gate">
      <h1 className="page-title">この端末に鍵をかける</h1>
      <p className="hint">
        トークン・ノートの写し・下書きは、すべてこの鍵で暗号化して端末に置きます。開くたびに鍵を開けます。鍵をなくしたら、端末のデータを消してつなぎ直せば戻れます（GitHub
        の Vault は消えません）。
      </p>
      {passkeyAvailable() && (
        <div className="buttons col">
          <button className="primary" disabled={busy} onClick={() => finish(createPasskeyLock)}>
            パスキー（Face ID）で守る
          </button>
        </div>
      )}
      <details className="alt" open={!passkeyAvailable()}>
        <summary>パスフレーズで守る</summary>
        <label className="field">
          パスフレーズ（10文字以上）
          <input type="password" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="new-password" />
        </label>
        <button disabled={busy || phrase.length < 10} onClick={() => finish(() => createPassphraseLock(phrase))}>
          パスフレーズで守る
        </button>
      </details>
      {busy && <p className="hint">準備しています…</p>}
      {error && <p className="warn">{error}</p>}
    </main>
  );
}

export function Lock({ record, onReady, onWiped }: { record: LockRecord; onReady: (ws: Workspace) => void; onWiped: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onReady(await openGitHub(await unlock(record, phrase)));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page gate">
      <h1 className="page-title">Vault</h1>
      {record.kind === 'passkey' ? (
        <div className="buttons col">
          <button className="primary" disabled={busy} onClick={open} autoFocus>
            Face ID で開く
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <label className="field">
            パスフレーズ
            <input type="password" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
          <button className="primary" disabled={busy}>
            開く
          </button>
        </form>
      )}
      {error && <p className="warn">{error}</p>}
      <details className="alt">
        <summary>開けないとき</summary>
        <p className="hint">この端末に保存したデータ（ノートの写し・まだ送っていない下書き・鍵）を消して、最初からつなぎ直せます。GitHub の Vault には触りません。</p>
        <button
          onClick={async () => {
            if (!confirm('この端末のデータを消します。送っていない下書きも消えます。続けますか？')) return;
            await wipeDevice();
            onWiped();
          }}
        >
          この端末のデータを消す
        </button>
      </details>
    </main>
  );
}
