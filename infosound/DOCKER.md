# Chạy InfoSound bằng Docker (Linux)

Yêu cầu: một host Linux thông thường có **Docker Engine + plugin `docker compose` v2**, cùng `python3`, `openssl` và `make`. Không cần VM, SSH hay Docker Desktop. Chạy mọi lệnh trong thư mục `infosound/`.

## Lần đầu

```bash
cp .env.example .env     # chỉnh nếu muốn (host, cổng, Gemini key...)
make bootstrap           # sinh secrets + chứng chỉ tự ký vào ./.runtime/secrets, render nginx.conf
make build               # build các image ứng dụng
make up                  # khởi động đủ dịch vụ và chạy migration/storage bootstrap
```

Mở web tại <https://localhost:3443> (API ở `/api/v1`, media ở <https://localhost:9443>). Chứng chỉ do dự án tự ký — trình duyệt sẽ cảnh báo cho tới khi bạn trust `./.runtime/secrets/ca.crt`.

## Vận hành

```bash
make status              # trạng thái container (docker compose ps)
make doctor              # kiểm tra env, secrets, Docker và cấu hình compose
make logs                # xem log đã lọc thông tin nhạy cảm
make down                # dừng dịch vụ, giữ nguyên volume dữ liệu
make build && make up    # build lại sau khi đổi source rồi khởi động lại
```

Dữ liệu (PostgreSQL, Redis, storage/filer, audio tạm) nằm trong các Docker named volume và được giữ qua các lần `make down`/`make up`. Secrets, chứng chỉ và backup ở `./.runtime/` (đã gitignore), không bao giờ đưa vào Git hay build context.
