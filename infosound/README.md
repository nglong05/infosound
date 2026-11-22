# InfoSound

InfoSound chạy bằng **Docker Compose** trên một host Linux thông thường (Docker Engine + plugin `docker compose` v2). Frontend/API, hai worker, PostgreSQL, Redis, SeaweedFS và gateway đều chạy trong container; không cần VM, SSH, tunnel hay Docker Desktop.

| Mục | Địa chỉ |
|---|---|
| Website / API | **https://localhost:3443** / `/api/v1` |
| Media ký số | **https://localhost:9443** |
| HTTP chuyển sang HTTPS | http://localhost:18080 |

Các cổng mặc định bind `127.0.0.1` (đổi `APP_HOST` trong `.env` để mở ra LAN). Dùng đúng hostname `localhost` cho Google OAuth/cookie; Google/SMTP vẫn cần Internet.

## Khởi động và dừng

Yêu cầu host Linux có Docker Engine + `docker compose` v2, cùng `python3`, `openssl`, `make`. Từ source root `infosound/`:

```bash
cp .env.example .env     # chỉnh host/cổng/Gemini key nếu muốn
make bootstrap           # sinh secrets + chứng chỉ vào ./.runtime/secrets, render nginx.conf
make build               # build các image ứng dụng
make up                  # khởi động dịch vụ, chạy migration và storage bootstrap
```

Vận hành: `make status`, `make doctor`, `make logs`, `make down`. Sau khi đổi source, build lại rồi khởi động bằng `make build && make up`.

Runtime dùng `compose.yaml` + `compose.lab.yaml`. Secrets, chứng chỉ và backup nằm ở `./.runtime/` (đã gitignore), không đưa vào Git hoặc build context. Bốn Docker named volume lưu DB, storage/filer metadata, Redis và audio working files, được giữ qua các lần `make down`/`make up`. `make bootstrap` chỉ sinh giá trị còn thiếu và không ghi đè.

Trình duyệt cần trust CA tự ký của dự án (`./.runtime/secrets/ca.crt`) để HTTPS và Secure cookies hoạt động.

## Đăng nhập và tính năng

Giữ đăng ký email + username duy nhất + mật khẩu, OTP xác minh rồi đăng nhập email/mật khẩu. OTP chỉ xác minh đăng ký, không tự cấp session. Google OAuth bổ sung bên cạnh phương thức cũ, callback chính xác:

```text
https://localhost:3443/api/v1/auth/oauth/google/callback
```

Credentials Google/SMTP được chuyển và nạp từ private runtime; không có trong source/log. Provider enabled không chứng minh consent/token exchange thật đã thành công. Xem [OAuth](docs/OAUTH_LOCAL.md), [OTP](docs/EMAIL_OTP.md), [SMTP](docs/SMTP.md).

Tài khoản tạo trước bằng email/mật khẩu không tự liên kết Google theo email trùng; giữ đăng nhập bằng phương thức hiện có. Google OAuth là tùy chọn và cần credentials riêng được nạp vào secrets private.

- VISITOR nghe nhạc công khai và được tính lượt nghe mà không cần tài khoản. Bình luận, thích, theo dõi và thư viện cá nhân vẫn cần đăng nhập; chỉ AUTHOR thấy công cụ quản lý. [Quyền nghe của khách](docs/VISITOR_PLAYBACK.md), [vai trò](docs/FRONTEND_ROLES.md).
- Player có trộn/lặp và hàng đợi phiên chỉnh sửa được: bấm từng bài tạo queue1, menu … thêm bài, kéo hoặc nút lên/xuống đổi thứ tự, xóa từng mục. Phát playlist là thao tác danh sách riêng; chuyển trang/locale/theme giữ cùng audio. [Playback](docs/PLAYBACK.md).
- Nút bàn phím góc phải mở bảng21 phím tắt đã dịch: phát/tua/âm lượng/hàng đợi/lyrics và điều hướng. Có thể tắt các phím chữ/số; nhập liệu/modal giữ hành vi riêng, nhạc không khởi động lại khi điều hướng. [Phím tắt](docs/SHORTCUTS.md).
- Nút micro mở lời toàn trang, sáng dòng hiện tại, cuộn theo audio và bấm dòng để tua. AUTHOR có thể đính kèm `.lrc` tùy chọn ngay lúc tải bài mới hoặc nhập/sửa ở trang bài trong Studio; bài chưa có dữ liệu hiện trạng thái trống. [Lời bài hát](docs/LYRICS.md).
- Mỗi bài tối đa tám thể loại độc lập theo ID; Studio chọn nhiều/tìm kiếm, hiển thị tag riêng và API lọc membership. [Thể loại](docs/GENRES.md).
- 109 lựa chọn ngôn ngữ bản địa/tìm prefix, 107 catalog máy offline,756thông điệp, RTL; giữ nội dung người dùng và timestamp UTC, English dùng New York/DST. [I18N](docs/I18N.md), [ngôn ngữ](docs/LANGUAGES.md).
- Chín palette tối dịu; đổi màu giữ form/player. [Themes](docs/THEMES.md).
- Avatar USER/AUTHOR, cover/audio của AUTHOR; signed media URLs, private buckets, sealed source versions, transactional outbox và fenced tasks. [Ảnh](docs/IMAGE_UPLOAD.md), [workers](docs/WORKERS.md).
- Like/follow/chuông, library và playlist giữ cùng dữ liệu hiện hành. Library dùng thẻ nghệ sĩ đang theo dõi giống thẻ thịnh hành, tối đa5 mỗi hàng và giữ toàn bộ danh sách API trả về. [Thẻ nghệ sĩ](docs/TRENDING_ARTISTS.md).
- Thông báo phát hành có ảnh bìa bài hát, tên/nghệ sĩ/thời gian và thao tác đánh dấu đọc; ảnh và trạng thái dùng dữ liệu thật. [Thông báo](docs/NOTIFICATIONS.md).

Không tạo tài khoản/bài hát mặc định; tài khoản, nhạc, ảnh và quan hệ thật không phải fixture có thể xóa. Source strict TypeScript/pnpm monorepo gồm Next.js/React/Tailwind, NestJS, Prisma/PostgreSQL, BullMQ/Redis và SeaweedFS. Giữ tám dịch vụ và exact pins/lock.

## Tài liệu

[Bản đồ mã nguồn](docs/CODE_MAP.md) chỉ vị trí từng chức năng; [biên bản tổ chức lại mã](docs/REFACTOR_VERIFICATION.md) ghi phạm vi và kết quả kiểm chứng ngày12/11/2026.

[Kiến trúc](docs/ARCHITECTURE.md), [dữ liệu](docs/DATA_MODEL.md), [API](docs/API.md), [bảo mật](docs/SECURITY.md), [vận hành](docs/OPERATIONS.md), [backup/restore](docs/BACKUP_RESTORE.md), [giới hạn](docs/KNOWN_LIMITATIONS.md), [đặc tả](docs/BUILD_SPEC.md).

Tìm kiếm hỗ trợ đoạn lời không dấu/một phần/gần đúng trong LRC đã lưu; kết quả có nhãn “Khớp lời bài hát”. Ví dụ `Thắc gì nữa mà mắc` có thể tìm Có Chắc Yêu Là Đây khi bài đã có lyrics đúng sourceVersion. [SEARCH.md](docs/SEARCH.md) mô tả thuật toán và quyền; nghiệm thu thật xem PROGRESS.

Khám phá có Bảng xếp hạng ở khu vực nhạc đầu tiên và Mới phát hành, mỗi phần tối đa 5 bài; Xem tất cả mở danh sách 20 bài/trang. Lượt nghe bắt đầu ghi khi triển khai; không dựng lại lịch sử. [DISCOVERY.md](docs/DISCOVERY.md).

Khám phá có Giai điệu đề xuất (tối đa5 bài) ngay sau Bảng xếp hạng: ưu tiên thể loại/nghệ sĩ trong hộp thoại khảo sát nổi tùy chọn, bố cục dọc và có thể đóng, tiếp theo sở thích từ bài đã tim, rồi bài nghe nhiều nhất khi chưa có dữ liệu. Visitor lưu lựa chọn trên trình duyệt; tài khoản lưu riêng, có thể bỏ qua/chỉnh sửa. [RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md), [MUSIC_PREFERENCES.md](docs/MUSIC_PREFERENCES.md).

Mục **Lịch sử** hiển thị bài đã nghe theo lần nghe gần nhất, mỗi bài một lần và 20 bài/trang, cùng giao diện Bài đã thích. Lưu sau 30 giây hoặc nửa bài ngắn, dùng tài khoản hiện tại. [HISTORY.md](docs/HISTORY.md).

Khám phá có **Nghệ sĩ thịnh hành**, tối đa5 thẻ ảnh lớn theo lượt nghe, kèm số người theo dõi, nút theo dõi và bài được nghe nhiều nhất của từng nghệ sĩ. [TRENDING_ARTISTS.md](docs/TRENDING_ARTISTS.md).

Trang bài hát có waveform thật trắng/đổi màu theo tiến độ, click để tua, bình luận theo mốc nhạc với tim/trả lời; sidebar nghệ sĩ/thống kê, top3 fan, bài cùng nghệ sĩ và tag. Dùng chung root player, giữ tải xuống/playlist/likes theo quyền. [TRACK_DETAIL.md](docs/TRACK_DETAIL.md).

Giao diện tinh chỉnh04/11/2026 dùng bề mặt/chữ/khoảng cách mềm và gọn hơn. Author Studio gom thao tác phụ vào mục mở rộng, giữ nguyên chức năng và các bản nháp; xóa bài qua nút nguy hiểm có xác nhận rõ. Phạm vi frontend, nguồn tham khảo và hướng phát triển ở [UI_REFINEMENT.md](docs/UI_REFINEMENT.md); nghiệm thu/triển khai xem PROGRESS.
