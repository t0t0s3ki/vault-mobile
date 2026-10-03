/** A small hand-drawn icon set (24px grid, 1.8 stroke). Inherit color from text. */
const paths: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zm5.3-2.2L21 21',
  shelf: 'M4 5h5v15H4zM10.5 5h5v15h-5zM17 6.2l3.6-.9 3 13.6-3.6.9z',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.4 7.4 0 0 1-2 1.2L15 20.5h-3.6l-.3-2.1a7.4 7.4 0 0 1-2-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.6 7.6 0 0 1 0-2.4L5.4 9.9l1.8-3.1 1.9.6a7.4 7.4 0 0 1 2-1.2L11.4 4H15l.3 2.2a7.4 7.4 0 0 1 2 1.2l1.9-.6 1.8 3.1-1.6 1.2a7.6 7.6 0 0 1 0 2.4z',
  back: 'M15 5l-7 7 7 7',
  pencil: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l3 3',
  star: 'M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  type: 'M4 19 9 5l5 14M5.8 14h6.4M15 19l3-8 3 8M15.9 16.6h4.2',
  close: 'M6 6l12 12M18 6 6 18',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.3h-4.3M5.5 21v-4.3h4.3',
  folder: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  note: 'M6 3.5h8.5L19 8v12.5H6zM14 3.5V8.5h5M9 13h7M9 16.5h5',
  clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7.5V12l3 2',
  lock: 'M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  paste: 'M9 4.5h6v3H9zM8 5.5H6v15h12v-15h-2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.8 4.8 0 0 1-.5 9.5z',
  task: 'M4.5 4.5h15v15h-15zM8.5 12l2.5 2.5 4.5-5',
  heading: 'M5 5v14M15 5v14M5 12h10M18 19v-7l-2 1.4',
  bullet: 'M9 7h11M9 12h11M9 17h11M5 7h.01M5 12h.01M5 17h.01',
  plus: 'M12 5v14M5 12h14',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  send:'M21 3 10.5 13.5M21 3l-6.5 18-4-7.5-7.5-4z',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
  calendar:'M4.5 6h15v14h-15zM4.5 10.5h15M8.5 3.5v4M15.5 3.5v4',
};

export function Icon({ name, size = 22, filled = false, label }: { name: keyof typeof paths | string; size?: number; filled?: boolean; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className="icon-svg"
    >
      <path d={paths[name] ?? ''} />
    </svg>
  );
}
