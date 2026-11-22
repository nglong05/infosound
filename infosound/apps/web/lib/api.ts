export type User = {
  id: string;
  email?: string | null;
  username?: string | null;
  displayName: string;
  role: 'USER' | 'AUTHOR';
  bio?: string;
  avatarUrl?: string | null;
};
export type Artist = User & {
  following?: boolean;
  subscribed?: boolean;
  notifyNewReleases?: boolean;
  followerCount?: number;
  tracks?: Track[];
  topTrack?: Track | null;
};
export type Genre = { id: string; name: string; aliases?: string[] };
export type Track = {
  id: string;
  title: string;
  description: string;
  genres: Genre[];
  genre?: string;
  downloadEnabled: boolean;
  authorId: string;
  author: Artist;
  sourceVersion?: number;
  searchMatch?: 'title' | 'lyrics';
  processingState: string;
  publicationState: string;
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  sourceCodec?: string;
  outputCodec?: string;
  lossyTranscode?: boolean;
  coverUrl?: string;
  likeCount?: number;
  playCount?: number;
  liked?: boolean;
  available?: boolean;
  errorCode?: string;
};
export type Playlist = {
  id: string;
  title: string;
  description?: string;
  isPublic: boolean;
  ownerId: string;
  owner?: { id: string; displayName: string };
  version: number;
  tracks?: Track[];
  trackCount?: number;
};
export type List<T> = { items: T[]; total: number; page: number; pageSize: number };
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
let accessToken: string | null = null;
let refreshFlight: Promise<boolean> | null = null;
let authChanged: (authenticated: boolean) => void = () => {};
export function onAuthChange(fn: (authenticated: boolean) => void) {
  authChanged = fn;
  return () => {
    authChanged = () => {};
  };
}
export function setAccessToken(token: string | null) {
  accessToken = token;
  authChanged(token !== null);
}
export function getAccessToken(): string | null {
  return accessToken;
}
const translations: Record<string, string> = {
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Nội dung không tồn tại hoặc không còn khả dụng.',
  CONFLICT: 'Dữ liệu đã thay đổi. Tải lại trang và thử lại.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Kiểm tra các trường và thử lại.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu chưa đúng.',
  INVALID_TOKEN: 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Hãy chờ một chút và thử lại.',
};
Object.assign(translations, {
  GENRE_NOT_AVAILABLE: 'Một số thể loại không còn khả dụng. Hãy chọn lại.',
  VALIDATION_FAILED: 'Thông tin chưa hợp lệ. Kiểm tra độ dài và định dạng các trường rồi thử lại.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  LOGIN_REQUIRED: 'Đăng nhập để thực hiện thao tác này.',
  AUTHOR_REQUIRED: 'Thao tác này dành cho tài khoản nghệ sĩ AUTHOR.',
  TRACK_NOT_FOUND: 'Bài hát không tồn tại hoặc không thuộc tài khoản của bạn.',
  TRACK_UNAVAILABLE: 'Bài hát đã được gỡ hoặc chưa được phát hành.',
  ASSET_UNAVAILABLE: 'Tệp âm thanh chưa khả dụng. Hãy thử lại sau.',
  QUOTA_EXCEEDED:
    'Đã đạt giới hạn dung lượng hoặc số phiên tải đang chờ. Hoàn tất hoặc chờ dọn phiên cũ rồi thử lại.',
  UPLOAD_EXPIRED: 'Phiên tải lên đã hết hạn. Bắt đầu lại thao tác tải tệp.',
  UPLOAD_NOT_FOUND: 'Không tìm thấy phiên tải của bạn. Chọn lại tệp để bắt đầu.',
  IDEMPOTENCY_CONFLICT: 'Yêu cầu tải đã thay đổi. Chọn lại tệp trước khi tiếp tục.',
  IMAGE_INVALID:
    'Ảnh chưa hợp lệ. Chọn ảnh JPEG, PNG hoặc WebP không động trong giới hạn đã công bố.',
  IMAGE_UPLOAD_CHANGED:
    'Ảnh chưa được tải đầy đủ hoặc đã thay đổi. Hãy gửi lại tệp rồi thử hoàn tất.',
  IMAGE_BUSY: 'Một ảnh khác đang được xử lý. Chờ một chút rồi thử lại.',
  IMAGE_PROCESSOR_UNAVAILABLE: 'Tạm thời chưa thể xử lý ảnh. Vui lòng thử lại sau.',
  IMAGE_UPLOAD_IN_PROGRESS:
    'Bạn đang có một ảnh chờ hoàn tất. Tiếp tục yêu cầu đang mở hoặc chờ tối đa 5 phút rồi thử lại.',
  IMAGE_QUOTA_EXCEEDED:
    'Bạn đã đạt giới hạn tải ảnh trong 24 giờ. Vui lòng chờ trước khi tải thêm ảnh.',
  UPLOAD_MISSING: 'Tệp chưa tải xong. Hãy gửi lại tệp rồi thử hoàn tất.',
  UPLOAD_SIZE_MISMATCH: 'Dung lượng thực tế chưa khớp. Kiểm tra tệp rồi gửi lại.',
  AUDIO_FORMAT: 'Chỉ hỗ trợ WAV PCM, FLAC hoặc MP3 đúng giới hạn đã công bố.',
  ARTWORK_INVALID: 'Ảnh bìa không hợp lệ. Hãy chọn JPEG, PNG hoặc WebP khác.',
  ARTWORK_FORMAT: 'Chọn ảnh JPEG, PNG hoặc WebP tối đa 5 MiB.',
  COMMENT_TIMING_INVALID: 'Mốc bình luận vượt quá thời lượng bài hát.',
  COMMENT_NOT_FOUND: 'Bình luận không còn khả dụng.',
  SOURCE_VERSION_CHANGED:
    'Âm thanh đã được thay thế ở phiên khác. Tải lại trang trước khi tiếp tục.',
  SOURCE_CHANGED: 'Tệp đang thay đổi. Hoàn tất gửi tệp rồi thử lại.',
  UNPUBLISH_REQUIRED: 'Gỡ phát hành bài hát trước khi thay tệp âm thanh.',
  TRACK_NOT_READY: 'Bài hát chưa xử lý xong. Chờ trạng thái Sẵn sàng trước khi phát hành.',
  DOWNLOAD_DISABLED: 'Nghệ sĩ chưa cho phép tải bài hát này.',
  RETRY_NOT_ALLOWED: 'Công việc chưa đủ điều kiện thử lại. Chờ xử lý xong hoặc tải lại trang.',
  REPLACE_SOURCE_REQUIRED: 'Tệp nguồn không được hỗ trợ. Hãy thay bằng tệp đúng định dạng.',
  PLAYLIST_VERSION_CONFLICT: 'Playlist vừa được sửa ở phiên khác. Tải lại trang rồi sắp xếp lại.',
  PLAYLIST_TRACKS_MISMATCH: 'Danh sách bài đã thay đổi. Tải lại trang rồi thử lại.',
  PLAYLIST_FULL: 'Playlist đã đạt giới hạn bài hát.',
  PLAYLIST_NOT_FOUND: 'Playlist không tồn tại hoặc là nội dung riêng tư.',
  FOLLOW_REQUIRED: 'Theo dõi nghệ sĩ trước khi bật thông báo.',
  SELF_FOLLOW: 'Bạn không thể tự theo dõi tài khoản của mình.',
  ACCOUNT_EXISTS: 'Email đã có tài khoản. Hãy đăng nhập hoặc đặt lại mật khẩu.',
  EMAIL_UNAVAILABLE: 'Tạm thời chưa thể gửi email xác minh. Vui lòng thử lại sau.',
  OTP_INVALID: 'Mã xác nhận chưa đúng hoặc đã hết hạn. Hãy nhập lại hoặc yêu cầu mã mới.',
  USERNAME_UNAVAILABLE: 'Tên người dùng đã được sử dụng hoặc đang chờ xác minh. Hãy chọn tên khác.',
  OTP_BUSY: 'Yêu cầu đang được xử lý. Hãy chờ một chút rồi thử lại.',
  OAUTH_PROVIDER_UNAVAILABLE:
    'Phương thức đăng nhập này hiện chưa khả dụng. Hãy chọn cách khác hoặc thử lại sau.',
  OAUTH_INVALID_STATE: 'Phiên đăng nhập này đã hết hạn. Hãy bắt đầu lại từ InfoSound.',
  OAUTH_SIGNIN_FAILED: 'Chưa thể hoàn tất đăng nhập. Hãy thử lại.',
  CSRF_ORIGIN_DENIED:
    'Yêu cầu không đến từ địa chỉ InfoSound đã cấu hình. Mở đúng địa chỉ ứng dụng rồi thử lại.',
  CSRF_HEADER_REQUIRED: 'Phiên làm việc chưa hợp lệ. Tải lại trang và thử lại.',
});
function rateLimitMessage(seconds: number | undefined): string {
  if (seconds === undefined) return translations.RATE_LIMITED;
  if (seconds === 0) return 'Bạn có thể thử lại ngay bây giờ.';
  const minutes = Math.floor(seconds / 60),
    remainder = seconds % 60;
  const wait = minutes ? `${minutes} phút ${remainder} giây` : `${seconds} giây`;
  return `Bạn thao tác quá nhanh. Hãy chờ ${wait} và thử lại.`;
}
async function decode<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(body.code || body.error || 'REQUEST_FAILED');
    const retryValue = body.retryAfterSeconds ?? response.headers.get('Retry-After');
    const retryAfter =
      retryValue !== null &&
      retryValue !== undefined &&
      Number.isFinite(Number(retryValue)) &&
      Number(retryValue) >= 0
        ? Math.ceil(Number(retryValue))
        : undefined;
    const message =
      code === 'RATE_LIMITED' || (response.status === 429 && !translations[code])
        ? rateLimitMessage(retryAfter)
        : translations[code] || 'Không thể hoàn tất yêu cầu. Kiểm tra thông tin và thử lại.';
    throw new ApiError(response.status, code, message, retryAfter);
  }
  return body as T;
}
export async function refreshSession(): Promise<boolean> {
  if (refreshFlight) return refreshFlight;
  refreshFlight = (async () => {
    try {
      const r = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'InfoSound',
          'X-InfoSound-CSRF': '1',
        },
        body: '{}',
      });
      if (!r.ok) {
        await r.arrayBuffer();
        setAccessToken(null);
        return false;
      }
      const data = await r.json();
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshFlight = null;
    }
  })();
  return refreshFlight;
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const perform = () =>
    fetch('/api/v1' + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'InfoSound',
        'X-InfoSound-CSRF': '1',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  let response: Response;
  try {
    response = await perform();
    if (
      response.status === 401 &&
      options.auth !== false &&
      !path.startsWith('/auth/') &&
      (await refreshSession())
    )
      response = await perform();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Không thể kết nối InfoSound. Kiểm tra mạng rồi thử lại.',
    );
  }
  return decode<T>(response);
}
export const time = (value = 0) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export const quality = (track: Track) =>
  track.lossyTranscode
    ? 'FLAC chuyển từ nguồn lossy'
    : track.outputCodec?.toUpperCase() || 'Đang xử lý';
/** A conditional image 412 only completes the transfer step; the caller must still validate with its complete API. */
export function uploadFile(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
  timeoutMs = 20 * 60 * 1000,
  acceptAlreadyUploaded = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = false;
    xhr.timeout = timeoutMs;
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      (xhr.status >= 200 && xhr.status < 300) ||
      (acceptAlreadyUploaded && headers['If-None-Match'] === '*' && xhr.status === 412)
        ? resolve()
        : reject(new Error('Tải tệp thất bại. Kiểm tra chứng chỉ media hoặc thử lại.'));
    xhr.onerror = () =>
      reject(new Error('Không thể gửi tệp. Kiểm tra kết nối và chứng chỉ media.'));
    xhr.ontimeout = () => reject(new Error('Tải tệp quá thời gian. Vui lòng thử lại.'));
    xhr.send(file);
  });
}
