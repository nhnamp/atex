import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, StopCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { AttendanceSession, AttendanceRecord } from '../../types';

interface SessionStatus {
  id: number;
  classId: number;
  status: 'ACTIVE' | 'COMPLETED';
  phase?: 'WARMUP' | 'ACTIVE';
  warmupLeft?: number;
  currentCode?: string;
  codeIndex?: number;
  timeLeft?: number;
  totalCodes: number;
  startedAt: string;
  endedAt?: string;
}

const AttendanceSessionPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<SessionStatus>(`/attendance/sessions/${sessionId}/status`);
      setStatus(data);
      if (data.status === 'COMPLETED') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        fetchRecords();
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  const fetchRecords = async () => {
    try {
      const { data } = await api.get(`/attendance/sessions/${sessionId}/records`);
      setRecords(data.records ?? []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchStatus();
      setLoading(false);
      intervalRef.current = setInterval(fetchStatus, 1000);
    };
    init();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  const handleEnd = async () => {
    setEnding(true);
    try {
      await api.put(`/attendance/sessions/${sessionId}/end`);
      toast.success('Session ended');
      if (intervalRef.current) clearInterval(intervalRef.current);
      fetchStatus();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to end session');
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  const present = records.filter((r) => r.isPresent).length;
  const absent = records.filter((r) => !r.isPresent).length;

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <Link
            to={status?.classId ? `/teacher/classes/${status.classId}` : '/teacher/classes'}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft size={16} /> Back to Class
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Attendance Session #{sessionId}</h1>
            {status?.status === 'ACTIVE' && (
              <button
                onClick={handleEnd}
                disabled={ending}
                className="btn-danger flex items-center gap-2"
              >
                <StopCircle size={16} />
                {ending ? 'Ending...' : 'End Session'}
              </button>
            )}
          </div>
        </div>

        {/* Warmup phase: notifying students */}
        {status?.status === 'ACTIVE' && status.phase === 'WARMUP' && (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold text-primary-600 uppercase tracking-widest mb-6">
              STARTING SESSION
            </p>
            <div className="w-24 h-24 rounded-full border-4 border-primary-400 flex items-center justify-center text-4xl font-bold text-primary-600 mx-auto mb-4">
              {status.warmupLeft}
            </div>
            <p className="text-lg font-semibold text-gray-900 mb-2">Notifying students…</p>
            <p className="text-sm text-gray-500">
              Students are being redirected to this session. First code appears in{' '}
              <span className="font-bold text-primary-600">{status.warmupLeft}s</span>.
            </p>
          </div>
        )}

        {/* Active Session - Code Display */}
        {status?.status === 'ACTIVE' && status.currentCode && (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold text-primary-600 uppercase tracking-widest mb-2">
              Code {(status.codeIndex ?? 0) + 1} of {status.totalCodes}
            </p>

            {/* Code Display */}
            <div className="my-6">
              <div className="inline-flex gap-2">
                {status.currentCode.split('').map((digit, i) => (
                  <div
                    key={i}
                    className="w-14 h-16 bg-primary-600 text-white text-3xl font-bold rounded-xl flex items-center justify-center shadow-lg"
                  >
                    {digit}
                  </div>
                ))}
              </div>
            </div>

            {/* Countdown */}
            <div className="flex items-center justify-center gap-3 mb-4">
              <div
                className={`w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-bold transition-all ${
                  (status.timeLeft ?? 0) <= 3
                    ? 'border-red-400 text-red-500'
                    : 'border-primary-400 text-primary-600'
                }`}
              >
                {status.timeLeft}
              </div>
              <p className="text-sm text-gray-500">seconds remaining</p>
            </div>

            {/* Progress dots */}
            <div className="flex justify-center gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${
                    i < (status.codeIndex ?? 0)
                      ? 'bg-green-500'
                      : i === (status.codeIndex ?? 0)
                      ? 'bg-primary-600 scale-125'
                      : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-4">
              Share this code with your students. New code appears every 10 seconds.
            </p>
          </div>
        )}

        {/* Completed */}
        {status?.status === 'COMPLETED' && (
          <div>
            <div className="card p-5 bg-green-50 border-green-200 flex items-center gap-3 mb-4">
              <CheckCircle size={24} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-800">Session Completed</p>
                <p className="text-sm text-green-600">
                  {new Date(status.startedAt).toLocaleString()} — {status.endedAt ? new Date(status.endedAt).toLocaleString() : ''}
                </p>
              </div>
            </div>

            {/* Attendance Summary */}
            <div className="grid grid-cols-3 gap-4 mb-4">
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

            {/* Records table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Attendance Results</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student</th>
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Code 1</th>
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Code 2</th>
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Code 3</th>
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {records.map(({ student, isPresent, codesEntered, submitted }) => (
                    <tr key={student.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{student.fullName}</p>
                          <p className="text-xs text-gray-500">{student.username}</p>
                        </div>
                      </td>
                      {[0, 1, 2].map((i) => (
                        <td key={i} className="px-3 py-3 text-center">
                          {submitted && codesEntered[i] ? (
                            <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                              {codesEntered[i]}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-5 py-3 text-center">
                        {isPresent ? (
                          <span className="badge-green badge text-xs">Present</span>
                        ) : (
                          <span className="badge-red badge text-xs">Absent</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AttendanceSessionPage;
