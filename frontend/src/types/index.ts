export interface User {
  id: number;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt?: string;
}

export interface Class {
  id: number;
  name: string;
  description?: string;
  teacherId: number;
  teacher?: User;
  createdAt?: string;
  _count?: { students: number; sessions: number };
  students?: { student: User; joinedAt: string }[];
  sessions?: AttendanceSession[];
}

export interface AttendanceSession {
  id: number;
  classId: number;
  class?: Class;
  name?: string | null;
  status: 'ACTIVE' | 'COMPLETED';
  method?: 'CODE' | 'FACE';
  startedAt: string;
  endedAt?: string;
  createdAt?: string;
  _count?: { records: number };
  // Teacher only fields (from status endpoint)
  currentCode?: string;
  codeIndex?: number;
  timeLeft?: number;
  totalCodes?: number;
}

export interface FaceDescriptor {
  id: number;
  studentId: number;
  descriptor: number[];
  createdAt?: string;
}

export interface AttendanceRecord {
  student: User;
  isPresent: boolean;
  codesEntered: Record<string, string>;
  submitted: boolean;
}

export interface Subject {
  id: number;
  name: string;
  teacherId: number;
  teacher?: User;
  createdAt?: string;
  _count?: { questions: number };
}

export interface Question {
  id: number;
  subjectId: number;
  type: 'MULTIPLE_CHOICE' | 'ESSAY' | 'TRUE_FALSE';
  content: string;
  answer: string;
  options?: string | null; // JSON string
  createdAt?: string;
}

export interface ExamRequirements {
  total: number;
  multipleChoice: number;
  essay: number;
  trueFalse: number;
}
