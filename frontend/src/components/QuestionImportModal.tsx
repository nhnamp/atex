import React, { useState } from 'react';
import { X, Download, Upload, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api';
import { LearningOutcome } from '../types';

type QuestionType = 'MULTIPLE_CHOICE' | 'ESSAY';

interface ParsedQuestion {
  id: string;
  type: QuestionType;
  content: string;
  answer: string;
  options?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  learningOutcomeCode?: string;
}

interface PreviewError {
  row: number;
  message: string;
}

interface EditingQuestion extends ParsedQuestion {}

interface QuestionImportModalProps {
  subjectId: number;
  outcomes: LearningOutcome[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple Choice',
  ESSAY: 'Essay',
};

const QuestionImportModal: React.FC<QuestionImportModalProps> = ({
  subjectId,
  outcomes,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [state, setState] = useState<'upload' | 'preview' | 'confirm'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [questions, setQuestions] = useState<ParsedQuestion[]>([]);
  const [errors, setErrors] = useState<PreviewError[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditingQuestion | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isOpen) return null;

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/questions/template', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'question-import-template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentElement?.removeChild(link);
      toast.success('Template downloaded');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to download template');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(
        `/questions/subject/${subjectId}/preview-excel`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setQuestions(data.questions);
      setErrors(data.errors);
      setState('preview');
      toast.success(`Parsed ${data.successCount} question(s)`);
      if (data.errorCount > 0) {
        toast.error(`${data.errorCount} validation error(s)`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to parse file');
    } finally {
      setUploading(false);
    }
  };

  const handleEditQuestion = (q: ParsedQuestion) => {
    setEditingId(q.id);
    setEditForm({
      ...q,
    });
  };

  const handleSaveEdit = () => {
    if (!editForm) return;

    setQuestions(
      questions.map((q) => (q.id === editingId ? editForm : q))
    );
    setEditingId(null);
    setEditForm(null);
    toast.success('Question updated');
  };

  const handleDeleteQuestion = (id: string) => {
    setQuestions(questions.filter((q) => q.id !== id));
    toast.success('Question removed from preview');
  };

  const handleConfirmImport = async () => {
    if (questions.length === 0) {
      toast.error('No questions to import');
      return;
    }

    setImporting(true);
    try {
      const { data } = await api.post(`/questions/subject/${subjectId}/import-excel`, {
        questions,
      });
      toast.success(`✅ Imported ${data.imported} question(s)`);
      if (data.failed > 0) {
        toast.error(`Failed to import ${data.failed} question(s)`);
      }
      setState('upload');
      setFile(null);
      setQuestions([]);
      setErrors([]);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to import questions');
    } finally {
      setImporting(false);
    }
  };

  const handleCancel = () => {
    setState('upload');
    setFile(null);
    setQuestions([]);
    setErrors([]);
    setEditingId(null);
    setEditForm(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {state === 'upload' && 'Import Questions'}
            {state === 'preview' && 'Preview Questions'}
            {state === 'confirm' && 'Confirm Import'}
          </h2>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Upload State */}
        {state === 'upload' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-700">
                📋 Download the template below, fill it with your questions, then upload the file
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownloadTemplate}
                className="btn-secondary flex items-center gap-2"
              >
                <Download size={16} /> Download Template
              </button>
            </div>

            <div className="border-t pt-4">
              <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
                <Upload size={18} className="text-gray-400" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Choose Excel file (.xlsx or .xls)'}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </label>

              {file && (
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="btn-primary flex items-center gap-2 flex-1"
                  >
                    {uploading ? 'Parsing...' : 'Parse & Preview'}
                  </button>
                  <button
                    onClick={() => setFile(null)}
                    className="btn-secondary flex-1"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preview State */}
        {state === 'preview' && (
          <div className="space-y-4">
            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800 mb-2">
                  ⚠️ {errors.length} validation error(s):
                </p>
                <div className="space-y-1 max-h-[150px] overflow-y-auto">
                  {errors.map((err, idx) => (
                    <p key={idx} className="text-xs text-red-700">
                      • Row {err.row}: {err.message}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700 font-medium">
                ✓ {questions.length} question(s) ready to import
              </p>
            </div>

            {/* Questions Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Content</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Answer</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Difficulty</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q, idx) => (
                    <tr key={q.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-700">
                          {TYPE_LABELS[q.type]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        <p className="truncate max-w-xs">{q.content}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        <p className="truncate max-w-xs">{q.answer}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{q.difficulty}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => handleEditQuestion(q)}
                            className="p-1.5 rounded hover:bg-primary-100 text-gray-400 hover:text-primary-600 transition"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <button
                onClick={() => setState('upload')}
                className="btn-secondary flex-1"
              >
                Back
              </button>
              <button
                onClick={() => setState('confirm')}
                disabled={questions.length === 0}
                className="btn-primary flex-1"
              >
                Proceed to Import
              </button>
            </div>
          </div>
        )}

        {/* Confirm State */}
        {state === 'confirm' && (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
              <p className="text-2xl font-bold text-gray-900 mb-2">{questions.length}</p>
              <p className="text-gray-700 mb-4">
                question(s) ready to be imported into the question bank
              </p>
              <p className="text-sm text-gray-600">
                Click "Confirm Import" to add these questions to the database
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setState('preview')}
                className="btn-secondary flex-1"
              >
                Back
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="btn-primary flex-1"
              >
                {importing ? 'Importing...' : 'Confirm Import'}
              </button>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingId && editForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-gray-900">Edit Question</h3>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditForm(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Question Type
                  </label>
                  <select
                    className="input-field"
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        type: e.target.value as QuestionType,
                      })
                    }
                    disabled
                  >
                    <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                    <option value="ESSAY">Essay</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Question type cannot be changed after upload
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Question Content *
                  </label>
                  <textarea
                    className="input-field resize-none"
                    rows={3}
                    value={editForm.content}
                    onChange={(e) =>
                      setEditForm({ ...editForm, content: e.target.value })
                    }
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Difficulty
                  </label>
                  <select
                    className="input-field"
                    value={editForm.difficulty}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD',
                      })
                    }
                  >
                    <option value="EASY">EASY</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HARD">HARD</option>
                  </select>
                </div>

                {editForm.type === 'MULTIPLE_CHOICE' && editForm.options && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Options (exactly 4)
                    </label>
                    {editForm.options.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-2">
                        <span className="w-6 text-sm font-bold text-gray-500">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <input
                          className="input-field"
                          value={item}
                          onChange={(e) => {
                            const newOptions = [...editForm.options!];
                            newOptions[idx] = e.target.value;
                            setEditForm({
                              ...editForm,
                              options: newOptions,
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Correct Answer *
                  </label>
                  <input
                    className="input-field"
                    value={editForm.answer}
                    onChange={(e) =>
                      setEditForm({ ...editForm, answer: e.target.value })
                    }
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Learning Outcome Code (optional)
                  </label>
                  <input
                    className="input-field"
                    value={editForm.learningOutcomeCode || ''}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        learningOutcomeCode: e.target.value,
                      })
                    }
                    placeholder="e.g., LO001"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    onClick={() => {
                      setEditingId(null);
                      setEditForm(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    onClick={handleSaveEdit}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionImportModal;
