import React, { useEffect, useState } from 'react';
import { Plus, Users, Trash2, X, UserPlus, GraduationCap } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';

interface Teacher {
  id: number;
  username: string;
  fullName: string;
}

interface ClassItem {
  id: number;
  name: string;
  description?: string;
  teacher: Teacher;
  _count: { students: number; sessions: number };
}

interface StudentClassItem {
  id: number;
  name: string;
  _count: { students: number };
}

const AdminClasses: React.FC = () => {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentClasses, setStudentClasses] = useState<StudentClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', teacherId: '' });
  const [creating, setCreating] = useState(false);

  // Add-by-class modal state
  const [addByClassModal, setAddByClassModal] = useState<ClassItem | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [addingByClass, setAddingByClass] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [classesRes, teachersRes, studentClassesRes] = await Promise.all([
        api.get<ClassItem[]>('/classes/all'),
        api.get<Teacher[]>('/admin/teachers'),
        api.get<StudentClassItem[]>('/admin/student-classes'),
      ]);
      setClasses(classesRes.data);
      setTeachers(teachersRes.data);
      setStudentClasses(studentClassesRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.teacherId) {
      toast.error('Please select a teacher');
      return;
    }
    setCreating(true);
    try {
      await api.post('/classes', {
        name: form.name,
        description: form.description,
        teacherId: parseInt(form.teacherId),
      });
      toast.success('Course created!');
      setShowModal(false);
      setForm({ name: '', description: '', teacherId: '' });
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete course "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/classes/${id}`);
      toast.success('Course deleted');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete');
    }
  };

  const handleAddByClass = async () => {
    if (!addByClassModal || !selectedClassId) return;
    setAddingByClass(true);
    try {
      const { data } = await api.post(`/classes/${addByClassModal.id}/students/by-class`, {
        studentClassId: parseInt(selectedClassId),
      });
      toast.success(data.message);
      setAddByClassModal(null);
      setSelectedClassId('');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add students');
    } finally {
      setAddingByClass(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Course Management</h1>
            <p className="text-gray-500 mt-1">Create and manage all courses</p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} />
            New Course
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : classes.length === 0 ? (
          <div className="card p-12 text-center">
            <Users size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No courses yet</h3>
            <p className="text-gray-400 mb-4">Create the first course to get started</p>
            <button onClick={() => setShowModal(true)} className="btn-primary">
              Create Course
            </button>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Course</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Teacher</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Students</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Sessions</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {classes.map((cls) => (
                  <tr key={cls.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 text-sm">{cls.name}</p>
                      {cls.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{cls.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                          {cls.teacher.fullName.charAt(0)}
                        </div>
                        <span className="text-sm text-gray-700">{cls.teacher.fullName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{cls._count.students}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{cls._count.sessions}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setAddByClassModal(cls); setSelectedClassId(''); }}
                          className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors"
                          title="Add students by class"
                        >
                          <UserPlus size={14} /> Add Class
                        </button>
                        <button
                          onClick={() => handleDelete(cls.id, cls.name)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete course"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Course Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Create New Course</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Course Name *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. NT208 - Network Security"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea
                  className="input-field resize-none"
                  rows={3}
                  placeholder="Optional description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Assign Teacher *</label>
                <select
                  className="input-field"
                  value={form.teacherId}
                  onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
                  required
                >
                  <option value="">Select a teacher</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName} ({t.username})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="btn-primary flex-1">
                  {creating ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Students by Class Modal */}
      {addByClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setAddByClassModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Add Students to Course</h2>
              <button onClick={() => setAddByClassModal(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-500">Course</p>
              <p className="font-medium text-gray-900">{addByClassModal.name}</p>
              <p className="text-xs text-gray-500 mt-1">Currently {addByClassModal._count.students} students enrolled</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Class</label>
                <select
                  className="input-field"
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                >
                  <option value="">Choose a class...</option>
                  {studentClasses.map(sc => (
                    <option key={sc.id} value={sc.id}>
                      {sc.name} ({sc._count.students} students)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1.5">
                  All students in the selected class will be added to this course. Already-enrolled students will be skipped.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setAddByClassModal(null)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button
                  onClick={handleAddByClass}
                  disabled={!selectedClassId || addingByClass}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <GraduationCap size={16} />
                  {addingByClass ? 'Adding...' : 'Add All Students'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AdminClasses;
