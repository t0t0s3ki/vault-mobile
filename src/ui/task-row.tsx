import { daysUntil, type Task } from '../core/tasks';

/** Only the coming week gets a countdown; anything else is just a date. No red, no "overdue". */
export function when(due: string) {
  const n = daysUntil(due);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n > 1 && n <= 7) return `あと${n}日`;
  const d = new Date(due + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}

/** Full text remains the accessible name; visual detail belongs in the existing sheet. */
export function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <button className="task-row" onClick={onOpen}>
      <span className="task-row-title">{task.area && <span className="tc-area" aria-hidden="true">{task.area}</span>}{task.text}</span>
      <span className="task-row-meta">
        <span>{task.waiting ? `相手待ち · ${task.waiting}` : task.kind === 'promise' ? '約束' : task.kind === 'button' ? '押すだけ' : 'タスク'}</span>
        {task.due && <time dateTime={task.due}>{when(task.due)}まで</time>}
      </span>
    </button>
  );
}
