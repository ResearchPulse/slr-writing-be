# Khảo sát `slr-be`: output của SLR dùng làm đầu vào cho Writing

> Phase 0 (P0-01, P0-02). Khảo sát ngày 2026-10-30 trên mã nguồn `slr-be` nhánh `dev`. Mọi điều ghi ở đây lấy từ code, không đoán. Chỗ chưa xác minh được ghi là **UNKNOWN**. Nếu code lệch tài liệu này thì code đúng.

## 1. Kết luận chính

1. **`slr-be` đã có sẵn gần đúng thứ roadmap cần.** Module `slr-artifacts` tạo ra một *corpus* (study, document, finding, evidence, claim) với ID ổn định, cộng 10 artifact A1–A10, gắn hash và trạng thái duyệt. Không cần quét web hay đoán schema: có API thật và kiểu TypeScript rõ ràng.
2. **Một `run` gần tương đương `ReviewSnapshot`.** Mỗi lần generate tạo một `run` mới, bất biến, kèm bản corpus đầy đủ và `corpus_hash`. Đúng nguyên tắc "snapshot bất biến, sửa dữ liệu thì tạo version mới".
3. **Từ "finding" của `slr-be` khác với roadmap.** Đây là điểm dễ nhầm nhất, xem mục 4.
4. **Không có xác thực giữa service với service.** Các endpoint artifact cần Firebase ID token của người dùng và vai trò trong project. Phải quyết định cách gọi (mục 5).
5. **Có vài thứ roadmap giả định nhưng `slr-be` chưa có**, xem mục 6.

## 2. Hiện trạng `slr-be` (P0-01)

| Hạng mục | Thực tế |
|---|---|
| Stack | Node.js 22, TypeScript ESM, Express 4, zod 3, pino, vitest |
| Database | Firestore (Firebase Admin). Không có ORM |
| Lưu file | Cloudinary (ảnh, PDF, Markdown), Firebase Storage |
| AI | Gemini, ngoài ra có agent bên ngoài qua `/api/agent/v1` |
| Xử lý PDF | GROBID (PDF thành Markdown và bản đồ tọa độ đoạn văn) |
| Auth | Firebase ID token (`requireAuth`), vai trò project `OWNER`, `LECTURER`, `REVIEWER`, và `MEMBER` (bất kỳ thành viên). Admin toàn cục được coi là OWNER |
| Envelope response | Không thống nhất: `{success, isSuccess, data, message}` hoặc `{success, data}`. Lỗi luôn là `{success:false, error:{code, message}}` |
| Tài liệu API | Swagger ở `/api-docs`, bản sinh tự động và bản repository riêng |
| Thư mục liên quan | `modules/slr-artifacts`, `synthesis`, `data-extraction`, `prisma` (PRISMA flow, không phải ORM), `protocol`, `quality-assessment`, `paper-ai-analysis`, `repository-api` |

Repo này (`slr-writing-be`) dùng Express 4, zod 3, pino, vitest giống hệt, nên có thể chép quy ước.

## 3. Output của SLR (P0-02)

### 3.1 Corpus (`SlrArtifactCorpus`)

Định nghĩa trong `src/modules/slr-artifacts/slr-artifacts.types.ts`. Mọi artifact đều sinh từ một corpus duy nhất và dùng chung các ID:

| Thực thể | ID | Nội dung chính |
|---|---|---|
| `studies[]` | `study_id` = id paper đã INCLUDED | title, authors, year, doi (có thể null), venue, keywords, trạng thái extraction (`COMPLETED` hoặc `NOT_COMPLETED`), `document_ids` |
| `documents[]` | `document_id` | `kind` luôn là `fulltext_markdown`, `source_revisions[]`, `source_hashes[]` |
| `findings[]` | `finding_id` = `F:{paperId}:{fieldId}` | một **giá trị đã trích xuất theo consensus** của reviewer: `field_name`, `role`, `value_text`, `is_not_reported`, `evidence_ids[]` |
| `evidence[]` | `evidence_id` | **trích dẫn nguyên văn** từ bài: `quote`, `quote_hash`, `quote_hash_verified`, `source_hash`, `source_location`, `consensus_value_match` |
| `claims[]` | `claim_id` | **theme** do nhà nghiên cứu tự định nghĩa, kèm `items[]` trỏ tới finding đã trích |
| `research_questions[]` | `rq_id` | `code`, `question` |
| `quality[]` | theo `study_id` | trạng thái `RESOLVED` / `UNRESOLVED` / `NOT_ASSESSED`, quyết định `HIGH` / `LOW`, điểm |
| `extraction_decisions[]` | `decision_id` | bất đồng và giá trị thiếu giữa các reviewer |
| `field_roles[]` | theo field | field của template trích xuất ứng với vai trò nào (finding, outcome, limitation...) và nguồn của việc ánh xạ |
| `picoc`, `issues[]` | | PICOC và danh sách vấn đề của corpus |

Corpus có `corpus_version` (hiện `slr-artifact-corpus-v2`), `corpus_hash` (SHA-256 nội dung), `built_at`.

**Source anchor** (`evidence[].source_location`): `page` (số hoặc null), `section`, `paragraph` (chỉ số đoạn 0-based trong Markdown của GROBID), `table_or_figure`, và tùy chọn `char_start`, `char_end`. Vị trí là theo đoạn văn của Markdown, không phải tọa độ PDF. `page` có thể null.

### 3.2 Mười artifact

| Mã | Tên | Dùng cho Writing |
|---|---|---|
| A1 | Knowledge Synthesis Matrix | Nguồn chính của phần Results: mỗi dòng là một theme, kèm finding đã trích, outcome, limitation, citation |
| A2 | Research Landscape & Taxonomy | Phần mô tả corpus: phân bố theo năm, venue, keyword, context |
| A3 | Scientific Argument Graph | Đồ thị lập luận kiểu AIF (node I và S, edge có role), kèm provenance và báo cáo validation |
| A4 | Evidence Quality & Confidence | Đánh giá chất lượng từng study. **Phần `certainty` chưa được đánh giá** (xem mục 6) |
| A5 | Context-Conditions-Outcomes | Điều kiện biên theo nhóm |
| A6 | Mechanism & Moderator Map | Đồ thị cơ chế và biến điều tiết |
| A7 | Contradiction & Uncertainty Register | Mâu thuẫn và điểm không chắc chắn, rất hợp cho phần Discussion |
| A8 | Evidence Gap Map | Bản đồ khoảng trống |
| A9 | Research Agenda | Đề xuất hướng nghiên cứu (câu hỏi sinh theo mẫu) |
| A10 | Traceability & Reproducibility Package | Protocol, chiến lược tìm kiếm, tiêu chí chọn, PRISMA, manifest artifact, decision log. Nguồn cho phần Methods |

Mọi artifact đều có `artifact_id`, `artifact_type`, `schema_version` (`1.0.0`), `metadata` với `corpus_hash`, thông tin generator (xác định hoặc AI), `review_status`, `validation_status`, `limitations[]`.

### 3.3 Run và trạng thái duyệt

- **`SlrArtifactRun`** (Firestore: `projects/{id}/slrArtifactRuns/{runId}`): `run_id` (dạng `run-YYYYMMDDHHMMSS-xxxxxx`), `generated_at`, `generated_by`, `corpus_hash`, `corpus_version`, `generator_version`, `options`, `artifacts[]` (mỗi phần tử có `content_hash`, `review_status`, `validation_status`), `reviews[]`.
- Payload của từng artifact và của `corpus` lưu tách trong subcollection, chia chunk. Truy cập qua API, không đọc Firestore trực tiếp.
- `review_status`: `unreviewed`, `needs_human_review`, `approved`, `rejected`.
- `validation_status`: `valid`, `invalid`, `not_applicable`.
- Duyệt: `POST .../runs/:runId/artifacts/:type/review` với `{decision: 'APPROVED'|'REJECTED', note?}`, chỉ **OWNER**. Artifact `invalid` không thể approved. Lịch sử duyệt là append-only trong `reviews[]`.

### 3.4 Dữ liệu methods và PRISMA

- `GET /api/projects/:projectId/prisma/writing-export.json` trả `PrismaWritingExport` (`schemaVersion: 'slr-prisma-writing-v1'`): số liệu flow (identified, removed, screened, excluded, sought, assessed, included), danh sách `includedStudies`, `excludedReports` kèm lý do, và `limitations[]`. Mô tả trong code là "gói bằng chứng cho bước viết tiếp theo", tức đúng mục đích của repo này.
- Có thêm báo cáo PRISMA theo version (`/prisma/reports`, xuất DOCX) và A10 chứa lại `selection.prisma`.
- Kết luận theo từng RQ do researcher viết: `GET /api/projects/:projectId/synthesis/findings` trả `ResearchQuestionFinding` (`answerText`, `status` là `Draft` hoặc `Finalized`).

### 3.5 Các endpoint dùng được

Tiền tố `/api`. Cần header `Authorization: Bearer <Firebase ID token>`. Vai trò tối thiểu: `MEMBER` cho GET, `OWNER` cho tạo run và duyệt.

| Method | Đường dẫn | Mục đích |
|---|---|---|
| GET | `/projects/:projectId/synthesis/artifacts/corpus` | Dựng corpus hiện tại (live, chưa là snapshot) |
| POST | `/projects/:projectId/synthesis/artifacts/runs` | Tạo run mới (OWNER) |
| GET | `/projects/:projectId/synthesis/artifacts/runs` | Danh sách run |
| GET | `/projects/:projectId/synthesis/artifacts/runs/:runId` | Chi tiết run |
| GET | `/projects/:projectId/synthesis/artifacts/runs/:runId/artifacts/:type` | Một artifact (`A1`..`A10`) hoặc `corpus` của run |
| POST | `/projects/:projectId/synthesis/artifacts/runs/:runId/artifacts/:type/review` | Duyệt (OWNER) |
| GET | `/projects/:projectId/prisma/writing-export.json` | Dữ liệu PRISMA cho bài viết |
| GET | `/projects/:projectId/synthesis/findings` | Câu trả lời theo RQ của researcher |

Response của nhóm artifact: `{success, isSuccess, data, message}`.

## 4. Đối chiếu thuật ngữ roadmap với `slr-be`

| Roadmap | Trong `slr-be` | Ghi chú |
|---|---|---|
| `ReviewSnapshot` | `SlrArtifactRun` + payload `corpus` | `snapshot_id` = `run_id`; hash là `corpus_hash` |
| `ResearchQuestion` | `corpus.research_questions` | Không có trường `status` |
| `ReviewArtifact` A1–A10 | `SlrArtifactRun.artifacts[]` | Đủ 10 artifact có thật, tên khác ví dụ trong roadmap (A1 là Knowledge Synthesis Matrix, không phải `evidence_synthesis`) |
| `Study` / `SourceDocument` | `corpus.studies` / `corpus.documents` | Chỉ có full text Markdown, không có PDF gốc trong corpus |
| `SourceAnchor` | `corpus.evidence[].source_location` + `quote` | Neo theo đoạn Markdown |
| `EvidenceRecord` | `corpus.evidence` | Là trích dẫn nguyên văn |
| `ExtractionRecord` | `corpus.findings` | **Đây là điểm dễ nhầm**: `finding` của `slr-be` là giá trị trích xuất, không phải kết luận tổng hợp |
| `SynthesisFinding` | `corpus.claims` (theme) và `A1.rows[].synthesized_finding`, cộng `ResearchQuestionFinding` | Có hai nguồn: theme (nhiều) và câu trả lời theo RQ (một cho mỗi RQ) |
| `ArgumentUnit`, `ArgumentRelation` | A3 (`nodes`, `edges`) | A3 đã dựa trên AIF, nên SAPEA không cần xây lại từ đầu cho Writing |
| `ProvenanceEvent` | A10 `decision_log`, `change_log`, `reviews[]` | |
| `ArtifactStatus` | `review_status` + `validation_status` | Roadmap có `DRAFT/PENDING_REVIEW/APPROVED/REJECTED/N_A/STALE`; `slr-be` chỉ có 4 giá trị duyệt, không có `N_A` và `STALE` |

**Quy ước đặt tên khi viết code:** trong repo này, gọi thứ roadmap gọi là "finding" là `SynthesisFinding`, và giữ nguyên tên `ExtractedFinding` cho `corpus.findings`, để không lẫn.

## 5. Nên lấy dữ liệu theo cách nào

Có ba hướng. Cần ghi thành ADR-001.

| Cách | Ưu | Nhược |
|---|---|---|
| A. Gọi API `slr-be` bằng token của người dùng | Dữ liệu luôn mới, có kiểm soát quyền theo project | Cần đăng nhập Firebase từ frontend của Writing, token hết hạn sau khoảng 1 giờ, job chạy dài khó |
| B. Người dùng tải về file rồi import vào Writing | Đơn giản, độc lập, không phụ thuộc xác thực | `slr-be` chưa có endpoint xuất một file gộp corpus + artifact, phải tự ghép từ nhiều lần gọi |
| C. Thêm vào `slr-be` một endpoint xuất gói (hoặc xác thực service) | Sạch nhất về lâu dài | Cần sửa repo khác, phối hợp với người phụ trách |

**Đề xuất:** làm A cho MVP. Frontend Writing gọi `slr-be` bằng token của người dùng, lấy `corpus` và các artifact của một run, rồi gửi cho backend Writing để tạo snapshot. Về sau nếu cần chạy nền thì cân nhắc C.

## 6. Khoảng trống giữa roadmap và thực tế

1. **Không có xác thực service-to-service** cho endpoint artifact. Agent token (`slrp_`) chỉ dùng cho agent task, repository API key chỉ dùng cho kho paper.
2. **`certainty` của A4 chưa triển khai.** Mọi mục đều `rating: null`, `status: 'not_assessed'`. Vì vậy không có độ tin cậy (confidence) cho finding. `claim_strength` trong `ParagraphPlan` không thể suy ra từ dữ liệu có sẵn, phải do người dùng chọn hoặc quy tắc riêng.
3. **Không có trạng thái `STALE`.** Nếu artifact hay corpus thay đổi sau khi viết thì Writing phải tự phát hiện bằng cách so sánh `corpus_hash` giữa run cũ và run mới.
4. **Source anchor là đoạn Markdown, không phải PDF.** Roadmap muốn mở đúng trang PDF; `page` có thể null. Cần xác minh trên dữ liệu thật tỉ lệ bản ghi có `page` (**UNKNOWN**).
5. **Chưa có endpoint xuất gói.** Muốn lấy trọn một run phải gọi nhiều lần.
6. **Quyền duyệt khác nhau:** duyệt artifact chỉ OWNER; trích xuất và tạo theme là LECTURER. Cần chốt ai được duyệt bài viết (H1, H2, H3) và có mượn vai trò project hay không.
7. **Envelope response không thống nhất** giữa các module của `slr-be`, nên adapter phải xử lý cả hai dạng.
8. **A9 (Research Agenda):** câu hỏi đề xuất sinh theo mẫu (`origin: 'template'`), `feasibility.rating` là null. Không nên coi là kết luận khoa học khi viết.
9. **A3 có hai chế độ sinh** (xác định hoặc AI). Bản sinh bằng AI phải được đánh dấu là suy luận khi đưa vào bài.

## 7. Việc còn cần xác minh (UNKNOWN)

- Dữ liệu thật: một project mẫu có đủ corpus và A1–A10 để chạy thử adapter. Nên dùng project demo đã nêu trong ghi chú nội bộ, dữ liệu đã loại thông tin nhạy cảm.
- Tỉ lệ evidence có `page` khác null, và `char_start`/`char_end` có được điền không.
- Quyền sử dụng full text của các paper trong corpus khi đưa vào bài viết (bản quyền).
- Corpus lớn (hàng trăm study) thì kích thước payload và thời gian gọi API ra sao.
- Cách `slr-fe` hiện đang đọc các endpoint trên (để tái sử dụng kiểu dữ liệu).

## 8. Đề xuất cho các bước tiếp theo

1. Chốt ADR-001 theo hướng A (gọi API bằng token người dùng) cho MVP.
2. Lấy một run mẫu từ project demo, lưu JSON đã ẩn thông tin nhạy cảm vào `tests/fixtures/`, dùng làm gold để viết adapter và test.
3. Thiết kế schema Phase 1 bám theo corpus: `Study`, `SourceDocument`, `ExtractedFinding`, `Evidence` (kiêm source anchor), `Claim` (theme), `ResearchQuestion`, cùng bảng `ReviewSnapshot` lưu `run_id`, `corpus_hash`, `schema_version`.
4. Với MVP, dùng A1 (Results), A10 (Methods, PRISMA), A7 (Discussion), A2 (mô tả corpus). A3 và A4–A6, A8–A9 để sau.
5. Cắt SAPEA riêng khỏi MVP: A3 đã có nền AIF.
