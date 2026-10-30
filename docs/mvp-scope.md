# Phạm vi MVP

> P0-03. Ngày 2026-10-30. Trạng thái: **đề xuất đã được chấp nhận để bắt đầu**, có thể điều chỉnh sau. Căn cứ: `docs/SLR_AI_Writing_Implementation_Roadmap.md` và `docs/slr-be-survey.md`.

## 1. Mục tiêu MVP

Một đường đi hoàn chỉnh, truy vết được từ đầu đến cuối cho **một project SLR**:

1. Lấy một `run` đã duyệt từ `slr-be` và lưu thành **snapshot bất biến**.
2. Kiểm tra snapshot có đủ dữ liệu để viết (readiness).
3. Tạo Journal Profile tối thiểu, tạo outline và **người dùng duyệt (H1)**.
4. Tạo ParagraphPlan chỉ từ finding và evidence đã duyệt.
5. Sinh văn bản một section bằng LLM, citation chỉ lấy từ registry. **Người dùng duyệt nội dung (H2)**.
6. Kiểm chứng citation và claim, hiển thị issue, cho người dùng sửa hoặc chấp nhận có lý do.
7. Chặn export khi còn lỗi nghiêm trọng. **Người dùng duyệt bản cuối (H3)**.
8. Xuất Markdown cùng citation manifest và báo cáo chất lượng.
9. Truy ngược một câu trong bản thảo về `ParagraphPlan → Finding → Study → SourceAnchor`.

## 2. Các quyết định đã chốt cho MVP

| Hạng mục | Quyết định | Ghi chú |
|---|---|---|
| Nguồn dữ liệu | API `slr-be`, gọi bằng token của người dùng | ADR-001 |
| Loại bài | Systematic review | |
| Journal Profile | **Một profile cấu hình được**, mặc định cấu trúc IMRaD chung. Chưa nhắm tạp chí cụ thể | Xem mục 4 |
| Định dạng xuất | Markdown | ADR-007. DOCX để sau |
| Artifact dùng | A1 (Results), A10 (Methods, PRISMA), A7 (Discussion), A2 (mô tả corpus) | |
| Quyền duyệt H1, H2, H3 | Vai trò **OWNER** của project trên `slr-be` | Khớp quyền duyệt artifact |
| Database | PostgreSQL + Prisma | ADR-011 |
| LLM | Qua interface `LLMProvider`, có mock cho test. Nhà cung cấp chưa chốt | Làm ở Phase 4 |

## 3. Ngoài phạm vi MVP

- SAPEA riêng (annotation, relation, graph UI). A3 của `slr-be` đã có nền AIF, dùng lại sau.
- A3, A4, A5, A6, A8, A9 trong bài viết.
- Xuất DOCX, LaTeX.
- Hàng đợi job và worker riêng (MVP chạy đồng bộ, có `job` đơn giản để theo dõi).
- Nhiều Journal Profile có kiểm tra chính sách tự động.
- Tự nộp bài, tự sinh DOI hay reference, meta-analysis.
- Đồng bộ liên tục với `slr-be`. MVP chỉ import snapshot theo yêu cầu.

## 4. Journal Profile

Vì chưa chọn tạp chí, MVP có đúng **một profile mặc định** do hệ thống cung cấp:

- Cấu trúc IMRaD: Abstract, Introduction, Methods, Results, Discussion, Conclusion.
- Phân bổ số từ mặc định theo section, cho phép chỉnh.
- `verified_at = null` và `policy_source_urls = []`, hiển thị cảnh báo **"chưa xác minh với chính sách tạp chí"**. Không được trình bày như chính sách thật của một tạp chí.
- Khi chọn tạp chí, thêm profile mới có `policy_source_urls`, `verified_at` và người chịu trách nhiệm.

## 5. Phạm vi artifact và chỗ dùng trong bài

| Section | Nguồn dữ liệu |
|---|---|
| Methods, PRISMA | A10 (`protocol`, `search_strategy`, `selection`, `selected_studies`) và `prisma/writing-export.json` |
| Study characteristics | A2 (phân bố theo năm, venue, context) |
| Results | A1 (theme, finding đã trích, outcome, limitation) |
| Discussion | A7 (mâu thuẫn, điểm không chắc chắn), limitation từ A1 và A10 |
| Abstract, Introduction, Conclusion | Sinh sau cùng từ các section trên và RQ. Mọi claim vẫn phải có evidence |

## 6. Thước đo thành công

- Import được một run thật (hoặc fixture đã ẩn thông tin) và báo cáo readiness đúng cho các trường hợp thiếu dữ liệu.
- Mọi finding và evidence dùng trong plan đều tồn tại trong snapshot. Plan trỏ ID không tồn tại thì bị từ chối.
- Draft không chứa citation ngoài registry. Có test chứng minh.
- Export bị chặn khi có issue critical hoặc chưa có H3.
- Truy ngược được một câu về source anchor bằng một truy vấn.
- Tái lập metadata của export từ snapshot, profile version, model config và hash.

## 7. Rủi ro đã biết

Xem mục "Khoảng trống" trong `docs/slr-be-survey.md`. Quan trọng nhất cho MVP:

- Không có `certainty` ở A4, nên `claim_strength` do người dùng hoặc quy tắc cố định quyết định.
- Source anchor neo theo đoạn Markdown, có thể thiếu số trang.
- Phát hiện dữ liệu cũ (`STALE`) phải tự làm bằng cách so `corpus_hash`.
