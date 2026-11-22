# Chatbot - InfoSound AI Assistant

**Thành viên:** Nguyễn Văn Long (longnv)

Chatbot hỏi đáp về âm nhạc cho nền tảng InfoSound, dùng Google Gemini với **function calling** —
bot tự truy vấn cơ sở dữ liệu để trả lời chính xác, không bịa thông tin.

## Tính năng

- **Hỏi đáp có dữ liệu thật** — bot tự gọi tool query DB (search/popular/artist) trước khi trả lời
- **Thẻ bài hát phát được trong chat** — khi bot nhắc bài hát, giao diện hiện thẻ có nút ▶, bấm phát ngay
- **Streaming response** — text hiện dần từng đoạn
- **Lịch sử hội thoại** — xem lại / xoá các cuộc trò chuyện cũ
- Chỉ hoạt động cho user đã đăng nhập
- Scope hẹp: chỉ trả lời về nhạc, từ chối câu hỏi ngoài phạm vi
- **Unit tests** — 18 test cho lớp protocol thuần

## Kiến trúc

```
chatbot/
├── src/
│   ├── server/
│   │   ├── controller.ts    # NestJS controller — 4 endpoints, tool loop, Gemini
│   │   └── protocol.ts       # Helper thuần (tool declarations, SSE, parse, context)
│   ├── shared/
│   │   └── protocol.mjs       # Bản JS của protocol.ts để test (node --test)
│   └── ui/
│       ├── index.tsx           # Entry — chỉ render khi đã login
│       ├── chatbot-context.tsx # State + SSE streaming + lịch sử hội thoại
│       ├── chatbot-bubble.tsx  # Nút 💬 floating góc phải dưới
│       ├── chatbot-panel.tsx   # Panel chính (chat ↔ lịch sử)
│       ├── chatbot-history.tsx # Danh sách hội thoại cũ
│       ├── chatbot-message.tsx # Render tin nhắn + thẻ bài hát
│       ├── chatbot-input.tsx   # Ô nhập + nút gửi
│       ├── chatbot-track-card.tsx # Thẻ bài hát bấm phát (qua usePlayer)
│       └── chatbot.css         # Styles (CSS variables, responsive)
├── tests/
│   └── protocol.test.mjs       # 18 unit test (node --test)
├── migration.sql               # DB schema: chat_conversations + chat_messages
├── package.json
└── README.md
```

> Code thực thi nằm trong `infosound/apps/api/src/` và `infosound/apps/web/features/chatbot/`
> (vì Docker build từ đó). Thư mục `chatbot/` là bản mirror để nộp bài + chạy test.
> `src/shared/protocol.mjs` phản chiếu `src/server/protocol.ts` (logic thuần, bản JS để test không cần TS loader).

## Function Calling

Bot được cấp 3 công cụ, tự quyết khi nào gọi:

| Tool | Khi nào dùng | Query |
|------|--------------|-------|
| `search_tracks(query)` | Hỏi bài/nghệ sĩ cụ thể | title hoặc artist chứa query |
| `get_popular_tracks(limit)` | Hỏi bài đang hot/nghe nhiều | sắp theo playCount |
| `get_artist_tracks(artist_name)` | Hỏi nghệ sĩ X có bài gì | lọc theo tên nghệ sĩ |

**Luồng:** gọi Gemini (kèm tools) → nếu có `functionCall` → thực thi query DB → trả kết quả cho
Gemini → lặp tới khi có câu trả lời cuối → stream text + đính kèm track objects (đã serialize qua
`viewTrack`, có signed cover URL) để UI hiện thẻ phát nhạc.

## API Endpoints

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/api/v1/chat/messages` | Gửi tin nhắn, nhận SSE stream (text + tracks) |
| GET | `/api/v1/chat/conversations` | Danh sách hội thoại |
| GET | `/api/v1/chat/conversations/:id/messages` | Tin nhắn của 1 hội thoại |
| DELETE | `/api/v1/chat/conversations/:id` | Xóa hội thoại |

## SSE Protocol

```
→ POST /api/v1/chat/messages {message, conversationId?}
← data: {"type":"meta","conversationId":"uuid"}
← data: {"type":"text","text":"Bài hát đang hot nhất là "}
← data: {"type":"text","text":"\"See Tình\"..."}
← data: {"type":"tracks","tracks":[{id,title,author,coverUrl,...}]}
← data: {"type":"done"}
```

## AI Model

- **Provider:** Google Gemini (REST API trực tiếp, không cần SDK)
- **Model:** `gemini-3.5-flash-lite` (cấu hình qua `GEMINI_CHAT_MODEL`)
- **Rate limit:** 10 tin/phút, 50 tin/giờ per user

## Database

2 bảng (xem `migration.sql`):
- `chat_conversations` — id, user_id, title, timestamps
- `chat_messages` — id, conversation_id, role (user/assistant), content, timestamp

## Chạy test

```bash
cd chatbot && npm test          # hoặc: node --test tests/
```

18 test cho `protocol.mjs`: SSE framing, chunk text (lossless), parse function call
(positive control 2 chiều — case có tool call + case không), tool declarations, format context.

## Cài đặt

1. Thêm `GEMINI_API_KEY` vào `infosound/.env`
2. Code đã tích hợp vào `infosound/apps/api` và `infosound/apps/web`
3. Migration đã chạy — 2 bảng có sẵn trong DB
4. Rebuild: `cd infosound && bash scripts/compose.sh up --build -d api web`
