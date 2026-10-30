# ADR-005: Nguồn sự thật của reference và finding

- **Trạng thái:** Đã chấp nhận (cho MVP)
- **Ngày:** 2026-10-30
- **Người phụ trách:** KalvinKhanh

## Bối cảnh

Nguyên tắc cốt lõi: citation chỉ lấy từ registry, và Writer không được sửa nội dung khoa học. Dữ liệu gốc nằm ở `slr-be` và có thể thay đổi sau khi bài đã được viết.

## Quyết định

1. **Sao chép dữ liệu vào snapshot khi import.** Study, document, extracted finding, evidence, claim và research question của một `run` được lưu vào database của Writing, kèm `run_id`, `corpus_hash` và `corpus_version`. Snapshot **bất biến**: không sửa trực tiếp.
2. **Registry của Writing là nguồn duy nhất cho citation.** Citation chỉ được trỏ tới `study_id` có trong snapshot. DOI và metadata lấy nguyên từ corpus. DOI null thì giữ null, không bổ sung.
3. **Giữ nguyên ID của `slr-be`** (`study_id`, `finding_id`, `evidence_id`, `claim_id`, `run_id`) làm khóa ngoại lý, để truy ngược được về hệ thống gốc.
4. **Dữ liệu nguồn đổi thì tạo snapshot mới.** So sánh `corpus_hash` giữa snapshot đã dùng và run mới nhất. Khác nhau thì đánh dấu bản thảo phụ thuộc là `STALE` và tạo báo cáo ảnh hưởng, không tự sửa bản thảo đã duyệt.
5. **Tên trong code:** `ExtractedFinding` cho `corpus.findings` (giá trị trích xuất), `SynthesisFinding` cho kết luận tổng hợp (theme và câu trả lời theo RQ), để không nhầm với từ "finding" của `slr-be`.

## Hệ quả

- Tốn dung lượng cho bản sao, nhưng đổi lại có tính tái lập và kiểm toán.
- Chỉ import run ở trạng thái đủ điều kiện (readiness). Artifact `invalid` hoặc chưa `approved` không được dùng làm bằng chứng, trừ khi người dùng ghi nhận ngoại lệ có lý do.
