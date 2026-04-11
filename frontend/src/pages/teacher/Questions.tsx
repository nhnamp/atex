import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, ArrowLeft, Trash2, X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { LearningOutcome, Question, Subject } from '../../types';

type QuestionType = 'MULTIPLE_CHOICE' | 'ESSAY';

interface QuestionForm {
  type: QuestionType;
  content: string;
  answer: string;
  options: string[];
  status: 'ACTIVE' | 'ARCHIVED';
  topic: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  learningOutcomeId: string;
  rubric: string;
}

const EMPTY_FORM: QuestionForm = {
  type: 'MULTIPLE_CHOICE',
  content: '',
  answer: '',
  options: ['', '', '', ''],
  status: 'ACTIVE',
  topic: '',
  difficulty: 'MEDIUM',
  learningOutcomeId: '',
  rubric: '',
};

const TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple Choice',
  ESSAY: 'Essay',
};

const TeacherQuestions: React.FC = () => {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [outcomes, setOutcomes] = useState<LearningOutcome[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | QuestionType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [importing, setImporting] = useState(false);

  const fetchData = async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const [qRes, sRes, oRes] = await Promise.all([
        api.get<Question[]>(`/questions/subject/${subjectId}`),
        api.get<Subject[]>('/subjects'),
        api.get<LearningOutcome[]>(`/subjects/${subjectId}/outcomes`),
      ]);
      setQuestions(qRes.data);
      setOutcomes(oRes.data);
      setSubject(sRes.data.find((s) => s.id === parseInt(subjectId, 10)) || null);
    } catch {
      toast.error('Failed to load question bank');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [subjectId]);

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
      status: q.status || 'ACTIVE',
      topic: q.topic || '',
      difficulty: q.difficulty || 'MEDIUM',
      learningOutcomeId: q.learningOutcomeId ? String(q.learningOutcomeId) : '',
      rubric: q.rubric || '',
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId) return;
    setSaving(true);

    const payload: any = {
      type: form.type,
      content: form.content,
      answer: form.answer,
      subjectId: parseInt(subjectId, 10),
      status: form.status,
      topic: form.topic,
      difficulty: form.difficulty,
      learningOutcomeId: form.learningOutcomeId ? parseInt(form.learningOutcomeId, 10) : null,
      rubric: form.rubric,
    };

    if (form.type === 'MULTIPLE_CHOICE') {
      const opts = form.options.map((item) => item.trim()).filter(Boolean);
      if (opts.length < 2) {
        toast.error('Multiple choice needs at least 2 options');
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
      toast.error(err?.response?.data?.error || 'Failed to save question');
    } finally {
      setSaving(false);
    }
  };

  const archiveQuestion = async (id: number) => {
    if (!confirm('Archive this question?')) return;
    try {
      await api.delete(`/questions/${id}`);
      toast.success('Question archived');
      fetchData();
    } catch {
      toast.error('Failed to archive question');
    }
  };

  const importExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!subjectId) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/questions/subject/${subjectId}/import-excel`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`Imported ${data.inserted} question(s)`);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        toast.error(`${data.errors.length} row(s) failed validation`);
      }
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to import Excel');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const filtered = questions.filter((q) => {
    if (typeFilter !== 'ALL' && q.type !== typeFilter) return false;
    if (statusFilter !== 'ALL' && (q.status || 'ACTIVE') !== statusFilter) return false;
    return true;
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <Link to="/teacher/subjects" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Subjects
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{subject?.name ?? 'Question Bank'}</h1>
              <p className="text-gray-500 mt-1">{questions.length} total questions</p>
            </div>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Add Question
            </button>
            <label className="btn-secondary flex items-center gap-2 cursor-pointer">
              {importing ? 'Importing...' : 'Import Excel'}
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing} onChange={importExcel} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['ALL', 'MULTIPLE_CHOICE', 'ESSAY'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setTypeFilter(item)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                typeFilter === item ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {item === 'ALL' ? 'All Types' : TYPE_LABELS[item]}
            </button>
          ))}
          {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setStatusFilter(item)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                statusFilter === item ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-500">No questions found</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((q, idx) => {
              const options: string[] = q.options ? JSON.parse(q.options) : [];
              return (
                <div key={q.id} className="card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-xs text-gray-400">#{idx + 1}</span>
                        <span className="badge badge-blue">{TYPE_LABELS[q.type]}</span>
                        <span className="badge badge-gray">Difficulty {q.difficulty || 'MEDIUM'}</span>
                        {q.topic && <span className="badge badge-yellow">{q.topic}</span>}
                        {q.learningOutcome?.code && <span className="badge badge-green">{q.learningOutcome.code}</span>}
                        <span className={`badge ${q.status === 'ARCHIVED' ? 'badge-red' : 'badge-green'}`}>{q.status || 'ACTIVE'}</span>
                      </div>

                      <p className="text-gray-900 font-medium mb-2">{q.content}</p>
                      {options.length > 0 && (
                        <div className="grid sm:grid-cols-2 gap-1 mb-2">
                          {options.map((item, i) => (
                            <span key={i} className={`text-xs px-2 py-1 rounded ${item === q.answer ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-700'}`}>
                              {String.fromCharCode(65 + i)}. {item}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded inline-block">Answer: {q.answer}</p>
                    </div>

                    <div className="flex gap-1">
                      <button className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50" onClick={() => openEdit(q)}>
                        <Pencil size={15} />
                      </button>
                      <button className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" onClick={() => archiveQuestion(q.id)}>
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit Question' : 'Add Question'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Question Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['MULTIPLE_CHOICE', 'ESSAY'] as QuestionType[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setForm({ ...form, type: item })}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border ${
                        form.type === item ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {TYPE_LABELS[item]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Question *</label>
                <textarea className="input-field resize-none" rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Difficulty</label>
                  <select
                    className="input-field"
                    value={form.difficulty}
                    onChange={(e) => setForm({ ...form, difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD' })}
                  >
                    <option value="EASY">EASY</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HARD">HARD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                  <select className="input-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'ARCHIVED' })}>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Topic</label>
                <input className="input-field" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Topic label" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Learning Outcome</label>
                <select className="input-field" value={form.learningOutcomeId} onChange={(e) => setForm({ ...form, learningOutcomeId: e.target.value })}>
                  <option value="">Not mapped</option>
                  {outcomes.map((item) => (
                    <option key={item.id} value={item.id}>{item.code} - {item.description}</option>
                  ))}
                </select>
              </div>

              {form.type === 'MULTIPLE_CHOICE' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Options (exactly 4)</label>
                  {form.options.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-2">
                      <span className="w-6 text-sm font-bold text-gray-500">{String.fromCharCode(65 + idx)}.</span>
                      <input
                        className="input-field"
                        value={item}
                        onChange={(e) => {
                          const next = [...form.options];
                          next[idx] = e.target.value;
                          setForm({ ...form, options: next });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Correct Answer *</label>
                <input className="input-field" value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} required />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Rubric (Essay grading)</label>
                <textarea className="input-field resize-none" rows={3} value={form.rubric} onChange={(e) => setForm({ ...form, rubric: e.target.value })} placeholder="Criteria for essay grading" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : editingId ? 'Update' : 'Add Question'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default TeacherQuestions;
