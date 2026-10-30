# SLR AI Writing --- Implementation Roadmap & Technical Specification

> **Phiên bản:** 0.1 (Implementation Draft)\
> **Ngày:** 29-10-2026\
> **Trạng thái:** Đề xuất triển khai --- cần xác nhận với codebase và
> định dạng export thực tế của SLRS\
> **Phạm vi:** SLR AI Writing + SLRS Integration + SAPEA/Evidence
> Registry + Writing Engine tự phát triển\
> **Không dùng:** AutoResearchClaw làm writing engine\
> **Ngôn ngữ tài liệu:** Tiếng Việt

------------------------------------------------------------------------

## 0. Cách đọc tài liệu và nguồn yêu cầu

Tài liệu này hợp nhất và chuyển các tài liệu thiết kế đã có thành
roadmap triển khai có thể chuyển thành GitHub Issues. Các mục được đánh
dấu:

-   **\[SOURCE\]**: nội dung được hỗ trợ bởi tài liệu SLR AI Writing
    hoặc SAPEA/Scientific Argument Knowledge Base đã có.
-   **\[PROPOSAL\]**: đề xuất kỹ thuật để triển khai; chưa phải quyết
    định đã được chốt.
-   **\[VERIFY\]**: phải xác minh bằng repository/code hoặc dữ liệu thật
    trước khi triển khai.

### 0.1 Tài liệu nền

1.  `SLR_AI_Writing_Tai_lieu_thiet_ke.pdf`
    -   Nêu vai trò SLR AI Writing là phân hệ hậu tổng hợp bằng chứng;
        đầu vào là artifacts đã chuẩn hóa và được xác nhận từ SLR
        Workbench.
    -   Định nghĩa 12 stage `S0`--`S11`, các data contract như
        `ValidatedReviewSnapshot`, `ParagraphPlan`, output
        verification/provenance.
    -   Đề xuất MVP gồm một review type, một Journal Profile, S0--S7,
        G1--G3, human approval; sau đó mở rộng các gate và export.
    -   **Không đặc tả đầy đủ wireframe, component và tương tác cho từng
        màn hình.**
2.  `SAPEA_Design_and_PRD_Combined.pdf` / `SAPEA_System_Design.pdf` /
    `SAPEA_PRD.pdf`
    -   Mô tả pipeline import → segment → label → normalize → relate →
        align → trace → review → reuse.
    -   Có giao diện minh họa: source passage được tô màu theo role,
        Inspector hiển thị Toulmin mapping, AIF links, provenance và
        trạng thái review.
    -   Có yêu cầu UI/NFR: usable ở độ rộng từ 1280px, có chế độ tablet,
        chọn span mục tiêu dưới 300ms sau khi dữ liệu đã tải, graph lớn
        lazy-load, trạng thái tương tác rõ ràng.
3.  `scientific_argument_data_model.pdf`
    -   Mô tả các thực thể như `SourceDocument`, `SourceAnchor`,
        `ArgumentComponent`, `ArgumentUnit`, `ArgumentRelation`,
        `Agent`, `ProvenanceEvent`, `ManuscriptArgument`,
        `ArgumentUsage`, `QualityGate`.
    -   Nhấn mạnh explicit/inferred/missing, provenance, review status
        và kiểm tra liên bảng ở tầng DB/application.

### 0.2 Những gì chưa được xác minh

-   **\[VERIFY\]** SLRS hiện hỗ trợ API, export file hay chỉ giao diện
    web; định dạng và schema thực tế.
-   **\[VERIFY\]** Backend/frontend, authentication, database và
    deployment hiện có của dự án.
-   **\[VERIFY\]** Cách các artifacts A1--A10 đang được lưu và ý nghĩa
    chính xác của từng artifact trong code thực tế.
-   **\[VERIFY\]** File schema JSON đi kèm SAPEA có thể được dùng trực
    tiếp hay cần migration/adapter.
-   **\[VERIFY\]** Quyền sử dụng PDF/full text, policy AI và format
    submission của từng journal.

Không được coi endpoint, schema hoặc UI mới trong tài liệu này là API đã
tồn tại. Các endpoint bên dưới là **API contract đề xuất**.

------------------------------------------------------------------------

# 1. Mục tiêu sản phẩm và phạm vi

## 1.1 Mục tiêu

Xây dựng một nền tảng viết bài khoa học theo hướng **evidence-grounded,
argument-aware, journal-adaptive**:

1.  Nhập kết quả SLR đã được xác nhận từ SLRS/SLR Workbench.
2.  Chuẩn hóa studies, findings, methods, references, source anchors và
    review artifacts.
3.  Dùng mô hình SAPEA để biểu diễn argument units, relations,
    provenance và review decisions.
4.  Lập outline và paragraph plans trước khi sinh văn bản.
5.  Sinh prose bằng LLM trong giới hạn evidence đã duyệt.
6.  Xác minh citation và claim-to-source, phát hiện overclaim, thiếu
    evidence, contradiction và reporting gaps.
7.  Cho người dùng review, chỉnh sửa, duyệt và xuất bản thảo.
8.  Bảo toàn lineage từ câu trong manuscript về finding, study và source
    anchor.
9.  Có revision history, audit trail và khả năng tái lập từ
    snapshot/config/model version.

## 1.2 Ngoài phạm vi MVP

-   Tự động thực hiện toàn bộ systematic review từ tìm kiếm đến
    synthesis nếu SLRS đã làm phần đó.
-   Tự tạo hoặc thay đổi scientific finding trong lúc viết.
-   Tự động nộp bài lên journal.
-   Tự xác nhận chất lượng khoa học chỉ dựa vào điểm LLM.
-   Tự động coi một `Evidence Report` là evidence đã được xác minh.
-   Tự động tạo DOI, reference hoặc experiment metrics không có trong dữ
    liệu.
-   Meta-analysis/statistical synthesis nếu chưa có dữ liệu, phương pháp
    và validation riêng.

## 1.3 Nguyên tắc bắt buộc

1.  **Artifact-first:** viết từ snapshot có version; không viết từ dữ
    liệu chưa xác nhận.
2.  **Argument-first:** findings, assumptions và uncertainty phải được
    xác định trước khi lập kế hoạch đoạn.
3.  **Writer không sửa science:** Writer có thể biên tập prose nhưng
    không được thay đổi finding, metric, sample size hoặc reference
    registry.
4.  **Registry-only citation:** citation phải tham chiếu source ID đã
    tồn tại trong registry.
5.  **Fail-closed:** chặn export khi có lỗi critical/blocking.
6.  **Human-accountable:** người dùng duyệt outline, nội dung quan trọng
    và bản cuối.
7.  **Immutable source/version:** tài liệu gốc và snapshot được
    version/hash; sửa dữ liệu tạo version/event mới.
8.  **Explicit vs inferred:** suy luận do AI đề xuất phải được gắn
    `inferred` và lưu rationale; không trình bày như trích dẫn nguyên
    văn.
9.  **Source-traceable \> inferred-but-labeled \> ungrounded.**
10. **Policy-aware:** Journal Profile có source URL, ngày xác minh và
    owner; không áp một chính sách cho mọi tạp chí.

------------------------------------------------------------------------

# 2. Kiến trúc tổng thể

``` mermaid
flowchart TD
    A[SLRS / SLR Workbench] --> B[SLRS Integration Adapter]
    B --> C[Validated Review Snapshot]
    C --> D[Evidence Registry]
    E[Source PDFs / References] --> F[Document & Anchor Service]
    F --> D
    D --> G[SAPEA Argument Layer]
    G --> H[Writing Orchestrator]
    H --> I[Outline Generator]
    I --> J[Coverage Planner]
    J --> K[Paragraph Planner]
    K --> L[LLM Writing Provider]
    L --> M[Draft Store]
    M --> N[Verification Engine]
    D --> N
    G --> N
    N --> O[Review Issues / Quality Gates]
    O --> P[Human Review UI]
    P --> Q[Revision Engine]
    Q --> N
    N --> R[Export & Audit]
```

## 2.1 Các module và trách nhiệm

  ------------------------------------------------------------------------
  Module                  Trách nhiệm              Không được làm
  ----------------------- ------------------------ -----------------------
  SLRS Adapter            Nhập dữ liệu; map        Không đoán schema SLRS
                          external IDs; validate;  chưa được xác minh
                          tạo snapshot             

  Intake/Normalization    Kiểm tra schema, status, Không tự điền dữ liệu
                          required fields,         khoa học còn thiếu
                          integrity hash           

  Document Service        Quản lý PDF, metadata,   Không giả mạo exact
                          page/section, source     excerpt hoặc offset
                          anchors                  

  Evidence Registry       Lưu studies, findings,   Không tự nâng
                          evidence records,        confidence hoặc biến
                          citations và nguồn       inference thành fact

  SAPEA Argument Layer    Annotation roles,        Không ép mọi argument
                          relations, provenance,   phải có đủ mọi thành
                          review decisions         phần Toulmin

  Journal Profile         Lưu journal scope,       Không làm thay đổi
                          article type, word       evidence để khớp
                          budget, format và        journal
                          policies                 

  Writing Orchestrator    Điều phối stages, job    Không để LLM tự quyết
                          state, retries,          định trạng thái
                          versioning               approval

  Outline Generator       Tạo ManuscriptBlueprint  Không thêm RQ hoặc
                          theo                     scientific conclusion
                          RQs/findings/profile     chưa duyệt

  Coverage Planner        Map RQ/reporting         Không đánh dấu coverage
                          checklist/findings tới   đạt khi thiếu dữ liệu
                          sections                 

  Paragraph Planner       Tạo ParagraphPlan với    Không đưa finding chưa
                          claim/finding/evidence   duyệt vào plan
                          IDs                      

  LLM Provider            Gọi mô hình qua          Không sở hữu nguồn sự
                          interface thống nhất     thật hoặc tự sinh
                                                   reference ID

  Verification Engine     Kiểm tra citation        Không tuyên bố khoa học
                          existence, source        đúng chỉ vì LLM
                          support, scope,          confidence cao
                          overclaim, coverage      

  Revision Engine         Sửa theo issue được chọn Không sửa ngầm
                          và lưu diff              scientific claim đã
                                                   approved

  Export/Audit            Xuất manuscript,         Không export khi còn
                          references, report,      blocking gate
                          disclosure, audit        

  UI                      Cho người dùng import,   Không hiển thị
                          inspect evidence, viết,  inference như explicit
                          review và export         source text
  ------------------------------------------------------------------------

## 2.2 Triển khai ban đầu

**\[PROPOSAL\]** Bắt đầu bằng modular monolith, không cần microservices
ngay:

-   Backend API: dùng backend hiện tại nếu phù hợp; nếu chưa có, FastAPI
    là lựa chọn tiện cho AI pipeline.
-   Database: PostgreSQL.
-   File storage: filesystem/object storage cho PDF, import file và
    artifacts.
-   Background jobs: có thể bắt đầu synchronous với dataset nhỏ; bổ sung
    worker/queue trước khi chạy job dài hoặc nhiều người dùng.
-   LLM: thông qua `LLMProvider` interface, không gắn chặt business
    logic với một vendor.
-   Search: PostgreSQL full-text search trước; vector search là
    enhancement, không phải nguồn xác minh.
-   Frontend: giữ stack hiện có; triển khai các screen trong mục 9.

------------------------------------------------------------------------

# 3. End-to-end flow

## 3.1 Flow từ SLRS đến bản thảo

1.  Người dùng chọn project/review trong UI.
2.  Adapter nhập dữ liệu từ file/API/UI export của SLRS theo khả năng đã
    xác minh.
3.  Adapter validate external payload và map thành canonical schema.
4.  Tạo `ReviewSnapshot` bất biến, lưu `schema_version`,
    `source_version`, import time, hash và trạng thái artifact.
5.  Kiểm tra readiness:
    -   RQs có mặt.
    -   Artifacts A1--A10 có status `APPROVED`, `N/A` hoặc trạng thái
        hợp lệ được quy định.
    -   Reference registry có stable study IDs.
    -   PRISMA/methods package đủ trường bắt buộc theo loại review.
    -   Findings có nguồn và trạng thái xác nhận.
6.  Tạo Evidence Registry từ snapshot; giữ liên kết với nguồn gốc ban
    đầu.
7.  SAPEA xử lý document/passage/annotation/argument relations;
    AI-generated annotations mặc định `pending`.
8.  Người dùng review/approve các annotation và relation cần thiết.
9.  Tạo Journal Profile và chọn article type.
10. Tạo contribution statement và coverage plan.
11. Sinh Manuscript Blueprint/outline.
12. Dừng để người dùng duyệt outline.
13. Tạo ParagraphPlan cho từng đoạn.
14. Kiểm tra plan: mỗi material claim có finding/evidence IDs hợp lệ,
    claim strength và qualifiers phù hợp.
15. Sinh draft từng section từ plan và evidence pack tối thiểu cần
    thiết.
16. Parse draft thành paragraph/sentence/claim/citation occurrence.
17. Chạy citation/claim verification và các quality gates.
18. Hiển thị ReviewIssue; người dùng chọn issue để sửa, chấp nhận có lý
    do hoặc tạo EvidenceRequest.
19. Revision Engine tạo diff, không ghi đè lịch sử.
20. Chạy lại gate bị ảnh hưởng.
21. Khi mọi blocking gate pass và author approve, tạo ExportSnapshot.
22. Xuất manuscript, citation manifest, quality report, revision diff,
    disclosure và audit log.

## 3.2 Flow khi thiếu bằng chứng

``` mermaid
flowchart TD
    A[ParagraphPlan] --> B{Evidence IDs valid?}
    B -- No --> C[Create EvidenceRequest]
    B -- Yes --> D[Generate draft]
    D --> E[Extract claims and citations]
    E --> F{Claim supported and scope-safe?}
    F -- Yes --> G[Mark candidate verified]
    F -- No --> H[Create ReviewIssue]
    H --> I{Can revise from approved evidence?}
    I -- Yes --> J[Controlled revision]
    J --> E
    I -- No --> C
    C --> K[Human resolves missing data]
    K --> A
```

Không được tự động "lấp chỗ trống" bằng kiến thức nền của LLM nếu chỗ
trống là dữ kiện Methods, PRISMA count, finding, metric hoặc claim khoa
học.

## 3.3 Human approval checkpoints

Bắt buộc có tối thiểu ba điểm dừng:

-   **H1 --- Outline approval:** sau khi tạo
    outline/ManuscriptBlueprint.
-   **H2 --- Content approval:** trước khi phát hành bản draft đầu tiên
    hoặc khi đoạn có material scientific claim cần duyệt.
-   **H3 --- Final approval:** trước khi export package cuối.

Khi artifact A1--A10 hoặc nguồn liên quan thay đổi sau khi viết: - Đánh
dấu paragraph/claim phụ thuộc là `STALE`. - Tạo impact report. - Không
âm thầm sửa manuscript đã approved. - Yêu cầu chạy lại verification cho
phần bị ảnh hưởng.

------------------------------------------------------------------------

# 4. Data model / canonical schema

Schema dưới đây là **canonical contract đề xuất**. Có thể map sang
schema hiện có trong SAPEA/SLR; không tạo song song một bản duplicate
nếu entity tương ứng đã có và đáp ứng yêu cầu.

## 4.1 Các entity chính

  ---------------------------------------------------------------------------
  Entity                  Mục đích                Trường tối thiểu
  ----------------------- ----------------------- ---------------------------
  `Project`               Workspace của người     `project_id`, `name`,
                          dùng                    `owner_id`, `created_at`

  `ReviewSnapshot`        Phiên bản cố định của   `snapshot_id`, `review_id`,
                          review                  `version`, `review_type`,
                                                  `schema_version`, `status`,
                                                  `integrity_hash`

  `ResearchQuestion`      RQ của review           `rq_id`, `snapshot_id`,
                                                  `text`, `status`

  `ReviewArtifact`        A1--A10 và              `artifact_id`,
                          status/version          `snapshot_id`,
                                                  `artifact_type`, `version`,
                                                  `status`, `payload_ref`

  `Study` /               Metadata công trình     `study_id`, `title`,
  `SourceDocument`                                `authors`, `year`, `doi`,
                                                  `url`, `sha256`,
                                                  `document_type`

  `SourceAnchor`          Vị trí source trong     `anchor_id`, `document_id`,
                          PDF/text                `page_pdf`, `section`,
                                                  `locator_type`,
                                                  `exact_excerpt`,
                                                  `char_start`, `char_end`

  `ExtractionRecord`      Dữ liệu trích xuất từ   `record_id`, `study_id`,
                          study                   `field`, `value`,
                                                  `source_anchor_ids`,
                                                  `review_status`

  `SynthesisFinding`      Finding tổng hợp của    `finding_id`,
                          review                  `snapshot_id`, `statement`,
                                                  `rq_ids`, `evidence_ids`,
                                                  `limitations`,
                                                  `confidence`, `status`

  `EvidenceRecord`        Bằng chứng có cấu trúc  `evidence_id`, `study_id`,
                                                  `anchor_ids`,
                                                  `evidence_type`, `value`,
                                                  `unit`, `context`, `status`

  `ArgumentUnit`          Đơn vị lập luận nguồn   `argument_id`,
                                                  `document_id`,
                                                  `components`,
                                                  `scope_conditions`,
                                                  `validation_status`

  `ArgumentRelation`      Quan hệ có hướng giữa   `relation_id`,
                          arguments               `from_argument_id`,
                                                  `to_argument_id`,
                                                  `relation_type`,
                                                  `rationale`, `status`

  `ProvenanceEvent`       Audit event append-only `event_id`, `timestamp`,
                                                  `agent_id`, `activity`,
                                                  `input_refs`,
                                                  `output_refs`, `method`,
                                                  `notes`

  `JournalProfile`        Yêu cầu tạp chí         `journal_profile_id`,
                                                  `journal_name`,
                                                  `article_type`, `scope`,
                                                  `section_rules`,
                                                  `word_budget`, `policies`,
                                                  `verified_at`,
                                                  `policy_source_urls`

  `Manuscript`            Bản thảo                `manuscript_id`,
                                                  `project_id`,
                                                  `snapshot_id`,
                                                  `journal_profile_id`,
                                                  `status`, `version`

  `ManuscriptBlueprint`   Outline + section plan  `blueprint_id`,
                                                  `manuscript_id`,
                                                  `sections`, `coverage_map`,
                                                  `status`

  `ParagraphPlan`         Contract trung tâm của  `paragraph_id`,
                          đoạn                    `section_id`,
                                                  `rhetorical_move`,
                                                  `rq_ids`, `finding_ids`,
                                                  `evidence_ids`,
                                                  `claim_strength`,
                                                  `conditions_required`,
                                                  `citation_policy`,
                                                  `status`, `sentence_slots`

  `DraftParagraph`        Văn bản sinh ra         `draft_paragraph_id`,
                                                  `paragraph_id`, `text`,
                                                  `revision`, `status`,
                                                  `generated_by`,
                                                  `model_version`

  `ManuscriptArgument`    Claim của bản thảo      `manuscript_argument_id`,
                                                  `paragraph_id`,
                                                  `claim_text`,
                                                  `claim_status`, `version`

  `ArgumentUsage`         Liên kết argument nguồn `usage_id`, `argument_id`,
                          với claim bản thảo      `manuscript_argument_id`,
                                                  `selected_component_ids`,
                                                  `argument_role`,
                                                  `citation_intent`,
                                                  `source_scope_check`,
                                                  `citation_support_check`,
                                                  `status`

  `CitationOccurrence`    Vị trí citation trong   `citation_occurrence_id`,
                          manuscript              `paragraph_id`,
                                                  `source_document_id`,
                                                  `anchor_ids`, `style`,
                                                  `rendered_marker`,
                                                  `verification_status`

  `ReviewIssue`           Issue được phát hiện    `issue_id`, `target_type`,
                          trong review            `target_id`, `severity`,
                                                  `code`, `description`,
                                                  `status`, `resolution`

  `QualityGateResult`     Kết quả gate            `gate_result_id`,
                                                  `gate_id`, `target_type`,
                                                  `target_id`, `status`,
                                                  `reason`, `checked_at`,
                                                  `reviewer_id`

  `ReviewDecision`        Quyết định của human    `decision_id`,
                          reviewer                `target_type`, `target_id`,
                                                  `decision`, `reason`,
                                                  `reviewer_id`, `created_at`

  `ExportSnapshot`        Gói xuất có thể tái lập `export_snapshot_id`,
                                                  `manuscript_version`,
                                                  `snapshot_id`,
                                                  `profile_version`,
                                                  `model_config`,
                                                  `artifact_hashes`,
                                                  `approved_by`
  ---------------------------------------------------------------------------

## 4.2 Status enums gợi ý

Dùng enum nhất quán, không để mỗi module tự định nghĩa status riêng.

-   `ArtifactStatus`: `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`,
    `N_A`, `STALE`
-   `EvidenceStatus`: `PENDING`, `VERIFIED`, `PARTIALLY_VERIFIED`,
    `UNRESOLVED`, `REJECTED`
-   `ParagraphPlanStatus`: `DRAFT`, `NEEDS_EVIDENCE`, `READY_TO_DRAFT`,
    `DRAFTED`, `NEEDS_REVIEW`, `APPROVED`, `STALE`
-   `IssueStatus`: `OPEN`, `IN_PROGRESS`, `RESOLVED`,
    `ACCEPTED_WITH_REASON`, `WONT_FIX`
-   `GateStatus`: `NOT_RUN`, `PASS`, `WARNING`, `FAIL`, `NEEDS_REVIEW`,
    `NOT_APPLICABLE`
-   `ManuscriptStatus`: `DRAFT`, `IN_REVIEW`, `BLOCKED`, `APPROVED`,
    `EXPORTED`, `STALE`

**\[PROPOSAL\]** Tất cả status transition phải được kiểm tra ở backend.
JSON Schema không thay thế FK, authorization, uniqueness, cross-entity
validation hay state-transition validation.

## 4.3 Contract: `ValidatedReviewSnapshot`

``` json
{
  "snapshot_id": "snap_example_001",
  "review_id": "review_example_001",
  "version": 1,
  "review_type": "systematic_review",
  "schema_version": "1.0",
  "rqs": [
    {
      "rq_id": "RQ1",
      "text": "Research question text",
      "status": "APPROVED"
    }
  ],
  "artifacts": [
    {
      "artifact_id": "A1",
      "artifact_type": "evidence_synthesis",
      "version": "v1",
      "status": "APPROVED",
      "payload_ref": "artifact://A1/v1"
    },
    {
      "artifact_id": "A3",
      "artifact_type": "argument_graph",
      "version": "v1",
      "status": "N_A",
      "payload_ref": null
    }
  ],
  "methods_package_id": "methods_001",
  "reference_registry_id": "refs_001",
  "integrity_hash": "sha256:example",
  "approved_by": "user_001",
  "created_at": "2026-10-29T00:00:00Z"
}
```

Đây là dữ liệu ví dụ; `artifact://` chỉ là locator minh họa. Trong
implementation, dùng storage reference thực tế.

## 4.4 Contract: `ParagraphPlan`

``` json
{
  "paragraph_id": "P-RESULTS-012",
  "section_id": "SEC-RESULTS",
  "rhetorical_move": "compare_and_synthesize",
  "rq_ids": ["RQ1"],
  "finding_ids": ["SF-004"],
  "evidence_ids": ["E-021", "E-028"],
  "claim_strength": "qualified",
  "conditions_required": true,
  "citation_policy": "registry_only",
  "sentence_slots": ["topic", "support", "interpretation", "qualification"],
  "status": "READY_TO_DRAFT",
  "limitations": ["Evidence comes from heterogeneous study designs"]
}
```

Acceptance rule: mọi `finding_id` và `evidence_id` phải tồn tại, thuộc
snapshot hợp lệ, có status cho phép reuse và không bị `STALE`.

## 4.5 Contract: claim verification

``` json
{
  "claim_id": "CL-001",
  "paragraph_id": "P-RESULTS-012",
  "claim_text": "Example manuscript claim",
  "source_anchor_ids": ["ANCHOR-014"],
  "checks": {
    "reference_exists": "PASS",
    "supports_claim": "NEEDS_REVIEW",
    "scope_consistent": "PASS",
    "qualifier_preserved": "PASS",
    "overclaim": "WARNING"
  },
  "human_review": "PENDING"
}
```

Không dùng `supports_claim: PASS` chỉ vì DOI tồn tại hoặc embedding
similarity cao. Nên dùng kiểm tra rule-based + LLM-assisted assessment +
human sampling/override.

------------------------------------------------------------------------

# 5. API design

## 5.1 Quy ước chung

**Base path:** `/api/v1`\
**Transport:** REST/JSON (đề xuất)\
**Auth:** session/JWT/OAuth theo hệ thống hiện có; không chốt nhà cung
cấp auth ở tài liệu này.\
**Content type:** `application/json`, upload multipart cho file.\
**ID:** stable UUID/ULID hoặc định dạng ID hiện có; không dùng array
index làm identity.

### Response envelope đề xuất

Thành công:

``` json
{
  "data": {},
  "meta": {
    "request_id": "req_123",
    "schema_version": "1.0"
  }
}
```

Lỗi:

``` json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Input payload is invalid",
    "details": [
      {
        "field": "snapshot_id",
        "reason": "required"
      }
    ],
    "request_id": "req_123"
  }
}
```

### Quy tắc API

-   Pagination: `?limit=50&cursor=...` hoặc `page/size`, chọn một chuẩn
    và dùng xuyên suốt.
-   Filter/sort phải có whitelist.
-   Các write endpoints cần `If-Match`/revision token hoặc
    `expected_version` để tránh ghi đè thay đổi của reviewer khác.
-   Endpoint khởi chạy tác vụ dài trả `202 Accepted` và `job_id`.
-   Mọi job có `status`, `progress`, `started_at`, `finished_at`,
    `error_code`, `trace_id`.
-   Không trả full text PDF nếu người dùng không có quyền.
-   Không log API key, token, private paper content hoặc prompt chứa dữ
    liệu nhạy cảm.
-   Có rate limit cho LLM jobs, upload và export.
-   Có idempotency key cho import/export/job creation khi phù hợp.

## 5.2 API theo miền

### Projects

  ------------------------------------------------------------------------------------------
  Method                  Endpoint                                   Mục đích
  ----------------------- ------------------------------------------ -----------------------
  `POST`                  `/api/v1/projects`                         Tạo project

  `GET`                   `/api/v1/projects`                         Liệt kê project được
                                                                     phép truy cập

  `GET`                   `/api/v1/projects/{project_id}`            Chi tiết project

  `PATCH`                 `/api/v1/projects/{project_id}`            Sửa metadata

  `GET`                   `/api/v1/projects/{project_id}/activity`   Audit/activity feed
  ------------------------------------------------------------------------------------------

### SLRS integration / snapshots

  -----------------------------------------------------------------------------------------------------
  Method                  Endpoint                                              Mục đích
  ----------------------- ----------------------------------------------------- -----------------------
  `POST`                  `/api/v1/integrations/slrs/import-jobs`               Tạo import job từ
                                                                                file/payload

  `GET`                   `/api/v1/integrations/slrs/import-jobs/{job_id}`      Trạng thái import

  `POST`                  `/api/v1/reviews/{review_id}/snapshots`               Tạo snapshot từ dữ liệu
                                                                                đã chuẩn hóa

  `GET`                   `/api/v1/reviews/{review_id}/snapshots`               Liệt kê snapshots

  `GET`                   `/api/v1/snapshots/{snapshot_id}`                     Chi tiết
                                                                                snapshot/readiness

  `POST`                  `/api/v1/snapshots/{snapshot_id}/validate`            Chạy validation

  `GET`                   `/api/v1/snapshots/{snapshot_id}/validation-report`   Lỗi/warning/readiness

  `POST`                  `/api/v1/snapshots/{snapshot_id}/evidence-requests`   Tạo yêu cầu bổ sung dữ
                                                                                liệu
  -----------------------------------------------------------------------------------------------------

**Import payload mẫu** (đề xuất; phải map theo dữ liệu SLRS thật):

``` json
{
  "source_system": "slrs",
  "source_review_id": "external-review-001",
  "source_version": "v5",
  "schema_version": "1.0",
  "payload": {
    "rqs": [],
    "studies": [],
    "artifacts": [],
    "methods": {},
    "references": []
  }
}
```

### Documents / anchors / evidence

  ---------------------------------------------------------------------------------------------------------
  Method                  Endpoint                                                  Mục đích
  ----------------------- --------------------------------------------------------- -----------------------
  `POST`                  `/api/v1/documents`                                       Upload/đăng ký source
                                                                                    document

  `GET`                   `/api/v1/documents/{document_id}`                         Metadata + version/hash

  `GET`                   `/api/v1/documents/{document_id}/anchors`                 Danh sách source
                                                                                    anchors

  `GET`                   `/api/v1/anchors/{anchor_id}`                             Chi tiết anchor

  `GET`                   `/api/v1/snapshots/{snapshot_id}/findings`                Findings thuộc snapshot

  `GET`                   `/api/v1/findings/{finding_id}`                           Chi tiết finding và
                                                                                    evidence

  `GET`                   `/api/v1/snapshots/{snapshot_id}/evidence/search?q=...`   Search evidence

  `POST`                  `/api/v1/evidence/{evidence_id}/review-decisions`         Approve/reject/flag
                                                                                    evidence
  ---------------------------------------------------------------------------------------------------------

### SAPEA / arguments

  ---------------------------------------------------------------------------------------------------
  Method                  Endpoint                                           Mục đích
  ----------------------- -------------------------------------------------- ------------------------
  `POST`                  `/api/v1/documents/{document_id}/analysis-jobs`    Parse/segment/annotate
                                                                             document

  `GET`                   `/api/v1/documents/{document_id}/passages`         Lấy passages, filter
                                                                             section/page

  `GET`                   `/api/v1/passages/{passage_id}/annotations`        Annotation cho passage

  `PATCH`                 `/api/v1/annotations/{annotation_id}`              Sửa role/text/epistemic
                                                                             status

  `POST`                  `/api/v1/arguments/{argument_id}/relations`        Tạo relation
                                                                             candidate/approved

  `GET`                   `/api/v1/arguments/{argument_id}/graph?view=aif`   Lấy graph

  `GET`                   `/api/v1/annotations/{annotation_id}/provenance`   Audit/provenance

  `POST`                  `/api/v1/reviews/decisions`                        Lưu reviewer decision

  `POST`                  `/api/v1/argument-usages`                          Tạo usage của argument
                                                                             nguồn trong manuscript
  ---------------------------------------------------------------------------------------------------

Các route trên tương thích với các contract minh họa trong SAPEA design,
nhưng prefix và chi tiết payload được chuẩn hóa lại cho ứng dụng tích
hợp. Cần tránh tạo route trùng nếu backend SAPEA hiện có đã cung cấp
endpoint tương đương.

### Journal profile / manuscript

  -----------------------------------------------------------------------------------------------------
  Method                  Endpoint                                              Mục đích
  ----------------------- ----------------------------------------------------- -----------------------
  `POST`                  `/api/v1/journal-profiles`                            Tạo profile

  `GET`                   `/api/v1/journal-profiles/{profile_id}`               Lấy profile/version

  `POST`                  `/api/v1/manuscripts`                                 Tạo manuscript từ
                                                                                snapshot

  `GET`                   `/api/v1/manuscripts/{manuscript_id}`                 Chi tiết manuscript

  `PATCH`                 `/api/v1/manuscripts/{manuscript_id}`                 Sửa metadata, không sửa
                                                                                science finding

  `POST`                  `/api/v1/manuscripts/{manuscript_id}/outline-jobs`    Sinh outline

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/blueprint`       Lấy outline/coverage

  `POST`                  `/api/v1/manuscripts/{manuscript_id}/approvals`       Duyệt
                                                                                outline/content/final

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/sections`        Danh sách sections

  `PATCH`                 `/api/v1/sections/{section_id}`                       Sửa section metadata

  `POST`                  `/api/v1/sections/{section_id}/paragraph-plan-jobs`   Lập paragraph plans

  `GET`                   `/api/v1/sections/{section_id}/paragraph-plans`       Lấy plans

  `POST`                  `/api/v1/paragraph-plans/{paragraph_id}/draft-jobs`   Sinh draft đoạn

  `GET`                   `/api/v1/paragraphs/{paragraph_id}`                   Lấy draft/provenance

  `POST`                  `/api/v1/paragraphs/{paragraph_id}/revision-jobs`     Revision có kiểm soát
  -----------------------------------------------------------------------------------------------------

### Verification / review / export

  ---------------------------------------------------------------------------------------------------------
  Method                  Endpoint                                                  Mục đích
  ----------------------- --------------------------------------------------------- -----------------------
  `POST`                  `/api/v1/manuscripts/{manuscript_id}/verification-jobs`   Chạy verifier

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/quality-report`      Gate results

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/issues`              Danh sách ReviewIssue

  `PATCH`                 `/api/v1/issues/{issue_id}`                               Gán, sửa status,
                                                                                    resolution

  `POST`                  `/api/v1/issues/{issue_id}/resolutions`                   Lưu quyết định có lý do

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/revision-diffs`      Lịch sử diff

  `POST`                  `/api/v1/manuscripts/{manuscript_id}/export-jobs`         Export

  `GET`                   `/api/v1/export-jobs/{job_id}`                            Trạng thái export

  `GET`                   `/api/v1/exports/{export_snapshot_id}`                    Metadata/artifact list

  `GET`                   `/api/v1/manuscripts/{manuscript_id}/audit`               Audit trail
  ---------------------------------------------------------------------------------------------------------

## 5.3 Job contract

``` json
{
  "job_id": "job_001",
  "job_type": "DRAFT_SECTION",
  "status": "QUEUED",
  "progress": 0,
  "created_at": "2026-10-29T00:00:00Z",
  "started_at": null,
  "finished_at": null,
  "trace_id": "trace_001",
  "result_refs": [],
  "error": null
}
```

Trạng thái job: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`,
`NEEDS_REVIEW`.

## 5.4 API validation / error codes

  -----------------------------------------------------------------------
  Code                                Khi nào
  ----------------------------------- -----------------------------------
  `VALIDATION_ERROR`                  Payload sai schema

  `SNAPSHOT_NOT_READY`                Snapshot còn blocking gaps

  `ARTIFACT_NOT_APPROVED`             Dùng artifact chưa duyệt

  `SOURCE_ANCHOR_MISMATCH`            Anchor không còn khớp document
                                      version

  `INVALID_ROLE`                      Role annotation không hợp lệ

  `UNREVIEWED_RELATION`               Relation cần review nhưng bị dùng
                                      như verified

  `MISSING_EVIDENCE_ASSET`            Evidence report chưa có asset xác
                                      minh

  `CLAIM_UNSUPPORTED`                 Claim chưa được evidence support

  `REVISION_CONFLICT`                 Revision token/version không khớp

  `PERMISSION_REQUIRED`               User không đủ quyền

  `QUALITY_GATE_BLOCKED`              Export bị chặn bởi gate

  `POLICY_PROFILE_STALE`              Journal policy quá hạn xác minh

  `RATE_LIMITED`                      Vượt giới hạn job/API

  `LLM_PROVIDER_ERROR`                Lỗi provider; không ghi nội dung
                                      nhạy cảm vào log
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 6. Writing pipeline --- 12 stages

Các stage dưới đây giữ cấu trúc `S0`--`S11` từ tài liệu SLR AI Writing;
phần task kỹ thuật và issue ID được bổ sung để triển khai.

## S0 --- Validate Inputs

**Input:** review snapshot, metadata, artifact statuses, references,
methods/PRISMA data.\
**Output:** `ValidatedReviewSnapshot`, validation report,
`EvidenceRequest[]`.

Tasks: - Kiểm tra schema/version. - Kiểm tra ID trùng, foreign keys và
status. - Kiểm tra artifact `APPROVED`/`N_A` hợp lệ. - Kiểm tra
references, source document hash và RQ. - Không cho tạo writing job nếu
có blocking gap.

Exit criteria: - Không còn blocking input errors. - Warning có lý do và
có người chịu trách nhiệm. - Snapshot immutable trong suốt writing job.

## S1 --- Build Journal Profile

**Input:** journal name/URL, article type, official guidelines.\
**Output:** `JournalWritingProfile`.

Tasks: - Lưu section convention, word/page budget, citation style,
figure/table requirements. - Lưu AI disclosure/policy, policy URL,
`verified_at`, owner và TTL. - Phân biệt policy chưa xác minh với policy
đã xác minh.

Exit criteria: - Profile có nguồn chính sách chính thức và ngày xác
minh. - Profile stale sẽ cảnh báo/chặn theo policy.

## S2 --- Position Contribution

**Input:** RQs, findings, landscape/taxonomy/gap artifacts, journal
scope.\
**Output:** `ContributionStatement`.

Tasks: - Đề xuất contribution dựa trên findings. - Map contribution tới
RQ và findings. - Kiểm tra không có claim "first-ever" hoặc novelty
tuyệt đối nếu thiếu evidence. - Yêu cầu human approval.

Exit criteria: - Contribution có finding IDs và phù hợp scope. - Không
thêm RQ/scientific conclusion mới.

## S3 --- Coverage Planning

**Input:** A1--A10, reporting checklist, RQs, methods package.\
**Output:** `EvidenceCoveragePlan`.

Tasks: - Map từng RQ đến section/paragraph destination. - Map reporting
checklist (PRISMA/SEGRESS hoặc guideline phù hợp) tới dữ liệu. - Ghi
`N/A` rõ ràng, không hiểu N/A là missing. - Tạo `EvidenceRequest` khi
thiếu thông tin.

Exit criteria: - Mỗi RQ/reporting item có destination hoặc lý do N/A. -
Không tự bịa counts, methods hoặc exclusion reasons.

## S4 --- Outline Generation

**Input:** Journal Profile + Coverage Plan + contribution.\
**Output:** `ManuscriptBlueprint`.

Tasks: - Tạo sections/subsections. - Gán mục tiêu, word budget,
dependencies và findings dự kiến. - Gợi ý rhetorical moves theo
section. - Cho phép người dùng reorder/edit.

Exit criteria: - Đủ section theo loại bài và journal profile. - Không có
section orphan hoặc coverage gap chưa được giải thích. - **Human
approval checkpoint H1.**

## S5 --- Paragraph Planning

**Input:** findings + evidence + constraints + blueprint.\
**Output:** `ParagraphPlan[]`.

Tasks: - Chọn rhetorical move, claim slot, supporting findings/evidence
IDs. - Chọn claim strength (neutral/qualified/strong theo schema đã
chốt). - Bảo toàn qualifiers, conditions, uncertainty và contradictory
evidence. - Đặt citation policy `registry_only`. - Tạo sentence slots
như topic/support/interpretation/qualification.

Exit criteria: - Mỗi material claim có evidence IDs hợp lệ. - Không có
finding chưa approved. - Plan ở trạng thái `READY_TO_DRAFT`.

## S6 --- Section Drafting

**Input:** ParagraphPlans + minimal evidence packs.\
**Output:** `DraftSection[]` / `DraftParagraph[]`.

Tasks: - Gọi LLM theo structured output contract. - Truyền source
excerpts tối thiểu cần thiết, không truyền toàn bộ corpus mặc định. -
LLM trả nội dung và ID evidence đã dùng. - Kiểm tra ID trả về thuộc
evidence pack. - Lưu model/provider/version, prompt template version và
parameters.

Exit criteria: - Không sinh reference mới. - Không dùng evidence ID
ngoài plan. - Mọi đoạn đều có revision ID và lineage.

## S7 --- Citations & Figures

**Input:** draft, reference registry, figure/table manifests.\
**Output:** `CitationManifest`, `FigureManifest`.

Tasks: - Render citation marker từ reference registry. - Kiểm tra
reference existence và metadata. - Kiểm tra figure/table source,
permissions, labels và numbering. - Tách citation marker khỏi prose để
tránh parser phụ thuộc vào style.

Exit criteria: - Không có citation ID không tồn tại. - Mỗi figure/table
có nguồn hoặc được đánh dấu original. - Citation unresolved không được
xem là verified.

## S8 --- Multi-perspective Review

**Input:** draft + registry + Journal Profile + reporting checklist.\
**Output:** `ReviewIssue[]`.

Reviewer perspectives: - Scientific reviewer: unsupported claims,
contradictions, overclaim. - Methodology reviewer: methods/PRISMA
counts/logs/checklist. - Citation auditor: citation existence và claim
support. - Journal/style reviewer: cấu trúc, format, readability. -
Argument reviewer: support/attack relations, speaker attribution,
qualifiers.

Exit criteria: - Mọi issue có severity, target, evidence, rationale và
suggested action. - AI reviewer không tự phê duyệt final. - Human
reviewer có thể sửa/override với audit.

## S9 --- Controlled Revision

**Input:** issue tickets + approved suggestions + current draft
version.\
**Output:** `RevisionDiff`.

Tasks: - Sửa đúng paragraph/section được chọn. - Giữ source anchors và
approved scientific claims. - Nếu thay đổi claim, yêu cầu evidence
re-check. - Ghi before/after, actor, rationale và version. - Tạo
conflict nếu revision token stale.

Exit criteria: - Không thay đổi approved science claim ngoài phạm vi cho
phép. - Diff có thể đọc và rollback. - Gate liên quan được chạy lại.

## S10 --- Quality Gates

**Input:** draft + citation/figure manifests + methods logs + review
decisions.\
**Output:** `QualityGateReport`.

Gates: - G1: source/claim extraction correctness. - G2: source
anchor/evidence resolvable. - G3: argument/inference validity. - G4:
context/qualifier preservation. - G5: source argument compatible with
manuscript claim. - G6: citation supports manuscript sentence. - G7: no
confusion between source speaker, AI inference and author claim. -
Additional writing gates: coverage, reporting completeness, PRISMA
reconciliation, policy/disclosure.

Exit criteria: - Không còn `FAIL` critical/blocking. - `NOT_RUN` không
được tự xem là pass. - N/A cần reason. - Người dùng thấy gate-level
explanation.

## S11 --- Export & Audit

**Input:** approved version + passed gates + disclosure + export
options.\
**Output:** `SubmissionPackage`.

Package gợi ý: - Manuscript DOCX/Markdown (LaTeX nếu triển khai). -
Bibliography/reference list. - Citation manifest. - Figure/table
manifest. - Quality gate report. - Open/accepted issues report. -
Revision diff/history. - AI-use disclosure và policy source. - Export
snapshot/hash/audit metadata.

Exit criteria: - Author final approval. - Không có blocking gate. -
Export snapshot lưu chính xác version, source snapshot, profile version,
model config và artifact hashes.

------------------------------------------------------------------------

# 7. Verification Engine --- quy tắc và quality gates

## 7.1 Các lớp kiểm tra

1.  **Deterministic validation**
    -   IDs tồn tại.
    -   Foreign keys hợp lệ.
    -   Citation target có trong reference registry.
    -   Snapshot/artifact version đúng.
    -   PRISMA counts reconcile.
    -   Word budget/section required fields.
    -   Required checklist items có destination.
2.  **Source alignment**
    -   Anchor khớp source document version.
    -   Exact excerpt khớp nguồn khi được dùng như quote.
    -   Table/figure anchor giữ đơn vị và label.
    -   Secondary citation không bị trình bày thành direct verification
        từ primary source.
3.  **LLM-assisted semantic review**
    -   Evidence có hỗ trợ claim không.
    -   Claim có mạnh hơn source không.
    -   Qualifiers/conditions có được giữ không.
    -   Có mâu thuẫn chưa được giải thích không.
    -   Không coi similarity score là proof.
4.  **Human review**
    -   Review các claim quan trọng/uncertain.
    -   Cho phép approve/reject/modify.
    -   Lưu reason, actor và before/after.
    -   Không xóa lịch sử decision.

## 7.2 Gate policy

-   `PASS`: kiểm tra đã chạy và đáp ứng rule.
-   `WARNING`: có rủi ro nhưng chưa block; cần reason.
-   `FAIL`: vi phạm rule.
-   `NEEDS_REVIEW`: cần human judgement.
-   `NOT_APPLICABLE`: không áp dụng, phải có reason.
-   `NOT_RUN`: chưa chạy, không được hiểu là pass.

**Fail-closed:** block export khi lỗi critical, quote mismatch, citation
không tồn tại, evidence anchor không truy được, PRISMA count mismatch
hoặc chưa có final approval.

## 7.3 Không đánh đồng các khái niệm

-   Reference tồn tại ≠ reference hỗ trợ claim.
-   Source excerpt tồn tại ≠ excerpt là evidence đầy đủ.
-   Argument relation được AI đề xuất ≠ relation đã được reviewer xác
    nhận.
-   `confidence` của classifier ≠ scientific certainty.
-   LLM đánh giá entailment ≠ bằng chứng khoa học cuối cùng.
-   Văn bản trôi chảy ≠ manuscript hợp lệ.

------------------------------------------------------------------------

# 8. Security, privacy, reliability và observability

## 8.1 Access control

Roles đề xuất: - `PROJECT_OWNER` - `RESEARCHER` - `REVIEWER` -
`READ_ONLY` - `ADMIN`

Quy tắc: - Kiểm tra quyền ở mọi endpoint, không chỉ UI. - Quyền xem
metadata không tự động cấp quyền tải PDF. - Chỉ người có quyền mới
approve/export. - Audit record gồm actor và timestamp.

## 8.2 File và dữ liệu

-   Lưu `sha256` cho source files.
-   Giữ `document_version`; khi reparse PDF phải kiểm tra/re-anchor.
-   Không mặc định public hóa hoặc export full text có bản quyền.
-   Kiểm tra file type/size, antivirus hoặc malware scan theo môi
    trường.
-   Mã hóa dữ liệu khi truyền và khi lưu theo hạ tầng.
-   Secrets/LLM keys nằm trong secret manager/environment, không trong
    source control.

## 8.3 Observability

Mọi job có: - `job_id` - `trace_id` - `project_id` - `snapshot_id` -
`manuscript_id` - stage - status - provider/model version - prompt
template version - retry count - duration - structured error code

Không log API keys hoặc toàn bộ private document content.

## 8.4 Reliability

-   Retry có giới hạn và exponential backoff cho lỗi tạm thời.
-   Không retry vô hạn với validation error.
-   Idempotent import khi cùng external source version/hash.
-   Lưu job result theo version; không ghi đè bản đã approved.
-   Hỗ trợ cancel job và recovery sau lỗi.
-   Có timeout cho LLM và file parsing.
-   Tách queue cho import, analysis, drafting và export nếu tải tăng.

------------------------------------------------------------------------

# 9. UI/UX requirements

Phần này tổng hợp **yêu cầu UI đã có** và **UI đề xuất bổ sung**. Các
màn hình mới là proposal để thực hiện workflow; không có nghĩa chúng đã
được thiết kế hoàn chỉnh trong tài liệu gốc.

## 9.1 Yêu cầu lấy từ SAPEA docs \[SOURCE\]

-   UI usable ở độ rộng từ **1280px**; hỗ trợ tablet.
-   Mọi thao tác có trạng thái phản hồi rõ ràng.
-   Chọn span mục tiêu dưới **300ms sau khi dữ liệu đã tải**.
-   Graph lớn phải lazy-load.
-   Source passage được tô màu theo Craft/argument role.
-   Inspector hiển thị Toulmin mapping, AIF links, provenance và review
    status.
-   Cho reviewer approve/edit/flag annotations và relations.
-   Có audit before/after khi annotation thay đổi.
-   Nếu PDF version đổi, re-anchor hoặc cảnh báo anchor mismatch.
-   Không hiển thị evidence report unresolved như evidence đã verified.

## 9.2 UI cần bổ sung cho SLR AI Writing \[PROPOSAL\]

### Screen A --- Project Dashboard

Hiển thị: - Danh sách projects/manuscripts. - Trạng thái hiện tại:
import, planning, drafting, review, blocked, approved, exported. -
Snapshot version, số findings, số open/blocking issues. - Tiến độ job và
recent activity. - CTA: Import review, Continue writing, Review issues,
Export.

Acceptance: - Người dùng thấy project state mà không phải mở từng
screen. - Blocking issues được hiển thị nổi bật nhưng không che mất nội
dung khác. - Job đang chạy có progress/error/cancel action nếu hỗ trợ.

### Screen B --- Import & Readiness

Hiển thị: - Nguồn nhập: file/API/SLRS connector (chỉ bật loại đã triển
khai). - File/payload preview. - Mapping external field → canonical
field. - Validation errors/warnings. - Artifact A1--A10 status:
approved/pending/rejected/N/A/missing. - PRISMA/methods/reference
readiness. - Snapshot version/hash và nút tạo snapshot.

Acceptance: - Người dùng xem trước mapping trước khi import. - Lỗi chỉ
rõ field, record và cách xử lý. - Không tạo snapshot ready nếu có
blocking error. - N/A phân biệt rõ với missing.

### Screen C --- Evidence Explorer

Bố cục đề xuất 3 pane: 1. **Left:** danh sách papers/findings/filters.
2. **Center:** PDF/text viewer, page/section, highlighted source spans.
3. **Right:** evidence/argument Inspector.

Inspector hiển thị: - Role: claim/reason/evidence
report/warrant/qualifier/rebuttal... - Explicit/inferred/missing. -
Source anchor, page, excerpt. - Related arguments và relation
direction. - Confidence loại classifier (nếu có) và review status. -
Provenance events, reviewer decisions. - Actions: approve, edit, reject,
flag, open source.

Acceptance: - Click anchor mở đúng page/section. - Source version
mismatch hiển thị warning. - Inferred không trình bày như explicit
quote. - Evidence unresolved không thể được dùng như verified evidence
mà không có override có lý do.

### Screen D --- Journal Profile

Hiển thị: - Journal, article type, scope. - Section conventions. -
Word/page budgets. - Citation style, figure/table requirements. - AI-use
disclosure policy. - Policy source URL, verified date, owner, stale
status.

Acceptance: - Mỗi policy có provenance. - Profile stale hiển thị cảnh
báo/chặn theo rule. - Thay đổi profile tạo version mới và lưu audit.

### Screen E --- Outline / Manuscript Blueprint

Hiển thị: - Tree view sections/subsections. - Mục tiêu section, word
budget, RQ mapping. - Findings dự kiến. - Coverage status. -
Drag/reorder, add/remove section, edit purpose. - Outline diff/version.

Acceptance: - Không cho duyệt outline khi có blocking coverage gap chưa
được xử lý. - User approve/reject và có comment. - Sau khi approve,
outline version được khóa cho writing job.

### Screen F --- Paragraph Planner

Hiển thị: - Section/paragraph list. - Rhetorical move. - Claim slots,
finding IDs, evidence IDs. - Required citations, qualifiers,
limitations. - Plan status: needs
evidence/ready/drafted/review/approved/stale.

Acceptance: - Mỗi material claim có evidence IDs. - Click finding mở
Evidence Explorer. - Không draft plan có evidence ID không tồn tại hoặc
chưa được phép reuse.

### Screen G --- Manuscript Editor

Bố cục đề xuất: - Left navigation: outline/sections. - Center: rich
text/Markdown editor. - Right sidebar: citations, source anchors,
verification status, revision actions.

Tính năng: - Chọn paragraph để regenerate/revise. - Hiển thị citation
marker với status. - Click citation mở source anchor. - Show diff
trước/sau revision. - Manual edit phải tạo revision version. - Đánh dấu
paragraph stale nếu nguồn/plan thay đổi.

Acceptance: - Revision chỉ tác động phạm vi đã chọn. - Nội dung đã
approved không bị ghi đè âm thầm. - Citation bị xóa/thay đổi kích hoạt
verification lại.

### Screen H --- Verification & Review Queue

Hiển thị: - Issue severity: critical/high/medium/low. - Issue type:
unsupported claim, invalid citation, scope mismatch, overclaim, missing
qualifier, contradiction, reporting gap, policy issue. - Target
sentence/paragraph/section. - Claim text, cited source, evidence
excerpt, reason. - Suggested action. - Actions: fix, re-run check,
approve with reason, reject suggestion, create EvidenceRequest.

Acceptance: - Mỗi issue có target, severity, rationale và status. -
`ACCEPTED_WITH_REASON` bắt buộc có reason và reviewer. - Không thể
export nếu còn blocking issue.

### Screen I --- Export & Audit

Hiển thị: - Export format và options. - Manuscript version, snapshot,
journal profile version. - Gate summary, disclosure, open issues. -
Final author approval. - Export job status và artifact list. - Audit
timeline.

Acceptance: - Export snapshot lưu hashes và config. - Export chỉ khi
final approval và blocking gates pass. - User có thể tải artifact theo
quyền. - Lưu ai export, khi nào, từ version nào.

## 9.3 Responsive/accessibility

-   Desktop target ≥1280px cho 3-pane Evidence Explorer.
-   Tablet: chuyển Inspector thành drawer/side panel, không yêu cầu giữ
    3 cột.
-   Loading, empty, error, success, stale và permission states cần được
    thiết kế.
-   Keyboard navigation cho annotation/review action.
-   Màu highlight không phải tín hiệu duy nhất; kèm label/icon/text.
-   Contrast và focus state rõ ràng.
-   Với graph lớn, render progressive/lazy; có filter theo
    relation/role.
-   Không block toàn bộ UI khi job dài đang chạy.

------------------------------------------------------------------------

# 10. Roadmap triển khai theo phase và GitHub Issues

Mỗi issue dưới đây nên được tạo thành GitHub Issue với `Phase`,
`Priority`, `Type`, `Dependencies`, `Acceptance Criteria`. IDs là mã gợi
ý; có thể đổi theo repo.

## Phase 0 --- Discovery & contracts

**Mục tiêu:** chốt dữ liệu đầu vào và các quyết định kiến trúc tối thiểu
trước khi viết business logic.

### P0-01 --- Kiểm kê repository và stack hiện có

-   **Priority:** P0
-   **Type:** chore
-   Tasks:
    -   Ghi nhận backend/frontend/database/auth/deployment.
    -   Xác định convention route, DTO, error response, test và
        migration.
    -   Tìm module hiện có cho papers, PDFs, review artifacts và users.
-   Acceptance:
    -   Có `docs/current-state.md`.
    -   Có sơ đồ hệ thống hiện tại và danh sách phần có thể tái sử dụng.
-   Dependencies: none.

### P0-02 --- Xác minh SLRS integration surface

-   **Priority:** P0
-   **Type:** integration
-   Tasks:
    -   Kiểm tra SLRS có API/export/download nào thực tế.
    -   Thu thập một sample export đã loại dữ liệu nhạy cảm.
    -   Ghi rõ field, type, ID, status và source provenance.
    -   Nếu chỉ UI: xác định export thủ công hợp lệ; không mặc định
        scrape.
-   Acceptance:
    -   Có sample payload/file và mapping draft.
    -   Mọi field chưa rõ được đánh dấu `UNKNOWN`, không tự đoán.
-   Dependencies: P0-01.

### P0-03 --- Chốt MVP scope và review type

-   **Priority:** P0
-   **Type:** product
-   Tasks:
    -   Chọn một loại bài đầu tiên (khuyến nghị systematic review).
    -   Chọn một Journal Profile.
    -   Chọn format output đầu tiên (Markdown hoặc DOCX).
    -   Chốt ai có quyền approve.
-   Acceptance:
    -   Có MVP scope, out-of-scope và success metrics.
-   Dependencies: P0-01, P0-02.

### P0-04 --- API/error/status conventions

-   **Priority:** P1
-   **Type:** architecture
-   Tasks:
    -   Chốt API prefix, pagination, envelope, error code.
    -   Chốt enum status và state transitions.
    -   Chốt ID strategy, revision token và job contract.
-   Acceptance:
    -   OpenAPI skeleton và enum definitions được review.
-   Dependencies: P0-01.

## Phase 1 --- Canonical schema, database, snapshot

**Mục tiêu:** xây nền dữ liệu có version và lineage.

### P1-01 --- Thiết kế canonical schema

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Định nghĩa Project, ReviewSnapshot, RQ, ReviewArtifact, Study,
        SourceAnchor, Finding, Evidence, Manuscript.
    -   Map SAPEA entities tương ứng.
    -   Định nghĩa required fields/enums.
-   Acceptance:
    -   ERD + schema document được commit.
    -   Không duplicate entity đã có nếu mapping đáp ứng contract.
-   Dependencies: P0-02, P0-03.

### P1-02 --- Tạo database migrations và constraints

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Tạo tables, indexes, foreign keys, unique constraints.
    -   Tạo migration và rollback.
    -   Kiểm tra FK, unique ID và tenant/project authorization.
-   Acceptance:
    -   Migration chạy từ DB trống.
    -   Test FK/unique/state invalid đều fail đúng.
-   Dependencies: P1-01.

### P1-03 --- Implement ReviewSnapshot service

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Tạo snapshot immutable.
    -   Lưu schema version, source version, hash, approver và
        timestamps.
    -   Thêm API create/list/get.
-   Acceptance:
    -   Snapshot không sửa trực tiếp sau khi tạo.
    -   Tạo version mới nếu dữ liệu nguồn thay đổi.
-   Dependencies: P1-02.

### P1-04 --- Snapshot validation/readiness report

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Validate RQs, artifacts, references, methods/PRISMA.
    -   Phân biệt missing với N/A.
    -   Tạo EvidenceRequest và readiness report.
-   Acceptance:
    -   Có unit tests cho missing, N/A, approved, stale và invalid
        status.
    -   Writing job bị chặn khi blocking gaps tồn tại.
-   Dependencies: P1-03.

### P1-05 --- Provenance event service

-   **Priority:** P1
-   **Type:** backend
-   Tasks:
    -   Lưu actor, activity, timestamp, input/output refs, method,
        notes.
    -   Append-only events cho import, parse, infer, verify, approve,
        reject, revise, cite.
-   Acceptance:
    -   Không sửa/xóa event qua API thông thường.
    -   Có audit tests.
-   Dependencies: P1-02.

## Phase 2 --- SLRS Adapter & Evidence Registry

**Mục tiêu:** đưa dữ liệu review vào schema canonical.

### P2-01 --- External-to-canonical mapping

-   **Priority:** P0
-   **Type:** integration
-   Tasks:
    -   Viết mapping từ sample SLRS payload.
    -   Chuẩn hóa study IDs, DOI/URL, RQs, artifact statuses và
        findings.
    -   Giữ external ID và raw import reference.
-   Acceptance:
    -   Mapping được version.
    -   Unknown fields được lưu/log hoặc đưa vào report; không silently
        discard critical data.
-   Dependencies: P0-02, P1-01.

### P2-02 --- Import job API

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Upload/receive payload.
    -   Validate schema, create job, return job ID.
    -   Lưu import report và raw source reference.
-   Acceptance:
    -   Idempotent khi cùng source version/hash.
    -   Có progress/error states.
-   Dependencies: P2-01, P1-03.

### P2-03 --- Study/reference registry

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Lưu metadata, DOI/URL, authors/year/venue.
    -   Không bắt buộc DOI nếu chưa xác minh.
    -   Quản lý duplicate candidates.
-   Acceptance:
    -   Không tự tạo DOI.
    -   Duplicate merge cần rule hoặc reviewer decision.
-   Dependencies: P2-02.

### P2-04 --- Source document & anchor service

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Upload/register PDF; hash/version.
    -   Lưu page PDF 1-based, section, locator type, excerpt, offsets
        nếu xác minh được.
    -   Kiểm tra anchor/document version.
-   Acceptance:
    -   Exact quote mismatch không được mark verified.
    -   Offset chưa xác minh để null.
-   Dependencies: P2-03.

### P2-05 --- Findings & evidence registry

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Lưu findings, evidence IDs, RQ mapping, limitations, status.
    -   Link findings tới nhiều studies/anchors.
    -   Tạo query/filter APIs.
-   Acceptance:
    -   Finding không thể approved nếu required source/evidence checks
        fail.
    -   Có traceability từ finding về source.
-   Dependencies: P2-04.

### P2-06 --- SLRS import UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Import source selector, payload preview, mapping, validation
        report.
    -   Hiển thị artifact status và snapshot readiness.
-   Acceptance:
    -   User xem mapping trước khi import.
    -   Missing khác N/A.
-   Dependencies: P2-02, P2-05, Phase 6 UI foundation.

## Phase 3 --- SAPEA integration

**Mục tiêu:** dùng schema/logic SAPEA để biểu diễn argument và
provenance.

### P3-01 --- Map SAPEA schema sang canonical schema

-   **Priority:** P0
-   **Type:** architecture
-   Tasks:
    -   Map
        SourceDocument/SourceAnchor/ArgumentComponent/ArgumentUnit/ArgumentRelation/Agent/ProvenanceEvent.
    -   Xác định entity dùng chung với Evidence Registry.
    -   Tránh duplicate paper/document/anchor tables.
-   Acceptance:
    -   Mapping matrix và migration plan được duyệt.
-   Dependencies: P1-01, P2-04.

### P3-02 --- Annotation/argument API

-   **Priority:** P1
-   **Type:** backend
-   Tasks:
    -   CRUD/read annotation, relation, graph, provenance.
    -   Revision token cho write endpoints.
    -   Enforce explicit/inferred/missing và review status.
-   Acceptance:
    -   Invalid role/status transition bị từ chối.
    -   Relation proposed không được dùng như verified.
-   Dependencies: P3-01, P1-05.

### P3-03 --- Document analysis pipeline

-   **Priority:** P1
-   **Type:** AI/backend
-   Tasks:
    -   Import → parse → segment → label → normalize → relate → align →
        trace.
    -   Ghi model/prompt version và provenance.
    -   Phân biệt source text với AI paraphrase.
-   Acceptance:
    -   Job có trạng thái và lỗi rõ.
    -   Chưa review thì annotation status là pending.
-   Dependencies: P2-04, P3-02.

### P3-04 --- Human annotation review

-   **Priority:** P1
-   **Type:** frontend/backend
-   Tasks:
    -   Approve/edit/reject/flag annotation/relation.
    -   Lưu before/after, reviewer, reason và timestamp.
-   Acceptance:
    -   Override không xóa quyết định cũ.
    -   Reviewer có thể sửa chiều relation.
-   Dependencies: P3-02, P3-03.

### P3-05 --- Argument graph & provenance UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Source pane highlight theo role.
    -   Inspector: Toulmin, AIF, provenance, status.
    -   Graph lazy loading/filter.
-   Acceptance:
    -   Click annotation mở đúng source anchor.
    -   Graph lớn không tải toàn bộ mặc định.
    -   Chọn span đạt mục tiêu \<300ms sau khi dữ liệu đã tải.
-   Dependencies: P3-04, Phase 6 UI foundation.

### P3-06 --- ArgumentUsage API

-   **Priority:** P2
-   **Type:** backend
-   Tasks:
    -   Link source argument/component tới manuscript claim.
    -   Phân biệt `argument_role` và `citation_intent`.
    -   Validate scope/support checks.
-   Acceptance:
    -   `inserted` usage có destination span và manuscript revision.
-   Dependencies: Phase 4.

## Phase 4 --- Writing Engine

**Mục tiêu:** viết theo kế hoạch và evidence pack, không viết tự do từ
toàn bộ corpus.

### P4-01 --- LLMProvider abstraction

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Interface
        `generate_structured(system_prompt, payload, output_schema)`.
    -   Timeout, retry, token/cost tracking, provider/model version.
    -   Không ghi secret vào log.
-   Acceptance:
    -   Có mock provider cho tests.
    -   Có thể đổi provider mà không sửa domain logic.
-   Dependencies: P0-04.

### P4-02 --- Journal Profile service

-   **Priority:** P1
-   **Type:** backend
-   Tasks:
    -   Schema, API, versioning, source URL, verified date, TTL.
    -   Word budget, article type, sections, citation style,
        policy/disclosure.
-   Acceptance:
    -   Profile không có verified source được đánh warning.
    -   Profile change tạo version mới.
-   Dependencies: P1-02.

### P4-03 --- Contribution statement generator

-   **Priority:** P1
-   **Type:** AI/backend
-   Tasks:
    -   Sinh contribution candidate từ RQs/findings/profile.
    -   Mỗi candidate có finding IDs và rationale.
    -   Human approval.
-   Acceptance:
    -   Không có unsupported novelty claim.
-   Dependencies: P2-05, P4-02.

### P4-04 --- Coverage planner

-   **Priority:** P1
-   **Type:** backend/AI
-   Tasks:
    -   Map RQs, findings, PRISMA/SEGRESS items tới sections.
    -   Báo coverage gap.
-   Acceptance:
    -   Mỗi RQ/reporting item có destination hoặc N/A reason.
-   Dependencies: P4-03.

### P4-05 --- Outline generator

-   **Priority:** P0
-   **Type:** AI/backend
-   Tasks:
    -   Tạo ManuscriptBlueprint.
    -   Section/subsection, objective, word budget, dependencies,
        findings.
    -   Edit/reorder và approve.
-   Acceptance:
    -   Outline output validate theo schema.
    -   H1 approval được lưu.
-   Dependencies: P4-04.

### P4-06 --- Paragraph Planner

-   **Priority:** P0
-   **Type:** AI/backend
-   Tasks:
    -   Tạo ParagraphPlan với rhetorical move, RQs, finding/evidence
        IDs, claim strength, conditions, citation policy, sentence
        slots.
    -   Kiểm tra evidence status.
-   Acceptance:
    -   Plan thiếu evidence không thể chuyển `READY_TO_DRAFT`.
    -   Không thêm finding/reference mới.
-   Dependencies: P4-05, P2-05, P3-02.

### P4-07 --- Section/paragraph drafting

-   **Priority:** P0
-   **Type:** AI/backend
-   Tasks:
    -   Sinh từng paragraph/section từ plan.
    -   Structured output gồm text, claim IDs, evidence IDs used.
    -   Validate IDs, claim strength và qualifiers.
-   Acceptance:
    -   Không có citation ngoài registry.
    -   Lưu provider/model/prompt version.
    -   Human review checkpoint H2.
-   Dependencies: P4-01, P4-06.

### P4-08 --- Draft store and revision versioning

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Lưu draft paragraph, section revision, status và diff.
    -   Optimistic concurrency.
    -   Mark stale khi source/plan thay đổi.
-   Acceptance:
    -   Không ghi đè approved revision.
    -   Conflict trả `REVISION_CONFLICT`.
-   Dependencies: P4-07, P1-05.

### P4-09 --- Manuscript editor UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Outline navigation, editor, citations, evidence sidebar,
        revision diff.
    -   Edit/revise paragraph.
-   Acceptance:
    -   Click citation mở source anchor.
    -   Thay đổi nội dung tạo revision và trigger checks.
-   Dependencies: P4-07, P4-08, Phase 6 UI foundation.

## Phase 5 --- Citation, verification, review and export

**Mục tiêu:** đảm bảo bản thảo có thể kiểm tra, không chỉ đọc tự nhiên.

### P5-01 --- Citation manifest/rendering

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Tách citation occurrence khỏi prose.
    -   Render citation style theo profile.
    -   Kiểm tra metadata/duplicates.
-   Acceptance:
    -   Citation chỉ trỏ reference registry.
    -   Unresolved citation không được mark verified.
-   Dependencies: P2-03, P4-07.

### P5-02 --- Claim extraction and source alignment

-   **Priority:** P0
-   **Type:** AI/backend
-   Tasks:
    -   Parse paragraph thành claims/sentences.
    -   Link claim tới findings/anchors.
    -   Kiểm tra source scope, qualifier và support.
-   Acceptance:
    -   Kết quả `PASS/WARNING/FAIL/NEEDS_REVIEW`.
    -   Similarity score không tự tạo pass.
-   Dependencies: P5-01, P2-04, P2-05.

### P5-03 --- Quality gates G1--G7

-   **Priority:** P0
-   **Type:** backend
-   Tasks:
    -   Implement gate registry, rule definitions, result records.
    -   Phân biệt NOT_RUN, N/A, warning, fail.
    -   Block export theo severity.
-   Acceptance:
    -   Mỗi gate có reason, severity, timestamp, reviewer khi cần.
    -   `NOT_RUN` không được coi là pass.
-   Dependencies: P5-02, P3-02.

### P5-04 --- Contradiction/overclaim review

-   **Priority:** P1
-   **Type:** AI/backend
-   Tasks:
    -   Tìm findings mâu thuẫn.
    -   Phát hiện claim mạnh hơn evidence hoặc bỏ qualifier.
    -   Ghi rationale và supporting sources.
-   Acceptance:
    -   Tạo issue có target/evidence/reason.
    -   Không tự resolve issue critical.
-   Dependencies: P5-02.

### P5-05 --- Review queue UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Filter issue theo severity/type/section.
    -   Hiển thị claim, source excerpt, rationale và suggested action.
    -   Approve with reason/reject/fix/re-run.
-   Acceptance:
    -   Blocking issue hiển thị rõ.
    -   Decision có reviewer và audit.
-   Dependencies: P5-03, Phase 6 UI foundation.

### P5-06 --- Controlled revision engine

-   **Priority:** P1
-   **Type:** AI/backend
-   Tasks:
    -   Revision chỉ theo issue đã chọn.
    -   Diff before/after.
    -   Giữ approved claims hoặc bắt buộc reverify khi claim đổi.
-   Acceptance:
    -   Revision không tự approve.
    -   Gate liên quan được rerun.
-   Dependencies: P4-08, P5-05.

### P5-07 --- PRISMA/reporting reconciliation

-   **Priority:** P1
-   **Type:** backend
-   Tasks:
    -   Reconcile counts với methods/search/screening logs.
    -   Map checklist item tới section/content.
    -   Block khi count mismatch.
-   Acceptance:
    -   Mismatch tạo critical issue.
    -   Không sinh số liệu thay thế.
-   Dependencies: P1-04, P4-04.

### P5-08 --- Export & audit package

-   **Priority:** P1
-   **Type:** backend
-   Tasks:
    -   Export Markdown/DOCX (LaTeX nếu được chốt).
    -   Citation/figure manifests, QA dossier, disclosure, revision
        diff, audit.
    -   Lưu ExportSnapshot/hash/config.
-   Acceptance:
    -   Chặn export khi blocking gate hoặc thiếu final approval.
    -   Export có thể truy lại source snapshot/version.
-   Dependencies: P5-03, P5-07.

### P5-09 --- Final approval & export UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Final checklist, gate summary, disclosure, export options.
    -   Show export job status/artifacts.
-   Acceptance:
    -   H3 approval trước export.
    -   Audit ghi người duyệt và version.
-   Dependencies: P5-08, Phase 6 UI foundation.

## Phase 6 --- UI foundation & cross-cutting UX

Có thể phát triển song song với backend; UI screen phụ thuộc API
contracts.

### P6-01 --- Design system and app shell

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Navigation, layout, status badges, forms, loading/error/empty
        states.
    -   Responsive layout desktop/tablet.
-   Acceptance:
    -   Desktop target ≥1280px; tablet layout hoạt động.
    -   Các trạng thái job được hiển thị nhất quán.
-   Dependencies: P0-03.

### P6-02 --- Project dashboard

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Projects, status, recent activity, open issues, job progress.
-   Acceptance:
    -   Mỗi status có CTA phù hợp.
-   Dependencies: P1-03, P2-02.

### P6-03 --- Import/readiness screen

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Payload preview, mapping, errors, warnings, snapshot readiness.
-   Acceptance:
    -   Không import âm thầm dữ liệu sai.
-   Dependencies: P2-06.

### P6-04 --- Evidence Explorer

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   3-pane UI, PDF/text viewer, source highlights, Inspector,
        provenance.
    -   Graph lazy-load và filters.
-   Acceptance:
    -   Source click-to-open đúng page.
    -   Span selection \<300ms mục tiêu sau khi dữ liệu đã tải.
-   Dependencies: P3-05.

### P6-05 --- Journal Profile and Outline UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Journal settings, policy provenance, outline tree, coverage map,
        approval.
-   Acceptance:
    -   Version/profile source hiển thị rõ.
-   Dependencies: P4-02, P4-05.

### P6-06 --- Manuscript Editor

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Section nav, draft editor, citation sidebar, evidence links,
        diff view.
-   Acceptance:
    -   Revision tạo version; citation link mở evidence.
-   Dependencies: P4-09.

### P6-07 --- Verification queue and export UI

-   **Priority:** P1
-   **Type:** frontend
-   Tasks:
    -   Issue review, decisions, gate summary, export history.
-   Acceptance:
    -   Không cho export khi blocking issue còn mở.
-   Dependencies: P5-05, P5-09.

## Phase 7 --- Testing, evaluation, deployment

### P7-01 --- Unit and schema tests

-   **Priority:** P0
-   **Type:** test
-   Test enums, JSON schemas, FK rules, state transitions, snapshot
    immutability, permissions.
-   Acceptance: CI chạy unit tests và fail khi schema regression.

### P7-02 --- API integration tests

-   **Priority:** P0
-   **Type:** test
-   Test import → snapshot → findings → outline → draft → verify →
    export.
-   Acceptance: có test success path và error paths.

### P7-03 --- Golden dataset for evidence verification

-   **Priority:** P0
-   **Type:** research/test
-   Tasks:
    -   Chuẩn bị corpus thực có provenance và quyền sử dụng.
    -   Human label claim-support, qualifier, citation correctness.
    -   Không dùng sample minh họa như gold-standard.
-   Acceptance:
    -   Dataset có annotation guideline, reviewer agreement và version.
-   Dependencies: P2-04, P5-02.

### P7-04 --- Evaluation metrics

-   **Priority:** P1
-   **Type:** research/test
-   Metrics:
    -   Citation correctness.
    -   Claim support.
    -   Evidence coverage.
    -   Contradiction handling.
    -   Reporting completeness.
    -   Error severity per 1000 words.
    -   Reviewer effort and revision rounds.
    -   Reproducibility.
-   Acceptance:
    -   Báo cáo kết quả có baseline và limitations.
    -   Không tuyên bố hệ thống "scientifically correct" chỉ từ fluency
        score.

### P7-05 --- E2E UI tests

-   **Priority:** P1
-   **Type:** test
-   Test import, review annotation, approve outline, draft paragraph,
    resolve issue, export.
-   Acceptance:
    -   Critical user journeys chạy trong CI hoặc staging.
-   Dependencies: Phase 6.

### P7-06 --- Observability and job recovery

-   **Priority:** P1
-   **Type:** platform
-   Tasks:
    -   Trace ID, metrics, structured logs, retry/cancel, timeout.
    -   Redact secrets/private content.
-   Acceptance:
    -   Có thể xác định stage gây lỗi từ job ID.
-   Dependencies: P4-01.

### P7-07 --- Security/privacy review

-   **Priority:** P1
-   **Type:** security
-   Tasks:
    -   AuthZ tests, file validation, export permission, rate limits,
        secrets.
    -   License/privacy rules.
-   Acceptance:
    -   Không thể tải PDF/export của project khác nếu không được phép.
-   Dependencies: P2-04, P5-08.

### P7-08 --- Deployment and backup

-   **Priority:** P1
-   **Type:** platform
-   Tasks:
    -   Config/environment, DB migrations, object storage,
        backup/restore.
    -   Version pinning cho provider/model/prompt.
-   Acceptance:
    -   Staging deployment có runbook.
    -   Backup restore đã được thử.
-   Dependencies: P7-01, P7-06.

------------------------------------------------------------------------

# 11. Definition of Done dùng chung cho mọi issue

Một issue chỉ được đóng khi:

-   [ ] Code đã merge theo quy trình repo.
-   [ ] Validation/input error được xử lý rõ.
-   [ ] Có unit/integration test tương ứng.
-   [ ] API/schema docs được cập nhật.
-   [ ] Authorization được kiểm tra nếu endpoint có dữ liệu riêng tư.
-   [ ] Audit/provenance được ghi nếu thao tác thay đổi dữ liệu hoặc
    status.
-   [ ] Có loading/error/empty state nếu liên quan UI.
-   [ ] Không tạo source, DOI, metric, finding hoặc quote không có căn
    cứ.
-   [ ] Không ghi đè dữ liệu/version đã approved.
-   [ ] Acceptance criteria của issue được chứng minh bằng test hoặc
    demo.

------------------------------------------------------------------------

# 12. Acceptance criteria cho MVP

MVP được coi là đạt khi thực hiện được một đường đi hoàn chỉnh:

1.  Import một review snapshot thật hoặc fixture đã được xác minh.
2.  Validate artifact, RQ, study, findings và reference registry.
3.  Mở source anchor đúng tài liệu/trang.
4.  Xem argument roles/relations và review status.
5.  Tạo Journal Profile tối thiểu.
6.  Tạo outline và duyệt.
7.  Tạo ParagraphPlan chỉ từ approved findings/evidence.
8.  Sinh một section với citation ID từ registry.
9.  Chạy citation/claim verification.
10. Hiển thị issue và cho người dùng resolve/revise.
11. Chặn export nếu có blocking issue.
12. Export bản thảo + citation manifest + QA report.
13. Truy ngược một câu trong bản thảo về
    `ParagraphPlan → Finding → Study → SourceAnchor`.
14. Tái lập export metadata từ snapshot, profile version, model config
    và source hashes.

## 12.1 Baselines/ablation để đánh giá

Để đánh giá đóng góp của pipeline, có thể so sánh: - B1: direct LLM
prompt từ extraction data. - B2: outline/draft/review pipeline nhưng
không có argument verification. - B3: artifact-grounded writing với
citation verification. - Ablation: tắt Paragraph Planner, Citation
Auditor, Journal Profile hoặc Human Gates từng thành phần.

Chỉ dùng corpus thực có provenance và quyền sử dụng trước khi báo cáo
kết quả; sample data trong tài liệu thiết kế không phải gold-standard.

------------------------------------------------------------------------

# 13. Rủi ro và biện pháp

  -----------------------------------------------------------------------
  Rủi ro                              Biện pháp
  ----------------------------------- -----------------------------------
  SLRS export thay đổi                Adapter versioning, schema
                                      validation, mapping tests

  Extraction thiếu context            EvidenceRequest; block synthesis
                                      overclaim

  Citation tồn tại nhưng không hỗ trợ Source anchor + semantic check +
  claim                               human sampling

  PRISMA counts không khớp            Deterministic reconciliation + hard
                                      stop

  Journal guideline stale             Verified date, TTL, official source
                                      URL, owner

  AI viết quá chắc chắn               Claim strength control, qualifier
                                      preservation

  Nhiều agent/module sửa chồng chéo   Section ownership, revision diff,
                                      approval state

  PDF đổi phiên bản                   Hash/version, re-anchor hoặc
                                      warning

  Inference bị coi như quote          Explicit/inferred/missing status và
                                      gate

  Graph lớn gây lag                   Lazy loading, pagination, filters

  LLM provider lỗi                    Timeout/retry giới hạn, job status
                                      và recovery

  Dữ liệu bản quyền bị export         Permission checks, license-aware
                                      reuse, export policy

  Source snapshot đổi sau draft       Mark stale, impact analysis, rerun
                                      verification
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 14. Thứ tự triển khai khuyến nghị

Không nên bắt đầu đồng thời mọi phase. Thứ tự ưu tiên:

1.  **P0 Discovery:** xác minh SLRS payload và stack.
2.  **P1 Canonical schema + Snapshot:** xây nguồn sự thật bất biến.
3.  **P2 SLRS Adapter + Evidence Registry:** dữ liệu thật vào hệ thống.
4.  **P3 SAPEA mapping + source anchors:** evidence có thể truy vết.
5.  **P4-01/04/05/06/07:** LLM abstraction → outline → paragraph plan →
    draft một section.
6.  **P5-01/02/03:** citation manifest và verifier trước khi mở rộng
    drafting.
7.  **P6 UI:** dashboard, import, Evidence Explorer, editor, review
    queue.
8.  **P5-08/P5-09:** export/audit và final approval.
9.  **P7:** test/evaluation/deployment.

Nếu cần demo sớm, có thể làm UI skeleton song song, nhưng không nên xây
logic viết bài trên schema tạm không có provenance.

------------------------------------------------------------------------

# 15. Các quyết định cần ghi vào ADR

Tạo Architecture Decision Records cho:

-   `ADR-001`: SLRS integration method (API/export/manual import).
-   `ADR-002`: canonical schema và mapping SAPEA.
-   `ADR-003`: LLM provider abstraction.
-   `ADR-004`: job execution sync/async và queue.
-   `ADR-005`: source of truth cho references/findings.
-   `ADR-006`: claim verification policy và human review.
-   `ADR-007`: output format đầu tiên (Markdown/DOCX/LaTeX).
-   `ADR-008`: access control và file/license policy.
-   `ADR-009`: schema/version migration strategy.
-   `ADR-010`: UI state model và editor approach.

Mỗi ADR cần có: context, options, decision, trade-offs, status, date,
owner.

------------------------------------------------------------------------

# 16. Checklist khởi động trong tuần đầu

-   [ ] Kiểm kê repo hiện tại và stack.
-   [ ] Lấy một sample export thật từ SLRS hoặc xác minh cơ chế export.
-   [ ] Chọn một review type và một Journal Profile.
-   [ ] Chọn một sample review có quyền sử dụng.
-   [ ] Chốt canonical schema v1.
-   [ ] Chốt API envelope/error/status.
-   [ ] Tạo DB migrations cho Project, ReviewSnapshot, Study,
    SourceAnchor, Finding, Evidence.
-   [ ] Tạo snapshot validation endpoint.
-   [ ] Tạo import report đầu tiên.
-   [ ] Vẽ UI wireframe cho Import/Readiness, Evidence Explorer và
    Manuscript Editor.
-   [ ] Tạo GitHub milestones Phase 0--7.
-   [ ] Chuyển từng issue trong mục 10 thành GitHub Issue.
-   [ ] Thiết lập CI chạy schema/unit tests.

**Ưu tiên số một:** không bắt đầu bằng "gọi LLM để viết cả bài". Hãy bắt
đầu bằng một snapshot thật, evidence registry có source anchors và một
đoạn ParagraphPlan → Draft → Verify có thể truy vết đầu-cuối.
