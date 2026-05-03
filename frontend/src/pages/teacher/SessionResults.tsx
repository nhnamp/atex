import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';

interface SessionStatus {
  id: number;
  classId: number;
  status: 'ACTIVE' | 'COMPLETED';
  method?: 'FACE' | 'CODE';
  name?: string | null;
  startedAt: string;
  endedAt?: string;
}

interface SessionRecord {
  student: { id: number; username: string; fullName: string };
  isPresent: boolean;
  submitted: boolean;
}

const TeacherSessionResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: statusData }, { data: recordsData }] = await Promise.all([
          api.get<SessionStatus>(`/attendance/sessions/${sessionId}/status`),
          api.get(`/attendance/sessions/${sessionId}/records`),
        ]);
        setStatus(statusData);
        setRecords(recordsData.records ?? []);
      } catch {
        toast.error('Failed to load session results');
        navigate('/teacher/classes');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [sessionId, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  if (!status) return null;

  const present = records.filter((r) => r.isPresent).length;
  const absent = records.length - present;

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <Link
            to={status.classId ? `/teacher/classes/${status.classId}` : '/teacher/classes'}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft size={16} /> Back to Class
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Attendance Results</h1>
            <span className={`badge text-xs ${status.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}`}>
              {status.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {(status.name || new Date(status.startedAt).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }))}
          </p>
        </div>

        {status.status === 'ACTIVE' && (
          <div className="card p-5 bg-amber-50 border-amber-200">
            <p className="text-sm text-amber-800">
              This session is still active. Results may be incomplete until it ends.
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 text-center">
            <p className="text-3xl font-bold text-gray-900">{records.length}</p>
            <p className="text-sm text-gray-500">Total</p>
          </div>
          <div className="card p-4 text-center bg-green-50">
            <p className="text-3xl font-bold text-green-600">{present}</p>
            <p className="text-sm text-green-600">Present</p>
          </div>
          <div className="card p-4 text-center bg-red-50">
            <p className="text-3xl font-bold text-red-500">{absent}</p>
            <p className="text-sm text-red-500">Absent</p>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Attendance Results</h2>
          </div>
          {!records.length ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">No records yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {records.map((record) => (
                  <tr key={record.student.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{record.student.fullName}</p>
                        <p className="text-xs text-gray-500">{record.student.username}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {record.isPresent ? (
                        <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                          <CheckCircle size={14} /> Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
                          <XCircle size={14} /> Absent
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default TeacherSessionResults;
