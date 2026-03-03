import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, BookOpen, ChevronRight, Trash2, X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Subject } from '../../types';

const TeacherSubjects: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSubjects = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Subject[]>('/subjects');
      setSubjects(data);
    } catch {
      toast.error('Failed to load subjects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubjects(); }, []);

  const openCreate = () => { setEditing(null); setName(''); setShowModal(true); };
  const openEdit = (s: Subject) => { setEditing(s); setName(s.name); setShowModal(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/subjects/${editing.id}`, { name });
        toast.success('Subject updated');
      } else {
        await api.post('/subjects', { name });
        toast.success('Subject created');
      }
      setShowModal(false);
      fetchSubjects();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, subjectName: string) => {
    if (!confirm(`Delete subject "${subjectName}" and all its questions?`)) return;
    try {
      await api.delete(`/subjects/${id}`);
      toast.success('Subject deleted');
      fetchSubjects();
    } catch {
      toast.error('Failed to delete subject');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Subjects & Question Bank</h1>
            <p className="text-gray-500 mt-1">Manage your subjects and exam questions</p>
          </div>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> New Subject
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : subjects.length === 0 ? (
          <div className="card p-12 text-center">
            <BookOpen size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No subjects yet</h3>
            <p className="text-gray-400 mb-4">Create subjects to manage question banks</p>
            <button onClick={openCreate} className="btn-primary">Create Subject</button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map((subject) => (
              <div key={subject.id} className="card p-5 hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <BookOpen size={20} className="text-purple-600" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(subject)} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => handleDelete(subject.id, subject.name)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{subject.name}</h3>
                <p className="text-sm text-gray-500 mb-4">
                  {subject._count?.questions ?? 0} questions
                </p>
                <Link
                  to={`/teacher/subjects/${subject.id}/questions`}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Manage Questions <ChevronRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing ? 'Edit Subject' : 'Create Subject'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject Name *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Network Security Fundamentals"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherSubjects;
