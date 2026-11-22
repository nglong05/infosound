export type ShortcutAction =
  | 'play'
  | 'next'
  | 'previous'
  | 'forward'
  | 'backward'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'position'
  | 'queue'
  | 'lyrics'
  | 'currentTrack'
  | 'search'
  | 'help'
  | 'liked'
  | 'library'
  | 'history'
  | 'profile'
  | 'home';
export type Shortcut = {
  id: ShortcutAction;
  label: string;
  keys: readonly string[];
  code: string;
  shift?: boolean;
  sequence?: boolean;
  track?: boolean;
};
export const shortcutGroups: readonly { id: string; items: readonly Shortcut[] }[] = [
  {
    id: 'playback',
    items: [
      { id: 'play', label: 'Phát hoặc tạm dừng', keys: ['Space'], code: 'Space', track: true },
      {
        id: 'next',
        label: 'Bài tiếp theo',
        keys: ['Shift', 'ArrowRight'],
        code: 'ArrowRight',
        shift: true,
        track: true,
      },
      {
        id: 'previous',
        label: 'Bài trước',
        keys: ['Shift', 'ArrowLeft'],
        code: 'ArrowLeft',
        shift: true,
        track: true,
      },
      {
        id: 'forward',
        label: 'Tua tới 5 giây',
        keys: ['ArrowRight'],
        code: 'ArrowRight',
        track: true,
      },
      {
        id: 'backward',
        label: 'Tua lùi 5 giây',
        keys: ['ArrowLeft'],
        code: 'ArrowLeft',
        track: true,
      },
      { id: 'position', label: 'Tua đến 0–90% bài hát', keys: ['0…9'], code: 'Digit', track: true },
      {
        id: 'volumeUp',
        label: 'Tăng âm lượng 10%',
        keys: ['Shift', 'ArrowUp'],
        code: 'ArrowUp',
        shift: true,
      },
      {
        id: 'volumeDown',
        label: 'Giảm âm lượng 10%',
        keys: ['Shift', 'ArrowDown'],
        code: 'ArrowDown',
        shift: true,
      },
      { id: 'mute', label: 'Tắt hoặc bật âm thanh', keys: ['M'], code: 'KeyM' },
      {
        id: 'repeat',
        label: 'Chuyển chế độ lặp',
        keys: ['Shift', 'L'],
        code: 'KeyL',
        shift: true,
        track: true,
      },
      {
        id: 'shuffle',
        label: 'Bật hoặc tắt trộn nhạc',
        keys: ['Shift', 'S'],
        code: 'KeyS',
        shift: true,
        track: true,
      },
    ],
  },
  {
    id: 'navigation',
    items: [
      { id: 'search', label: 'Tìm kiếm', keys: ['S'], code: 'KeyS' },
      { id: 'help', label: 'Hiển thị phím tắt', keys: ['H'], code: 'KeyH' },
      { id: 'currentTrack', label: 'Mở bài hát đang phát', keys: ['P'], code: 'KeyP', track: true },
      { id: 'queue', label: 'Mở hoặc đóng hàng đợi', keys: ['Q'], code: 'KeyQ', track: true },
      { id: 'lyrics', label: 'Mở hoặc đóng lời bài hát', keys: ['Y'], code: 'KeyY', track: true },
      { id: 'liked', label: 'Mở bài đã thích', keys: ['G', 'L'], code: 'KeyL', sequence: true },
      { id: 'home', label: 'Mở trang Khám phá', keys: ['G', 'D'], code: 'KeyD', sequence: true },
      { id: 'library', label: 'Mở thư viện', keys: ['G', 'C'], code: 'KeyC', sequence: true },
      { id: 'profile', label: 'Mở hồ sơ của bạn', keys: ['G', 'P'], code: 'KeyP', sequence: true },
      { id: 'history', label: 'Mở lịch sử nghe', keys: ['G', 'H'], code: 'KeyH', sequence: true },
    ],
  },
];
export const shortcuts = shortcutGroups.flatMap((group) => group.items);
