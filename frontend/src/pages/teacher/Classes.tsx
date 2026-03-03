import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, ChevronRight, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class } from '../../types';

const TeacherClasses: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Class[]>('/classes');
      setClasses(data);
    } catch {
      toast.error('Failed to load classes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClasses(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/classes', form);
      toast.success('Class created!');
      setShowModal(false);
      setForm({ name: '', description: '' });
      fetchClasses();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create class');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete class "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/classes/${id}`);
      toast.success('Class deleted');
      fetchClasses();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Classes</h1>
            <p className="text-gray-500 mt-1">Manage your classes and students</p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} />
            New Class
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : classes.length === 0 ? (
          <div className="card p-12 text-center">
            <Users size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No classes yet</h3>
            <p className="text-gray-400 mb-4">Create your first class to get started</p>
            <button onClick={() => setShowModal(true)} className="btn-primary">
              Create Class
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <div key={cls.id} className="card p-5 hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Users size={20} className="text-primary-600" />
                  </div>
                  <button
                    onClick={() => handleDelete(cls.id, cls.name)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{cls.name}</h3>
                {cls.description && (
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{cls.description}</p>
                )}
                <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                  <span>{cls._count?.students ?? 0} students</span>
                  <span>{cls._count?.sessions ?? 0} sessions</span>
                </div>
                <Link
                  to={`/teacher/classes/${cls.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Open Class <ChevronRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Class Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Create New Class</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Class Name *</label>
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
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="btn-primary flex-1">
                  {creating ? 'Creating...' : 'Create Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherClasses;
