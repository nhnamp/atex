[English](USAGE.md) | **Tiếng Việt**

# ATEX - Attendance & Exam

Ứng dụng web full-stack hỗ trợ Giảng viên quản lý điểm danh Sinh viên bằng nhận diện khuôn mặt và chấm bài thi giấy với sự hỗ trợ của AI. ATEX (Attendance & Exam) cung cấp các tính năng: quản lý người dùng, nhận diện khuôn mặt để điểm danh, quản lý ngân hàng câu hỏi, tạo đề thi, chấm điểm phiếu trả lời trắc nghiệm, chấm bài tự luận bằng AI.

## Tính năng

- **Phân quyền**: Admin, Giảng viên, Sinh viên.
- **Quản lý lớp học**: Admin tạo lớp, phân công Giảng viên, và thêm Sinh viên vào lớp
- **Điểm danh bằng nhận diện khuôn mặt**: Giảng viên đăng ký khuôn mặt Sinh viên và mở phiên điểm danh trực tiếp bằng nhận diện khuôn mặt trên trình duyệt
- **Ngân hàng câu hỏi**: Trắc nghiệm + Tự luận với độ khó Dễ / Trung bình / Khó
- **Tạo đề thi**: Tạo đề thi từ ngân hàng câu hỏi, xuất file `.docx` để in
- **Quét bài + Chấm tự động**: OMR cho trắc nghiệm, AI cho tự luận
- **Duyệt kết quả**: Xem lại ảnh quét và điểm trước khi công bố cho Sinh viên

## Công nghệ sử dụng

| Tầng | Công nghệ |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Cơ sở dữ liệu | PostgreSQL |
| Nhận diện khuôn mặt | `@vladmandic/face-api` |
| Dịch vụ OMR | Python 3, OpenCV (`opencv-python-headless`), Flask |
| Chấm bài AI | Google Gemini API |
| Lưu trữ | Cloudinary |

## Yêu cầu hệ thống

- **Node.js** >= 20
- **PostgreSQL**
- **Python 3** cho dịch vụ OMR
- **Google Gemini API key** cho chấm bài tự luận bằng AI
- **Tài khoản Cloudinary** cho upload ảnh quét bài thi (không bắt buộc nếu chỉ dùng điểm danh)

## Cài đặt

### 1. Clone và cài đặt

```bash
git clone https://github.com/nhnamp/atex.git
cd atex
npm install --workspaces
```

### 2. Thiết lập PostgreSQL

Khởi động PostgreSQL và tạo database:

```bash
createdb atex
```

### 3. Cấu hình môi trường

```bash
cp .env.example backend/.env
```

Chỉnh sửa `backend/.env` và điền các giá trị:

| Biến | Mô tả |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL, ví dụ `postgresql://user:password@localhost:5432/atex` |
| `DIRECT_URL` | Giống `DATABASE_URL` khi chạy cục bộ |
| `JWT_SECRET` | Chuỗi ngẫu nhiên bất kỳ để ký JWT token |
| `GEMINI_API_KEY` | Khóa API Google Gemini |
| `ADMIN_PASSWORD` | Mật khẩu cho tài khoản admin |
| `CLOUDINARY_CLOUD_NAME` | Tên cloud Cloudinary |
| `CLOUDINARY_API_KEY` | Khóa API Cloudinary |
| `CLOUDINARY_API_SECRET` | Secret Cloudinary |

### 4. Khởi tạo cơ sở dữ liệu

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts
```

Lệnh seed tạo một tài khoản **admin** (tên đăng nhập: `admin`, mật khẩu: giá trị của `ADMIN_PASSWORD` lấy từ `.env`).

### 5. Khởi động dịch vụ OMR (tùy chọn, cần thiết cho quét bài thi)

```bash
cd backend/omr-service
pip install -r requirements.txt
python3 omr_server.py
# Chạy trên http://localhost:5001
```

### 6. Khởi động ứng dụng

**Terminal 1 - Backend:**

```bash
npm run dev:backend
# Chạy trên http://localhost:5000
```

**Terminal 2 - Frontend:**

```bash
npm run dev:frontend
# Chạy trên http://localhost:5174
```

Mở [localhost](http://localhost:5174) trên trình duyệt.

## Hướng dẫn sử dụng

### Admin

1. Đăng nhập bằng tài khoản admin (`admin` / mật khẩu `ADMIN_PASSWORD` đã cấu hình).
2. **Quản lý Giảng viên**: Tạo tài khoản cho Giảng viên, thêm Giảng viên vào khoa tương ứng.
3. **Quản lý lớp học**: Tạo lớp, phân công Giảng viên cho từng lớp, thêm Sinh viên bằng mã số Sinh viên.
4. **Quản lý Sinh viên**: Tạo tài khoản Sinh viên, sắp xếp theo lớp sinh hoạt.

### Giảng viên

1. **Lớp học**: Xem các lớp được phân công và danh sách Sinh viên.
2. **Đăng ký khuôn mặt**: Đăng ký khuôn mặt Sinh viên cho lớp.
3. **Điểm danh khuôn mặt**: Mở phiên điểm danh trực tiếp; camera nhận diện khuôn mặt đã đăng ký và đánh dấu Sinh viên có mặt.
4. **Môn học & Câu hỏi**: Tạo môn học, chuẩn đầu ra, và ngân hàng câu hỏi (trắc nghiệm / tự luận).
5. **Tạo đề thi**: Tạo đề thi từ ngân hàng câu hỏi với tỷ lệ độ khó tùy chỉnh.
6. **Quản lý phiên thi**: Gán lớp để bắt đầu phiên thi giấy, in đề thi với file `.docx`, quét phiếu trả lời, chạy OMR + AI chấm điểm, duyệt kết quả, và công bố điểm.

### Sinh viên

1. Trang Dashboard hiển thị các lớp đã đăng ký.
2. Xem lịch sử điểm danh theo từng lớp.
3. Kết quả thi hiển thị sau khi Giảng viên xác nhận và công bố báo cáo phiên thi.

## Cấu trúc dự án

```
atex/
├── backend/
│   ├── prisma/             # Schema & migrations cơ sở dữ liệu
│   ├── src/
│   │   ├── config/         # Cấu hình ứng dụng
│   │   ├── controllers/    # Xử lý route
│   │   ├── middleware/     # Middleware xác thực
│   │   ├── routes/         # Express routes
│   │   ├── services/       # Dịch vụ Gemini, Cloudinary, DOCX
│   │   └── index.ts        # Điểm vào
│   ├── omr-service/        # Dịch vụ OMR bằng Python (OpenCV + Flask)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios instance
│   │   ├── components/     # Layout, ProtectedRoute, Spinner
│   │   ├── contexts/       # AuthContext
│   │   ├── pages/          # Trang Admin, Giảng viên, Sinh viên
│   │   ├── types/          # TypeScript interfaces
│   │   └── App.tsx         # Routes
│   └── package.json
├── template/               # Mẫu DOCX cho xuất đề thi
└── README.md
```

## Giấy phép

Dự án này là mã nguồn mở theo [Giấy phép MIT](LICENSE).
