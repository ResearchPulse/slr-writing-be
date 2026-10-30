# ADR-011: Cơ sở dữ liệu

- **Trạng thái:** Đã chấp nhận
- **Ngày:** 2026-10-30
- **Người phụ trách:** KalvinKhanh

## Bối cảnh

`slr-be` dùng Firestore. Writing cần ràng buộc khóa ngoại giữa finding, evidence, study, anchor và đoạn văn, snapshot bất biến, audit log chỉ ghi thêm, kiểm soát version, và truy vết ngược một câu về nguồn.

## Các lựa chọn

- **PostgreSQL + Prisma.**
- **Firestore** như `slr-be`: không có FK, JOIN, full-text search, và cần Firebase Emulator cùng Java trong CI.

## Quyết định

**PostgreSQL 16 + Prisma 7.** Dev chạy bằng Docker (cổng 5433). CI dùng service container. Triển khai dùng Postgres được quản lý (Neon hoặc Supabase), chỉ cần đổi `DATABASE_URL`.

## Hệ quả

- Hai hệ thống dùng hai database, không JOIN với nhau. Dữ liệu từ `slr-be` đi qua API và được lưu thành snapshot (ADR-001, ADR-005).
- Prisma 7 yêu cầu driver adapter (`@prisma/adapter-pg`) khi thêm model đầu tiên.
- Quy tắc chuyển trạng thái, FK và unique do database và backend cùng kiểm tra. JSON Schema không thay thế các ràng buộc này.
