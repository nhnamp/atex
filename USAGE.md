**English** | [Tiếng Việt](USAGE_VI.md)

# ATEX — Attendance & Exam

A full-stack web application that helps teachers manage student attendance via face recognition and supports paper-based exam grading with AI assistance. ATEX (Attendance & Exam) provides user management, face recognition attendance, question bank management, exam generation, multiple-choice answer-sheet scoring, and AI-assisted essay grading.

## Features

- **Role-based access** — Admin, Teacher, Student
- **Class management** — Admin creates classes, assigns teachers, and adds students to classes
- **Face-recognition attendance** — Teachers enroll student faces and open a live attendance session in the browser
- **Question Bank** — Multiple choice + Essay with Easy / Medium / Hard difficulty
- **Exam Builder** — Generate exams from the question bank and export `.docx` files for printing
- **Paper Scan + Auto Grading** — OMR for multiple-choice questions, AI for essay questions
- **Result Review** — Review scanned images and scores before publishing to students

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Face Recognition | `@vladmandic/face-api` |
| OMR Service | Python 3, OpenCV (`opencv-python-headless`), Flask |
| AI Grading | Google Gemini API |
| Storage | Cloudinary |

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL**
- **Python 3** for the OMR service
- **Google Gemini API key** for AI essay grading
- **Cloudinary account** for scan image uploads (not required if you only use attendance)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/nhnamp/atex.git
cd atex
npm install --workspaces
```

### 2. Set up PostgreSQL

Start a local PostgreSQL server and create a database:

```bash
createdb atex
```

### 3. Configure environment

```bash
cp .env.example backend/.env
```

Edit `backend/.env` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/atex` |
| `DIRECT_URL` | Same as `DATABASE_URL` for local setup |
| `JWT_SECRET` | Any random string for signing JWT tokens |
| `GEMINI_API_KEY` | Google Gemini API key |
| `ADMIN_PASSWORD` | Password for the seeded admin account |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (required for exam scan upload) |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### 4. Initialize the database

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts
```

The seed script creates a single **admin** account (username: `admin`, password: value of `ADMIN_PASSWORD`).

### 5. Start the OMR service (optional — needed for exam scanning)

```bash
cd backend/omr-service
pip install -r requirements.txt
python3 omr_server.py
# Runs on http://localhost:5001
```

### 6. Start the app

**Terminal 1 — Backend:**

```bash
npm run dev:backend
# Runs on http://localhost:5000
```

**Terminal 2 — Frontend:**

```bash
npm run dev:frontend
# Runs on http://localhost:5174
```

Open http://localhost:5174 in your browser.

## Usage

### Admin

1. Log in with the admin account (`admin` / the configured `ADMIN_PASSWORD`)
2. **Manage teachers** — Create teacher accounts and add teachers to the corresponding faculty
3. **Manage classes** — Create classes, assign teachers to each class, and add students using their student IDs
4. **Manage students** — Create student accounts and organize them by homeroom class

### Teacher

1. **Classes** — View assigned classes and student lists
2. **Face Enrollment** — Register student faces for a class
3. **Face Attendance** — Open a live attendance session; the camera recognizes registered faces and marks students present
4. **Subjects & Questions** — Create subjects, learning outcomes, and a question bank (multiple choice / essay)
5. **Exam Builder** — Create an exam from the question bank with customizable difficulty ratios
6. **Exam Session Management** — Assign a class to start a paper-based exam session, print the `.docx` exam, scan answer sheets, run OMR + AI grading, review results, and publish scores

### Student

1. The dashboard shows enrolled classes
2. View attendance history per class
3. Exam results appear after the teacher confirms and publishes the session report

## Project Structure

```
atex/
├── backend/
│   ├── prisma/             # Database schema & migrations
│   ├── src/
│   │   ├── config/         # App configuration
│   │   ├── controllers/    # Route handlers
│   │   ├── middleware/     # Auth middleware
│   │   ├── routes/         # Express routes
│   │   ├── services/       # Gemini, Cloudinary, DOCX services
│   │   └── index.ts        # Entry point
│   ├── omr-service/        # Python OMR microservice (OpenCV + Flask)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios instance
│   │   ├── components/     # Layout, ProtectedRoute, Spinner
│   │   ├── contexts/       # AuthContext
│   │   ├── pages/          # Admin, Teacher, Student pages
│   │   ├── types/          # TypeScript interfaces
│   │   └── App.tsx         # Routes
│   └── package.json
├── template/               # DOCX templates for exam export
└── README.md
```

## License

This project is open-source and available under the [MIT License](LICENSE).
