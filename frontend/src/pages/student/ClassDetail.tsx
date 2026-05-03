import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { AttendanceSession, Class } from '../../types';

const StudentClassDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cls, setCls] = useState<Class | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionResults, setSessionResults] = useState<Record<number, { submitted: boolean; isPresent: boolean }>>({});

  const formatSessionName = (session: AttendanceSession) =>
    session.name || new Date(session.startedAt).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  useEffect(() => {
    const fetchClass = async () => {
      setLoading(true);
      try {
        const { data } = await api.get<Class>(`/classes/${id}`);
        setCls(data);
        if (data.sessions?.length) {
          const results = await Promise.all(
            data.sessions.map(async (session) => {
              try {
                const res = await api.get(`/attendance/sessions/${session.id}/my-record`);
                return [session.id, res.data] as const;
              } catch {
                return [session.id, { submitted: false, isPresent: false }] as const;
              }
            })
          );
          setSessionResults(Object.fromEntries(results));
        }
      } catch {
        toast.error('Failed to load class');
        navigate('/student');
      } finally {
        setLoading(false);
      }
    };
    fetchClass();
  }, [id, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  if (!cls) return null;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <Link to="/student" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
              {cls.description && <p className="text-gray-500 mt-1">{cls.description}</p>}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-gray-400" />
                <span>{cls._count?.students ?? 0} students</span>
              </div>
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-gray-400" />
                <span>{cls._count?.sessions ?? 0} sessions</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            <span className="font-medium">Teacher:</span> {cls.teacher?.fullName}
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Students */}
          <div className="lg:col-span-2 card">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Students</h2>
            </div>
            {!cls.students?.length ? (
              <div className="p-8 text-center">
                <p className="text-gray-400">No students enrolled yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cls.students.map(({ student }) => (
                  <div key={student.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">
                      {student.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{student.fullName}</p>
                      <p className="text-xs text-gray-500">{student.username}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sessions */}
          <div className="card">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Attendance Sessions</h2>
            </div>
            {!cls.sessions?.length ? (
              <div className="p-8 text-center">
                <ClipboardList size={36} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No sessions yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cls.sessions.map((session) => {
                  const result = sessionResults[session.id];
                  const isCompleted = session.status === 'COMPLETED';
                  const label = isCompleted
                    ? result?.submitted
                      ? result.isPresent
                        ? 'Present'
                        : 'Absent'
                      : 'No Record'
                    : 'Active';
                  const badgeClass = isCompleted
                    ? result?.submitted
                      ? result.isPresent
                        ? 'badge-green'
                        : 'badge-red'
                      : 'badge-gray'
                    : 'badge-green';

                  return (
                    <div key={session.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatSessionName(session)}</p>
                        <p className="text-xs text-gray-500">{new Date(session.startedAt).toLocaleString()}</p>
                      </div>
                      <span className={`badge text-xs ${badgeClass}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default StudentClassDetail;
