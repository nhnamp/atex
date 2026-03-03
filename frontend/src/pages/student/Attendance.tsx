import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, CheckCircle, XCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';

interface SessionStatus {
  id: number;
  classId: number;
  status: 'ACTIVE' | 'COMPLETED';
  phase?: 'WARMUP' | 'ACTIVE';
  warmupLeft?: number;
  codeIndex?: number;
  timeLeft?: number;
  totalCodes: number;
  startedAt: string;
}

interface MyRecord {
  submitted: boolean;
  codesEntered: Record<string, string>;
  isPresent: boolean;
}

interface SubmitResult {
  success: boolean;
  isCorrect: boolean;
  submittedCount: number;
  isPresent: boolean;
  message: string;
}

const StudentAttendance: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [myRecord, setMyRecord] = useState<MyRecord>({ submitted: false, codesEntered: {}, isPresent: false });
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<SessionStatus>(`/attendance/sessions/${sessionId}/status`);
      setStatus(data);
      if (data.status === 'COMPLETED') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        fetchRecord();
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  const fetchRecord = async () => {
    try {
      const { data } = await api.get<MyRecord>(`/attendance/sessions/${sessionId}/my-record`);
      setMyRecord(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchStatus(), fetchRecord()]);
      setLoading(false);
      intervalRef.current = setInterval(fetchStatus, 1000);
    };
    init();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<SubmitResult>(`/attendance/sessions/${sessionId}/submit`, { code });
      if (data.isCorrect) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
      setCode('');
      fetchRecord();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const currentIndex = Math.max(0, status?.codeIndex ?? 0);
  const alreadySubmittedCurrent = myRecord.codesEntered[currentIndex] !== undefined;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-md mx-auto">
        {/* Header */}
        <div>
          <Link to="/student" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Attendance Session</h1>
          <p className="text-gray-500 mt-1">Session #{sessionId}</p>
        </div>

        {/* Progress */}
        <div className="card p-5">
          <p className="text-sm font-semibold text-gray-600 mb-3">Your Progress</p>
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => {
              const submitted = myRecord.codesEntered[i] !== undefined;
              // We can't know which was correct until session ends
              return (
                <div
                  key={i}
                  className={`flex-1 h-12 rounded-lg border-2 flex items-center justify-center font-bold text-sm transition-all ${
                    submitted
                      ? 'border-green-400 bg-green-50 text-green-700'
                      : status?.status === 'ACTIVE' && currentIndex === i
                      ? 'border-primary-400 bg-primary-50 text-primary-700 animate-pulse'
                      : 'border-gray-200 bg-gray-50 text-gray-400'
                  }`}
                >
                  {submitted ? (
                    <CheckCircle size={20} />
                  ) : (
                    <span>Code {i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Warmup: session is starting countdown */}
        {status?.status === 'ACTIVE' && status.phase === 'WARMUP' && (
          <div className="card p-8 text-center">
            <div className="w-20 h-20 rounded-full border-4 border-primary-400 flex items-center justify-center text-3xl font-bold text-primary-600 mx-auto mb-4 animate-pulse">
              {status.warmupLeft}
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Session is starting…</h2>
            <p className="text-sm text-gray-500">
              First code appears in{' '}
              <span className="font-semibold text-primary-600">
                {status.warmupLeft} second{status.warmupLeft !== 1 ? 's' : ''}
              </span>. Get ready!
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-3 h-3 rounded-full bg-primary-200 animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Active: code entry */}
        {status?.status === 'ACTIVE' && status.phase !== 'WARMUP' && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-semibold text-gray-900">Enter Code {currentIndex + 1} of 3</p>
                <p className="text-sm text-gray-500">Code changes every 10 seconds</p>
              </div>
              <div className={`w-12 h-12 rounded-full border-4 flex items-center justify-center font-bold text-lg ${
                (status.timeLeft ?? 0) <= 3 ? 'border-red-400 text-red-500' : 'border-primary-400 text-primary-600'
              }`}>
                {status.timeLeft}
              </div>
            </div>

            {alreadySubmittedCurrent ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                <CheckCircle size={20} className="text-green-600" />
                <div>
                  <p className="font-medium text-green-800">Code {currentIndex + 1} submitted!</p>
                  <p className="text-xs text-green-600">
                    Entered: {myRecord.codesEntered[currentIndex]}
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="input-field text-center text-3xl font-bold tracking-[0.5em] h-16"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="off"
                    autoFocus
                  />
                  <p className="text-xs text-center text-gray-500 mt-1">
                    Enter the 6-digit code shown by your teacher
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={submitting || code.length !== 6}
                  className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2"
                >
                  <Send size={18} />
                  {submitting ? 'Submitting...' : 'Submit Code'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Session completed */}
        {status?.status === 'COMPLETED' && (
          <div className={`card p-6 text-center ${myRecord.isPresent ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            {myRecord.isPresent ? (
              <>
                <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-green-800 mb-1">✅ Present!</h2>
                <p className="text-green-600">You successfully completed attendance. All 3 codes correct.</p>
              </>
            ) : (
              <>
                <XCircle size={48} className="text-red-400 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-red-700 mb-1">❌ Absent</h2>
                <p className="text-red-600 mb-3">
                  {!myRecord.submitted
                    ? 'You did not submit any codes for this session.'
                    : `You submitted ${Object.keys(myRecord.codesEntered).length}/3 codes but not all were correct.`}
                </p>
                <div className="flex justify-center gap-3 mt-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                      myRecord.codesEntered[i] ? 'bg-white border' : 'bg-red-100 text-red-600'
                    }`}>
                      {myRecord.codesEntered[i] ? `Code ${i+1}: ${myRecord.codesEntered[i]}` : `Code ${i+1}: missed`}
                    </div>
                  ))}
                </div>
              </>
            )}

            <Link to="/student" className="mt-5 btn-secondary inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Back to Dashboard
            </Link>
          </div>
        )}

        {/* Instructions */}
        {status?.status === 'ACTIVE' && !alreadySubmittedCurrent && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-2">
              <Clock size={16} /> Instructions
            </p>
            <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
              <li>Look at the code displayed on your teacher's screen</li>
              <li>Enter it here before the 10-second timer expires</li>
              <li>You must submit all 3 codes correctly to be marked present</li>
              <li>Each code can only be submitted once</li>
            </ul>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default StudentAttendance;
