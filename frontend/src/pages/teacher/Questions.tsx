import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, ArrowLeft, Trash2, X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Question, Subject } from '../../types';

type QuestionType = 'MULTIPLE_CHOICE' | 'ESSAY' | 'TRUE_FALSE';

interface QuestionForm {
  type: QuestionType;
  content: string;
  answer: string;
  options: string[];
}

const EMPTY_FORM: QuestionForm = {
  type: 'MULTIPLE_CHOICE',
  content: '',
  answer: '',
  options: ['', '', '', ''],
};

const TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: '📋 Multiple Choice',
  ESSAY: '✍️ Essay',
  TRUE_FALSE: '✅ True / False',
};

const TeacherQuestions: React.FC = () => {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'ALL' | QuestionType>('ALL');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [qRes, sRes] = await Promise.all([
        api.get<Question[]>(`/questions/subject/${subjectId}`),
        api.get<Subject[]>('/subjects'),
      ]);
      setQuestions(qRes.data);
      const sub = sRes.data.find((s) => s.id === parseInt(subjectId!));
      if (sub) setSubject(sub);
    } catch {
      toast.error('Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [subjectId]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (q: Question) => {
    setEditingId(q.id);
    setForm({
      type: q.type,
      content: q.content,
      answer: q.answer,
      options: q.options ? JSON.parse(q.options) : ['', '', '', ''],
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const payload: any = {
      type: form.type,
      content: form.content,
      answer: form.answer,
      subjectId: parseInt(subjectId!),
    };

    if (form.type === 'MULTIPLE_CHOICE') {
      const opts = form.options.filter((o) => o.trim());
      if (opts.length < 2) {
        toast.error('Add at least 2 options for multiple choice');
        setSaving(false);
        return;
      }
      payload.options = opts;
    }

    try {
      if (editingId) {
        await api.put(`/questions/${editingId}`, payload);
        toast.success('Question updated');
      } else {
        await api.post('/questions', payload);
        toast.success('Question added');
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this question?')) return;
    try {
      await api.delete(`/questions/${id}`);
      toast.success('Deleted');
      fetchData();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const filtered = filter === 'ALL' ? questions : questions.filter((q) => q.type === filter);

  const counts = {
    ALL: questions.length,
    MULTIPLE_CHOICE: questions.filter((q) => q.type === 'MULTIPLE_CHOICE').length,
    ESSAY: questions.filter((q) => q.type === 'ESSAY').length,
    TRUE_FALSE: questions.filter((q) => q.type === 'TRUE_FALSE').length,
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <Link to="/teacher/subjects" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Subjects
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {subject?.name ?? 'Question Bank'}
              </h1>
              <p className="text-gray-500 mt-1">{questions.length} questions total</p>
            </div>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Add Question
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {(['ALL', 'MULTIPLE_CHOICE', 'ESSAY', 'TRUE_FALSE'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                filter === t
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
              }`}
            >
              {t === 'ALL' ? 'All' : TYPE_LABELS[t]} ({counts[t]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-400 mb-4">No questions yet. Add your first question!</p>
            <button onClick={openCreate} className="btn-primary">Add Question</button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((q, idx) => {
              const opts: string[] = q.options ? JSON.parse(q.options) : [];
              return (
                <div key={q.id} className="card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-gray-400 text-sm font-medium">#{idx + 1}</span>
                        <span className={`badge text-xs ${
                          q.type === 'MULTIPLE_CHOICE' ? 'badge-blue' :
                          q.type === 'ESSAY' ? 'badge-yellow' : 'badge-green'
                        }`}>
                          {TYPE_LABELS[q.type]}
                        </span>
                      </div>
                      <p className="text-gray-900 font-medium mb-2">{q.content}</p>
                      {opts.length > 0 && (
                        <div className="grid grid-cols-2 gap-1 mb-2">
                          {opts.map((opt, i) => (
                            <span key={i} className={`text-xs px-2 py-1 rounded ${
                              opt === q.answer ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {String.fromCharCode(65 + i)}. {opt}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded inline-block">
                        Answer: {q.answer}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(q)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(q.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Question Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit Question' : 'Add Question'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Question Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['MULTIPLE_CHOICE', 'ESSAY', 'TRUE_FALSE'] as QuestionType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...EMPTY_FORM, type: t })}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                        form.type === t
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Question *</label>
                <textarea
                  className="input-field resize-none"
                  rows={3}
                  placeholder="Enter the question..."
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                />
              </div>

              {/* Options (MC only) */}
              {form.type === 'MULTIPLE_CHOICE' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>
                  {form.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <span className="w-6 text-sm font-bold text-gray-500">{String.fromCharCode(65 + i)}.</span>
                      <input
                        type="text"
                        className="input-field"
                        placeholder={`Option ${String.fromCharCode(65 + i)}`}
                        value={opt}
                        onChange={(e) => {
                          const newOpts = [...form.options];
                          newOpts[i] = e.target.value;
                          setForm({ ...form, options: newOpts });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Answer */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Correct Answer *
                </label>
                {form.type === 'TRUE_FALSE' ? (
                  <div className="flex gap-3">
                    {['True', 'False'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, answer: v })}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                          form.answer === v
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white text-gray-600 border-gray-200'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    className="input-field"
                    placeholder={form.type === 'MULTIPLE_CHOICE' ? 'Enter the exact correct option text' : 'Enter the expected answer'}
                    value={form.answer}
                    onChange={(e) => setForm({ ...form, answer: e.target.value })}
                    required
                  />
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Add Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherQuestions;
