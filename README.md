# NT208 – Student Attendance System 🎓

A full-stack MVP for student attendance management with AI-powered exam generation.

## Features

- **Role-based access**: Admin, Teacher, Student
- **Teacher account approval**: Admin must approve teacher accounts
- **Class management**: Create classes, add students by student ID
- **Live attendance sessions**: 3-code rolling system with 10s countdown per code
- **Subject & Question Bank**: Multiple choice, Essay, True/False
- **AI Exam Generator**: Gemini API selects questions → exports `.docx`
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
# Edit .env and add your GEMINI_API_KEY
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
3. **Subjects** → Create subjects, manage question banks (MC / Essay / True-False)
4. **Exam Generator** → Select subject, set question counts → AI generates a `.docx` exam file

### Student
1. Dashboard shows enrolled classes and active sessions
2. Open an active session → enter the 6-digit code shown on teacher's screen
3. Submit all 3 codes correctly to be marked **Present**

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

## AI Exam Generation

1. Teacher picks a subject and specifies requirements:
   - e.g. 10 total (5 MC, 3 Essay, 2 True/False)
2. Backend sends question bank + requirements to **Gemini API**
3. Gemini returns selected question IDs (diverse, balanced)
4. `docx` library formats them into a Word document
5. Auto-downloads in the browser

> If Gemini API key is not set, falls back to random selection.

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
