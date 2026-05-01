import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Download, BookOpen, AlertCircle, Eye, GripVertical, X, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import api from '../../api';
import { BuiltExam, Class, ExamRequirements, ExamSession, LearningOutcome, Question, Subject } from '../../types';

const TeacherExamGenerator: React.FC = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [exams, setExams] = useState<BuiltExam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [subjectOutcomes, setSubjectOutcomes] = useState<LearningOutcome[]>([]);
  const [outcomeRatios, setOutcomeRatios] = useState<Record<number, number>>({});
  const [examTitle, setExamTitle] = useState('');
  const [examType, setExamType] = useState('MIXED');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [requirements, setRequirements] = useState<ExamRequirements>({
    total: 10,
    multipleChoice: 5,
    essay: 5,
    difficultyDistribution: {
      multipleChoice: { easy: 50, medium: 35, hard: 15 },
      essay: { easy: 50, medium: 35, hard: 15 },
    },
  });
  const [sectionPoints, setSectionPoints] = useState<{ multipleChoice: number; essay: number }>({ multipleChoice: 7, essay: 3 });
  const [generating, setGenerating] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [draggedQuestionId, setDraggedQuestionId] = useState<number | null>(null);
  const [dragOverQuestionId, setDragOverQuestionId] = useState<number | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<{ examQuestionId: number; question: Question } | null>(null);
  const [activeTab, setActiveTab] = useState<'EDIT' | 'REPLACE'>('EDIT');
  const [questionForm, setQuestionForm] = useState({
    content: '',
    answer: '',
    difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
    status: 'ACTIVE' as 'ACTIVE' | 'ARCHIVED',
    rubric: '',
    learningOutcomeId: '',
    options: ['', '', '', ''],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [replacementDifficulty, setReplacementDifficulty] = useState<'ALL' | 'EASY' | 'MEDIUM' | 'HARD'>('ALL');
  const [replacementOutcomeId, setReplacementOutcomeId] = useState('');
  const [replacementResults, setReplacementResults] = useState<Question[]>([]);
  const [selectedReplacementId, setSelectedReplacementId] = useState<number | null>(null);
  const [loadingReplacement, setLoadingReplacement] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [subjectRes, classRes, examRes] = await Promise.all([
          api.get<Subject[]>('/subjects'),
          api.get<Class[]>('/classes'),
          api.get<BuiltExam[]>('/exams/builder'),
        ]);
        const latestDrafts = examRes.data.filter((item) => item.status === 'DRAFT').slice(0, 1);
        setSubjects(subjectRes.data);
        setClasses(classRes.data);
        setExams(latestDrafts);
        if (latestDrafts.length > 0) {
          setSelectedExamId(latestDrafts[0].id);
        }
        if (subjectRes.data.length > 0) {
          setSelectedSubjectId(String(subjectRes.data[0].id));
        }
      } catch {
        toast.error('Failed to load exam data');
      } finally {
        setLoadingSubjects(false);
      }
    };
    fetchData();
  }, []);

  const selectedExam = useMemo(
    () => exams.find((item) => item.id === selectedExamId) || null,
    [exams, selectedExamId]
  );

  useEffect(() => {
    const fetchOutcomes = async () => {
      if (!selectedSubjectId) {
        setSubjectOutcomes([]);
        setOutcomeRatios({});
        return;
      }
      try {
        const { data } = await api.get<LearningOutcome[]>(`/subjects/${selectedSubjectId}/outcomes`);
        setSubjectOutcomes(data);
      } catch {
        setSubjectOutcomes([]);
      }
    };
    fetchOutcomes();
  }, [selectedSubjectId]);

  useEffect(() => {
    if (!selectedSubjectId) return;
    const selected = subjects.find((item) => item.id === parseInt(selectedSubjectId, 10));
    if (!selected) return;

    if (!examTitle.trim()) {
      const today = new Date();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setExamTitle(`${selected.name} - ${examType === 'FULL_ESSAY' ? 'Essay' : 'Mixed'} - ${today.getFullYear()}${mm}${dd}`);
    }
  }, [selectedSubjectId, subjects, examTitle, examType]);

  const loadExamDetail = async (examId: number) => {
    try {
      const { data } = await api.get<BuiltExam>(`/exams/builder/${examId}`);
      setExams((prev) => prev.map((item) => (item.id === examId ? data : item)));
      setSelectedExamId(examId);
    } catch {
      toast.error('Failed to load exam details');
    }
  };

  const validateRequirements = () => {
    const sum = requirements.multipleChoice + requirements.essay;
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

    const mcqDist = requirements.difficultyDistribution?.multipleChoice;
    const essayDist = requirements.difficultyDistribution?.essay;
    const mcqSum = (mcqDist?.easy || 0) + (mcqDist?.medium || 0) + (mcqDist?.hard || 0);
    const essaySum = (essayDist?.easy || 0) + (essayDist?.medium || 0) + (essayDist?.hard || 0);

    if (requirements.multipleChoice > 0 && mcqSum !== 100) {
      toast.error('Difficulty ratio for MCQ must total 100% when MCQ > 0');
      return false;
    }

    if (requirements.essay > 0 && essaySum !== 100) {
      toast.error('Difficulty ratio for Essay must total 100% when Essay > 0');
      return false;
    }

    if (subjectOutcomes.length > 0) {
      const ratioEntries = Object.entries(outcomeRatios)
        .map(([id, ratio]) => ({ learningOutcomeId: Number(id), ratio: Number(ratio) || 0 }))
        .filter((item) => item.ratio > 0);

      if (ratioEntries.length > 0) {
        const ratioSum = ratioEntries.reduce((acc, item) => acc + item.ratio, 0);
        if (ratioSum !== 100) {
          toast.error('Outcome ratio must sum to 100% (or leave empty to auto split evenly)');
          return false;
        }
      }
    }

    return true;
  };

  const setBalancedRatio = () => {
    setRequirements((prev) => ({
      ...prev,
      difficultyDistribution: {
        multipleChoice: { easy: 50, medium: 35, hard: 15 },
        essay: { easy: 50, medium: 35, hard: 15 },
      },
    }));
    toast.success('Applied balanced ratio: 50% / 35% / 15%');
  };

  const handleGenerate = async () => {
    if (!validateRequirements()) return;
    setGenerating(true);

    try {
      const ratioPayload = Object.entries(outcomeRatios)
        .map(([learningOutcomeId, ratio]) => ({
          learningOutcomeId: Number(learningOutcomeId),
          ratio: Number(ratio) || 0,
        }))
        .filter((item) => item.ratio > 0);

      const { data } = await api.post<BuiltExam>('/exams/builder', {
        subjectId: parseInt(selectedSubjectId, 10),
        title: examTitle.trim() || `${selectedSubjectData?.name || 'Exam'} Draft`,
        examType,
        durationMinutes,
        requirements: {
          ...requirements,
          sectionPoints: sectionPoints,
          examFormat: examType === 'FULL_ESSAY' ? 'MIXED' : 'FULL_OBJECTIVE',
          outcomeRatios: ratioPayload,
        },
      });
      setExams([data]);
      setSelectedExamId(data.id);
      toast.success('Exam draft created');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create exam draft');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async (examId: number) => {
    try {
      const response = await api.get(`/exams/builder/${examId}/export`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `exam_${examId}.docx`;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Exam exported (.docx template)');
    } catch {
      toast.error('Failed to export exam');
    }
  };

  const handleExportAnswerKey = async (examId: number) => {
    try {
      const response = await api.get(`/exams/builder/${examId}/export-answer-key`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `answer_key_${examId}.docx`;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Answer key exported (.docx template)');
    } catch {
      toast.error('Failed to export answer key');
    }
  };

  const handleCreateSession = async () => {
    if (!selectedExamId || !selectedClassId) {
      toast.error('Select exam and class first');
      return;
    }
    setCreatingSession(true);
    try {
      const { data } = await api.post<ExamSession>(`/exams/builder/${selectedExamId}/sessions`, {
        classId: parseInt(selectedClassId, 10),
      });
      await api.patch(`/exams/sessions/${data.id}/status`, { status: 'ONGOING' });
      toast.success('Session started');
      await loadExamDetail(selectedExamId);
      navigate(`/teacher/exam-sessions?sessionId=${data.id}&tab=AI_GRADING`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  };

  const moveQuestion = async (index: number, direction: 'up' | 'down') => {
    if (!selectedExam?.questions) return;
    const next = [...selectedExam.questions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

    try {
      await api.patch(`/exams/builder/${selectedExam.id}/reorder`, {
        orderedQuestionIds: next.map((item) => item.question.id),
      });
      await loadExamDetail(selectedExam.id);
      toast.success('Exam structure updated');
    } catch {
      toast.error('Failed to reorder questions');
    }
  };

  const reorderQuestions = async (nextQuestionIds: number[]) => {
    if (!selectedExam?.questions) return;
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/reorder`, {
        orderedQuestionIds: nextQuestionIds,
      });
      await loadExamDetail(selectedExam.id);
      toast.success('Exam structure updated');
    } catch {
      toast.error('Failed to reorder questions');
    }
  };

  const handleDragStart = (questionId: number) => {
    setDraggedQuestionId(questionId);
  };

  const handleDragEnd = () => {
    setDraggedQuestionId(null);
    setDragOverQuestionId(null);
  };

  const reorderWithinSection = async (sectionType: 'MULTIPLE_CHOICE' | 'ESSAY', nextSectionQuestions: number[]) => {
    if (!selectedExam?.questions) return;

    const otherQuestions = selectedExam.questions
      .filter((item) => item.question.type !== sectionType)
      .map((item) => item.question.id);

    const nextOrder = sectionType === 'MULTIPLE_CHOICE'
      ? [...nextSectionQuestions, ...otherQuestions]
      : [...otherQuestions, ...nextSectionQuestions];

    await reorderQuestions(nextOrder);
  };

  const handleDropOnQuestion = async (sectionType: 'MULTIPLE_CHOICE' | 'ESSAY', targetQuestionId: number) => {
    if (!selectedExam?.questions || draggedQuestionId === null || draggedQuestionId === targetQuestionId) return;

    const sectionItems = selectedExam.questions.filter((item) => item.question.type === sectionType);
    const draggedItem = sectionItems.find((item) => item.question.id === draggedQuestionId);
    const targetItem = sectionItems.find((item) => item.question.id === targetQuestionId);
    if (!draggedItem || !targetItem) return;

    const nextSection = [...sectionItems];
    const fromIndex = nextSection.findIndex((item) => item.question.id === draggedQuestionId);
    const toIndex = nextSection.findIndex((item) => item.question.id === targetQuestionId);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = nextSection.splice(fromIndex, 1);
    nextSection.splice(toIndex, 0, moved);
    await reorderWithinSection(sectionType, nextSection.map((item) => item.question.id));
  };

  const handleDropToSection = async (sectionType: 'MULTIPLE_CHOICE' | 'ESSAY') => {
    if (!selectedExam?.questions || draggedQuestionId === null) return;

    const sectionItems = selectedExam.questions.filter((item) => item.question.type === sectionType);
    const draggedItem = sectionItems.find((item) => item.question.id === draggedQuestionId);
    if (!draggedItem) return;

    const nextSection = sectionItems.filter((item) => item.question.id !== draggedQuestionId);
    nextSection.push(draggedItem);
    await reorderWithinSection(sectionType, nextSection.map((item) => item.question.id));
  };

  const saveExamConfig = async () => {
    if (!selectedExam) return;
    try {
      // include sectionPoints when present
      const parsedReq = selectedExam.requirements ? JSON.parse(selectedExam.requirements as unknown as string) : {};
      const mergedReq = { ...parsedReq, sectionPoints };
      await api.patch(`/exams/builder/${selectedExam.id}/configuration`, {
        title: selectedExam.title,
        examType,
        durationMinutes,
        requirements: mergedReq,
      });
      toast.success('Exam configuration updated');
      await loadExamDetail(selectedExam.id);
    } catch {
      toast.error('Failed to update exam config');
    }
  };

  const handleShuffleSection = async (sectionType: 'MULTIPLE_CHOICE' | 'ESSAY') => {
    if (!selectedExam || !selectedExam.questions) return;
    const seq = [...selectedExam.questions];
    const sectionItems = seq.filter((s) => s.question.type === sectionType);
    const otherItems = seq.filter((s) => s.question.type !== sectionType);

    // Fisher-Yates shuffle
    for (let i = sectionItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sectionItems[i], sectionItems[j]] = [sectionItems[j], sectionItems[i]];
    }

    let newOrder: number[] = [];
    if (sectionType === 'MULTIPLE_CHOICE') {
      newOrder = [...sectionItems, ...otherItems].map((it) => it.question.id);
    } else {
      const mcqs = seq.filter((s) => s.question.type === 'MULTIPLE_CHOICE');
      newOrder = [...mcqs, ...sectionItems].map((it) => it.question.id);
    }

    try {
      await reorderQuestions(newOrder);
      toast.success('Shuffled section questions');
    } catch {
      toast.error('Failed to shuffle section');
    }
  };

  const handleUpdateQuestionPoints = async (questionId: number, points: number) => {
    if (!selectedExam) return;
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/questions/${questionId}/points`, { points });
      await loadExamDetail(selectedExam.id);
      toast.success('Updated question points');
    } catch (e) {
      toast.error('Failed to update question points');
    }
  };

  const parseQuestionOptions = (question: Question): string[] => {
    if (!question.options) return [];
    try {
      const parsed = JSON.parse(question.options);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  };

  const openQuestionModal = (question: Question) => {
    setActiveQuestion({ examQuestionId: question.id, question });
    setActiveTab('EDIT');
    setQuestionForm({
      content: question.content,
      answer: question.answer,
      difficulty: question.difficulty || 'MEDIUM',
      status: question.status || 'ACTIVE',
      rubric: question.rubric || '',
      learningOutcomeId: question.learningOutcomeId ? String(question.learningOutcomeId) : '',
      options: question.type === 'MULTIPLE_CHOICE' ? (parseQuestionOptions(question).length > 0 ? parseQuestionOptions(question) : ['', '', '', '']) : ['', '', '', ''],
    });
    setSearchQuery('');
    setReplacementDifficulty('ALL');
    setReplacementOutcomeId(question.learningOutcomeId ? String(question.learningOutcomeId) : '');
    setReplacementResults([]);
    setSelectedReplacementId(null);
  };

  const closeQuestionModal = () => {
    setActiveQuestion(null);
    setReplacementResults([]);
    setSelectedReplacementId(null);
  };

  const saveQuestionEdit = async () => {
    if (!activeQuestion) return;
    const payload: Record<string, unknown> = {
      content: questionForm.content.trim(),
      answer: questionForm.answer.trim(),
      difficulty: questionForm.difficulty,
      status: questionForm.status,
      rubric: questionForm.rubric.trim(),
      learningOutcomeId: questionForm.learningOutcomeId ? Number(questionForm.learningOutcomeId) : null,
    };

    if (activeQuestion.question.type === 'MULTIPLE_CHOICE') {
      const options = questionForm.options.map((item) => item.trim()).filter(Boolean);
      if (options.length < 2) {
        toast.error('Multiple choice questions need at least 2 options');
        return;
      }
      payload.options = options;
    }

    try {
      await api.put(`/questions/${activeQuestion.question.id}`, payload);
      toast.success('Question updated in the question bank');
      await loadExamDetail(selectedExam!.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save question changes');
    }
  };

  const runReplacementSearch = async () => {
    if (!selectedExam || !activeQuestion) return;
    setLoadingReplacement(true);
    try {
      const params = new URLSearchParams();
      params.set('type', activeQuestion.question.type);
      params.set('status', 'ACTIVE');
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (replacementDifficulty !== 'ALL') params.set('difficulty', replacementDifficulty);
      if (replacementOutcomeId) params.set('learningOutcomeId', replacementOutcomeId);

      const { data } = await api.get<Question[]>(`/questions/subject/${selectedExam.subjectId}?${params.toString()}`);
      const currentIds = new Set((selectedExam.questions || []).map((item) => item.question.id));
      const baseQuestion = activeQuestion.question;
      const sorted = data
        .filter((item) => item.id !== baseQuestion.id && !currentIds.has(item.id) && item.type === baseQuestion.type)
        .sort((a, b) => {
          const aScore = Number(a.learningOutcomeId === baseQuestion.learningOutcomeId) + Number((a.difficulty || 'MEDIUM') === (baseQuestion.difficulty || 'MEDIUM'));
          const bScore = Number(b.learningOutcomeId === baseQuestion.learningOutcomeId) + Number((b.difficulty || 'MEDIUM') === (baseQuestion.difficulty || 'MEDIUM'));
          if (bScore !== aScore) return bScore - aScore;
          return Number(new Date(b.createdAt || 0)) - Number(new Date(a.createdAt || 0));
        });
      setReplacementResults(sorted);
      setSelectedReplacementId(sorted[0]?.id ?? null);
    } catch {
      toast.error('Failed to search replacement questions');
    } finally {
      setLoadingReplacement(false);
    }
  };

  const confirmManualReplacement = async () => {
    if (!selectedExam || !activeQuestion || !selectedReplacementId) return;
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/questions/${activeQuestion.question.id}/replace`, {
        replacementQuestionId: selectedReplacementId,
      });
      toast.success('Question replaced');
      await loadExamDetail(selectedExam.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to replace question');
    }
  };

  const confirmAutoReplacement = async () => {
    if (!selectedExam || !activeQuestion) return;
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/questions/${activeQuestion.question.id}/replace`, {
        autoReplace: true,
      });
      toast.success('Question replaced automatically');
      await loadExamDetail(selectedExam.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'No matching replacement question was found');
    }
  };

  useEffect(() => {
    if (activeQuestion && activeTab === 'REPLACE') {
      void runReplacementSearch();
    }
  }, [activeQuestion, activeTab]);

  const mcqQuestions = selectedExam?.questions?.filter((item) => item.question.type === 'MULTIPLE_CHOICE') || [];
  const essayQuestions = selectedExam?.questions?.filter((item) => item.question.type === 'ESSAY') || [];


  const handleReqChange = (field: 'total' | 'multipleChoice' | 'essay', value: number) => {
    const newReq = { ...requirements, [field]: value };
    if (field !== 'total') {
      newReq.total = newReq.multipleChoice + newReq.essay;
    }
    setRequirements(newReq);
  };

  const sum = requirements.multipleChoice + requirements.essay;
  const isValid = sum === requirements.total && requirements.total > 0 && !!selectedSubjectId;

  const selectedSubjectData = subjects.find((s) => s.id === parseInt(selectedSubjectId));
  const totalQuestions = selectedSubjectData?._count?.questions ?? 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Exam Builder & Grading</h1>
            <p className="text-gray-500 mt-0.5">Create drafts, export/print, start sessions, scan papers, and batch auto-grade (OMR + AI)</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-5">
          <h3 className="font-semibold text-primary-800 mb-2 flex items-center gap-2">
            <Sparkles size={16} /> How it works
          </h3>
          <ol className="text-sm text-primary-700 space-y-1 list-decimal list-inside">
            <li>Select a subject with questions in the bank</li>
            <li>Specify mode: Full Essay or Mixed (MCQ + Essay)</li>
            <li>Set easy/medium/hard ratios and optional outcome distribution ratio</li>
            <li>Create a draft, edit/reorder questions, export the .docx, then start a class session</li>
            <li>Scan submissions (pass 1 includes student info + OMR in mixed mode), then run batch auto-grading (OMR + AI)</li>
            <li>Export the exam and answer key as Word (.docx)</li>
          </ol>
        </div>

        <div className="grid xl:grid-cols-3 gap-6 items-start">
          <div className="card p-6 space-y-6 xl:col-span-1">
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
              Exam Title *
            </label>
            <input
              type="text"
              className="input-field"
              placeholder={selectedSubjectData ? `${selectedSubjectData.name} Midterm` : 'Exam title...'}
              value={examTitle}
              onChange={(e) => setExamTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Exam Type</label>
              <select
                className="input-field"
                value={examType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setExamType(nextType);
                  if (nextType === 'FULL_ESSAY') {
                    setRequirements((prev) => ({
                      ...prev,
                      multipleChoice: 0,
                      essay: prev.total,
                    }));
                  }
                }}
              >
                <option value="FULL_ESSAY">Full Essay</option>
                <option value="MIXED">Mixed (Essay + MCQ)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input
                type="number"
                min={15}
                className="input-field"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 60)}
              />
            </div>
          </div>

          {subjectOutcomes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Outcome-based Ratio (%)</label>
              <p className="text-xs text-gray-500 mb-3">Leave all zero to auto split evenly across outcomes.</p>
              <div className="space-y-2">
                {subjectOutcomes.map((outcome) => (
                  <div key={outcome.id} className="border border-gray-200 rounded-md p-2">
                    <p className="text-xs font-medium text-gray-700 mb-2">{outcome.code}</p>
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="input-field"
                        placeholder="Ratio %"
                        value={outcomeRatios[outcome.id] ?? 0}
                        onChange={(e) => {
                          const value = parseInt(e.target.value || '0', 10) || 0;
                          setOutcomeRatios((prev) => ({
                            ...prev,
                            [outcome.id]: value,
                          }));
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Requirements */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Question Requirements</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: '📋 Multiple Choice', field: 'multipleChoice' as const, color: 'text-blue-600' },
                { label: '✍️ Essay', field: 'essay' as const, color: 'text-orange-600' },
              ].map(({ label, field, color }) => (
                <div key={field}>
                  <label className={`block text-xs font-medium mb-1 ${color}`}>{label}</label>
                  <input
                    type="number"
                    min={0}
                    className="input-field"
                    disabled={examType === 'FULL_ESSAY' && field === 'multipleChoice'}
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
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Section Points</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    className="input-field"
                    value={sectionPoints.multipleChoice}
                    onChange={(e) => setSectionPoints((prev) => ({ ...prev, multipleChoice: Number(e.target.value || 0) }))}
                  />
                  <input
                    type="number"
                    min={0}
                    className="input-field"
                    value={sectionPoints.essay}
                    onChange={(e) => setSectionPoints((prev) => ({ ...prev, essay: Number(e.target.value || 0) }))}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Defaults: MCQ 7, Essay 3 — these totals determine per-question default points.</p>
              </div>
            </div>

            {sum !== requirements.total && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
                <AlertCircle size={12} />
                Question types sum ({sum}) doesn't match total ({requirements.total})
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <button className="btn-secondary w-full" type="button" onClick={setBalancedRatio}>
                  Auto Balance 50/35/15
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">MCQ Difficulty Ratio (%)</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Easy"
                    value={requirements.difficultyDistribution?.multipleChoice.easy ?? 50}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: {
                          easy: parseInt(e.target.value || '0', 10) || 0,
                          medium: prev.difficultyDistribution?.multipleChoice.medium ?? 35,
                          hard: prev.difficultyDistribution?.multipleChoice.hard ?? 15,
                        },
                        essay: prev.difficultyDistribution?.essay ?? { easy: 50, medium: 35, hard: 15 },
                      },
                    }))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Medium"
                    value={requirements.difficultyDistribution?.multipleChoice.medium ?? 35}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: {
                          easy: prev.difficultyDistribution?.multipleChoice.easy ?? 50,
                          medium: parseInt(e.target.value || '0', 10) || 0,
                          hard: prev.difficultyDistribution?.multipleChoice.hard ?? 15,
                        },
                        essay: prev.difficultyDistribution?.essay ?? { easy: 50, medium: 35, hard: 15 },
                      },
                    }))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Hard"
                    value={requirements.difficultyDistribution?.multipleChoice.hard ?? 15}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: {
                          easy: prev.difficultyDistribution?.multipleChoice.easy ?? 50,
                          medium: prev.difficultyDistribution?.multipleChoice.medium ?? 35,
                          hard: parseInt(e.target.value || '0', 10) || 0,
                        },
                        essay: prev.difficultyDistribution?.essay ?? { easy: 50, medium: 35, hard: 15 },
                      },
                    }))}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">Essay Difficulty Ratio (%)</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Easy"
                    value={requirements.difficultyDistribution?.essay.easy ?? 50}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: prev.difficultyDistribution?.multipleChoice ?? { easy: 50, medium: 35, hard: 15 },
                        essay: {
                          easy: parseInt(e.target.value || '0', 10) || 0,
                          medium: prev.difficultyDistribution?.essay.medium ?? 35,
                          hard: prev.difficultyDistribution?.essay.hard ?? 15,
                        },
                      },
                    }))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Medium"
                    value={requirements.difficultyDistribution?.essay.medium ?? 35}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: prev.difficultyDistribution?.multipleChoice ?? { easy: 50, medium: 35, hard: 15 },
                        essay: {
                          easy: prev.difficultyDistribution?.essay.easy ?? 50,
                          medium: parseInt(e.target.value || '0', 10) || 0,
                          hard: prev.difficultyDistribution?.essay.hard ?? 15,
                        },
                      },
                    }))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field"
                    placeholder="Hard"
                    value={requirements.difficultyDistribution?.essay.hard ?? 15}
                    onChange={(e) => setRequirements((prev) => ({
                      ...prev,
                      difficultyDistribution: {
                        multipleChoice: prev.difficultyDistribution?.multipleChoice ?? { easy: 50, medium: 35, hard: 15 },
                        essay: {
                          easy: prev.difficultyDistribution?.essay.easy ?? 50,
                          medium: prev.difficultyDistribution?.essay.medium ?? 35,
                          hard: parseInt(e.target.value || '0', 10) || 0,
                        },
                      },
                    }))}
                  />
                </div>
              </div>
            </div>
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
                Creating Draft...
              </>
            ) : (
              <>
                <Download size={20} />
                Create Exam Draft
              </>
            )}
          </button>

          {generating && (
            <p className="text-center text-sm text-gray-500">
              Preparing draft from question bank...
            </p>
          )}

          </div>

          <div className="card p-6 xl:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Exam Drafts</h2>
              <span className="text-sm text-gray-500">{exams.length} total</span>
            </div>

            {exams.length === 0 ? (
              <p className="text-sm text-gray-500">No drafts yet.</p>
            ) : (
              <div className="space-y-3">
                {exams.map((exam) => (
                  <div key={exam.id} className={`border rounded-lg p-4 ${selectedExamId === exam.id ? 'border-primary-300 bg-primary-50' : 'border-gray-200'}`}>
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{exam.title}</p>
                        <p className="text-xs text-gray-500">{exam.subject?.name} • {exam._count?.questions ?? 0} questions • v{exam.version}</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-secondary text-xs" onClick={() => loadExamDetail(exam.id)}>Edit Questions</button>
                        <button className="btn-secondary text-xs" onClick={() => handleExport(exam.id)}>Export Exam (.docx)</button>
                        <button className="btn-secondary text-xs" onClick={() => handleExportAnswerKey(exam.id)}>Answer Key</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedExam && (
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <h3 className="font-semibold text-gray-900">Sessions of: {selectedExam.title}</h3>
                <div className="flex gap-2 mb-2">
                  <button className="btn-secondary text-xs" onClick={() => loadExamDetail(selectedExam.id)}>
                    <Eye size={14} className="inline mr-1" />View Exam
                  </button>
                  <button className="btn-secondary text-xs" onClick={saveExamConfig}>
                    Save Config
                  </button>
                </div>

                {selectedExam.questions && selectedExam.questions.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-gray-800">Exam Preview (drag to reorder)</h4>
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary text-xs" onClick={() => handleShuffleSection('MULTIPLE_CHOICE')}>Shuffle MCQ</button>
                        <button className="btn-secondary text-xs" onClick={() => handleShuffleSection('ESSAY')}>Shuffle Essay</button>
                      </div>
                    </div>

                    {[
                      { type: 'MULTIPLE_CHOICE' as const, label: 'Multiple Choice', items: mcqQuestions },
                      { type: 'ESSAY' as const, label: 'Essay', items: essayQuestions },
                    ].map((section) => (
                      <div
                        key={section.type}
                        className="border border-gray-200 rounded-lg p-3 space-y-3"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropToSection(section.type);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-gray-900">{section.label}</h5>
                            <p className="text-xs text-gray-500">{section.items.length} questions</p>
                          </div>
                          <span className="text-xs text-gray-500">Drag within this section to reorder</span>
                        </div>

                        <div className="space-y-2">
                          {section.items.map((item, idx) => (
                            <div
                              key={item.question.id}
                              draggable
                              onDoubleClick={() => openQuestionModal(item.question)}
                              onDragStart={() => handleDragStart(item.question.id)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(event) => {
                                event.preventDefault();
                                setDragOverQuestionId(item.question.id);
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleDropOnQuestion(section.type, item.question.id);
                              }}
                              className={`flex items-start justify-between gap-3 text-sm border border-gray-100 rounded-md p-3 transition-colors cursor-pointer ${
                                draggedQuestionId === item.question.id ? 'opacity-50' : ''
                              } ${dragOverQuestionId === item.question.id ? 'bg-primary-50' : 'bg-white'}`}
                            >
                              <div className="flex items-start gap-2 flex-1">
                                <span className="mt-0.5 text-gray-400 cursor-grab active:cursor-grabbing">
                                  <GripVertical size={16} />
                                </span>
                                <div className="flex-1">
                                  <p className="font-medium text-gray-900">Q{idx + 1}. {item.question.content}</p>
                                  <p className="text-xs text-gray-500">
                                    {item.question.type}
                                    {item.question.learningOutcome?.code ? ` • ${item.question.learningOutcome.code}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="w-36 flex flex-col items-end gap-1">
                                <div className="text-xs text-gray-500">Points</div>
                                <input
                                  type="number"
                                  className="input-field w-28 text-right"
                                  value={Number(item.points || 0)}
                                  onChange={(e) => handleUpdateQuestionPoints(item.question.id, Number(e.target.value || 0))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <h4 className="text-sm font-semibold text-gray-800">Start Exam Session</h4>
                  <p className="text-xs text-gray-500">Select a class and start a session for this exam.</p>
                  <div className="flex gap-2">
                    <select
                      className="input-field"
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                    >
                      <option value="">Select class</option>
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>{cls.name}</option>
                      ))}
                    </select>
                    <button
                      disabled={creatingSession || !selectedExamId || !selectedClassId}
                      onClick={handleCreateSession}
                      className="btn-secondary whitespace-nowrap"
                    >
                      {creatingSession ? 'Starting...' : 'Start Exam Session'}
                    </button>
                  </div>
                </div>

                {selectedExam.sessions && selectedExam.sessions.length > 0 ? (
                  <div className="space-y-2">
                    {selectedExam.sessions.map((session) => (
                      <div key={session.id} className="border rounded-lg p-3 border-gray-200">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-gray-900">Session #{session.id} • {session.class?.name}</p>
                            <p className="text-xs text-gray-500">Status: {session.status} • Submissions: {session._count?.submissions ?? 0}</p>
                          </div>
                          <div className="flex gap-2">
                            <button className="btn-secondary text-xs" onClick={() => navigate(`/teacher/exam-sessions?sessionId=${session.id}&tab=AI_GRADING`)}>
                              Open Scan & Batch Auto-Grading
                            </button>
                            <button className="btn-secondary text-xs" onClick={() => navigate(`/teacher/exam-sessions?sessionId=${session.id}&tab=REPORT`)}>
                              Open Report
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No sessions created for this exam.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {activeQuestion && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-gray-200">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Question editor</p>
                  <h3 className="text-lg font-semibold text-gray-900 mt-1">Edit or replace the selected question</h3>
                  <p className="text-sm text-gray-500 mt-1">Editing updates the source question in the question bank. Replace keeps the bank question intact and swaps the draft link only.</p>
                </div>
                <button onClick={closeQuestionModal} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>

              <div className="flex gap-2 border-b border-gray-100 px-6 pt-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('EDIT')}
                  className={`rounded-t-lg px-4 py-2 text-sm font-medium border ${activeTab === 'EDIT' ? 'bg-white border-gray-200 border-b-white text-gray-900' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('REPLACE')}
                  className={`rounded-t-lg px-4 py-2 text-sm font-medium border ${activeTab === 'REPLACE' ? 'bg-white border-gray-200 border-b-white text-gray-900' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
                >
                  Replace
                </button>
              </div>

              <div className="px-6 py-5">
                <div className="mb-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="badge badge-blue">{activeQuestion.question.type === 'MULTIPLE_CHOICE' ? 'Multiple Choice' : 'Essay'}</span>
                    <span className="badge badge-gray">Difficulty {activeQuestion.question.difficulty || 'MEDIUM'}</span>
                    {activeQuestion.question.learningOutcome?.code && <span className="badge badge-green">{activeQuestion.question.learningOutcome.code}</span>}
                    <span className={`badge ${activeQuestion.question.status === 'ARCHIVED' ? 'badge-red' : 'badge-green'}`}>{activeQuestion.question.status || 'ACTIVE'}</span>
                  </div>
                  <p className="text-sm text-gray-900 font-medium">{activeQuestion.question.content}</p>
                </div>

                {activeTab === 'EDIT' ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Question content</label>
                      <textarea
                        className="input-field resize-none"
                        rows={4}
                        value={questionForm.content}
                        onChange={(e) => setQuestionForm((prev) => ({ ...prev, content: e.target.value }))}
                      />
                    </div>

                    {activeQuestion.question.type === 'MULTIPLE_CHOICE' && (
                      <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <label className="block text-sm font-medium text-gray-700">Answer options</label>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => setQuestionForm((prev) => ({ ...prev, options: [...prev.options, ''] }))}
                          >
                            Add option
                          </button>
                        </div>
                        <div className="space-y-2">
                          {questionForm.options.map((option, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <div className="w-10 text-sm font-medium text-gray-500">{String.fromCharCode(65 + index)}</div>
                              <input
                                className="input-field flex-1"
                                value={option}
                                onChange={(e) => setQuestionForm((prev) => {
                                  const next = [...prev.options];
                                  next[index] = e.target.value;
                                  return { ...prev, options: next };
                                })}
                              />
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => setQuestionForm((prev) => {
                                  if (prev.options.length <= 2) return prev;
                                  const next = prev.options.filter((_, i) => i !== index);
                                  return { ...prev, options: next };
                                })}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Correct answer</label>
                        <input
                          className="input-field"
                          value={questionForm.answer}
                          onChange={(e) => setQuestionForm((prev) => ({ ...prev, answer: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                        <select
                          className="input-field"
                          value={questionForm.difficulty}
                          onChange={(e) => setQuestionForm((prev) => ({ ...prev, difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD' }))}
                        >
                          <option value="EASY">Easy</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HARD">Hard</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Learning outcome</label>
                        <select
                          className="input-field"
                          value={questionForm.learningOutcomeId}
                          onChange={(e) => setQuestionForm((prev) => ({ ...prev, learningOutcomeId: e.target.value }))}
                        >
                          <option value="">No learning outcome</option>
                          {subjectOutcomes.map((outcome) => (
                            <option key={outcome.id} value={outcome.id}>{outcome.code} - {outcome.description}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select
                          className="input-field"
                          value={questionForm.status}
                          onChange={(e) => setQuestionForm((prev) => ({ ...prev, status: e.target.value as 'ACTIVE' | 'ARCHIVED' }))}
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="ARCHIVED">Archived</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Rubric / notes</label>
                      <textarea
                        className="input-field resize-none"
                        rows={3}
                        value={questionForm.rubric}
                        onChange={(e) => setQuestionForm((prev) => ({ ...prev, rubric: e.target.value }))}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button type="button" className="btn-secondary" onClick={closeQuestionModal}>Cancel</button>
                      <button type="button" className="btn-primary" onClick={saveQuestionEdit}>Save Changes</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Search keywords</label>
                        <input
                          className="input-field"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search content or answer text"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Learning outcome</label>
                        <select
                          className="input-field"
                          value={replacementOutcomeId}
                          onChange={(e) => setReplacementOutcomeId(e.target.value)}
                        >
                          <option value="">Any outcome</option>
                          {subjectOutcomes.map((outcome) => (
                            <option key={outcome.id} value={outcome.id}>{outcome.code} - {outcome.description}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                        <select className="input-field" value={replacementDifficulty} onChange={(e) => setReplacementDifficulty(e.target.value as 'ALL' | 'EASY' | 'MEDIUM' | 'HARD')}>
                          <option value="ALL">Any difficulty</option>
                          <option value="EASY">Easy</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HARD">Hard</option>
                        </select>
                      </div>
                      <div className="md:col-span-2 flex items-end gap-2">
                        <button type="button" className="btn-secondary flex items-center gap-2" onClick={runReplacementSearch}>
                          <Search size={14} /> Search
                        </button>
                        <button type="button" className="btn-secondary flex items-center gap-2" onClick={confirmAutoReplacement}>
                          <RefreshCw size={14} /> Auto Replace
                        </button>
                      </div>
                    </div>

                    {loadingReplacement ? (
                      <p className="text-sm text-gray-500">Searching replacement questions...</p>
                    ) : replacementResults.length === 0 ? (
                      <p className="text-sm text-gray-500">No replacement candidates loaded yet. Use Search or Auto Replace.</p>
                    ) : (
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        {replacementResults.map((item) => (
                          <label key={item.id} className={`block rounded-xl border p-4 cursor-pointer transition-colors ${selectedReplacementId === item.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                className="mt-1"
                                checked={selectedReplacementId === item.id}
                                onChange={() => setSelectedReplacementId(item.id)}
                              />
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <span className="badge badge-blue">{item.type === 'MULTIPLE_CHOICE' ? 'Multiple Choice' : 'Essay'}</span>
                                  <span className="badge badge-gray">{item.difficulty || 'MEDIUM'}</span>
                                  {item.learningOutcome?.code && <span className="badge badge-green">{item.learningOutcome.code}</span>}
                                </div>
                                <p className="text-sm font-medium text-gray-900">{item.content}</p>
                                <p className="text-xs text-gray-500 mt-1">Answer: {item.answer}</p>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button type="button" className="btn-secondary" onClick={closeQuestionModal}>Cancel</button>
                      <button type="button" className="btn-primary" disabled={!selectedReplacementId} onClick={confirmManualReplacement}>Replace Selected</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
