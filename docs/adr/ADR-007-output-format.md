# ADR-007: Định dạng xuất đầu tiên

- **Trạng thái:** Đã chấp nhận (cho MVP)
- **Ngày:** 2026-10-30
- **Người phụ trách:** KalvinKhanh

## Bối cảnh

Roadmap đề nghị chọn một định dạng xuất đầu tiên: Markdown, DOCX hoặc LaTeX.

## Các lựa chọn

- **Markdown:** đơn giản, dễ diff, dễ gắn citation marker, dễ kiểm thử.
- **DOCX:** gần với quy trình nộp bài thực tế. `slr-be` đã dùng thư viện `docx` cho báo cáo PRISMA.
- **LaTeX:** cần template theo từng tạp chí.

## Quyết định

**Markdown** cho MVP, kèm citation manifest (JSON) và báo cáo chất lượng. DOCX làm sau khi có Journal Profile của một tạp chí cụ thể. Citation được lưu tách khỏi văn bản (`CitationOccurrence`), không phụ thuộc cú pháp Markdown, nên đổi định dạng xuất không làm đổi dữ liệu.

## Hệ quả

- Tạo thêm bộ render theo định dạng ở lớp export, tách khỏi logic viết và xác minh.
- Người dùng muốn nộp bài phải chuyển Markdown sang DOCX thủ công cho đến khi DOCX được hỗ trợ.
