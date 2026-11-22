

# InfoSound — Ứng dụng nghe nhạc Lossless

**InfoSound** là ứng dụng nghe và chia sẻ âm nhạc trên nền tảng web, hướng đến trải nghiệm phát nhạc chất lượng cao với FLAC. Người nghe có thể khám phá bài hát, theo dõi nghệ sĩ, tạo playlist và đọc lời đồng bộ; nghệ sĩ có không gian riêng để tải lên, quản lý và phát hành âm nhạc.

Dự án được phát triển theo mô hình TypeScript monorepo và chạy bằng **Docker Compose** trên một host Linux thông thường (Docker Engine + plugin `docker compose` v2). Không cần VM, SSH hay Docker Desktop.

Các `.gitignore` chặn env/runtime/secret/key và file tạm, chỉ giữ file mẫu cùng Docker image pins. Secrets và chứng chỉ được sinh cục bộ khi `make bootstrap`, không đưa vào Git.

## Âm thanh Lossless

InfoSound hỗ trợ tải lên **FLAC, WAV PCM integer 16/24-bit và MP3**, xử lý âm thanh bằng FFmpeg trong audio worker riêng. WAV phù hợp được chuyển sang FLAC để bảo toàn mẫu âm thanh; hệ thống giữ phiên bản nguồn và metadata phục vụ quá trình xử lý, phát nhạc.

**Chất lượng phụ thuộc bản thu đầu vào:** chuyển MP3 sang FLAC không khôi phục phần âm thanh đã mất. FLAC cũng không tự chứng minh nguồn thu ban đầu là lossless. Khả năng phát FLAC còn phụ thuộc trình duyệt và thiết bị.

## Tính năng chính

### Dành cho người nghe

- **Khám phá âm nhạc:** bảng xếp hạng, bài mới phát hành và danh sách nghệ sĩ theo lượt nghe.
- **Giai điệu đề xuất:** dựa trên thể loại/nghệ sĩ đã chọn trong khảo sát và thể loại của bài đã thích; khi chưa có sở thích, đề xuất các bài được nghe nhiều.
- **Tìm kiếm:** theo bài hát, nghệ sĩ, playlist và một phần lời bài hát đã lưu, hỗ trợ tiếng Việt không dấu và khớp gần đúng.
- **Trình phát xuyên suốt:** chuyển trang nội bộ, tìm kiếm hoặc xem hồ sơ vẫn giữ nhạc đang phát.
- **Hàng đợi linh hoạt:** thêm bài, giữ dòng để kéo thả thứ tự, xóa khỏi hàng đợi; hỗ trợ trộn, lặp danh sách và lặp một bài.
- **Lời bài hát đồng bộ:** hiển thị ảnh bìa, làm nổi dòng đang phát, cuộn theo nhạc và bấm dòng lời để tua.
- **Trang bài hát:** waveform có thể tua, bình luận theo thời điểm phát, tim/trả lời bình luận, nghệ sĩ, người hâm mộ và bài liên quan.
- **Thư viện cá nhân:** bài đã thích, playlist, nghệ sĩ đang theo dõi và lịch sử nghe.
- **Theo dõi nghệ sĩ:** bật thông báo khi có bài phát hành mới.
- **Cá nhân hóa giao diện:** 109 lựa chọn ngôn ngữ với tên bản địa, tìm nhanh ngôn ngữ, hỗ trợ RTL và 9 bảng màu tối.
- **Phím tắt:** bảng hướng dẫn có thể mở từ biểu tượng bàn phím trên giao diện.

### Dành cho nghệ sĩ

**Author Studio** cung cấp các công cụ tải tệp âm thanh, thêm ảnh bìa, chỉnh thông tin, chọn nhiều thể loại, nhập hoặc tải lời `.lrc`, quản lý bản nháp và phát hành bài hát. Thao tác xóa bài có xác nhận rõ ràng.

Lời đồng bộ được nghệ sĩ cung cấp cùng mốc thời gian; ứng dụng chưa tự lấy lời hoặc tự căn mốc từ bản thu.

## Vai trò và đăng nhập

| Vai trò | Khả năng chính |
| --- | --- |
| Visitor | Khám phá, tìm kiếm, nghe nhạc công khai và được tính lượt nghe; cần đăng nhập để bình luận, thích, theo dõi hoặc dùng thư viện cá nhân. |
| USER | Nghe nhạc, sử dụng thư viện/playlist/lịch sử, thích bài, theo dõi nghệ sĩ và bình luận. |
| AUTHOR | Các tính năng người nghe cùng Author Studio để quản lý âm nhạc của mình. |

Đăng ký bằng email và mật khẩu có bước xác minh OTP. Đăng nhập Google OAuth được bổ sung bên cạnh đăng nhập bằng mật khẩu; Google cần cấu hình ứng dụng và credentials riêng.

## Công nghệ và kiến trúc

| Thành phần | Công nghệ / vai trò |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | NestJS theo mô hình modular monolith, API kiểm quyền và quyền sở hữu dữ liệu |
| Cơ sở dữ liệu | PostgreSQL, Prisma; lưu tài khoản, metadata, quan hệ và trạng thái tác vụ |
| Hàng đợi | Redis, BullMQ |
| Audio worker | FFmpeg, xử lý âm thanh và tạo dữ liệu waveform |
| Background worker | Xử lý tác vụ nền, outbox và thông báo/email theo cấu hình |
| Lưu trữ | SeaweedFS S3 với bucket riêng tư và URL ký số |
| Gateway | Nginx, HTTPS cho ứng dụng và media |
| Môi trường chạy | Docker Compose trên host Linux (Docker Engine + compose v2) |

Hệ thống gồm **8 dịch vụ**: gateway, web, API, audio worker, background worker, PostgreSQL, Redis và storage. Frontend dùng một audio player ở cấp gốc để duy trì phát nhạc khi điều hướng nội bộ. Audio upload được kiểm tra và xử lý ở worker trước khi sẵn sàng phát; trạng thái sẵn sàng và trạng thái phát hành được quản lý riêng.

## Chạy bằng Docker

Yêu cầu một host Linux có **Docker Engine + plugin `docker compose` v2**, cùng `python3`, `openssl` và `make`. Cần trust CA tự ký của dự án để dùng HTTPS; Google OAuth và gửi email là tùy chọn, cần Internet cùng cấu hình nhà cung cấp.

Từ thư mục chứa README này:

```bash
cd infosound
cp .env.example .env     # chỉnh host/cổng/Gemini key nếu muốn
make bootstrap           # sinh secrets + chứng chỉ vào ./.runtime/secrets, render nginx.conf
make build               # build các image ứng dụng
make up                  # khởi động dịch vụ, chạy migration và storage bootstrap
```

| Địa chỉ | Mục đích |
| --- | --- |
| https://localhost:3443 | Website và API tại `/api/v1` |
| https://localhost:9443 | Media |
| http://localhost:18080 | Chuyển hướng sang HTTPS |

Các cổng mặc định bind vào `127.0.0.1` (đổi `APP_HOST` trong `.env` nếu cần truy cập từ LAN).

Các lệnh vận hành, chạy trong `infosound/`:

```bash
make status              # Xem trạng thái dịch vụ
make doctor              # Kiểm tra env, secrets, Docker và cấu hình
make build && make up    # Build lại sau thay đổi source rồi khởi động
make down                # Dừng dịch vụ, giữ dữ liệu
```

`make bootstrap` chỉ sinh secrets/chứng chỉ còn thiếu, không ghi đè giá trị đã có. `make up` chạy migration nhưng không reset dữ liệu. Xem [hướng dẫn Docker](infosound/DOCKER.md).

## Cấu trúc thư mục

```text
.
├── README.md                 # Giới thiệu dự án
├── PROGRESS.md               # Tiến độ, thay đổi và kết quả kiểm chứng
└── infosound/                # Source chính
    ├── apps/
    │   ├── web/              # Giao diện Next.js
    │   ├── api/              # API NestJS
    │   ├── audio-worker/     # Xử lý âm thanh
    │   └── background-worker/
    ├── packages/             # Database, contracts, storage dùng chung
    ├── infra/                # Docker, gateway, database và sandbox
    ├── scripts/              # Build, vận hành và công cụ hỗ trợ
    ├── docs/                 # Tài liệu hệ thống
    ├── design-system/        # Quy chuẩn giao diện
    └── compose*.yaml         # Cấu hình dịch vụ
```

Runtime, secrets, dữ liệu và backup được lưu riêng, không đưa lên Git. `.gitignore` ở thư mục này và trong `infosound/` loại các file private, dependency, cache và kết quả build.

## Tài liệu phát triển

- [README kỹ thuật](infosound/README.md) và [tiến độ hiện tại](infosound/PROGRESS.md).
- [Kiến trúc](infosound/docs/ARCHITECTURE.md), [mô hình dữ liệu](infosound/docs/DATA_MODEL.md) và [API](infosound/docs/API.md).
- [Luồng phát nhạc](infosound/docs/PLAYBACK.md), [xử lý âm thanh](infosound/docs/WORKERS.md) và [lời đồng bộ](infosound/docs/LYRICS.md).
- [Hệ thống giao diện](infosound/docs/DESIGN_SYSTEM.md), [đa ngôn ngữ](infosound/docs/I18N.md) và [bảng màu](infosound/docs/THEMES.md).
- [Bảo mật](infosound/docs/SECURITY.md), [backup/restore](infosound/docs/BACKUP_RESTORE.md) và [giới hạn hiện tại](infosound/docs/KNOWN_LIMITATIONS.md).

Môi trường hiện tại phục vụ chạy local; hàng đợi phát chỉ tồn tại trong phiên trang, còn thư viện và lịch sử nghe được lưu theo tài khoản. Các catalog ngôn ngữ bổ sung là bản dịch máy lưu sẵn, chưa được hiệu đính toàn bộ. Trạng thái triển khai và phạm vi kiểm thử của từng tính năng được ghi tại PROGRESS.
