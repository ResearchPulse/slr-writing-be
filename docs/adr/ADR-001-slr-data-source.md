# ADR-001: Cách lấy dữ liệu từ `slr-be`

- **Trạng thái:** Đã chấp nhận (cho MVP)
- **Ngày:** 2026-10-30
- **Người phụ trách:** KalvinKhanh

## Bối cảnh

Writing cần corpus và artifact A1–A10 của một project SLR. Khảo sát (`docs/slr-be-survey.md`) cho thấy `slr-be` có API thật cho việc này, nhưng chỉ chấp nhận Firebase ID token của người dùng kèm vai trò project. Không có xác thực service-to-service cho các endpoint artifact, và không có endpoint xuất một gói gộp.

## Các lựa chọn

- **A. Gọi API `slr-be` bằng token của người dùng.** Dữ liệu mới, quyền kiểm soát đúng theo project. Token hết hạn khoảng 1 giờ, khó chạy nền.
- **B. Người dùng tải file rồi import.** Độc lập, nhưng `slr-be` chưa có file xuất gộp.
- **C. Thêm endpoint xuất gói hoặc xác thực service vào `slr-be`.** Sạch nhất, nhưng sửa repo khác.

## Quyết định

Chọn **A** cho MVP. Frontend Writing đăng nhập Firebase, gọi `slr-be` lấy `corpus` và các artifact của một `run`, rồi gửi cho backend Writing để tạo snapshot. Chuyển sang C nếu cần chạy nền hoặc khi `slr-be` có endpoint xuất gói.

Backend Writing **không lưu token** của người dùng và không ghi token vào log.

## Hệ quả

- Việc import chạy trong phiên đăng nhập của người dùng.
- Dữ liệu import được lưu thành snapshot bất biến, nên các bước sau không cần gọi lại `slr-be` và không phụ thuộc token.
- Cần một adapter chịu được hai dạng envelope response của `slr-be`.
- Nếu đổi sang C thì chỉ thay phần adapter, schema snapshot giữ nguyên.
