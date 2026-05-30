import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class, AttendanceSession, StudentPublishedExamResult } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const StudentDashboard: React.FC = () => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);
  const [publishedResults, setPublishedResults] = useState<StudentPublishedExamResult[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [classRes, sessionRes, resultRes] = await Promise.all([
        api.get<Class[]>('/classes/student/enrolled'),
        api.get<AttendanceSession[]>('/attendance/sessions/student/active'),
        api.get<StudentPublishedExamResult[]>('/exams/results/me'),
      ]);
      setClasses(classRes.data);
      setActiveSessions(sessionRes.data);
      setPublishedResults(resultRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const totalSessions = classes.reduce((sum, cls) => sum + (cls._count?.sessions ?? 0), 0);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
          <h1 className="text-2xl font-bold">Hello, {user?.fullName}! 👋</h1>
          <p className="mt-1 text-primary-200">Student ID: {user?.username}</p>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mb-3">
                <BookOpen size={20} className="text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
              <p className="text-sm text-gray-500">Enrolled Classes</p>
            </div>
            <div className="card p-5">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-3">
                <ClipboardList size={20} className="text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{totalSessions}</p>
              <p className="text-sm text-gray-500">Total Sessions</p>
            </div>
          </div>
        )}

        {/* Enrolled Classes */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">My Classes</h2>
          {classes.length === 0 ? (
            <div className="card p-8 text-center">
              <BookOpen size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">You are not enrolled in any classes yet</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {classes.map((cls) => (
                <Link key={cls.id} to={`/student/classes/${cls.id}`} className="card p-5 hover:border-primary-200 transition-colors">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <BookOpen size={20} className="text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{cls.name}</h3>
                      {cls.description && (
                        <p className="text-sm text-gray-500 line-clamp-1">{cls.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-gray-400" />
                      <span>{cls._count?.students ?? 0} students</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ClipboardList size={14} className="text-gray-400" />
                      <span>{cls._count?.sessions ?? 0} sessions</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    <span className="font-medium">Teacher:</span> {cls.teacher?.fullName}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Published Exam Results</h2>
          {publishedResults.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-gray-500">No finalized exam results published yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {publishedResults.map((item) => (
                <div key={item.submissionId} className="card p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.examTitle}</p>
                    <p className="text-xs text-gray-500">
                      {item.className} • Published {new Date(item.publishedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Final Score</p>
                    <p className="text-lg font-bold text-green-700">{item.finalScore ?? 0}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default StudentDashboard;
