import { useLayoutEffect } from 'react';
import { href, type Workspace } from '../app';
import { Icon } from './icons';
import { Sheet } from './kit';
import { TaskSheet } from './now';
import { SyncButton } from './screens';
import { TaskRow } from './task-row';
import { overviewGroups, taskFilter, taskFilters } from './task-overview';
import { TASKS_PATH, useBoard } from './work';

// In-memory only; route keys may contain private task searches. Never localStorage.
const positions = new Map<string, number>();
const labels = { all: 'すべて', active: 'アクティブ', waiting: '相手待ち' };
function replaceRoute(to: string) {
  history.replaceState(null, '', to);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export function Tasks({ ws, filter, q, taskKey }: { ws: Workspace; filter: string; q: string; taskKey: string }) {
  const board = useBoard(ws);
  const selected = taskFilter(filter);
  const base = href.tasks(selected, q);
  const positionKey = ws.remote.id + '\u0000' + base;
  const groups = overviewGroups(board, selected, q);
  const count = groups.reduce((n, g) => n + g.tasks.length, 0);
  // Raw line identity avoids selecting a different item with the same display title.
  const matches = [...board.active, ...board.waiting].filter((t) => t.raw === taskKey && !t.done);
  const task = matches.length === 1 ? matches[0] : null;
  const source = ws.vault.note(TASKS_PATH);
  useLayoutEffect(() => {
    window.scrollTo(0, positions.get(positionKey) ?? 0);
    const remember = () => {
      positions.set(positionKey, window.scrollY);
      if (positions.size > 50) positions.delete(positions.keys().next().value!);
    };
    addEventListener('scroll', remember, { passive: true });
    return () => removeEventListener('scroll', remember);
  }, [positionKey]);
  const close = () => {
    if (history.state?.taskOverviewReturn === base) history.back();
    else replaceRoute(base);
  };
  const open = (raw: string) => {
    positions.set(positionKey, window.scrollY);
    history.pushState({ taskOverviewReturn: base }, '', href.tasks(selected, q, raw));
    dispatchEvent(new HashChangeEvent('hashchange'));
  };
  return (
    <main className="page task-overview">
      <header className="shelf-head">
        <a className="icon-btn" href={href.home()} aria-label="Nowに戻る"><Icon name="back" /></a>
        <div><p className="label">Now</p><h1>タスク</h1></div>
        <SyncButton ws={ws} compact />
      </header>
      <p className="quiet small">約束・押すだけ・相手待ちを一覧に。経過や操作はタップで。</p>
      <div className="task-filters" role="group" aria-label="タスクの絞り込み">
        {taskFilters.map((f) => <button key={f} aria-pressed={selected === f} onClick={() => replaceRoute(href.tasks(f, q))}>{labels[f]}</button>)}
      </div>
      <label className="task-search">
        <Icon name="search" size={18} />
        <input type="search" aria-label="タスクを探す" placeholder="タイトル・相手・期限で探す" value={q} onChange={(e) => replaceRoute(href.tasks(selected, e.target.value))} />
      </label>
      {!source ? (
        <p className="quiet" role="status">{ws.vault.syncedAt ? 'Tasks.md を取得できていません。更新するか、Libraryでファイルを確認してください。' : 'まだタスクを取得していません。上の更新ボタンから読み込めます。'}</p>
      ) : (
        <>
          <p className="quiet small" role="status">{count}件{q.trim() ? ' · 検索結果' : ' · 未完了'}</p>
          {groups.filter((g) => g.tasks.length).map((g) => (
            <section className="block" key={g.key}>
              <h2 className="label">{g.title}</h2>
              <div className="task-rows">{g.tasks.map((t) => <TaskRow key={t.line} task={t} onOpen={() => open(t.raw)} />)}</div>
            </section>
          ))}
          {!count && <p className="quiet">{q.trim() ? '一致するタスクはありません。別の言葉で探せます。' : selected === 'waiting' ? '相手待ちはありません。' : 'この一覧の未完了タスクはありません。'}</p>}
          {(q || selected !== 'all') && <button className="btn" onClick={() => replaceRoute(href.tasks())}>絞り込みを解除</button>}
        </>
      )}
      <p className="quiet small task-source">Tasks.md のアクティブと相手待ちを表示しています。</p>
      <TaskSheet ws={ws} task={task} onClose={close} />
      {taskKey && !task && <Sheet open title="状況" onClose={close}>{matches.length > 1 ? <p>同じ内容のタスクが複数あるため、詳細を特定できません。<a href={href.note(TASKS_PATH)}>Tasks.md で経過を確認する</a></p> : <p>このタスクは更新・完了されたか、見つからなくなりました。一覧に戻って確認してください。</p>}</Sheet>}
    </main>
  );
}
