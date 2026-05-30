# Attendance system and AI exam generation

A full-stack MVP for student attendance management and paper-exam grading workflow.

## Features

- **Role-based access**: Admin, Teacher, Student
- **Teacher account approval**: Admin must approve teacher accounts
- **Class management**: Create classes, add students by student ID
- **Live attendance sessions**: 3-code rolling system with 10s countdown per code
- **Subject & Question Bank**: Multiple choice + Essay with EASY/MEDIUM/HARD difficulty
- **Paper Exam Builder**: Generate exam draft from question bank and print `.docx`
- **Paper Scan + Auto Grading**: OMR for MCQ, AI grading for essay, report review before publish
- **Minimalist UI**: White & blue design with TailwindCSS

---

## Tech Stack

| Layer     | Technology                                |
|-----------|-------------------------------------------|
| Frontend  | React 18, TypeScript, Vite, TailwindCSS   |
| Backend   | Node.js, Express, TypeScript              |
| Database  | SQLite via Prisma ORM                     |
| Realtime  | Socket.IO                                 |
| AI        | Google Gemini API (`gemini-1.5-flash`)    |
| Docs      | docx (Word file generation)               |
| Auth      | JWT (jsonwebtoken) + bcryptjs             |

---

## Quick Start

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY + Cloudinary credentials for scan upload
```

### 3. Set up database

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts
```

### 4. Start the servers

**Terminal 1 – Backend:**
```bash
cd backend
npm run dev
# Runs on http://localhost:5000
```

**Terminal 2 – Frontend:**
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

---

## Default Accounts

| Role    | Username      | Password     |
|---------|---------------|--------------|
| Admin   | `admin`       | `admin123`   |
| Teacher | `Nguyen Van A`| `teacher123` |
| Student | `22521000`    | `student123` |

---

## Usage Guide

### Admin
- Go to `/admin` → see pending teacher approval requests
- Approve or reject teacher accounts

### Teacher
1. **Classes** → Create a class, add students by 8-digit IDs
2. **Start Attendance** → Opens live session with rolling 6-digit codes (3 rounds × 10 seconds)
3. **Subjects** → Create subjects, outcomes, and question bank (MC / Essay)
4. **Create Exam + Assign Class** → Build draft from question bank and create a paper exam session for a class
5. **Run Paper Test in Classroom** → Print exam, students do paper answers, no online answer submission in this stage
6. **Scan Papers in Session Management** → Capture paper scans per student, store scan evidence, then run OMR + AI grading
7. **Review Report and Confirm** → Review image proofs and component scores, adjust/regrade if needed, then confirm report to publish

### Student
1. Dashboard shows enrolled classes and active sessions
2. Open an active session → enter the 6-digit code shown on teacher's screen
3. Submit all 3 codes correctly to be marked **Present**
4. Exam results appear only after teacher confirms session report and publishes finalized scores

---

## Attendance System Logic

```
Session starts → generates 3 codes: [C1, C2, C3]

t=0s  → C1 displayed (10 seconds)
t=10s → C2 displayed (10 seconds)  
t=20s → C3 displayed (10 seconds)
t=30s → Session ends automatically

Student must submit correct C1, C2, C3 → marked PRESENT
```

---

## Paper Exam Workflow

1. Teacher creates exam draft from question bank and assigns class for paper test.
2. Teacher prints exam and students do the test on paper in classroom.
3. Teacher scans each answer sheet in Session Management.
4. MCQ is scored by OMR template; essay is scored by AI against answer/rubric.
5. System builds a report with scans, warnings, and scores for manual review.
6. Teacher confirms report to finalize and publish scores to student portal.

## AI Exam Generation

1. Teacher picks a subject and specifies requirements:
   - e.g. 10 total (5 MC, 5 Essay)
   - Set difficulty ratios for MCQ and Essay independently (EASY/MEDIUM/HARD)
2. Backend selects questions with deterministic rule-based distribution (no online student answering flow).
3. `docx` library formats the draft into a Word document for printing.

## Scan Upload (Cloudinary)

1. Create a Cloudinary account and get `cloud_name`, `api_key`, `api_secret`.
2. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `backend/.env`.
3. Optional upload limits (defaults shown):
   - `EXAM_MOBILE_SCAN_MAX_FILES=20`
   - `EXAM_SUBMISSION_SCAN_MAX_FILES=20`
   - `EXAM_BULK_SCAN_MAX_FILES=100`
   - `EXAM_MISSING_PAGE_MAX_FILES=20`
4. Restart backend server.
5. In teacher flow:
   - Select a draft, review exam preview, then use Start Test block (under preview) to pick class and start session
   - Optional: click Create Mobile Link and open on phone browser
   - Click Start Scan and capture each student sheet
   - Click AI Start Grading
   - Review report and click Confirm & Publish

> Cloudinary credentials are required for scan upload and merged PDF storage in this workflow.

---

## Project Structure

```
NT208-Project/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema
│   │   └── seed.ts             # Seed data
│   ├── src/
│   │   ├── config/             # App configuration
│   │   ├── controllers/        # Route handlers
│   │   ├── middleware/         # Auth middleware
│   │   ├── routes/             # Express routes
│   │   ├── services/           # Gemini + DOCX services
│   │   └── index.ts            # Entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/                # Axios instance
│   │   ├── components/         # Layout, ProtectedRoute, Spinner
│   │   ├── contexts/           # AuthContext
│   │   ├── pages/
│   │   │   ├── auth/           # Login, Register
│   │   │   ├── admin/          # Dashboard
│   │   │   ├── teacher/        # Dashboard, Classes, Sessions, Subjects, Questions, Exam
│   │   │   └── student/        # Dashboard, Attendance
│   │   ├── types/              # TypeScript interfaces
│   │   └── App.tsx             # Routes
│   └── package.json
└── README.md
```
This project is a student attendance system with AI exam generation capabilities. It consists of a backend built with Node.js and Express, and a frontend built with React. The system allows teachers to manage student attendance, generate exams using AI, and provides students with access to their attendance records and generated exams.

This is **group 14**'s project for the Web Programming course (NT208) at UIT. The project is developed by **Phan Ban Nhat Nam** (24521122) and **Nguyen Minh Triet** (24521851).
