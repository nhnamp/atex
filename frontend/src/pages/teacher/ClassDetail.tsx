import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, ScanFace, Pencil, Trash2, X, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class, AttendanceSession } from '../../types';

const TeacherClassDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cls, setCls] = useState<Class | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingFaceSession, setStartingFaceSession] = useState(false);
  const [renameSession, setRenameSession] = useState<AttendanceSession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteSession, setDeleteSession] = useState<AttendanceSession | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formatSessionName = (session: AttendanceSession) =>
    session.name || new Date(session.startedAt).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [classRes, sessionsRes] = await Promise.all([
        api.get<Class>(`/classes/${id}`),
        api.get<AttendanceSession[]>(`/attendance/sessions/class/${id}`),
      ]);
      setCls(classRes.data);
      setSessions(sessionsRes.data);
    } catch {
      toast.error('Failed to load class');
      navigate('/teacher/classes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);



  const handleStartFaceSession = async () => {
    setStartingFaceSession(true);
    try {
      const { data } = await api.post('/attendance/sessions/face', { classId: parseInt(id!) });
      toast.success('Face attendance session started!');
      navigate(`/teacher/face-attendance/${data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to start face session');
    } finally {
      setStartingFaceSession(false);
    }
  };

  const openRenameModal = (session: AttendanceSession) => {
    setRenameSession(session);
    setRenameValue(formatSessionName(session));
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameSession || !renameValue.trim()) return;

    setRenaming(true);
    try {
      await api.put(`/attendance/sessions/${renameSession.id}`, { name: renameValue.trim() });
      toast.success('Session renamed');
      setRenameSession(null);
      setRenameValue('');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to rename session');
    } finally {
      setRenaming(false);
    }
  };

  const openDeleteModal = (session: AttendanceSession) => {
    setDeleteSession(session);
  };

  const confirmDelete = async () => {
    if (!deleteSession) return;
    setDeleting(true);
    try {
      await api.delete(`/attendance/sessions/${deleteSession.id}`);
      toast.success('Session deleted');
      setDeleteSession(null);
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete session');
    } finally {
      setDeleting(false);
    }
  };

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
          <Link to="/teacher/classes" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Classes
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
              {cls.description && <p className="text-gray-500 mt-1">{cls.description}</p>}
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link
                to={`/teacher/classes/${id}/attendance-summary`}
                className="btn-secondary flex items-center gap-2"
              >
                <BarChart3 size={16} /> View Summary
              </Link>
              <Link
                to={`/teacher/classes/${id}/face-enroll`}
                className="btn-secondary flex items-center gap-2"
              >
                <ScanFace size={16} /> Manage Faces
              </Link>
              <button
                onClick={handleStartFaceSession}
                disabled={startingFaceSession}
                className="btn-primary flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                <ScanFace size={16} />
                {startingFaceSession ? 'Starting...' : 'Face Attendance'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Students */}
          <div className="lg:col-span-2 card">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Students ({cls.students?.length ?? 0})
              </h2>
            </div>
            {!cls.students?.length ? (
              <div className="p-8 text-center">
                <p className="text-gray-400">No students enrolled yet</p>
              <p className="text-xs text-gray-400 mt-1">Contact admin to add students</p>
            </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cls.students.map(({ student }) => (
                  <div key={student.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">
                        {student.fullName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{student.fullName}</p>
                        <p className="text-xs text-gray-500">{student.username}</p>
                      </div>
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
            {!sessions.length ? (
              <div className="p-8 text-center">
                <ClipboardList size={36} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No sessions yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {sessions.map((session) => {
                  const isActiveFace = session.method === 'FACE' && session.status === 'ACTIVE';
                  const Row = (
                    <div className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatSessionName(session)}</p>
                        <p className="text-xs text-gray-500">{new Date(session.startedAt).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span
                          className={`badge text-xs ${
                            session.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'
                          }`}
                        >
                          {session.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openRenameModal(session);
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-500"
                          title="Rename session"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openDeleteModal(session);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500"
                          title="Delete session"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );

                  if (isActiveFace) {
                    return (
                      <Link
                        key={session.id}
                        to={`/teacher/face-attendance/${session.id}`}
                        className="block"
                      >
                        {Row}
                      </Link>
                    );
                  }

                  return (
                    <Link
                      key={session.id}
                      to={`/teacher/sessions/${session.id}`}
                      className="block"
                    >
                      {Row}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {renameSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setRenameSession(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Rename Session</h2>
              <button
                onClick={() => setRenameSession(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitRename} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Session Name</label>
                <input
                  type="text"
                  className="input-field"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setRenameSession(null)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={renaming} className="btn-primary flex-1">
                  {renaming ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDeleteSession(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Delete Session</h2>
              <button
                onClick={() => setDeleteSession(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Delete attendance session "{formatSessionName(deleteSession)}"? This cannot be undone.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setDeleteSession(null)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="button" onClick={confirmDelete} disabled={deleting} className="btn-danger flex-1">
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherClassDetail;
