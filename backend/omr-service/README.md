# OMR Service (Python + OpenCV)

Nhận diện **MSSV** và chấm **trắc nghiệm** từ ảnh chụp trang phiếu trả lời, dùng
mẫu phiếu có 4 điểm neo ở góc + vạch đồng bộ (timing marks) ở lề.

## Cách hoạt động

1. **Định vị bằng điểm neo**: tìm 4 ô vuông đen đặc ở 4 góc → kéo phẳng (warp)
   ảnh về khung chuẩn A4 (1050×1485 px, 5 px/mm), rồi tinh chỉnh lần 2 để 4 neo
   trùng đúng vị trí góc.
2. **Vạch đồng bộ (timing marks)**: dò các vạch đen ở lề trái/phải của vùng MSSV
   và vùng trắc nghiệm để xác định **đúng tọa độ từng hàng**, bù được nghiêng và
   cong vênh cục bộ của giấy.
3. **Chấm ô tô**: đo **độ đậm tương đối so với nền giấy** trong mỗi ô, rồi **trừ
   baseline** để loại nét chữ in, chỉ còn nét bút thí sinh thêm vào:
   - MCQ: trừ baseline từng câu (trung vị 4 ô A/B/C/D) — chống bóng/cong ở mép
     trang làm ô trống trông như đã tô.
   - MSSV: trừ baseline từng hàng (trung vị 6 cột ≈ nét chữ số in) — đọc được cả
     nét bút mờ mà không nhầm với chữ in đậm (vd nét "8" in đậm hơn nét "1" tô mờ).
   Ô được chọn là ô có độ đậm vượt trội; nếu không ô nào đủ đậm hoặc có ≥2 ô đậm
   thì câu đó là **không hợp lệ** (`x`).
4. **MSSV**: 6 cột × 10 dòng (dùng 2 số đầu + 4 số cuối của MSSV — bỏ số thứ 3, 4).
5. **Ảnh kết quả**: vẽ **vòng XANH** ở đáp án đúng cho mọi câu; **vòng ĐỎ** ở ô
   thí sinh đã tô đối với câu sai/không hợp lệ; vòng xanh dương ở chữ số MSSV
   nhận diện được.

## Yêu cầu ảnh đầu vào để đạt độ chính xác 20/20

Thuật toán đạt **20/20 câu** và đọc đúng MSSV khi ảnh đáp ứng các điều kiện sau.
Nếu thiếu, hệ thống vẫn cố xử lý nhưng sẽ **ghi cảnh báo (warnings)** và có thể
sai ở một vài câu / chữ số.

1. **Đủ 4 điểm neo ở 4 góc** — cả 4 ô vuông đen góc phải nằm trong khung hình,
   không bị tay/vật che, không bị cắt mất. Đây là điều kiện **bắt buộc** để căn
   ảnh; thiếu neo → cảnh báo `Sheet alignment uncertain (n/4 ...)` và kết quả
   không đáng tin.
2. **Toàn bộ trang phiếu nằm trong khung hình** và chiếm phần lớn khung; chụp
   thẳng từ trên xuống. Cho phép nghiêng nhẹ/phối cảnh vừa phải (neo sẽ kéo
   phẳng), nhưng **tránh góc nghiêng quá lớn**.
3. **Nền tối, tương phản với giấy** — đặt phiếu trên mặt bàn/nền sẫm màu. Nền
   sáng hoặc có vật sáng lớn sát mép giấy (ví dụ bàn phím laptop sáng) dễ làm
   nhận diện trang sai.
4. **Ánh sáng đều, không bóng đổ** — đặc biệt **không để bóng/vùng tối phủ lên
   lưới ô tròn**. Vùng bị tối làm ô trống bị hiểu nhầm là đã tô.
5. **Giấy phẳng, không cong/gấp** — cong vênh cục bộ làm lệch hàng. Vạch đồng bộ
   bù được phần lớn, nhưng cong nhiều vẫn gây lệch (nhất là vùng MSSV).
6. **Chỉ một trang phiếu trong khung** — không để trang phiếu thứ hai (cũng có ô
   neo đen) lọt vào ảnh, sẽ gây nhầm điểm neo.
7. **Tô đậm, kín và đúng trong vòng tròn** — tô bằng bút/chì đủ đậm, kín ô. Tô
   quá nhạt hoặc lem ra ngoài có thể bị bỏ sót hoặc bị coi là không hợp lệ.
8. **Ảnh nét, đủ phân giải** — không mờ/nhòe, không quá nhỏ (nên ≥ 1000 px cạnh
   ngắn).
9. **Mỗi câu chỉ tô 1 ô** — tô nhiều hơn 1 ô hoặc bỏ trống được tính là **không
   hợp lệ** (`x`) và **không được điểm**.

## API

```
GET  /api/omr/health   -> { "status": "ok" }

POST /api/omr/process   (multipart/form-data)
  image            (bắt buộc) file ảnh phiếu
  total_questions  (tùy chọn) số câu trắc nghiệm, mặc định 20
  answer_key       (tùy chọn) đáp án đúng, ví dụ "aabbccddaabbbbaaccdd"
  return_image     (tùy chọn) "1" để trả ảnh kết quả base64 PNG

  -> {
       "studentCode": "221003" | null,
       "answers": { "1": "A", "2": "C", ... , "5": "x" },
       "mcqLayout": {...}, "identityLayout": {...},
       "confidence": 0.0-1.0,
       "aligned": 0-4,           // số điểm neo căn được (4 = tốt nhất)
       "warnings": ["..."],
       "resultImage": "data:image/png;base64,..."   // chỉ khi return_image=1
     }
```

- `answers`: giá trị `"x"` nghĩa là **không tô hoặc tô nhiều hơn 1 ô** (không hợp lệ).
- `aligned < 4` hoặc `warnings` không rỗng ⇒ nên kiểm tra lại ảnh / chấm tay.

## Chạy

```bash
cd backend/omr-service
pip install -r requirements.txt
python3 omr_server.py              # cổng 5001 (OMR_SERVICE_PORT để đổi)
OMR_DEBUG=1 python3 omr_server.py  # in log chi tiết từng ô
```

## Kiểm thử

Bộ ảnh mẫu ở `test/identity_mcq/` (tên file = 6 số MSSV + 20 đáp án đã tô; `x` =
không tô / tô nhiều ô). Đáp án đúng dùng để vẽ ảnh kết quả: `aabbccddaabbbbaaccdd`.

```bash
python3 test/omr_service/test_omr.py
```

In ra số câu đọc đúng / MSSV cho từng ảnh. Ảnh kết quả (xanh/đỏ) được lưu ở
`test/omr_service/output/results/`.
