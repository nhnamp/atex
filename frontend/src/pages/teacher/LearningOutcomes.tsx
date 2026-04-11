import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import api from '../../api';
import { LearningOutcome, Subject } from '../../types';

const TeacherLearningOutcomes: React.FC = () => {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [outcomes, setOutcomes] = useState<LearningOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchData = async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const [subjectsRes, outcomesRes] = await Promise.all([
        api.get<Subject[]>('/subjects'),
        api.get<LearningOutcome[]>(`/subjects/${subjectId}/outcomes`),
      ]);
      setSubject(subjectsRes.data.find((item) => item.id === parseInt(subjectId, 10)) || null);
      setOutcomes(outcomesRes.data);
    } catch {
      toast.error('Failed to load learning outcomes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [subjectId]);

  const resetForm = () => {
    setCode('');
    setDescription('');
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId) return;

    try {
      if (editingId) {
        await api.put(`/subjects/${subjectId}/outcomes/${editingId}`, { code, description });
        toast.success('Learning outcome updated');
      } else {
        await api.post(`/subjects/${subjectId}/outcomes`, { code, description });
        toast.success('Learning outcome created');
      }
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save learning outcome');
    }
  };

  const startEdit = (item: LearningOutcome) => {
    setEditingId(item.id);
    setCode(item.code);
    setDescription(item.description);
  };

  const remove = async (id: number) => {
    if (!subjectId) return;
    if (!confirm('Delete this learning outcome?')) return;

    try {
      await api.delete(`/subjects/${subjectId}/outcomes/${id}`);
      toast.success('Learning outcome deleted');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete learning outcome');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <Link to="/teacher/subjects" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Subjects
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Learning Outcomes</h1>
          <p className="text-gray-500 mt-1">{subject?.name || 'Subject'} • Manage outcome codes and mapping stats</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <div className="card p-5 lg:col-span-1">
            <h2 className="font-semibold text-gray-900 mb-3">{editingId ? 'Edit Outcome' : 'New Outcome'}</h2>
            <form className="space-y-3" onSubmit={submit}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                <input
                  className="input-field"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CLO1"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="input-field resize-none"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe this outcome"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1">
                  <Plus size={15} className="inline mr-1" /> {editingId ? 'Update' : 'Create'}
                </button>
                {editingId && (
                  <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
                )}
              </div>
            </form>
          </div>

          <div className="card p-5 lg:col-span-2">
            <h2 className="font-semibold text-gray-900 mb-3">Outcome List</h2>
            {loading ? (
              <p className="text-sm text-gray-500">Loading outcomes...</p>
            ) : outcomes.length === 0 ? (
              <p className="text-sm text-gray-500">No outcomes yet.</p>
            ) : (
              <div className="space-y-2">
                {outcomes.map((item) => (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-primary-700">{item.code}</p>
                      <p className="text-sm text-gray-700 mt-1">{item.description}</p>
                      <p className="text-xs text-gray-500 mt-1">Questions mapped: {item._count?.questions ?? 0}</p>
                    </div>
                    <div className="flex gap-1">
                      <button className="p-2 rounded-lg hover:bg-primary-50 text-gray-500 hover:text-primary-700" onClick={() => startEdit(item)}>
                        <Pencil size={15} />
                      </button>
                      <button className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600" onClick={() => remove(item.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default TeacherLearningOutcomes;
