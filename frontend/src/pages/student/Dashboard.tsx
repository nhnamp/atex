import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Clock, CheckCircle, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { io as socketIO, Socket } from 'socket.io-client';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class, AttendanceSession, StudentPublishedExamResult } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const StudentDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
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
    // Connect to socket for instant session notifications
    const socket = socketIO('http://localhost:5000', { withCredentials: true });
    socketRef.current = socket;

    socket.on('class:session_started', ({ sessionId, className }: { sessionId: number; className: string }) => {
      toast.success(`📢 Attendance started: ${className}`, { duration: 6000 });
      // Auto-navigate to the attendance page immediately
      navigate(`/student/attendance/${sessionId}`);
    });

    fetchData();

    // 5-second fallback poll (catches missed socket events)
    const interval = setInterval(() => {
      api.get<AttendanceSession[]>('/attendance/sessions/student/active')
        .then(({ data }) => setActiveSessions(data))
        .catch(() => {});
    }, 5000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [navigate]);

  // Join class-specific socket rooms once classes are loaded
  useEffect(() => {
    if (socketRef.current && classes.length > 0) {
      classes.forEach((cls) => {
        socketRef.current!.emit('join:class', cls.id.toString());
      });
    }
  }, [classes]);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
          <h1 className="text-2xl font-bold">Hello, {user?.fullName}! 👋</h1>
          <p className="mt-1 text-primary-200">Student ID: {user?.username}</p>
        </div>

        {/* Active Sessions Alert */}
        {activeSessions.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={20} className="text-green-600 animate-pulse" />
              <h2 className="font-semibold text-green-800">
                🔴 Active Attendance Session{activeSessions.length > 1 ? 's' : ''}
              </h2>
            </div>
            <div className="space-y-2">
              {activeSessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/student/attendance/${session.id}`}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-200 hover:border-green-400 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{session.class?.name}</p>
                    <p className="text-xs text-gray-500">
                      Started {new Date(session.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-green text-xs">LIVE</span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

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
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center mb-3">
                <CheckCircle size={20} className="text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{activeSessions.length}</p>
              <p className="text-sm text-gray-500">Active Sessions</p>
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
                <div key={cls.id} className="card p-5">
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
                  <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                    <span className="font-medium">Teacher:</span> {cls.teacher?.fullName}
                  </div>
                </div>
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
