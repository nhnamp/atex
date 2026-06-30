import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Download, BookOpen, AlertCircle, Eye, GripVertical, X, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import api from '../../api';
import { BuiltExam, Class, ExamRequirements, ExamSession, LearningOutcome, Question, Subject } from '../../types';

const TOTAL_EXAM_POINTS = 10;

// A stable signature of what ends up in the exported .docx (question order + per-question
// points). Used to light up "Generate New Word" only when those actually changed.
const examWordSignature = (exam: BuiltExam | null): string => {
  if (!exam?.questions) return '';
  return JSON.stringify(
    [...exam.questions]
      .sort((a, b) => a.position - b.position)
      .map((item) => [item.question.id, Number(item.points || 0)])
  );
};

const TeacherExamGenerator: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [exams, setExams] = useState<BuiltExam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [subjectOutcomes, setSubjectOutcomes] = useState<LearningOutcome[]>([]);
  const [outcomeRatios, setOutcomeRatios] = useState<Record<number, number>>({});
  const [examTitle, setExamTitle] = useState('');
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

  const examType = requirements.multipleChoice === 0 ? 'FULL_ESSAY' : 'MIXED';

  const [sectionPoints, setSectionPoints] = useState<{ multipleChoice: number; essay: number }>({ multipleChoice: 7, essay: 3 });
  const [generating, setGenerating] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [draggedQuestionId, setDraggedQuestionId] = useState<number | null>(null);
  const [dragOverQuestionId, setDragOverQuestionId] = useState<number | null>(null);
  const [pointsDrafts, setPointsDrafts] = useState<Record<number, string>>({});
  const [activeQuestion, setActiveQuestion] = useState<{ examQuestionId: number; question: Question } | null>(null);
  const [activeTab, setActiveTab] = useState<'EDIT' | 'REPLACE'>('EDIT');
  const [questionForm, setQuestionForm] = useState({
    content: '',
    answer: '',
    difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
    status: 'ACTIVE' as 'ACTIVE' | 'ARCHIVED',
    learningOutcomeId: '',
    options: ['', '', '', ''],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [replacementDifficulty, setReplacementDifficulty] = useState<'ALL' | 'EASY' | 'MEDIUM' | 'HARD'>('ALL');
  const [replacementOutcomeId, setReplacementOutcomeId] = useState('');
  const [replacementResults, setReplacementResults] = useState<Question[]>([]);
  const [selectedReplacementId, setSelectedReplacementId] = useState<number | null>(null);
  const [loadingReplacement, setLoadingReplacement] = useState(false);
  const [exportingExamId, setExportingExamId] = useState<number | null>(null);
  const [exportingKeyId, setExportingKeyId] = useState<number | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const replacementSearchSeqRef = useRef(0);
  const [generatingWord, setGeneratingWord] = useState(false);
  // Baseline order+points captured when an exam opens / after a Word is generated.
  const [wordBaseline, setWordBaseline] = useState<{ examId: number; signature: string } | null>(null);
  // Serial queue for all exam-structure writes (reorder + points). Running them one at a
  // time prevents overlapping renumber transactions from deadlocking ("fail to reorder").
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  // Latest desired order per exam. While a PATCH is in flight, further drags overwrite the
  // entry so superseded orders are skipped — a burst coalesces to one PATCH per exam.
  const pendingReorderRef = useRef<Map<number, number[]>>(new Map());

  // Raw text shown in each numeric/required config input. A present key means the box shows
  // that string verbatim (so it can be emptied while editing); the parsed number still flows
  // into the real state. On Create Exam Draft we read these to flag empty/invalid boxes inline.
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});
  // Once the user edits the title we stop auto-filling it, so clearing the box stays cleared.
  const titleTouchedRef = useRef(false);
  // Tracks which exam's config is loaded so input drafts only reset when the exam changes.
  const loadedConfigExamIdRef = useRef<number | null>(null);

  const rawValueOf = (key: string, num: number) => rawInputs[key] ?? String(num);

  const clearConfigErrors = (...keys: string[]) =>
    setConfigErrors((prev) => {
      if (!keys.some((key) => key in prev)) return prev;
      const next = { ...prev };
      keys.forEach((key) => delete next[key]);
      return next;
    });

  // Numeric config inputs keep the raw string (empty allowed) and push a parsed number into
  // state — empty/NaN counts as 0 for live totals while the box itself stays visually empty.
  const handleNumInput = (
    key: string,
    raw: string,
    apply: (value: number) => void,
    alsoClear: string[] = []
  ) => {
    setRawInputs((prev) => ({ ...prev, [key]: raw }));
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);
    apply(Number.isFinite(parsed) ? parsed : 0);
    clearConfigErrors(key, ...alsoClear);
  };

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
        const requestedExamId = Number.parseInt(searchParams.get('examId') || '', 10);
        const requestedClassId = Number.parseInt(searchParams.get('classId') || '', 10);

        if (Number.isFinite(requestedClassId) && requestedClassId > 0) {
          setSelectedClassId(String(requestedClassId));
        }

        if (Number.isFinite(requestedExamId) && requestedExamId > 0) {
          setSelectedExamId(requestedExamId);
          await loadExamDetail(requestedExamId);
        } else if (latestDrafts.length > 0) {
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
  }, [searchParams]);

  const selectedExam = useMemo(
    () => exams.find((item) => item.id === selectedExamId) || null,
    [exams, selectedExamId]
  );

  useEffect(() => {
    if (!selectedExam) return;

    // Switching to a different exam re-seeds every config field from the saved values, so drop
    // any in-progress input drafts/errors and let the boxes reflect the loaded numbers again.
    if (loadedConfigExamIdRef.current !== selectedExam.id) {
      loadedConfigExamIdRef.current = selectedExam.id;
      setRawInputs({});
      setConfigErrors({});
      titleTouchedRef.current = false;
    }

    const parseRequirements = (raw: string): ExamRequirements | null => {
      try {
        return JSON.parse(raw) as ExamRequirements;
      } catch {
        return null;
      }
    };

    const parsedRequirements = parseRequirements(selectedExam.requirements);

    setSelectedSubjectId(String(selectedExam.subjectId));
    setExamTitle(selectedExam.title);
    setDurationMinutes(selectedExam.durationMinutes || 60);

    if (parsedRequirements) {
      setRequirements({
        total: parsedRequirements.total ?? selectedExam.questions?.length ?? 10,
        multipleChoice: parsedRequirements.multipleChoice ?? 0,
        essay: parsedRequirements.essay ?? 0,
        difficultyDistribution: parsedRequirements.difficultyDistribution ?? {
          multipleChoice: { easy: 50, medium: 35, hard: 15 },
          essay: { easy: 50, medium: 35, hard: 15 },
        },
      });

      const nextSectionPoints = parsedRequirements.sectionPoints || { multipleChoice: 7, essay: 3 };
      const loadedSectionPoints = {
        multipleChoice: Number(nextSectionPoints.multipleChoice ?? 7),
        essay: Number(nextSectionPoints.essay ?? 3),
      };
      setSectionPoints(
        parsedRequirements.multipleChoice === 0
          ? { multipleChoice: 0, essay: TOTAL_EXAM_POINTS }
          : parsedRequirements.essay === 0
            ? { multipleChoice: TOTAL_EXAM_POINTS, essay: 0 }
            : loadedSectionPoints
      );

      const nextOutcomeRatios: Record<number, number> = {};
      (parsedRequirements.outcomeRatios || []).forEach((item) => {
        if (item?.learningOutcomeId) {
          nextOutcomeRatios[item.learningOutcomeId] = Number(item.ratio || 0);
        }
      });
      setOutcomeRatios(nextOutcomeRatios);
    }
  }, [selectedExam]);

  // Capture the baseline signature when a different exam is opened. Edits to the same exam
  // keep the existing baseline so "Generate New Word" can detect drift; switching exams resets it.
  useEffect(() => {
    if (!selectedExam) {
      setWordBaseline(null);
      return;
    }
    setWordBaseline((prev) =>
      prev && prev.examId === selectedExam.id
        ? prev
        : { examId: selectedExam.id, signature: examWordSignature(selectedExam) }
    );
  }, [selectedExam]);

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

    if (!examTitle.trim() && !titleTouchedRef.current) {
      const today = new Date();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setExamTitle(`${selected.name} - ${examType === 'FULL_ESSAY' ? 'Essay' : 'Mixed'} - ${today.getFullYear()}${mm}${dd}`);
    }
  }, [selectedSubjectId, subjects, examTitle, examType]);

  const loadExamDetail = async (examId: number) => {
    try {
      const { data } = await api.get<BuiltExam>(`/exams/builder/${examId}`);
      setExams((prev) => {
        const exists = prev.some((item) => item.id === examId);
        if (exists) {
          return prev.map((item) => (item.id === examId ? data : item));
        }
        return [data, ...prev];
      });
      setSelectedExamId(examId);
    } catch {
      toast.error('Failed to load exam details');
    }
  };

  // Replace an exam in local state without a network round-trip (used for optimistic updates
  // and to reconcile from the data returned by PATCH responses).
  const applyExamData = (data: BuiltExam) => {
    setExams((prev) => prev.map((item) => (item.id === data.id ? data : item)));
  };

  // Append a write to the serial queue. Tasks own their error handling; the chain is kept
  // alive on failure so one bad write can't wedge later ones.
  const enqueueWrite = (task: () => Promise<void>): Promise<void> => {
    const next = writeChainRef.current.then(() => task());
    writeChainRef.current = next.catch(() => {});
    return next;
  };

  // Resolves once every queued write has been persisted — used before exporting so the
  // .docx always reflects the latest order + points.
  const flushPendingWrites = (): Promise<void> => writeChainRef.current;

  const downloadDocx = async (url: string, filename: string) => {
    const response = await api.get(url, { responseType: 'blob' });
    const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(blobUrl);
  };

  // Validates every config field. Empty/invalid boxes get an inline red message keyed by the
  // field; cross-field problems (totals, ratios) get a specific message under the right group.
  // The first message is also surfaced as a toast.
  const validateConfig = (): boolean => {
    const errors: Record<string, string> = {};
    const EMPTY = 'Giá trị không được để trống';
    const INVALID = 'Giá trị không hợp lệ';

    // Reads a box and records EMPTY/INVALID; returns the number or null when unusable.
    const checkNum = (key: string, num: number, opts?: { positive?: boolean }): number | null => {
      const raw = rawValueOf(key, num).trim();
      if (raw === '') {
        errors[key] = EMPTY;
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || (opts?.positive && n <= 0)) {
        errors[key] = INVALID;
        return null;
      }
      return n;
    };

    // Reads a box treating empty/invalid as 0 (used for ratio sums that don't require each box).
    const readNum = (key: string, num: number): number => {
      const raw = rawValueOf(key, num).trim();
      if (raw === '') return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    };

    if (!selectedSubjectId) errors.subject = 'Vui lòng chọn môn học';
    if (!examTitle.trim()) errors.title = EMPTY;

    checkNum('duration', durationMinutes, { positive: true });

    const mcqCount = checkNum('mcqCount', requirements.multipleChoice);
    const essayCount = checkNum('essayCount', requirements.essay);
    if (mcqCount !== null && essayCount !== null && mcqCount + essayCount <= 0) {
      errors.total = 'Tổng số câu hỏi phải lớn hơn 0';
    }

    const spMcq = checkNum('spMcq', sectionPoints.multipleChoice);
    const spEssay = checkNum('spEssay', sectionPoints.essay);
    if (spMcq !== null && spEssay !== null && Math.abs(spMcq + spEssay - TOTAL_EXAM_POINTS) > 0.0001) {
      errors.sectionPoints = `Tổng điểm 2 phần phải bằng ${TOTAL_EXAM_POINTS} (hiện tại ${spMcq + spEssay})`;
    }

    const dd = requirements.difficultyDistribution;
    if ((mcqCount ?? 0) > 0) {
      const total =
        readNum('mcqEasy', dd?.multipleChoice.easy ?? 0) +
        readNum('mcqMedium', dd?.multipleChoice.medium ?? 0) +
        readNum('mcqHard', dd?.multipleChoice.hard ?? 0);
      if (total !== 100) errors.mcqRatio = 'Tỉ lệ độ khó MCQ phải tổng 100%';
    }
    if ((essayCount ?? 0) > 0) {
      const total =
        readNum('essayEasy', dd?.essay.easy ?? 0) +
        readNum('essayMedium', dd?.essay.medium ?? 0) +
        readNum('essayHard', dd?.essay.hard ?? 0);
      if (total !== 100) errors.essayRatio = 'Tỉ lệ độ khó Essay phải tổng 100%';
    }

    if (subjectOutcomes.length > 0) {
      const entries = subjectOutcomes
        .map((outcome) => readNum(`outcome:${outcome.id}`, outcomeRatios[outcome.id] ?? 0))
        .filter((ratio) => ratio > 0);
      if (entries.length > 0) {
        const ratioSum = entries.reduce((acc, ratio) => acc + ratio, 0);
        if (ratioSum !== 100) {
          errors.outcomeRatio = 'Tổng tỉ lệ outcome phải bằng 100% (hoặc để trống để chia đều)';
        }
      }
    }

    setConfigErrors(errors);
    const keys = Object.keys(errors);
    if (keys.length > 0) {
      toast.error(errors[keys[0]]);
      return false;
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
    if (!validateConfig()) return;
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
      setConfigErrors({});
      toast.success('Exam draft created');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create exam draft');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async (examId: number) => {
    if (exportingExamId) return;
    setExportingExamId(examId);
    try {
      await flushPendingWrites();
      await downloadDocx(`/exams/builder/${examId}/export`, `exam_${examId}.docx`);
      toast.success('Exam exported (.docx template)');
    } catch {
      toast.error('Failed to export exam');
    } finally {
      setExportingExamId(null);
    }
  };

  const handleExportAnswerKey = async (examId: number) => {
    if (exportingKeyId) return;
    setExportingKeyId(examId);
    try {
      await flushPendingWrites();
      await downloadDocx(`/exams/builder/${examId}/export-answer-key`, `answer_key_${examId}.docx`);
      toast.success('Answer key exported (.docx template)');
    } catch {
      toast.error('Failed to export answer key');
    } finally {
      setExportingKeyId(null);
    }
  };

  // One button to regenerate both the exam and the answer-key .docx after reordering or
  // re-pointing questions. Flushing first guarantees the files match the latest layout, and
  // resetting the baseline dims the button until the next change.
  const handleGenerateWord = async (examId: number) => {
    if (generatingWord) return;
    setGeneratingWord(true);
    try {
      await flushPendingWrites();
      await downloadDocx(`/exams/builder/${examId}/export`, `exam_${examId}.docx`);
      await downloadDocx(`/exams/builder/${examId}/export-answer-key`, `answer_key_${examId}.docx`);
      setWordBaseline({ examId, signature: currentWordSignature });
      toast.success('Generated new Word (exam + answer key)');
    } catch {
      toast.error('Failed to generate Word');
    } finally {
      setGeneratingWord(false);
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

  const reorderQuestions = (nextQuestionIds: number[]): void => {
    if (!selectedExam?.questions) return;
    const examId = selectedExam.id;

    // Optimistically reorder locally so drag/shuffle feels instant. The backend persists
    // positions 1..N in the same order we send, so the local order already matches the result.
    const byId = new Map(selectedExam.questions.map((item) => [item.question.id, item]));
    const nextQuestions = nextQuestionIds
      .map((id, index) => {
        const item = byId.get(id);
        return item ? { ...item, position: index + 1 } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    applyExamData({ ...selectedExam, questions: nextQuestions });

    // Persist the latest order through the serial queue. Coalescing means a burst of drags
    // collapses to one PATCH, and serialization stops overlapping renumbers from deadlocking.
    const order = nextQuestionIds;
    pendingReorderRef.current.set(examId, order);
    void enqueueWrite(async () => {
      if (pendingReorderRef.current.get(examId) !== order) return; // superseded by a newer order
      pendingReorderRef.current.delete(examId);
      try {
        await api.patch(`/exams/builder/${examId}/reorder`, { orderedQuestionIds: order });
        // Optimistic state already matches the persisted order — no reconcile needed.
      } catch {
        toast.error('Failed to reorder questions');
        await loadExamDetail(examId); // resync to server truth
      }
    });
  };

  const handleDragStart = (questionId: number) => {
    setDraggedQuestionId(questionId);
  };

  const handleDragEnd = () => {
    setDraggedQuestionId(null);
    setDragOverQuestionId(null);
  };

  const reorderWithinSection = (sectionType: 'MULTIPLE_CHOICE' | 'ESSAY', nextSectionQuestions: number[]) => {
    if (!selectedExam?.questions) return;

    const otherQuestions = selectedExam.questions
      .filter((item) => item.question.type !== sectionType)
      .map((item) => item.question.id);

    const nextOrder = sectionType === 'MULTIPLE_CHOICE'
      ? [...nextSectionQuestions, ...otherQuestions]
      : [...otherQuestions, ...nextSectionQuestions];

    reorderQuestions(nextOrder);
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
    if (Math.abs(sectionPoints.multipleChoice + sectionPoints.essay - TOTAL_EXAM_POINTS) > 0.0001) {
      toast.error(`Section points must total ${TOTAL_EXAM_POINTS}`);
      return;
    }
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

    reorderQuestions(newOrder);
    toast.success('Shuffled section questions');
  };

  const handleUpdateQuestionPoints = (questionId: number, points: number): void => {
    if (!selectedExam?.questions) return;
    const examId = selectedExam.id;
    const prevPoints = Number(
      selectedExam.questions.find((item) => item.question.id === questionId)?.points ?? 0
    );

    // Set just this question's points so a concurrent reorder/edit isn't clobbered.
    const setQuestionPoints = (value: number) =>
      setExams((prev) =>
        prev.map((exam) =>
          exam.id === examId
            ? {
                ...exam,
                questions: exam.questions?.map((item) =>
                  item.question.id === questionId ? { ...item, points: value } : item
                ),
              }
            : exam
        )
      );

    setQuestionPoints(points); // optimistic

    // Serialize with reorder writes so the two never collide on the same exam rows.
    void enqueueWrite(async () => {
      try {
        await api.patch(`/exams/builder/${examId}/questions/${questionId}/points`, { points });
        toast.success('Updated question points');
      } catch {
        setQuestionPoints(prevPoints); // revert just this field
        toast.error('Failed to update question points');
      }
    });
  };

  // The points input is uncontrolled-by-draft while typing (see pointsDrafts) and only commits
  // on blur / Enter, so we don't fire a request + reload on every keystroke.
  const commitQuestionPoints = (questionId: number) => {
    if (!selectedExam?.questions) return;
    const draft = pointsDrafts[questionId];
    setPointsDrafts((prev) => {
      if (!(questionId in prev)) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    if (draft === undefined) return;

    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Points must be a number ≥ 0');
      return;
    }
    const current = selectedExam.questions.find((item) => item.question.id === questionId);
    if (current && Number(current.points || 0) === parsed) return;
    handleUpdateQuestionPoints(questionId, parsed);
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
    const parsedOptions = question.type === 'MULTIPLE_CHOICE' ? parseQuestionOptions(question) : [];
    setQuestionForm({
      content: question.content,
      answer: question.answer,
      difficulty: question.difficulty || 'MEDIUM',
      status: question.status || 'ACTIVE',
      learningOutcomeId: question.learningOutcomeId ? String(question.learningOutcomeId) : '',
      options: parsedOptions.length > 0 ? parsedOptions : ['', '', '', ''],
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
    if (!activeQuestion || savingQuestion) return;
    const payload: Record<string, unknown> = {
      content: questionForm.content.trim(),
      answer: questionForm.answer.trim(),
      difficulty: questionForm.difficulty,
      status: questionForm.status,
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

    setSavingQuestion(true);
    try {
      await api.put(`/questions/${activeQuestion.question.id}`, payload);
      toast.success('Question updated in the question bank');
      await loadExamDetail(selectedExam!.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save question changes');
    } finally {
      setSavingQuestion(false);
    }
  };

  const runReplacementSearch = async () => {
    if (!selectedExam || !activeQuestion) return;
    const seq = ++replacementSearchSeqRef.current;
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
      if (seq !== replacementSearchSeqRef.current) return;
      setReplacementResults(sorted);
      setSelectedReplacementId(sorted[0]?.id ?? null);
    } catch {
      if (seq === replacementSearchSeqRef.current) toast.error('Failed to search replacement questions');
    } finally {
      if (seq === replacementSearchSeqRef.current) setLoadingReplacement(false);
    }
  };

  const confirmManualReplacement = async () => {
    if (!selectedExam || !activeQuestion || !selectedReplacementId || savingQuestion) return;
    setSavingQuestion(true);
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/questions/${activeQuestion.question.id}/replace`, {
        replacementQuestionId: selectedReplacementId,
      });
      toast.success('Question replaced');
      await loadExamDetail(selectedExam.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to replace question');
    } finally {
      setSavingQuestion(false);
    }
  };

  const confirmAutoReplacement = async () => {
    if (!selectedExam || !activeQuestion || savingQuestion) return;
    if (!window.confirm('Tự động thay câu hỏi này bằng một câu tương đương trong ngân hàng?')) return;
    setSavingQuestion(true);
    try {
      await api.patch(`/exams/builder/${selectedExam.id}/questions/${activeQuestion.question.id}/replace`, {
        autoReplace: true,
      });
      toast.success('Question replaced automatically');
      await loadExamDetail(selectedExam.id);
      closeQuestionModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'No matching replacement question was found');
    } finally {
      setSavingQuestion(false);
    }
  };

  useEffect(() => {
    if (activeQuestion && activeTab === 'REPLACE') {
      void runReplacementSearch();
    }
  }, [activeQuestion, activeTab]);

  const mcqQuestions = selectedExam?.questions?.filter((item) => item.question.type === 'MULTIPLE_CHOICE') || [];
  const essayQuestions = selectedExam?.questions?.filter((item) => item.question.type === 'ESSAY') || [];

  const currentWordSignature = useMemo(() => examWordSignature(selectedExam), [selectedExam]);
  // True once the order or any points drift from the last generated/opened state → light the button.
  const isWordDirty =
    !!selectedExam && wordBaseline?.examId === selectedExam.id && wordBaseline.signature !== currentWordSignature;

  const handleReqChange = (field: 'total' | 'multipleChoice' | 'essay', value: number) => {
    const newReq = { ...requirements, [field]: value };
    if (field !== 'total') {
      newReq.total = newReq.multipleChoice + newReq.essay;
    }
    setRequirements(newReq);
    if (field === 'multipleChoice' || field === 'essay') {
      if (newReq.multipleChoice === 0) {
        setSectionPoints({ multipleChoice: 0, essay: TOTAL_EXAM_POINTS });
      } else if (newReq.essay === 0) {
        setSectionPoints({ multipleChoice: TOTAL_EXAM_POINTS, essay: 0 });
      }
      // When a section is dropped to 0 we force its points — drop any stale input drafts so the
      // boxes show the forced values instead of leftover typing.
      if (newReq.multipleChoice === 0 || newReq.essay === 0) {
        setRawInputs((prev) => {
          if (!('spMcq' in prev) && !('spEssay' in prev)) return prev;
          const next = { ...prev };
          delete next.spMcq;
          delete next.spEssay;
          return next;
        });
        clearConfigErrors('spMcq', 'spEssay', 'sectionPoints');
      }
    }
  };

  const setDifficulty = (
    section: 'multipleChoice' | 'essay',
    level: 'easy' | 'medium' | 'hard',
    value: number
  ) => {
    setRequirements((prev) => {
      const dd = prev.difficultyDistribution ?? {
        multipleChoice: { easy: 50, medium: 35, hard: 15 },
        essay: { easy: 50, medium: 35, hard: 15 },
      };
      return {
        ...prev,
        difficultyDistribution: {
          multipleChoice:
            section === 'multipleChoice' ? { ...dd.multipleChoice, [level]: value } : dd.multipleChoice,
          essay: section === 'essay' ? { ...dd.essay, [level]: value } : dd.essay,
        },
      };
    });
  };

  const sum = requirements.multipleChoice + requirements.essay;
  const sectionPointsTotal = sectionPoints.multipleChoice + sectionPoints.essay;

  const selectedSubjectData = subjects.find((s) => s.id === parseInt(selectedSubjectId));
  const totalQuestions = selectedSubjectData?._count?.questions ?? 0;
  const defaultOutcomeRatio = subjectOutcomes.length > 0 ? 100 / subjectOutcomes.length : 0;

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
                onChange={(e) => { setSelectedSubjectId(e.target.value); clearConfigErrors('subject'); }}
              >
                <option value="">-- Select a subject --</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s._count?.questions ?? 0} questions)
                  </option>
                ))}
              </select>
            )}
            {configErrors.subject && (
              <p className="text-xs text-red-600 mt-1.5">{configErrors.subject}</p>
            )}
            {selectedSubjectId && totalQuestions < requirements.total && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                <AlertCircle size={12} />
                Only {totalQuestions} questions available (need {requirements.total})
              </p>
            )}
          </div>

          {/* Exam Title & Duration Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Exam Title *
              </label>
              <input
                type="text"
                className="input-field py-2.5"
                placeholder={selectedSubjectData ? `${selectedSubjectData.name} Midterm` : 'Exam title...'}
                value={examTitle}
                onChange={(e) => { titleTouchedRef.current = true; setExamTitle(e.target.value); clearConfigErrors('title'); }}
              />
              {configErrors.title && <p className="text-xs text-red-600 mt-1">{configErrors.title}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Duration (min)</label>
              <input
                type="number"
                min={15}
                className="input-field py-2.5"
                value={rawValueOf('duration', durationMinutes)}
                onChange={(e) => handleNumInput('duration', e.target.value, (n) => setDurationMinutes(n))}
              />
              {configErrors.duration && <p className="text-xs text-red-600 mt-1">{configErrors.duration}</p>}
            </div>
          </div>

          {subjectOutcomes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Outcome-based Ratio (%)</label>
              <p className="text-xs text-gray-500 mb-3">
                {Object.keys(outcomeRatios).length === 0
                  ? `No manual outcome ratios set. The system will split evenly at ${defaultOutcomeRatio.toFixed(2)}% per outcome.`
                  : 'Set ratios to total 100%. Leaving some values empty is not recommended.'}
              </p>
              <div className="space-y-2">
                {subjectOutcomes.map((outcome) => (
                  <div key={outcome.id} className="border border-gray-200 rounded-md p-2">
                    <p className="text-xs font-medium text-gray-700 mb-2">{outcome.code}</p>
                    {Object.keys(outcomeRatios).length === 0 && (
                      <p className="text-[11px] text-gray-500 mb-1">Default: {defaultOutcomeRatio.toFixed(2)}%</p>
                    )}
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="input-field"
                        placeholder="Ratio %"
                        value={rawValueOf(`outcome:${outcome.id}`, outcomeRatios[outcome.id] ?? 0)}
                        onChange={(e) =>
                          handleNumInput(
                            `outcome:${outcome.id}`,
                            e.target.value,
                            (n) => setOutcomeRatios((prev) => ({ ...prev, [outcome.id]: n })),
                            ['outcomeRatio']
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
              {configErrors.outcomeRatio && (
                <p className="text-xs text-red-600 mt-2">{configErrors.outcomeRatio}</p>
              )}
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
                    value={rawValueOf(field === 'multipleChoice' ? 'mcqCount' : 'essayCount', requirements[field])}
                    onChange={(e) =>
                      handleNumInput(
                        field === 'multipleChoice' ? 'mcqCount' : 'essayCount',
                        e.target.value,
                        (n) => handleReqChange(field, n),
                        ['total']
                      )
                    }
                  />
                  {configErrors[field === 'multipleChoice' ? 'mcqCount' : 'essayCount'] && (
                    <p className="text-xs text-red-600 mt-1">
                      {configErrors[field === 'multipleChoice' ? 'mcqCount' : 'essayCount']}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Total Questions</label>
                <div className={`input-field font-bold text-lg text-center ${
                  sum !== requirements.total ? 'bg-red-50 border-red-300 text-red-600' : 'bg-gray-50 text-gray-900'
                }`}>
                  {requirements.total}
                </div>
                {configErrors.total && <p className="text-xs text-red-600 mt-1">{configErrors.total}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Section Points</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="number"
                      min={0}
                      className="input-field"
                      value={rawValueOf('spMcq', sectionPoints.multipleChoice)}
                      onChange={(e) =>
                        handleNumInput('spMcq', e.target.value, (n) => setSectionPoints((prev) => ({ ...prev, multipleChoice: n })), ['sectionPoints'])
                      }
                    />
                    {configErrors.spMcq && <p className="text-xs text-red-600 mt-1">{configErrors.spMcq}</p>}
                  </div>
                  <div>
                    <input
                      type="number"
                      min={0}
                      className="input-field"
                      value={rawValueOf('spEssay', sectionPoints.essay)}
                      onChange={(e) =>
                        handleNumInput('spEssay', e.target.value, (n) => setSectionPoints((prev) => ({ ...prev, essay: n })), ['sectionPoints'])
                      }
                    />
                    {configErrors.spEssay && <p className="text-xs text-red-600 mt-1">{configErrors.spEssay}</p>}
                  </div>
                </div>
                <p className={`text-xs mt-1 ${Math.abs(sectionPointsTotal - TOTAL_EXAM_POINTS) > 0.0001 ? 'text-red-600' : 'text-gray-500'}`}>
                  Total: {sectionPointsTotal}. Required total: {TOTAL_EXAM_POINTS}. Defaults for mixed exams: MCQ 7, Essay 3.
                </p>
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
                  {([
                    { key: 'mcqEasy', level: 'easy', placeholder: 'Easy', fallback: 50 },
                    { key: 'mcqMedium', level: 'medium', placeholder: 'Medium', fallback: 35 },
                    { key: 'mcqHard', level: 'hard', placeholder: 'Hard', fallback: 15 },
                  ] as const).map(({ key, level, placeholder, fallback }) => (
                    <input
                      key={key}
                      type="number"
                      min={0}
                      max={100}
                      className="input-field"
                      placeholder={placeholder}
                      value={rawValueOf(key, requirements.difficultyDistribution?.multipleChoice[level] ?? fallback)}
                      onChange={(e) => handleNumInput(key, e.target.value, (n) => setDifficulty('multipleChoice', level, n), ['mcqRatio'])}
                    />
                  ))}
                </div>
                {configErrors.mcqRatio && <p className="text-xs text-red-600 mt-1">{configErrors.mcqRatio}</p>}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">Essay Difficulty Ratio (%)</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'essayEasy', level: 'easy', placeholder: 'Easy', fallback: 50 },
                    { key: 'essayMedium', level: 'medium', placeholder: 'Medium', fallback: 35 },
                    { key: 'essayHard', level: 'hard', placeholder: 'Hard', fallback: 15 },
                  ] as const).map(({ key, level, placeholder, fallback }) => (
                    <input
                      key={key}
                      type="number"
                      min={0}
                      max={100}
                      className="input-field"
                      placeholder={placeholder}
                      value={rawValueOf(key, requirements.difficultyDistribution?.essay[level] ?? fallback)}
                      onChange={(e) => handleNumInput(key, e.target.value, (n) => setDifficulty('essay', level, n), ['essayRatio'])}
                    />
                  ))}
                </div>
                {configErrors.essayRatio && <p className="text-xs text-red-600 mt-1">{configErrors.essayRatio}</p>}
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || totalQuestions < requirements.total}
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
                  <div
                    key={exam.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadExamDetail(exam.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void loadExamDetail(exam.id);
                      }
                    }}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${selectedExamId === exam.id ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:border-primary-200 hover:bg-gray-50'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{exam.title}</p>
                        <p className="text-xs text-gray-500">{exam.subject?.name} • {exam._count?.questions ?? 0} questions • v{exam.version}</p>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-secondary text-xs" disabled={exportingExamId === exam.id} onClick={() => handleExport(exam.id)}>{exportingExamId === exam.id ? 'Exporting…' : 'Export Exam (.docx)'}</button>
                        <button className="btn-secondary text-xs" disabled={exportingKeyId === exam.id} onClick={() => handleExportAnswerKey(exam.id)}>{exportingKeyId === exam.id ? 'Exporting…' : 'Answer Key'}</button>
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
                </div>

                {selectedExam.questions && selectedExam.questions.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-gray-800">Exam Preview (drag to reorder)</h4>
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary text-xs" onClick={() => handleShuffleSection('MULTIPLE_CHOICE')}>Shuffle MCQ</button>
                        <button className="btn-secondary text-xs" onClick={() => handleShuffleSection('ESSAY')}>Shuffle Essay</button>
                        <button
                          className={`text-xs ${isWordDirty ? 'btn-primary' : 'btn-secondary opacity-50'}`}
                          disabled={!isWordDirty || generatingWord}
                          onClick={() => handleGenerateWord(selectedExam.id)}
                          title={isWordDirty
                            ? 'Question order or points changed — generate updated exam + answer key (.docx)'
                            : 'No changes since the last generated Word'}
                        >
                          <Download size={14} className="inline mr-1" />
                          {generatingWord ? 'Generating…' : 'Generate New Word'}
                        </button>
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
                                  min={0}
                                  step={0.25}
                                  className="input-field w-28 text-right"
                                  value={pointsDrafts[item.question.id] ?? String(Number(item.points || 0))}
                                  onChange={(e) =>
                                    setPointsDrafts((prev) => ({ ...prev, [item.question.id]: e.target.value }))
                                  }
                                  onBlur={() => commitQuestionPoints(item.question.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  }}
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

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button type="button" className="btn-secondary" onClick={closeQuestionModal}>Cancel</button>
                      <button type="button" className="btn-primary" disabled={savingQuestion} onClick={saveQuestionEdit}>{savingQuestion ? 'Saving…' : 'Save Changes'}</button>
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
                        <button type="button" className="btn-secondary flex items-center gap-2" disabled={loadingReplacement} onClick={runReplacementSearch}>
                          <Search size={14} /> {loadingReplacement ? 'Searching…' : 'Search'}
                        </button>
                        <button type="button" className="btn-secondary flex items-center gap-2" disabled={savingQuestion} onClick={confirmAutoReplacement}>
                          <RefreshCw size={14} /> {savingQuestion ? 'Replacing…' : 'Auto Replace'}
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
                      <button type="button" className="btn-primary" disabled={!selectedReplacementId || savingQuestion} onClick={confirmManualReplacement}>{savingQuestion ? 'Replacing…' : 'Replace Selected'}</button>
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
