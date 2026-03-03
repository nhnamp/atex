import React, { useEffect, useState } from 'react';
import { FileText, Sparkles, Download, BookOpen, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import api from '../../api';
import { Subject, ExamRequirements } from '../../types';

const TeacherExamGenerator: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [requirements, setRequirements] = useState<ExamRequirements>({
    total: 10,
    multipleChoice: 5,
    essay: 3,
    trueFalse: 2,
  });
  const [generating, setGenerating] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  useEffect(() => {
    const fetchSubjects = async () => {
      try {
        const { data } = await api.get<Subject[]>('/subjects');
        setSubjects(data);
      } catch {
        toast.error('Failed to load subjects');
      } finally {
        setLoadingSubjects(false);
      }
    };
    fetchSubjects();
  }, []);

  const validateRequirements = () => {
    const sum = requirements.multipleChoice + requirements.essay + requirements.trueFalse;
    if (sum !== requirements.total) {
      toast.error(`Question types sum (${sum}) must equal total (${requirements.total})`);
      return false;
    }
    if (!selectedSubjectId) {
      toast.error('Please select a subject');
      return false;
    }
    if (requirements.total <= 0) {
      toast.error('Total questions must be greater than 0');
      return false;
    }
    return true;
  };

  const handleGenerate = async () => {
    if (!validateRequirements()) return;
    setGenerating(true);

    const selectedSubject = subjects.find((s) => s.id === parseInt(selectedSubjectId));
    const title = examTitle || `${selectedSubject?.name} - Exam`;

    try {
      const response = await api.post(
        '/exams/generate',
        {
          subjectId: parseInt(selectedSubjectId),
          examTitle: title,
          requirements,
        },
        { responseType: 'blob' }
      );

      // Download file
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `exam_${selectedSubject?.name?.replace(/\s+/g, '_')}_${Date.now()}.docx`;
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('Exam generated and downloaded!');
    } catch (err: any) {
      if (err?.response?.data instanceof Blob) {
        const text = await err.response.data.text();
        try {
          const parsed = JSON.parse(text);
          toast.error(parsed.error || 'Failed to generate exam');
        } catch {
          toast.error('Failed to generate exam');
        }
      } else {
        toast.error(err?.response?.data?.error || 'Failed to generate exam');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleReqChange = (field: keyof ExamRequirements, value: number) => {
    const newReq = { ...requirements, [field]: value };
    if (field !== 'total') {
      newReq.total = newReq.multipleChoice + newReq.essay + newReq.trueFalse;
    }
    setRequirements(newReq);
  };

  const sum = requirements.multipleChoice + requirements.essay + requirements.trueFalse;
  const isValid = sum === requirements.total && requirements.total > 0 && !!selectedSubjectId;

  const selectedSubjectData = subjects.find((s) => s.id === parseInt(selectedSubjectId));
  const totalQuestions = selectedSubjectData?._count?.questions ?? 0;

  return (
    <Layout>
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Exam Generator</h1>
            <p className="text-gray-500 mt-0.5">Generate exams from your question bank using AI</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-5">
          <h3 className="font-semibold text-primary-800 mb-2 flex items-center gap-2">
            <Sparkles size={16} /> How it works
          </h3>
          <ol className="text-sm text-primary-700 space-y-1 list-decimal list-inside">
            <li>Select a subject with questions in the bank</li>
            <li>Specify how many questions of each type you need</li>
            <li>AI (Gemini) intelligently selects diverse questions</li>
            <li>Download the exam as a formatted Word (.docx) file</li>
          </ol>
        </div>

        <div className="card p-6 space-y-6">
          {/* Subject Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Subject *
            </label>
            {loadingSubjects ? (
              <div className="input-field bg-gray-50 animate-pulse h-10" />
            ) : (
              <select
                className="input-field"
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
              >
                <option value="">-- Select a subject --</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s._count?.questions ?? 0} questions)
                  </option>
                ))}
              </select>
            )}
            {selectedSubjectId && totalQuestions < requirements.total && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                <AlertCircle size={12} />
                Only {totalQuestions} questions available (need {requirements.total})
              </p>
            )}
          </div>

          {/* Exam Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Exam Title (optional)
            </label>
            <input
              type="text"
              className="input-field"
              placeholder={selectedSubjectData ? `${selectedSubjectData.name} - Exam` : 'Exam title...'}
              value={examTitle}
              onChange={(e) => setExamTitle(e.target.value)}
            />
          </div>

          {/* Requirements */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Question Requirements</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: '📋 Multiple Choice', field: 'multipleChoice' as const, color: 'text-blue-600' },
                { label: '✍️ Essay', field: 'essay' as const, color: 'text-orange-600' },
                { label: '✅ True / False', field: 'trueFalse' as const, color: 'text-green-600' },
              ].map(({ label, field, color }) => (
                <div key={field}>
                  <label className={`block text-xs font-medium mb-1 ${color}`}>{label}</label>
                  <input
                    type="number"
                    min={0}
                    className="input-field"
                    value={requirements[field]}
                    onChange={(e) => handleReqChange(field, parseInt(e.target.value) || 0)}
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Total Questions</label>
                <div className={`input-field font-bold text-lg text-center ${
                  sum !== requirements.total ? 'bg-red-50 border-red-300 text-red-600' : 'bg-gray-50 text-gray-900'
                }`}>
                  {requirements.total}
                </div>
              </div>
            </div>

            {sum !== requirements.total && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
                <AlertCircle size={12} />
                Question types sum ({sum}) doesn't match total ({requirements.total})
              </p>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !isValid || totalQuestions < requirements.total}
            className="btn-primary w-full py-3 text-base flex items-center justify-center gap-3"
          >
            {generating ? (
              <>
                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                Generating with AI...
              </>
            ) : (
              <>
                <Download size={20} />
                Generate & Download Exam
              </>
            )}
          </button>

          {generating && (
            <p className="text-center text-sm text-gray-500">
              🤖 AI is selecting the best questions for your exam... This may take a moment.
            </p>
          )}
        </div>

        {/* No subjects */}
        {!loadingSubjects && subjects.length === 0 && (
          <div className="card p-8 text-center border-dashed border-2 border-gray-200">
            <BookOpen size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium mb-1">No subjects found</p>
            <p className="text-sm text-gray-400 mb-4">
              Create subjects and add questions before generating exams
            </p>
            <a href="/teacher/subjects" className="btn-primary text-sm">
              Go to Subjects
            </a>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TeacherExamGenerator;
