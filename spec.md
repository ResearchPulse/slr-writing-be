# slr-writing-be spec

> Đọc file này trước khi đọc code. Snapshot 2026-10-30: repo mới khởi tạo (nhánh `dev`), chưa có logic nghiệp vụ. Code lệch spec thì code đúng.

---

## 1. Hệ thống

**SLR AI Writing** là phân hệ hậu tổng hợp của SLRS (`slr-be` + `slr-fe`). Đầu vào là kết quả SLR đã được người dùng xác nhận (RQ, studies, findings, artifacts A1–A10, methods/PRISMA, references). Đầu ra là bản thảo bài báo có thể truy vết từng câu về finding, study và source anchor.

Quyết định đã chốt: **tự xây writing engine, không dùng phase cuối của AutoResearchClaw.** Lý do: hệ thống cần Writer không sửa science, citation chỉ lấy từ registry, và có các điểm duyệt của con người. Pipeline viết tự do của công cụ khác đi ngược các nguyên tắc này.

Tài liệu thiết kế đầy đủ: `docs/SLR_AI_Writing_Implementation_Roadmap.md` (12 stage S0–S11, Phase 0–7, quality gate G1–G7). Các endpoint, schema và UI trong tài liệu đó là **đề xuất**, không phải thứ đã tồn tại.

## 2. Nguyên tắc bắt buộc

1. Artifact-first: viết từ snapshot có version và hash, không viết từ dữ liệu chưa xác nhận.
2. Writer không sửa science: không đổi finding, metric, sample size, reference registry.
3. Registry-only citation: citation phải trỏ tới source ID có trong registry. Không tự tạo DOI hay reference.
4. Fail-closed: chặn export khi có lỗi critical, citation không tồn tại, PRISMA count lệch, hoặc thiếu final approval. `NOT_RUN` không phải `PASS`.
5. Human-accountable: duyệt tại H1 (outline), H2 (nội dung), H3 (bản cuối).
6. Explicit / inferred / missing: suy luận của AI phải gắn `inferred`, không trình bày như trích dẫn nguyên văn.
7. Reference tồn tại không có nghĩa là reference hỗ trợ claim.

## 3. Stack

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js 22, TypeScript, ESM (NodeNext) |
| Framework | Express 4 (cùng phiên bản với `slr-be`) |
| Database | PostgreSQL 16 (Docker, cổng 5433) + Prisma 7. `prisma/schema.prisma` chưa có model; cấu hình URL ở `prisma.config.ts`; client sinh vào `src/generated/prisma` (gitignored) |
| Validate | zod 3 |
| Log | pino |
| API docs | `swagger-ui-express`, tài liệu OpenAPI viết tay ở `src/config/openapi.ts` |
| Test | vitest, supertest (`tests/**/*.test.ts`) |
| CI | GitHub Actions: `.github/workflows/ci.yml` (prisma validate, migrate deploy, typecheck, test, build; có service Postgres) cho PR và push vào `dev`, `main` |

**Đã chốt (2026-10-30):** PostgreSQL + Prisma, không dùng Firestore như `slr-be`. Lý do: cần FK giữa finding/evidence/study/anchor, snapshot bất biến, audit append-only, truy vết lineage bằng truy vấn quan hệ. Dữ liệu từ `slr-be` lấy qua API rồi lưu thành snapshot riêng.

**Chưa chốt:** nhà cung cấp LLM, hàng đợi job.

**Lưu ý Prisma 7:** khi thêm model đầu tiên cần cài thêm driver adapter (`@prisma/adapter-pg`) và khởi tạo `PrismaClient` với adapter đó.

## 4. Cấu trúc

```
src/
├─ app.ts            createApp(): helmet, request-logger, cors, json, swagger, routes, 404, error handler
├─ server.ts         listen + graceful shutdown
├─ routes.ts         gom router module dưới /api
├─ config/           env.ts (zod), logger.ts, openapi.ts
├─ middleware/       error, request-logger (req.id, X-Request-Id), validation (validate(zodSchema))
├─ shared/           errors/app-error.ts, types/common.types.ts
└─ modules/
   ├─ health/        GET /api/health (đã có)
   └─ snapshots, evidence, journal-profiles, manuscripts, verification, export, jobs, llm   (thư mục trống)
tests/               health.test.ts
docs/                tài liệu thiết kế
```

Quy ước theo `slr-be`: file `<module>.routes.ts` / `.controller.ts` / `.service.ts`, import có đuôi `.js`.

## 5. Quy ước API

- Thành công: `{ success: true, data }`. Lỗi: `{ success: false, error: { code, message, requestId } }`.
- Lỗi nghiệp vụ ném `AppError` (hoặc `NotFoundError`, `BadRequestError`, ...), `errorHandler` chuyển thành response.
- Input validate bằng `validate(z.object({ body, query, params }))`.
- Prefix: `/api`. Cổng mặc định: `5100`. Swagger: `/api-docs`.

Roadmap đề xuất `/api/v1` và envelope `{data, meta}`. Repo hiện dùng envelope của `slr-be` để đồng nhất với hệ thống SLR. Nếu đổi thì ghi vào ADR.

## 6. Biến môi trường

`NODE_ENV`, `PORT` (5100), `LOG_LEVEL`, `LOG_PRETTY`, `FRONTEND_URL` (CORS, cách nhau bằng dấu phẩy), `SLR_API_BASE_URL` (mặc định `http://localhost:5000`), `DATABASE_URL` (Postgres). Xem `.env.example`.

## 7. Trạng thái triển khai theo roadmap

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Khảo sát repo, xác minh output của SLR, chốt MVP, quy ước API | Chưa làm (mới có bộ khung) |
| 1 | Schema chuẩn, DB, ReviewSnapshot, validation | Chưa làm |
| 2 | Adapter SLR, Evidence Registry, source anchor | Chưa làm |
| 3 | Tích hợp SAPEA (argument graph) | Chưa làm, có thể cắt khỏi MVP |
| 4 | Writing engine (LLMProvider, outline, ParagraphPlan, draft) | Chưa làm |
| 5 | Citation, verification, quality gate, export | Chưa làm |
| 6 | UI (`slr-writing-fe`, chưa tạo) | Chưa làm |
| 7 | Test, đánh giá, triển khai | Chưa làm |

Thứ tự khuyến nghị: làm một lát cắt dọc cho một đoạn văn (snapshot → evidence → ParagraphPlan → draft → verify) trước khi mở rộng.

## 8. Quyết định còn mở

- Nhà cung cấp LLM (qua interface `LLMProvider` để đổi được).
- Cách lấy dữ liệu từ `slr-be`: gọi API nội bộ hay đọc file export. Cần xác minh output thực của `slr-be` (artifacts A1–A10 nằm ở `slr-be/src/modules/slr-artifacts`).
- Loại bài và Journal Profile cho MVP, định dạng output đầu tiên (Markdown hay DOCX).
- Phạm vi MVP có gồm SAPEA hay không.
