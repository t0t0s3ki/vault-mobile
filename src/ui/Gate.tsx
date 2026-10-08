import { useEffect, useState } from 'react';
import { DEFAULT_PLACES, openDemo, openGitHub, remoteFor, saveConfig, setMode, useVersion, wipeDevice, type Config, type Workspace } from '../app';
import { createPassphraseLock, createPasskeyLock, passkeyAvailable, unlock, type Key, type LockRecord } from '../core/lock';
import { Icon } from './icons';
import { BrandMark } from './BrandMark';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Accepts a GitHub URL, "owner/repo", or a URL copied from the repo page with /tree/<branch>. */
export function parseRepo(input: string) {
  const s = input.trim().replace(/\.git$/, '');
  const m = s.match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/?#]+))?/);
  if (!m || /\s/.test(s)) return null;
  return { owner: m[1], repo: m[2], branch: m[3] || 'main' };
}

function tokenUrl(owner: string, repo: string) {
  const q = new URLSearchParams({
    name: `Vault（スマホ）${repo}`,
    description: `vault-mobile から ${owner}/${repo} を読み書きする`,
    target_name: owner,
    expires_in: '90',
    contents: 'write',
  });
  return 'https://github.com/settings/personal-access-tokens/new?' + q.toString();
}

function Steps({ at }: { at: number }) {
  return (
    <ol className="steps" aria-label={`3ステップ中 ${at}`}>
      {['Vault', 'トークン', '鍵'].map((s, i) => (
        <li key={s} className={i + 1 === at ? 'on' : i + 1 < at ? 'done' : ''}>
          <span>{i + 1 < at ? <Icon name="check" size={14} /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Setup({ onReady }: { onReady: (ws: Workspace) => void }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [repoInput, setRepoInput] = useState('');
  const [token, setToken] = useState('');
  const [found, setFound] = useState<string>();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const repo = parseRepo(repoInput);
  const config: Config | null = repo ? { ...repo, token: token.trim(), projects: DEFAULT_PLACES.projects, memos: DEFAULT_PLACES.memos, drafts: DEFAULT_PLACES.drafts } : null;

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

  const check = (value = token) =>
    run(async () => {
      if (!repo || !value.trim()) return;
      const remote = remoteFor({ ...config!, token: value.trim() });
      const { entries } = await remote.tree().catch(async (e: unknown) => {
        throw new Error(await remote.diagnose().catch(() => msg(e)));
      });
      setFound(`${entries.filter((e) => e.path.endsWith('.md')).length.toLocaleString()} 本のノートが見えました`);
    });

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      setToken(t);
      setFound(undefined);
      if (t) void check(t);
    } catch {
      setError('貼り付けできませんでした。入力欄を長押しして「ペースト」を選んでください');
    }
  };

  const finish = (make: () => Promise<{ record: LockRecord; key: Key }>) =>
    run(async () => {
      const { record, key } = await make();
      await saveConfig(key, record, config!);
      onReady(await openGitHub(key));
    });

  if (step === 0)
    return (
      <main className="gate">
        <div className="gate-hero">
          <BrandMark />
          <h1>Vault をポケットに</h1>
          <p>GitHub にある Markdown の Vault を、この iPhone で読んで、探して、書き足せます。電波がなくても読めます。</p>
        </div>
        <div className="gate-actions">
          <button className="btn primary big" onClick={() => setStep(1)}>
            はじめる
          </button>
          <button
            className="btn ghost"
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

  if (step === 1)
    return (
      <main className="gate">
        <Steps at={1} />
        <h1 className="gate-title">どの Vault を開く？</h1>
        <p className="gate-lead">GitHub のリポジトリのページを開いて、アドレスをそのまま貼ってください。</p>
        <label className="field">
          リポジトリのアドレス
          <input
            className="text big"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="https://github.com/持ち主/リポジトリ"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {repo ? (
          <div className="parsed">
            <Icon name="check" size={16} />
            <span>
              <b>{repo.owner}</b> / <b>{repo.repo}</b> の <b>{repo.branch}</b> ブランチ
            </span>
          </div>
        ) : (
          repoInput && <p className="quiet">「持ち主/リポジトリ」の形で読み取れませんでした</p>
        )}
        <div className="gate-actions">
          <button className="btn primary big" disabled={!repo} onClick={() => setStep(2)}>
            次へ
          </button>
          <button className="btn ghost" onClick={() => setStep(0)}>
            戻る
          </button>
        </div>
      </main>
    );

  if (step === 2 && repo)
    return (
      <main className="gate">
        <Steps at={2} />
        <h1 className="gate-title">読み書き用のトークンを作る</h1>
        <p className="gate-lead">このアプリが GitHub に入るための合鍵です。{repo.repo} だけに使えるものを作ります。</p>
        <ol className="howto">
          <li>
            <span className="howto-n">1</span>
            <div>
              下のボタンで GitHub の作成画面を開く。名前・期限（90日）・権限（Contents の読み書き）は入った状態で開きます。
              <a className="btn primary" href={tokenUrl(repo.owner, repo.repo)} target="_blank" rel="noopener noreferrer">
                GitHub で作成画面を開く <Icon name="external" size={16} />
              </a>
            </div>
          </li>
          <li>
            <span className="howto-n">2</span>
            <div>
              <b>Repository access</b> だけは手で選びます。<b>Only select repositories</b> → <b>{repo.repo}</b>
              <span className="quiet block">ここは GitHub の仕様で、先に入れておけません。</span>
            </div>
          </li>
          <li>
            <span className="howto-n">3</span>
            <div>
              いちばん下の <b>Generate token</b> を押して、出てきた <code>github_pat_…</code> をコピーし、ここに戻る。
            </div>
          </li>
        </ol>
        <div className="paste-row">
          <input
            className="text"
            type="password"
            value={token}
            onChange={(e) => (setToken(e.target.value), setFound(undefined))}
            onBlur={() => token && !found && void check()}
            placeholder="github_pat_…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="トークン"
          />
          <button className="btn" onClick={paste}>
            <Icon name="paste" size={18} /> 貼り付け
          </button>
        </div>
        {busy && <p className="quiet">確かめています…</p>}
        {found && (
          <div className="parsed">
            <Icon name="check" size={16} />
            <span>{found}</span>
          </div>
        )}
        {error && <p className="warn">{error}</p>}
        <div className="gate-actions">
          <button className="btn primary big" disabled={!found} onClick={() => setStep(3)}>
            次へ
          </button>
          {!found && token && !busy && (
            <button className="btn" onClick={() => check()}>
              もう一度確かめる
            </button>
          )}
          <button className="btn ghost" onClick={() => setStep(1)}>
            戻る
          </button>
        </div>
      </main>
    );

  return (
    <main className="gate">
      <Steps at={3} />
      <h1 className="gate-title">この iPhone に鍵をかける</h1>
      <p className="gate-lead">トークンとノートの写しは、Face ID で開く鍵で暗号化してこの端末に置きます。開くたびに Face ID を求めます。</p>
      <div className="gate-actions">
        {passkeyAvailable() && (
          <button className="btn primary big" disabled={busy} onClick={() => finish(createPasskeyLock)}>
            <Icon name="lock" size={18} /> Face ID で鍵をかける
          </button>
        )}
        <details className="alt" open={!passkeyAvailable()}>
          <summary>Face ID が使えないとき：合言葉で守る</summary>
          <input className="text" type="password" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="new-password" placeholder="10文字以上の合言葉" />
          <button className="btn" disabled={busy || phrase.length < 10} onClick={() => finish(() => createPassphraseLock(phrase))}>
            合言葉で鍵をかける
          </button>
        </details>
        <button className="btn ghost" onClick={() => setStep(2)}>
          戻る
        </button>
      </div>
      {busy && <p className="quiet">準備しています…</p>}
      {error && <p className="warn">{error}</p>}
      <p className="quiet">鍵を開けられなくなっても、端末のデータを消してつなぎ直せば戻れます。GitHub の Vault は消えません。</p>
    </main>
  );
}

/** First import after connecting: the only time the whole vault is downloaded. */
export function Import({ ws, onDone }: { ws: Workspace; onDone: () => void }) {
  useVersion(ws.vault);
  const [p, setP] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string>();
  const start = () => {
    setError(undefined);
    ws.vault.sync((done, total) => setP({ done, total })).then(onDone, (e) => setError(msg(e)));
  };
  useEffect(start, []);
  const ratio = p.total ? p.done / p.total : 0;
  return (
    <main className="gate center">
      <div className="gate-mark">
        <Icon name="cloud" size={30} />
      </div>
      <h1 className="gate-title">Vault を取り込んでいます</h1>
      <p className="gate-lead">初めの1回だけ全部を取り込みます。次からは変わったノートだけです。終わるまで画面を開いたままにしてください。</p>
      <div className="big-progress">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="quiet">{p.total ? `${p.done.toLocaleString()} / ${p.total.toLocaleString()} 本` : 'ノートの一覧を確かめています…'}</p>
      {error && (
        <>
          <p className="warn">{error}</p>
          <button className="btn primary" onClick={start}>
            続きから取り込む
          </button>
        </>
      )}
    </main>
  );
}

export function Lock({ record, onReady, onWiped }: { record: LockRecord; onReady: (ws: Workspace) => void; onWiped: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = async (auto = false) => {
    setBusy(true);
    setError(undefined);
    try {
      onReady(await openGitHub(await unlock(record, phrase)));
    } catch (e) {
      // Safari may refuse a prompt without a tap; the automatic attempt fails quietly.
      if (!auto) setError(record.kind === 'passkey' && /NotAllowed|cancel/i.test(msg(e)) ? 'Face ID がキャンセルされました' : msg(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (record.kind === 'passkey') void open(true);
  }, []);
  return (
    <main className="gate center">
      <BrandMark />
      <h1 className="gate-title gate-locked-title"><Icon name="lock" size={18} /> Vault</h1>
      {record.kind === 'passkey' ? (
        <button className="btn primary big" disabled={busy} onClick={() => open()}>
          Face ID で開く
        </button>
      ) : (
        <form
          className="gate-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <input className="text big" type="password" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoFocus autoComplete="current-password" placeholder="合言葉" />
          <button className="btn primary big" disabled={busy}>
            開く
          </button>
        </form>
      )}
      {error && <p className="warn">{error}</p>}
      <details className="alt">
        <summary>開けないとき</summary>
        <p className="quiet">この端末に置いたもの（ノートの写し・送っていない書きかけ・鍵）を消して、最初からつなぎ直せます。GitHub の Vault には触りません。</p>
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm('この端末のデータを消します。送っていない書きかけも消えます。続けますか？')) return;
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
