# slr-writing-be

Backend của phân hệ **SLR AI Writing** thuộc hệ thống ResearchPulse. Phân hệ này lấy kết quả đã được xác nhận từ hệ thống SLR (`slr-be`), kiểm chứng lại bằng chứng và hỗ trợ viết thành bản thảo bài báo khoa học.

> Tài liệu nội bộ. Dự án đang ở giai đoạn khởi tạo (Phase 0), mới có bộ khung và endpoint health check.

## Mục tiêu

- Nhập kết quả SLR đã duyệt và tạo **snapshot bất biến** có version và hash.
- Quản lý **Evidence Registry**: study, finding, evidence, source anchor.
- Lập outline và kế hoạch từng đoạn (ParagraphPlan) trước khi sinh văn bản.
- Sinh văn bản bằng LLM, giới hạn trong bằng chứng đã duyệt, không tự tạo citation, số liệu hay finding.
- Kiểm chứng citation và claim, tạo issue và cho người dùng duyệt, sửa.
- Xuất bản thảo kèm báo cáo chất lượng và audit trail.

Nguyên tắc cốt lõi:

1. Viết từ snapshot đã duyệt, không viết từ dữ liệu chưa xác nhận.
2. Writer không được sửa nội dung khoa học (finding, số liệu, reference).
3. Citation chỉ lấy từ registry.
4. Chặn export khi còn lỗi nghiêm trọng (fail-closed).
5. Con người duyệt tại 3 điểm: outline (H1), nội dung (H2), bản cuối (H3).

Thiết kế chi tiết nằm trong tài liệu `SLR_AI_Writing_Implementation_Roadmap.md` (12 stage S0 đến S11, các phase 0 đến 7).

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js 22, TypeScript (ESM, NodeNext) |
| Web framework | Express 4 (cùng phiên bản với `slr-be`) |
| Tài liệu API | Swagger UI (`swagger-ui-express`, OpenAPI 3) |
| Validate | zod 3 |
| Log | pino (tự che các trường nhạy cảm) |
| Test | vitest, supertest |

Chưa chốt: cơ sở dữ liệu (PostgreSQL hay Firestore), nhà cung cấp LLM, hàng đợi job.

## Cài đặt và chạy

Yêu cầu: Node.js 22 trở lên.

```bash
npm install
cp .env.example .env     # chỉnh lại giá trị nếu cần
npm run dev              # chạy ở chế độ watch, cổng 5100
```

Sau khi chạy:

- Health check: http://localhost:5100/api/health
- Swagger UI: http://localhost:5100/api-docs
- OpenAPI JSON: http://localhost:5100/api-docs.json

## Biến môi trường

Xem `.env.example`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `production` | `development`, `production` hoặc `test` |
| `PORT` | `5100` | Cổng server |
| `LOG_LEVEL` | tự chọn theo môi trường | `fatal` đến `trace`, hoặc `silent` |
| `LOG_PRETTY` | `true` khi development | Log dễ đọc cho môi trường dev |
| `FRONTEND_URL` | `http://localhost:5173,http://localhost:3000` | Danh sách origin được phép (CORS), cách nhau bằng dấu phẩy |
| `SLR_API_BASE_URL` | `http://localhost:5000` | Địa chỉ backend `slr-be` |

Không commit file `.env`.

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Chạy dev, tự reload (`tsx watch`) |
| `npm run build` | Biên dịch TypeScript ra `dist/` |
| `npm start` | Chạy bản đã build |
| `npm test` | Chạy toàn bộ test một lần |
| `npm run test:watch` | Chạy test ở chế độ watch |
| `npm run typecheck` | Kiểm tra kiểu, không sinh file |

## Cấu trúc thư mục

```
src/
├─ app.ts            Tạo Express app (middleware, routes, error handler)
├─ server.ts         Khởi động server, tắt an toàn khi nhận SIGTERM/SIGINT
├─ routes.ts         Gom route của các module dưới /api
├─ config/           env (zod), logger, openapi
├─ middleware/       error, request-logger, validation
├─ shared/           error dùng chung, type dùng chung
└─ modules/
   ├─ health/            Health check (đã có)
   ├─ snapshots/         Snapshot và kiểm tra readiness của review
   ├─ evidence/          Study, finding, evidence, source anchor
   ├─ journal-profiles/  Yêu cầu của tạp chí
   ├─ manuscripts/       Bản thảo, outline, paragraph plan, draft
   ├─ verification/      Kiểm chứng citation, claim và quality gate
   ├─ export/            Xuất bản thảo và audit
   ├─ jobs/              Quản lý job chạy dài
   └─ llm/               Lớp trừu tượng gọi LLM
tests/                Test (vitest)
docs/                 Tài liệu thiết kế
```

Các module ngoài `health` hiện là thư mục trống, sẽ được triển khai theo từng phase.

## Quy ước

- **Tên file:** `<tên>.routes.ts`, `<tên>.controller.ts`, `<tên>.service.ts` trong thư mục module.
- **Import:** có đuôi `.js` (yêu cầu của ESM với NodeNext), ví dụ `import x from './x.js'`.
- **Response thành công:** `{ "success": true, "data": ... }`.
- **Response lỗi:** `{ "success": false, "error": { "code", "message", "requestId" } }`. Mã lỗi nằm trong `AppError`.
- **Request ID:** mỗi request có header `X-Request-Id`, dùng để truy vết log.
- **Validate input:** dùng middleware `validate(schema)` với zod.

## Quy trình làm việc với Git

- `main`: nhánh ổn định, chỉ cập nhật qua Pull Request.
- `dev`: nhánh tích hợp.
- Làm việc trên nhánh con (ví dụ `<tên>/feat/<nội-dung>`), mở PR vào `dev`.
- Commit theo dạng `feat:`, `fix:`, `chore:`, `docs:`, `test:`.

## Liên quan

- `slr-be`, `slr-fe`: hệ thống SLR, nguồn dữ liệu đầu vào.
- `slr-writing-fe`: giao diện cho phân hệ này (dự kiến).
