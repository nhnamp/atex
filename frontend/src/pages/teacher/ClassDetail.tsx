import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserPlus, Play, ClipboardList, Trash2, X, ScanFace } from 'lucide-react';
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
  const [showAddStudents, setShowAddStudents] = useState(false);
  const [studentIds, setStudentIds] = useState('');
  const [addingStudents, setAddingStudents] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [startingFaceSession, setStartingFaceSession] = useState(false);

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

  const handleAddStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    const ids = studentIds.split(/[\n,\s]+/).filter((s) => s.trim());
    if (ids.length === 0) {
      toast.error('Please enter at least one student ID');
      return;
    }
    setAddingStudents(true);
    try {
      const { data } = await api.post(`/classes/${id}/students`, { studentIds: ids });
      const msg = [];
      if (data.added.length) msg.push(`Added: ${data.added.join(', ')}`);
      if (data.notFound.length) msg.push(`Not found: ${data.notFound.join(', ')}`);
      if (data.alreadyEnrolled.length) msg.push(`Already enrolled: ${data.alreadyEnrolled.join(', ')}`);
      toast.success(`Processed ${ids.length} IDs. ${data.added.length} added.`);
      if (data.notFound.length) toast.error(`Not found: ${data.notFound.join(', ')}`);
      setShowAddStudents(false);
      setStudentIds('');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add students');
    } finally {
      setAddingStudents(false);
    }
  };

  const handleRemoveStudent = async (studentId: number, name: string) => {
    if (!confirm(`Remove ${name} from class?`)) return;
    try {
      await api.delete(`/classes/${id}/students/${studentId}`);
      toast.success(`${name} removed`);
      fetchData();
    } catch {
      toast.error('Failed to remove student');
    }
  };

  const handleStartSession = async () => {
    setStartingSession(true);
    try {
      const { data } = await api.post('/attendance/sessions', { classId: parseInt(id!) });
      toast.success('Attendance session started!');
      navigate(`/teacher/attendance/${data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to start session');
    } finally {
      setStartingSession(false);
    }
  };

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
              <button
                onClick={() => setShowAddStudents(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <UserPlus size={16} /> Add Students
              </button>
              <Link
                to={`/teacher/classes/${id}/face-enroll`}
                className="btn-secondary flex items-center gap-2"
              >
                <ScanFace size={16} /> Manage Faces
              </Link>
              <button
                onClick={handleStartSession}
                disabled={startingSession}
                className="btn-primary flex items-center gap-2"
              >
                <Play size={16} />
                {startingSession ? 'Starting...' : 'Code Attendance'}
              </button>
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
                <button
                  onClick={() => setShowAddStudents(true)}
                  className="mt-3 btn-secondary text-sm"
                >
                  Add Students
                </button>
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
                    <button
                      onClick={() => handleRemoveStudent(student.id, student.fullName)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
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
                {sessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/teacher/attendance/${session.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Session #{session.id}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(session.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`badge text-xs ${
                        session.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'
                      }`}
                    >
                      {session.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Students Modal */}
      {showAddStudents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Add Students</h2>
              <button onClick={() => setShowAddStudents(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddStudents} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Student IDs
                </label>
                <textarea
                  className="input-field resize-none"
                  rows={5}
                  placeholder="Enter 8-digit student IDs, one per line or comma-separated&#10;e.g.&#10;22521000&#10;22521001, 22521002"
                  value={studentIds}
                  onChange={(e) => setStudentIds(e.target.value)}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Separate multiple IDs with commas, spaces, or newlines</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowAddStudents(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={addingStudents} className="btn-primary flex-1">
                  {addingStudents ? 'Adding...' : 'Add Students'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherClassDetail;
