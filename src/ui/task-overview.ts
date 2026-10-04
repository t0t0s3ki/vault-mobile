import type { TaskBoard } from '../core/tasks';

export const taskFilters = ['all', 'active', 'waiting'] as const;
export type TaskFilter = (typeof taskFilters)[number];
export function taskFilter(value: string): TaskFilter {
  return taskFilters.includes(value as TaskFilter) ? value as TaskFilter : 'all';
}

/** A view of the existing board, not a new ledger or a guess about ownership. */
export function overviewGroups(board: TaskBoard, filter: TaskFilter, query: string) {
  const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return [
    { key: 'active', title: 'アクティブ', tasks: board.active },
    { key: 'waiting', title: '相手待ち', tasks: board.waiting },
  ].filter((g) => filter === 'all' || filter === g.key).map((g) => ({
    ...g,
    tasks: g.tasks.filter((t) => !t.done && terms.every((term) =>
      [t.text, t.waiting, t.section, t.due].join(' ').normalize('NFKC').toLowerCase().includes(term))),
  }));
}
