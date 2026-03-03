import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

// Admin pages
import AdminDashboard from './pages/admin/Dashboard';

// Teacher pages
import TeacherDashboard from './pages/teacher/Dashboard';
import TeacherClasses from './pages/teacher/Classes';
import TeacherClassDetail from './pages/teacher/ClassDetail';
import TeacherAttendanceSession from './pages/teacher/AttendanceSession';
import TeacherSubjects from './pages/teacher/Subjects';
import TeacherQuestions from './pages/teacher/Questions';
import TeacherExamGenerator from './pages/teacher/ExamGenerator';

// Student pages
import StudentDashboard from './pages/student/Dashboard';
import StudentAttendance from './pages/student/Attendance';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
  if (user.role === 'TEACHER') return <Navigate to="/teacher" replace />;
  return <Navigate to="/student" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Admin */}
      <Route element={<ProtectedRoute role="ADMIN" />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>

      {/* Teacher */}
      <Route element={<ProtectedRoute role="TEACHER" />}>
        <Route path="/teacher" element={<TeacherDashboard />} />
        <Route path="/teacher/classes" element={<TeacherClasses />} />
        <Route path="/teacher/classes/:id" element={<TeacherClassDetail />} />
        <Route path="/teacher/attendance/:sessionId" element={<TeacherAttendanceSession />} />
        <Route path="/teacher/subjects" element={<TeacherSubjects />} />
        <Route path="/teacher/subjects/:subjectId/questions" element={<TeacherQuestions />} />
        <Route path="/teacher/exams" element={<TeacherExamGenerator />} />
      </Route>

      {/* Student */}
      <Route element={<ProtectedRoute role="STUDENT" />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/student/attendance/:sessionId" element={<StudentAttendance />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
