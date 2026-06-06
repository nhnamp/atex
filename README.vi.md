[English](README.md) | **Tiếng Việt**

# ATEX — Attendance & Exam

Ứng dụng web full-stack hỗ trợ giáo viên quản lý điểm danh sinh viên bằng nhận diện khuôn mặt và chấm bài thi giấy với sự hỗ trợ của AI. ATEX (Attendance & Exam) cung cấp các tính năng: đăng ký & nhận diện khuôn mặt để điểm danh, quản lý ngân hàng câu hỏi, tạo đề thi in giấy, quét phiếu trả lời OMR, và chấm bài tự luận bằng AI.

## Tính năng

- **Phân quyền** — Admin, Giáo viên, Sinh viên
- **Quản lý lớp học** — Admin tạo lớp, phân công giáo viên, và thêm sinh viên vào lớp
- **Điểm danh bằng nhận diện khuôn mặt** — Giáo viên đăng ký khuôn mặt sinh viên và mở phiên điểm danh trực tiếp bằng nhận diện khuôn mặt trên trình duyệt ([`@vladmandic/face-api`](https://github.com/nicehash/face-api))
- **Môn học & Ngân hàng câu hỏi** — Trắc nghiệm + Tự luận với độ khó Dễ / Trung bình / Khó
- **Tạo đề thi giấy** — Tạo đề thi từ ngân hàng câu hỏi, xuất file `.docx` để in
- **Quét bài + Chấm tự động** — OMR (OpenCV) cho trắc nghiệm, AI (Google Gemini) cho tự luận
- **Duyệt kết quả** — Xem lại ảnh quét và điểm trước khi công bố cho sinh viên

## Công nghệ sử dụng

| Tầng | Công nghệ |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Cơ sở dữ liệu | PostgreSQL qua Prisma ORM |
| Nhận diện khuôn mặt | `@vladmandic/face-api` (chạy trên trình duyệt) |
| Dịch vụ OMR | Python 3, OpenCV (`opencv-python-headless`), Flask |
| Chấm bài AI | Google Gemini API |
| Lưu trữ | Cloudinary (ảnh quét & PDF gộp) |

## Yêu cầu hệ thống

- **Node.js** >= 20 (xem `.nvmrc`)
- **PostgreSQL** — cài đặt cục bộ (ví dụ [Postgres.app](https://postgresapp.com/), Docker, hoặc Homebrew `postgresql`)
- **Python 3** — cho dịch vụ OMR
- **Google Gemini API key** — cho chấm bài tự luận bằng AI
- **Tài khoản Cloudinary** — cho upload ảnh quét bài thi (không bắt buộc nếu chỉ dùng điểm danh)

## Cài đặt

### 1. Clone và cài đặt

```bash
git clone https://github.com/<your-username>/atex.git
cd atex
npm install --workspaces
```

### 2. Thiết lập PostgreSQL

Khởi động PostgreSQL cục bộ và tạo database:

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
| `ADMIN_PASSWORD` | Mật khẩu cho tài khoản admin (tạo khi seed) |
| `CLOUDINARY_CLOUD_NAME` | Tên cloud Cloudinary (bắt buộc cho upload ảnh quét bài thi) |
| `CLOUDINARY_API_KEY` | Khóa API Cloudinary |
| `CLOUDINARY_API_SECRET` | Secret Cloudinary |

### 4. Khởi tạo cơ sở dữ liệu

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts
```

Lệnh seed tạo một tài khoản **admin** duy nhất (tên đăng nhập: `admin`, mật khẩu: giá trị của `ADMIN_PASSWORD`).

### 5. Khởi động dịch vụ OMR (tùy chọn — cần thiết cho quét bài thi)

```bash
cd backend/omr-service
pip install -r requirements.txt
python3 omr_server.py
# Chạy trên http://localhost:5001
```

### 6. Khởi động ứng dụng

**Terminal 1 — Backend:**

```bash
npm run dev:backend
# Chạy trên http://localhost:5000
```

**Terminal 2 — Frontend:**

```bash
npm run dev:frontend
# Chạy trên http://localhost:5173
```

Mở http://localhost:5173 trên trình duyệt.

## Hướng dẫn sử dụng

### Admin

1. Đăng nhập bằng tài khoản admin (`admin` / mật khẩu `ADMIN_PASSWORD` đã cấu hình)
2. **Quản lý giáo viên** — Duyệt hoặc từ chối yêu cầu đăng ký tài khoản giáo viên
3. **Quản lý lớp học** — Tạo lớp, phân công giáo viên cho từng lớp, thêm sinh viên bằng mã số sinh viên 8 chữ số
4. **Quản lý sinh viên** — Tạo hàng loạt tài khoản sinh viên, sắp xếp theo lớp sinh hoạt

### Giáo viên

1. **Lớp học của tôi** — Xem các lớp được phân công và danh sách sinh viên
2. **Đăng ký khuôn mặt** — Đăng ký khuôn mặt sinh viên cho lớp (chụp qua webcam)
3. **Điểm danh khuôn mặt** — Mở phiên điểm danh trực tiếp; camera nhận diện khuôn mặt đã đăng ký và đánh dấu sinh viên có mặt
4. **Môn học & Câu hỏi** — Tạo môn học, chuẩn đầu ra, và ngân hàng câu hỏi (trắc nghiệm / tự luận)
5. **Tạo đề thi** — Tạo bản nháp đề thi từ ngân hàng câu hỏi với tỷ lệ độ khó tùy chỉnh
6. **Quản lý phiên thi** — Gán lớp để bắt đầu phiên thi giấy, in đề thi `.docx`, quét phiếu trả lời, chạy OMR + AI chấm điểm, duyệt kết quả, và công bố điểm

### Sinh viên

1. Trang Dashboard hiển thị các lớp đã đăng ký
2. Xem lịch sử điểm danh theo từng lớp
3. Kết quả thi hiển thị sau khi giáo viên xác nhận và công bố báo cáo phiên thi

## Cấu trúc dự án

```
atex/
├── backend/
│   ├── prisma/             # Schema & migrations cơ sở dữ liệu
│   ├── src/
│   │   ├── config/         # Cấu hình ứng dụng
│   │   ├── controllers/    # Xử lý route
│   │   ├── middleware/      # Middleware xác thực
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
│   │   ├── pages/          # Trang Admin, Giáo viên, Sinh viên
│   │   ├── types/          # TypeScript interfaces
│   │   └── App.tsx         # Routes
│   └── package.json
├── template/               # Mẫu DOCX cho xuất đề thi
└── README.md
```

## Giấy phép

Dự án này là mã nguồn mở theo [Giấy phép MIT](LICENSE).
