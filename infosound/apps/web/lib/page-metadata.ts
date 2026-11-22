/** Shared by initial server rendering and the persistent client application shell. */
const titles: Record<string, string> = {
  login: 'Đăng nhập',
  register: 'Đăng ký',
  search: 'Tìm kiếm',
  charts: 'Bảng xếp hạng',
  'new-releases': 'Mới phát hành',
  history: 'Lịch sử',
  library: 'Thư viện',
  playlists: 'Playlist',
  notifications: 'Thông báo',
  settings: 'Cài đặt',
  studio: 'Không gian âm nhạc của bạn',
  'verify-email': 'Xác minh email',
  'forgot-password': 'Quên mật khẩu',
  'reset-password': 'Đặt lại mật khẩu',
  tracks: 'Bài hát',
  artists: 'Nghệ sĩ',
  profile: 'Hồ sơ',
  profiles: 'Hồ sơ',
  oauth: 'Hoàn tất đăng nhập',
};
export const pageDescriptionKey =
  'Lắng nghe âm nhạc độc lập, kết nối nghệ sĩ và lưu những giai điệu yêu thích trên InfoSound.';
export function pageTitleKey(pathname: string) {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? titles[first] || 'InfoSound' : 'Không gian âm nhạc của bạn';
}
