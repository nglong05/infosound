import type { CSSProperties } from 'react';
const repeatPath =
  'M4.2 10a8 8 0 0 1 13.6-4.4L20 8M20 3v5h-5M19.8 14a8 8 0 0 1-13.6 4.4L4 16M4 21v-5h5';
const playbackPaths: Record<string, string> = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  keyboard:
    'M3 5h18v14H3zM6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01M7 16h10',
  history: 'M3 11a9 9 0 1 1 2.4 7M3 4v7h7M12 7v5l3 2',
  microphone: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',
  shuffle: 'M3 6h3c4 0 8 12 12 12h3m-3-3 3 3-3 3M3 18h3c4 0 8-12 12-12h3m-3-3 3 3-3 3',
  repeat: repeatPath,
  'repeat-one': repeatPath + 'M10.5 10 12 9v6m-1.5 0h3',
};
const paths: Record<string, string> = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  search: 'm21 21-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  library: 'M4 4v16M8 4v16m4-15 6-1 3 15-6 1z',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  playlist: 'M4 5h14M4 10h14M4 15h8m5-2v8m-4-4h8',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4',
  studio: 'M4 4h16v16H4zM8 8v8m4-11v14m4-10v6',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 4v16m8-16v16',
  next: 'm4 4 12 8-12 8zM20 4v16',
  previous: 'm20 4-12 8 12 8zM4 4v16',
  volume: 'M4 9h4l5-5v16l-5-5H4zm12-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  plus: 'M12 4v16M4 12h16',
  close: 'm5 5 14 14M19 5 5 19',
  check: 'm4 12 5 5L20 6',
  mail: 'M3 5h18v14H3zm0 0 9 8 9-8',
  music:
    'M9 18V5l11-2v13M9 5l11-2M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3m11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  logout: 'M10 4H4v16h6m3-12 4 4-4 4m-5-4h13',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 7M4 12l2 7a7 7 0 0 0 12-2',
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={playbackPaths[name] || paths[name] || paths.music} />
    </svg>
  );
}
