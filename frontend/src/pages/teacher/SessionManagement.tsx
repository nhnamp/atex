import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, BarChart3, Camera, CameraOff, CheckCircle2, ClipboardCheck, Download, Eye, RefreshCw, Upload, XCircle } from 'lucide-react';
import Layout from '../../components/Layout';
import api from '../../api';
import { BulkUploadResponse, BuiltExam, ExamScanEntry, ExamSession, ExamSubmission, RegradeResponse, SessionIssuesReport } from '../../types';

type TabKey = 'AI_GRADING' | 'REPORT' | 'EXAM_VIEW';

type ViewfinderVariant = 'omr' | 'identityEssay' | 'essayPage' | 'generic';
type ViewfinderZone = {
  id: string;
  top: string;
  left: string;
  width: string;
  height: string;
  label?: string;
};

const VIEWFINDER_ZONES: Record<ViewfinderVariant, ViewfinderZone[]> = {
  omr: [
    { id: 'header', top: '3%', left: '8%', width: '84%', height: '8%', label: 'HEADER' },
    { id: 'identity', top: '13%', left: '8%', width: '54%', height: '16%', label: 'INFO' },
    { id: 'mssv', top: '13%', left: '66%', width: '26%', height: '20%', label: 'MSSV' },
    { id: 'instructions', top: '31%', left: '8%', width: '54%', height: '12%', label: 'INSTRUCTIONS' },
    { id: 'omr', top: '48%', left: '8%', width: '84%', height: '44%', label: 'OMR GRID' },
  ],
  identityEssay: [
    { id: 'header', top: '3%', left: '8%', width: '84%', height: '8%', label: 'HEADER' },
    { id: 'identity', top: '13%', left: '8%', width: '54%', height: '16%', label: 'INFO' },
    { id: 'mssv', top: '13%', left: '66%', width: '26%', height: '20%', label: 'MSSV' },
    { id: 'instructions', top: '31%', left: '8%', width: '54%', height: '12%', label: 'INSTRUCTIONS' },
    { id: 'essay', top: '48%', left: '8%', width: '84%', height: '44%', label: 'ESSAY AREA' },
  ],
  essayPage: [
    { id: 'essay-header', top: '4%', left: '8%', width: '84%', height: '10%', label: 'QUESTION HEADER' },
    { id: 'essay-body', top: '18%', left: '8%', width: '84%', height: '68%', label: 'ANSWER AREA' },
    { id: 'essay-footer', top: '88%', left: '8%', width: '84%', height: '6%', label: 'END LINE' },
  ],
  generic: [],
};

const ViewfinderOverlay: React.FC<{ variant: ViewfinderVariant }> = ({ variant }) => {
  const zones = VIEWFINDER_ZONES[variant];
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-[4%] rounded-lg border border-white/40" />
      {zones.map((zone) => (
        <div
          key={zone.id}
          className="absolute rounded-md border border-dashed border-white/50 bg-white/5"
          style={{ top: zone.top, left: zone.left, width: zone.width, height: zone.height }}
        >
          {zone.label && (
            <span className="absolute left-1 top-1 text-[10px] uppercase tracking-wide text-white/70">
              {zone.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

type ExamScanBlueprintConfig = {
  scannablePages?: number;
  passPurposeByIndex?: Record<string, string>;
};

type SubmissionFeedbackPayload = {
  warnings: string[];
  objectiveScore: number | null;
  essayScore: number | null;
  totalScore: number | null;
  aiComments: string | null;
  mergedPdfUrl: string | null;
  aiReport: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    integrityFlags: string[];
  } | null;
};

const TeacherSessionManagement: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedExam, setSelectedExam] = useState<BuiltExam | null>(null);
  const [submissions, setSubmissions] = useState<ExamSubmission[]>([]);
  const [report, setReport] = useState<any | null>(null);
  const [tab, setTab] = useState<TabKey>('AI_GRADING');
  const [scanMode, setScanMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [activeSubmissionId, setActiveSubmissionId] = useState<number | null>(null);
  const [activePassIndex, setActivePassIndex] = useState(1);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureHint, setCaptureHint] = useState('Camera is idle');
  const [capturing, setCapturing] = useState(false);
  const [publishingReport, setPublishingReport] = useState(false);
  const [mobileScanLink, setMobileScanLink] = useState('');
  const [workflowSummary, setWorkflowSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkUploadResult, setBulkUploadResult] = useState<BulkUploadResponse | null>(null);
  const [issuesReport, setIssuesReport] = useState<SessionIssuesReport | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [regradingSubmissionId, setRegradingSubmissionId] = useState<number | null>(null);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);
  const [inlineEditScore, setInlineEditScore] = useState<{ submissionId: number; score: string } | null>(null);

  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qualityTimerRef = useRef<number | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const activeSubmission = useMemo(
    () => submissions.find((item) => item.id === activeSubmissionId) || null,
    [submissions, activeSubmissionId]
  );

  const essayQuestionIds = useMemo(
    () => (selectedExam?.questions || []).filter((item) => item.question.type === 'ESSAY').map((item) => item.question.id),
    [selectedExam]
  );

  const hasMcq = useMemo(
    () => (selectedExam?.questions || []).some((item) => item.question.type === 'MULTIPLE_CHOICE'),
    [selectedExam]
  );

  const buildFallbackPassPurpose = (passIndex: number): string => {
    if (essayQuestionIds.length === 0) {
      return 'IDENTITY_OMR';
    }
    if (hasMcq) {
      if (passIndex === 1) return 'IDENTITY_OMR';
      const essayId = essayQuestionIds[passIndex - 2];
      return essayId ? `ESSAY_${essayId}` : `PAGE_${passIndex}`;
    }
    const essayId = essayQuestionIds[passIndex - 1];
    return essayId ? `IDENTITY_ESSAY_${essayId}` : `PAGE_${passIndex}`;
  };

  const fallbackExpectedPasses = useMemo(() => {
    const inferred = hasMcq ? essayQuestionIds.length + 1 : essayQuestionIds.length;
    return inferred > 0 ? inferred : 1;
  }, [essayQuestionIds, hasMcq]);

  const scanBlueprint = useMemo<ExamScanBlueprintConfig | null>(() => {
    const requirementSources = [report?.session?.exam?.requirements, selectedExam?.requirements];
    for (const raw of requirementSources) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      try {
        const parsed = JSON.parse(raw) as { scanBlueprint?: ExamScanBlueprintConfig };
        if (parsed?.scanBlueprint && typeof parsed.scanBlueprint === 'object') {
          return parsed.scanBlueprint;
        }
      } catch {
        continue;
      }
    }
    return null;
  }, [report, selectedExam]);

  const expectedPasses = useMemo(() => {
    const reportExpectedPages = Number.parseInt(String(report?.session?.exam?.expectedPages), 10);
    if (Number.isFinite(reportExpectedPages) && reportExpectedPages > 0) {
      return reportExpectedPages;
    }

    const configuredScannablePages = Number.parseInt(String(scanBlueprint?.scannablePages), 10);
    if (Number.isFinite(configuredScannablePages) && configuredScannablePages > 0) {
      return configuredScannablePages;
    }

    return fallbackExpectedPasses;
  }, [report, scanBlueprint, fallbackExpectedPasses]);

  const passPurposeByIndex = useMemo(() => {
    const purposes: Record<number, string> = {};
    const rawMap = scanBlueprint?.passPurposeByIndex || {};

    for (const [rawIndex, rawPurpose] of Object.entries(rawMap)) {
      const index = Number.parseInt(rawIndex, 10);
      if (!Number.isFinite(index) || index < 1 || index > expectedPasses) continue;
      const normalized = String(rawPurpose || '').trim();
      if (!normalized) continue;
      purposes[index] = normalized;
    }

    for (let passIndex = 1; passIndex <= expectedPasses; passIndex += 1) {
      if (!purposes[passIndex]) {
        purposes[passIndex] = buildFallbackPassPurpose(passIndex);
      }
    }

    return purposes;
  }, [scanBlueprint, expectedPasses, essayQuestionIds, hasMcq]);

  const getTotalPasses = (): number => {
    return expectedPasses;
  };

  const getPassPurpose = (passIndex: number): string => {
    return passPurposeByIndex[passIndex] || `PAGE_${passIndex}`;
  };

  const getPassTitle = (passIndex: number): string => {
    const purpose = getPassPurpose(passIndex);
    if (purpose === 'IDENTITY_OMR') return 'Pass 1: Student Info + OMR';
    if (purpose.startsWith('IDENTITY_ESSAY_')) {
      return `Pass ${passIndex}: Student Info + ${purpose.replace('IDENTITY_', '')}`;
    }
    if (purpose.startsWith('ESSAY_')) return `Pass ${passIndex}: ${purpose}`;
    if (purpose.startsWith('PAGE_')) return `Pass ${passIndex}: Additional Page`;
    return `Pass ${passIndex}`;
  };

  const viewfinderVariant = useMemo<ViewfinderVariant>(() => {
    const purpose = getPassPurpose(activePassIndex).toUpperCase();
    if (purpose.includes('IDENTITY_ESSAY')) return 'identityEssay';
    if (purpose.includes('ESSAY')) return 'essayPage';
    if (purpose.includes('OMR')) return 'omr';
    return 'generic';
  }, [activePassIndex, passPurposeByIndex]);

  const parseSubmissionFeedback = (submission: ExamSubmission): SubmissionFeedbackPayload => {
    const toNumberOrNull = (value: unknown): number | null => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const empty: SubmissionFeedbackPayload = {
      warnings: [],
      objectiveScore: toNumberOrNull(submission.objectiveScore),
      essayScore: toNumberOrNull(submission.essayScore),
      totalScore: toNumberOrNull(submission.totalScore ?? submission.finalScore),
      aiComments: submission.aiComments || null,
      mergedPdfUrl: submission.mergedPdfUrl || null,
      aiReport: null,
    };

    const raw = submission.feedback;
    if (!raw || !raw.trim()) return empty;

    try {
      const parsed = JSON.parse(raw) as {
        warnings?: unknown;
        objectiveScore?: unknown;
        essayScore?: unknown;
        totalScore?: unknown;
        aiComments?: unknown;
        mergedPdfUrl?: unknown;
        aiReport?: {
          summary?: unknown;
          strengths?: unknown;
          weaknesses?: unknown;
          recommendations?: unknown;
          integrityFlags?: unknown;
        };
      };

      const normalizeTextArray = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      };

      const summary = String(parsed?.aiReport?.summary || '').trim();
      const strengths = normalizeTextArray(parsed?.aiReport?.strengths);
      const weaknesses = normalizeTextArray(parsed?.aiReport?.weaknesses);
      const recommendations = normalizeTextArray(parsed?.aiReport?.recommendations);
      const integrityFlags = normalizeTextArray(parsed?.aiReport?.integrityFlags);
      const hasAiReport = summary || strengths.length || weaknesses.length || recommendations.length || integrityFlags.length;

      return {
        warnings: normalizeTextArray(parsed?.warnings),
        objectiveScore: toNumberOrNull(submission.objectiveScore ?? parsed?.objectiveScore),
        essayScore: toNumberOrNull(submission.essayScore ?? parsed?.essayScore),
        totalScore: toNumberOrNull(submission.totalScore ?? parsed?.totalScore),
        aiComments: String(submission.aiComments || parsed?.aiComments || '').trim() || null,
        mergedPdfUrl: String(submission.mergedPdfUrl || parsed?.mergedPdfUrl || '').trim() || null,
        aiReport: hasAiReport
          ? {
            summary,
            strengths,
            weaknesses,
            recommendations,
            integrityFlags,
          }
          : null,
      };
    } catch {
      return empty;
    }
  };

  const parseScanEntriesFromRaw = (scanFiles: string | undefined): ExamScanEntry[] => {
    if (!scanFiles) return [];
    try {
      const parsed = JSON.parse(scanFiles) as unknown[];
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((entry) => {
          if (typeof entry === 'string') {
            if (entry.startsWith('http://') || entry.startsWith('https://')) {
              return { source: 'cloudinary', url: entry, accessUrl: entry } as ExamScanEntry;
            }
            return {
              source: 'local',
              filename: entry,
              accessUrl: `/uploads/scans/${encodeURIComponent(entry)}`,
            } as ExamScanEntry;
          }

          if (entry && typeof entry === 'object') {
            const scan = entry as ExamScanEntry;
            return {
              ...scan,
              accessUrl: scan.accessUrl
                || scan.url
                || (scan.filename ? `/uploads/scans/${encodeURIComponent(scan.filename)}` : undefined),
            };
          }

          return null;
        })
        .filter((entry): entry is ExamScanEntry => !!entry);
    } catch {
      return [];
    }
  };

  const resolveScanEntries = (submission: ExamSubmission): ExamScanEntry[] => {
    if (Array.isArray(submission.scanEntries) && submission.scanEntries.length > 0) {
      return submission.scanEntries.map((scan) => ({
        ...scan,
        accessUrl: scan.accessUrl
          || scan.url
          || (scan.filename ? `/uploads/scans/${encodeURIComponent(scan.filename)}` : undefined),
      }));
    }
    return parseScanEntriesFromRaw(submission.scanFiles);
  };

  const parseScanCount = (submission: ExamSubmission): number => {
    return resolveScanEntries(submission).length;
  };

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ExamSession[]>('/exams/sessions');
      setSessions(data);
      if (data.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data[0].id);
      }
    } catch {
      toast.error('Failed to load exam sessions');
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetails = async (sessionId: number) => {
    try {
      const [submissionRes, reportRes] = await Promise.all([
        api.get<ExamSubmission[]>(`/exams/sessions/${sessionId}/submissions`),
        api.get(`/exams/sessions/${sessionId}/report`),
      ]);
      setSubmissions(submissionRes.data);
      setReport(reportRes.data);

      const examId = reportRes.data?.session?.exam?.id;
      if (examId) {
        const examRes = await api.get<BuiltExam>(`/exams/builder/${examId}`);
        setSelectedExam(examRes.data);
      }
    } catch {
      toast.error('Failed to load session details');
    }
  };

  const deleteSession = async (sessionId: number) => {
    const confirmed = window.confirm(`Delete session #${sessionId}? This will remove related submissions.`);
    if (!confirmed) return;

    try {
      await api.delete(`/exams/sessions/${sessionId}`);
      toast.success(`Session #${sessionId} deleted`);
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setSelectedExam(null);
        setSubmissions([]);
        setReport(null);
      }
      await fetchSessions();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete session');
    }
  };

  const stopCamera = () => {
    if (qualityTimerRef.current) {
      window.clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCaptureReady(false);
    setCaptureHint('Camera is idle');
  };

  const startCamera = async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Live camera needs HTTPS (or localhost). You can still use Upload Full Set below.');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }

      streamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }

      setCameraOpen(true);
      setCaptureHint('Align answer sheet and wait for green status');
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Cannot access camera';
      toast.error(message);
    }
  };

  const evaluateCaptureQuality = () => {
    const video = cameraVideoRef.current;
    const canvas = probeCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      setCaptureReady(false);
      setCaptureHint('Waiting for camera signal');
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = 320;
    canvas.height = 240;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let brightnessTotal = 0;
    let edgeTotal = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      brightnessTotal += gray;
      if (i >= 8) {
        const prevGray = 0.299 * data[i - 4] + 0.587 * data[i - 3] + 0.114 * data[i - 2];
        edgeTotal += Math.abs(gray - prevGray);
      }
    }

    const pixels = data.length / 4;
    const avgBrightness = brightnessTotal / Math.max(1, pixels);
    const edgeScore = edgeTotal / Math.max(1, pixels);
    const ready = avgBrightness > 65 && avgBrightness < 210 && edgeScore > 8;

    setCaptureReady(ready);
    if (ready) {
      setCaptureHint('Green: readable, press Capture');
    } else if (avgBrightness <= 65) {
      setCaptureHint('Too dark, increase light');
    } else if (avgBrightness >= 210) {
      setCaptureHint('Too bright, avoid glare');
    } else {
      setCaptureHint('Hold device steady and fill frame with paper');
    }
  };

  const validateUploadedImageQuality = async (file: File): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const objectUrl = URL.createObjectURL(file);

      const result = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
        const image = new Image();

        image.onload = () => {
          try {
            const width = image.naturalWidth;
            const height = image.naturalHeight;

            if (width < 900 || height < 1200) {
              resolve({ ok: false, reason: 'resolution too low (minimum 900x1200)' });
              return;
            }

            const probeWidth = 320;
            const probeHeight = Math.max(180, Math.round((height / Math.max(1, width)) * probeWidth));
            const canvas = document.createElement('canvas');
            canvas.width = probeWidth;
            canvas.height = probeHeight;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              resolve({ ok: false, reason: 'cannot analyze image' });
              return;
            }

            ctx.drawImage(image, 0, 0, probeWidth, probeHeight);
            const data = ctx.getImageData(0, 0, probeWidth, probeHeight).data;

            let brightnessTotal = 0;
            let edgeTotal = 0;
            for (let i = 0; i < data.length; i += 4) {
              const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              brightnessTotal += gray;
              if (i >= 8) {
                const prevGray = 0.299 * data[i - 4] + 0.587 * data[i - 3] + 0.114 * data[i - 2];
                edgeTotal += Math.abs(gray - prevGray);
              }
            }

            const pixels = data.length / 4;
            const avgBrightness = brightnessTotal / Math.max(1, pixels);
            const edgeScore = edgeTotal / Math.max(1, pixels);

            if (avgBrightness <= 60) {
              resolve({ ok: false, reason: 'too dark' });
              return;
            }
            if (avgBrightness >= 220) {
              resolve({ ok: false, reason: 'too bright / glare' });
              return;
            }
            if (edgeScore <= 7) {
              resolve({ ok: false, reason: 'blurred or low edge contrast' });
              return;
            }

            resolve({ ok: true });
          } catch {
            resolve({ ok: false, reason: 'cannot analyze image content' });
          }
        };

        image.onerror = () => {
          resolve({ ok: false, reason: 'invalid image file' });
        };

        image.src = objectUrl;
      });

      URL.revokeObjectURL(objectUrl);
      return result;
    } catch {
      return { ok: false, reason: 'failed to read image file' };
    }
  };

  const uploadScanForSubmission = async (
    submission: ExamSubmission | null,
    uploadInput?: File | FileList | null,
    passIndex?: number,
    totalPasses?: number,
    purpose?: string
  ) => {
    if (!selectedSessionId || !uploadInput) return null;

    const files = uploadInput instanceof File
      ? [uploadInput]
      : Array.from(uploadInput);

    if (files.length === 0) {
      toast.error('No file selected');
      return;
    }

    if (files.some((file) => !file.type.startsWith('image/'))) {
      toast.error('Only image files are allowed for scan upload');
      return;
    }

    const isCaptureMode = Number.isFinite(Number(passIndex));
    const expectedPasses = getTotalPasses();

    if (!isCaptureMode && files.length !== expectedPasses) {
      toast.error(`Upload Full Set requires exactly ${expectedPasses} image(s). You selected ${files.length}.`);
      return;
    }

    const formData = new FormData();
    if (submission?.student?.id) {
      formData.append('studentId', String(submission.student.id));
    }
    files.forEach((file) => formData.append('files', file));
    if (isCaptureMode) {
      formData.append('passIndex', String(passIndex));
    }
    formData.append(
      'totalPasses',
      String(Number.isFinite(Number(totalPasses)) ? Number(totalPasses) : expectedPasses)
    );
    if (purpose) {
      formData.append('purpose', purpose);
    }

    try {
      const { data } = await api.post(`/exams/sessions/${selectedSessionId}/submissions/scan-upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const resolvedName = data?.resolvedStudent?.fullName || submission?.student?.fullName || 'detected student';
      toast.success(
        isCaptureMode
          ? `Uploaded scan for ${resolvedName} (${data.scanCount || '-'})`
          : `Uploaded full paper set for ${resolvedName} (${data.scanCount || '-'})`
      );
      await fetchSessionDetails(selectedSessionId);
      return data;
    } catch (err: any) {
      const payload = err?.response?.data;
      const invalidScans = Array.isArray(payload?.invalidScans) ? payload.invalidScans : [];

      if (invalidScans.length > 0) {
        toast.error(payload?.error || 'Ảnh bài làm bị mờ hoặc thiếu góc, vui lòng chụp lại rõ nét hơn.');
        return null;
      }

      if (payload?.requiresManualSelection) {
        toast.error(payload?.error || 'Không nhận diện được tên hoặc MSSV, vui lòng kiểm tra lại ảnh trang đầu.');

        if (Array.isArray(payload?.candidates) && payload.candidates.length === 1) {
          const inferredStudentId = Number(payload.candidates[0]?.id || 0);
          const matchedSubmission = submissions.find((item) => item.student?.id === inferredStudentId);
          if (matchedSubmission) {
            setActiveSubmissionId(matchedSubmission.id);
          }
        }

        return null;
      }

      toast.error(payload?.error || 'Failed to upload scan');
      return null;
    }
  };

  const openCameraForSubmission = async (submission: ExamSubmission) => {
    setScanMode(true);
    setActiveSubmissionId(submission.id);
    setActivePassIndex(1);
    if (!cameraOpen) {
      await startCamera();
    }
  };

  const openCameraForAutoScan = async () => {
    setScanMode(true);
    setActiveSubmissionId(null);
    setActivePassIndex(1);
    if (!cameraOpen) {
      await startCamera();
    }
  };

  const captureForActiveSubmission = async () => {
    if (!captureReady) {
      toast.error('Image quality is not ready yet. Wait for green indicator before capturing.');
      return;
    }

    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera frame unavailable');
      return;
    }

    setCapturing(true);
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        toast.error('Cannot process captured frame');
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) {
        toast.error('Failed to capture frame');
        return;
      }

      const linkedStudent = activeSubmission?.studentId || 'auto';
      const file = new File([blob], `scan_${linkedStudent}_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const totalPasses = getTotalPasses();
      const purpose = getPassPurpose(activePassIndex);
      const uploadResult = await uploadScanForSubmission(activeSubmission || null, file, activePassIndex, totalPasses, purpose);

      const resolvedStudentId = Number(uploadResult?.resolvedStudentId || 0);
      if (resolvedStudentId > 0) {
        const matchedSubmission = submissions.find((item) => item.student?.id === resolvedStudentId);
        if (matchedSubmission) {
          setActiveSubmissionId(matchedSubmission.id);
        }
      }

      if (activePassIndex < totalPasses) {
        setActivePassIndex((prev) => prev + 1);
      } else {
        setActiveSubmissionId(null);
        setActivePassIndex(1);
        toast.success('Completed one paper set. Continue scanning the next student paper.');
      }
    } finally {
      setCapturing(false);
    }
  };

  const gradeAI = async (submissionId: number) => {
    try {
      await api.post(`/exams/submissions/${submissionId}/grade-ai`, { useScanExtraction: true });
      toast.success('Batch AI grading completed');
      if (selectedSessionId) fetchSessionDetails(selectedSessionId);
    } catch {
      toast.error('Failed to grade with AI');
    }
  };

  const completeScanningAndAutoGrade = async () => {
    if (!selectedSessionId) return;
    try {
      const { data } = await api.post(`/exams/sessions/${selectedSessionId}/complete-scanning`, {});
      setWorkflowSummary(data);
      toast.success(`Batch graded ${data.gradedCount || 0}/${data.totalSubmissions || 0} submissions`);
      await fetchSessionDetails(selectedSessionId);
      await fetchSessions();
      setTab('REPORT');
      setScanMode(false);
      stopCamera();
    } catch {
      toast.error('Failed to complete scanning workflow');
    }
  };

  const reviewScore = async (submissionId: number, current: number | null | undefined) => {
    const raw = prompt('Final score', String(current ?? 0));
    if (!raw) return;
    const score = Number(raw);
    if (!Number.isFinite(score)) {
      toast.error('Invalid score');
      return;
    }

    try {
      await api.post(`/exams/submissions/${submissionId}/review`, {
        finalScore: score,
        note: 'Manual review from session management',
      });
      toast.success('Final score updated');
      if (selectedSessionId) fetchSessionDetails(selectedSessionId);
    } catch {
      toast.error('Failed to review score');
    }
  };

  const exportExam = async () => {
    if (!selectedExam) return;
    try {
      const response = await api.get(`/exams/builder/${selectedExam.id}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `exam_session_${selectedExam.id}.docx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Exam exported (.docx template)');
    } catch {
      toast.error('Failed to export exam');
    }
  };

  const exportAnswerKey = async () => {
    if (!selectedExam) return;
    try {
      const response = await api.get(`/exams/builder/${selectedExam.id}/export-answer-key`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `answer_key_${selectedExam.id}.docx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Answer key exported (.docx template)');
    } catch {
      toast.error('Failed to export answer key');
    }
  };

  const handleBulkUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedSessionId) return;
    setBulkUploading(true);
    setBulkUploadResult(null);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append('files', file));
      const { data } = await api.post<BulkUploadResponse>(
        `/exams/sessions/${selectedSessionId}/bulk-upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setBulkUploadResult(data);
      toast.success(data.message || 'Bulk upload completed');
      await fetchSessionDetails(selectedSessionId);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Bulk upload failed');
    } finally {
      setBulkUploading(false);
    }
  };

  const fetchIssuesReport = async () => {
    if (!selectedSessionId) return;
    setIssuesLoading(true);
    try {
      const { data } = await api.get<SessionIssuesReport>(`/exams/sessions/${selectedSessionId}/issues`);
      setIssuesReport(data);
    } catch {
      toast.error('Failed to load issues report');
    } finally {
      setIssuesLoading(false);
    }
  };

  const handleRegrade = async (submissionId: number) => {
    setRegradingSubmissionId(submissionId);
    try {
      const { data } = await api.post<RegradeResponse>(`/exams/submissions/${submissionId}/regrade`);
      if (data.status === 'GRADED') {
        toast.success(`Regraded: ${data.studentName} — ${data.previousScore ?? '-'} → ${data.newScore}`);
      } else {
        toast.error(data.error || 'Regrade failed');
      }
      if (selectedSessionId) fetchSessionDetails(selectedSessionId);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to regrade');
    } finally {
      setRegradingSubmissionId(null);
    }
  };

  const handleUploadMissing = async (submissionId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append('files', file));
      const { data } = await api.post(`/exams/submissions/${submissionId}/upload-missing`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`Uploaded ${data.pagesUploaded} page(s) for ${data.studentName}`);
      if (selectedSessionId) fetchSessionDetails(selectedSessionId);
      fetchIssuesReport();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to upload missing pages');
    }
  };

  const saveInlineScore = async () => {
    if (!inlineEditScore) return;
    const score = Number(inlineEditScore.score);
    if (!Number.isFinite(score)) {
      toast.error('Invalid score value');
      return;
    }
    try {
      await api.post(`/exams/submissions/${inlineEditScore.submissionId}/review`, {
        finalScore: score,
        note: 'Inline manual review from session management',
      });
      toast.success('Score updated');
      setInlineEditScore(null);
      if (selectedSessionId) fetchSessionDetails(selectedSessionId);
    } catch {
      toast.error('Failed to update score');
    }
  };

  const downloadSessionReportFile = async () => {
    if (!selectedSessionId) return;
    try {
      const response = await api.get(`/exams/sessions/${selectedSessionId}/report/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `session_${selectedSessionId}_report.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Report exported');
    } catch {
      toast.error('Failed to export report');
    }
  };

  const generateMobileScanLink = async () => {
    if (!selectedSessionId) return;

    try {
      const { data } = await api.post(`/exams/sessions/${selectedSessionId}/mobile-scan-link`);
      const rawLink = String(data?.scanUrl || '').trim();
      let normalizedLink = rawLink;

      try {
        const parsed = new URL(rawLink);
        const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        const currentHostIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        if (isLoopback && !currentHostIsLoopback) {
          parsed.protocol = window.location.protocol;
          parsed.host = window.location.host;
          normalizedLink = parsed.toString();
        }
      } catch {
        normalizedLink = rawLink;
      }

      setMobileScanLink(normalizedLink);
      toast.success('Mobile scan link created');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create mobile scan link');
    }
  };

  const copyMobileScanLink = async () => {
    if (!mobileScanLink) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mobileScanLink);
        toast.success('Link copied');
        return;
      }

      throw new Error('Clipboard API is unavailable');
    } catch {
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = mobileScanLink;
      tempTextArea.style.position = 'fixed';
      tempTextArea.style.opacity = '0';
      tempTextArea.style.pointerEvents = 'none';
      document.body.appendChild(tempTextArea);
      tempTextArea.focus();
      tempTextArea.select();

      const copied = document.execCommand('copy');
      document.body.removeChild(tempTextArea);

      if (copied) {
        toast.success('Link copied');
        return;
      }

      window.prompt('Copy this mobile scan link:', mobileScanLink);
      toast('Manual copy dialog opened');
    }
  };

  const confirmAndPublishReport = async () => {
    if (!selectedSessionId) return;

    const confirmed = window.confirm(
      'Confirm report and publish final scores to students? This will finalize all submissions in this session.'
    );
    if (!confirmed) return;

    setPublishingReport(true);
    try {
      const { data } = await api.post(`/exams/sessions/${selectedSessionId}/report/finalize`);
      toast.success(`Published to students. Auto-filled from AI: ${data.autoFilledFromAiCount || 0}, zero-scored: ${data.autoFilledZeroCount || 0}`);
      await fetchSessionDetails(selectedSessionId);
      await fetchSessions();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to confirm and publish report');
    } finally {
      setPublishingReport(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    const requestedTab = searchParams.get('tab') as TabKey | null;
    const requestedSessionId = parseInt(searchParams.get('sessionId') || '', 10);

    if (requestedTab && ['AI_GRADING', 'REPORT', 'EXAM_VIEW'].includes(requestedTab)) {
      setTab(requestedTab);
    }
    if (Number.isFinite(requestedSessionId)) {
      setSelectedSessionId(requestedSessionId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedSessionId) {
      setMobileScanLink('');
      fetchSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    setActivePassIndex((prev) => Math.min(Math.max(prev, 1), expectedPasses));
  }, [expectedPasses]);

  useEffect(() => {
    if (!cameraOpen) return;

    qualityTimerRef.current = window.setInterval(evaluateCaptureQuality, 400);
    return () => {
      if (qualityTimerRef.current) {
        window.clearInterval(qualityTimerRef.current);
        qualityTimerRef.current = null;
      }
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (!scanMode || !cameraOpen || !streamRef.current || !cameraVideoRef.current) return;

    const video = cameraVideoRef.current;
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => undefined);
    }
  }, [scanMode, cameraOpen, activeSubmissionId]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Session Management</h1>
          <p className="text-gray-500 mt-1">Manage scanning, batch AI auto-grading, reports, and exam view for active sessions</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Session</label>
            {selectedSessionId && (
              <button className="btn-danger text-xs" onClick={() => deleteSession(selectedSessionId)}>
                Delete Session
              </button>
            )}
          </div>
          <select
            className="input-field"
            value={selectedSessionId || ''}
            onChange={(e) => setSelectedSessionId(parseInt(e.target.value, 10))}
            disabled={loading || sessions.length === 0}
          >
            <option value="">-- Select Session --</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                Session #{session.id} - {session.exam?.title} - {session.class?.name} ({session.status})
              </option>
            ))}
          </select>
          {sessions.length > 0 && (
            <div className="mt-3 max-h-40 overflow-auto border border-gray-200 rounded-md">
              {sessions.map((session) => (
                <div key={session.id} className="px-3 py-2 border-b border-gray-100 last:border-0 flex items-center justify-between gap-2">
                  <button
                    className="text-left text-xs text-gray-700 hover:text-primary-700"
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    #{session.id} • {session.exam?.title} • {session.class?.name} • {session.status}
                  </button>
                  <button className="btn-secondary text-xs" onClick={() => deleteSession(session.id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className={`btn-secondary ${tab === 'AI_GRADING' ? 'bg-primary-600 text-white border-primary-600' : ''}`} onClick={() => setTab('AI_GRADING')}>
            <ClipboardCheck size={14} className="inline mr-1" /> Grade Papers
          </button>
          <button className={`btn-secondary ${tab === 'REPORT' ? 'bg-primary-600 text-white border-primary-600' : ''}`} onClick={() => setTab('REPORT')}>
            <BarChart3 size={14} className="inline mr-1" /> View Report
          </button>
          <button className={`btn-secondary ${tab === 'EXAM_VIEW' ? 'bg-primary-600 text-white border-primary-600' : ''}`} onClick={() => setTab('EXAM_VIEW')}>
            <Eye size={14} className="inline mr-1" /> View Exam
          </button>
        </div>

        {tab === 'AI_GRADING' && (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">Batch AI Grading and Manual Review</h2>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-secondary text-xs" onClick={generateMobileScanLink} disabled={!selectedSessionId}>
                  Create Mobile Link
                </button>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => {
                    if (submissions.length === 0) {
                      toast.error('No submissions to scan');
                      return;
                    }
                    setWorkflowSummary(null);
                    void openCameraForAutoScan();
                    toast.success('Scan mode started in auto-match mode.');
                  }}
                  disabled={!selectedSessionId || submissions.length === 0}
                >
                  Start Scan
                </button>
                <button className="btn-secondary text-xs" onClick={completeScanningAndAutoGrade} disabled={!selectedSessionId}>
                  Start Batch AI Grading
                </button>
                <button className="btn-secondary text-xs" onClick={fetchIssuesReport} disabled={!selectedSessionId || issuesLoading}>
                  <AlertTriangle size={14} className="inline mr-1" />
                  {issuesLoading ? 'Loading...' : 'Check Issues'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              Upload Full Set requires exactly {getTotalPasses()} image(s) per student. Hard-to-read pages are flagged by the server and must be re-uploaded immediately. The backend uses batch processing to grade all pages of a submission in a single optimized AI call.
            </p>

            {/* Bulk Upload Section */}
            <div className="border border-dashed border-primary-300 bg-primary-50/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-primary-800">Bulk Upload (All Students)</p>
                  <p className="text-xs text-primary-600">Upload all exam images in sequential order. The system groups images by {getTotalPasses()} pages per student and matches students using the identity/OMR block on page 1 of each set.</p>
                </div>
                <label className={`btn-primary text-xs cursor-pointer whitespace-nowrap ${bulkUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload size={14} className="inline mr-1" />
                  {bulkUploading ? 'Uploading...' : 'Select Images'}
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    disabled={bulkUploading || !selectedSessionId}
                    onChange={(e) => {
                      void handleBulkUpload(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
              {bulkUploading && (
                <div className="flex items-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                  <p className="text-xs text-primary-700">Extracting student identity from page 1 and matching sets...</p>
                </div>
              )}
            </div>

            {/* Bulk Upload Results */}
            {bulkUploadResult && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-gray-900">Bulk Upload Results</p>
                <div className="flex gap-4 text-xs">
                  <span className="text-green-700">✓ Matched: {bulkUploadResult.matched}</span>
                  <span className="text-amber-700">⚠ Ambiguous: {bulkUploadResult.ambiguous}</span>
                  <span className="text-red-700">✗ Unmatched: {bulkUploadResult.unmatched}</span>
                  <span className="text-gray-600">Total: {bulkUploadResult.totalImages} images</span>
                </div>
                {bulkUploadResult.classifications.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-auto">
                    {bulkUploadResult.classifications.map((cls, idx) => (
                      <div key={idx} className={`text-xs p-2 rounded border ${
                        cls.status === 'MATCHED' ? 'border-green-200 bg-green-50' :
                        cls.status === 'AMBIGUOUS' ? 'border-amber-200 bg-amber-50' :
                        'border-red-200 bg-red-50'
                      }`}>
                        <span className="font-medium">{cls.studentName || 'Unknown'}</span>
                        <span className="text-gray-500"> ({cls.studentCode})</span>
                        <span className="ml-2">{cls.pagesAssigned} pages</span>
                        {cls.warnings.length > 0 && <span className="text-amber-700 ml-2">• {cls.warnings.join(' | ')}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {bulkUploadResult.unmatchedFiles.length > 0 && (
                  <p className="text-xs text-red-600">Unmatched files: {bulkUploadResult.unmatchedFiles.join(', ')}</p>
                )}
              </div>
            )}

            {/* Issues Panel */}
            {issuesReport && (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-amber-900">
                    <AlertTriangle size={14} className="inline mr-1" />
                    Session Issues ({issuesReport.studentsWithIssues} students)
                  </p>
                  <span className="text-xs text-green-700">Ready for grading: {issuesReport.readyForGrading}/{issuesReport.totalStudents}</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-red-700">🔴 Missing: {issuesReport.summary.missingExams}</span>
                  <span className="text-amber-700">🟡 Incomplete: {issuesReport.summary.incompletePages}</span>
                  <span className="text-orange-700">🟠 Unreadable: {issuesReport.summary.unreadableImages}</span>
                  <span className="text-purple-700">🟣 ID mismatch: {issuesReport.summary.identityMismatches}</span>
                </div>
                {issuesReport.issues.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-auto">
                    {issuesReport.issues.map((issue) => (
                      <div key={issue.submissionId} className="flex items-center justify-between gap-2 text-xs border border-amber-100 rounded-md p-2 bg-white">
                        <div>
                          <span className="font-medium text-gray-900">{issue.studentName}</span>
                          <span className="text-gray-500 ml-1">({issue.studentCode})</span>
                          <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            issue.issueType === 'MISSING_EXAM' ? 'bg-red-100 text-red-700' :
                            issue.issueType === 'INCOMPLETE_PAGES' ? 'bg-amber-100 text-amber-700' :
                            issue.issueType === 'UNREADABLE_IMAGE' ? 'bg-orange-100 text-orange-700' :
                            'bg-purple-100 text-purple-700'
                          }`}>{issue.issueType.replace(/_/g, ' ')}</span>
                          <span className="text-gray-500 ml-2">{issue.description}</span>
                        </div>
                        <div className="flex gap-1">
                          <label className="btn-secondary text-[10px] cursor-pointer">
                            <Upload size={12} className="inline mr-0.5" />Re-upload
                            <input
                              type="file"
                              multiple
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                void handleUploadMissing(issue.submissionId, e.target.files);
                                e.currentTarget.value = '';
                              }}
                            />
                          </label>
                          <button
                            className="btn-secondary text-[10px]"
                            onClick={() => handleRegrade(issue.submissionId)}
                            disabled={regradingSubmissionId === issue.submissionId}
                          >
                            <RefreshCw size={12} className="inline mr-0.5" />
                            {regradingSubmissionId === issue.submissionId ? 'Regrading...' : 'Regrade'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mobileScanLink && (
              <div className="border border-primary-200 bg-primary-50 rounded-lg p-3 space-y-2">
                <p className="text-xs text-primary-800 font-medium">Mobile scan link</p>
                <a href={mobileScanLink} target="_blank" rel="noreferrer" className="text-xs text-primary-700 break-all underline">
                  {mobileScanLink}
                </a>
                {/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(mobileScanLink) && (
                  <p className="text-xs text-amber-700">
                    This link is localhost-only. Open frontend by your LAN IP/HTTPS to share with phone camera.
                  </p>
                )}
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs" onClick={copyMobileScanLink}>Copy Link</button>
                  <a href={mobileScanLink} target="_blank" rel="noreferrer" className="btn-secondary text-xs">Open Link</a>
                </div>
              </div>
            )}

            {scanMode && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <p className="text-xs text-primary-700">When indicator turns green, press Capture to upload this scan for the selected student.</p>
                <div className="grid lg:grid-cols-3 gap-3">
                  <div className="lg:col-span-2">
                    <div className={`rounded-xl border-2 overflow-hidden ${captureReady ? 'border-green-500' : 'border-red-400'}`}>
                      <div className="relative w-full aspect-[210/297] bg-black">
                        <video ref={cameraVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                        <ViewfinderOverlay variant={viewfinderVariant} />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <p className={`text-xs ${captureReady ? 'text-green-700' : 'text-amber-700'}`}>{captureHint}</p>
                      <div className="flex gap-2">
                        <button className="btn-secondary text-xs" onClick={() => (cameraOpen ? stopCamera() : startCamera())}>
                          {cameraOpen ? <CameraOff size={14} className="inline mr-1" /> : <Camera size={14} className="inline mr-1" />}
                          {cameraOpen ? 'Stop Camera' : 'Start Camera'}
                        </button>
                        <button className="btn-primary text-xs" onClick={captureForActiveSubmission} disabled={!cameraOpen || !captureReady || capturing}>
                          {capturing ? 'Capturing...' : 'Capture'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      {activeSubmission ? getPassTitle(activePassIndex) : 'Auto match student from page 1'} / Total passes: {getTotalPasses()}
                    </p>
                    {/* Page progress indicator */}
                    <div className="flex gap-1 mt-2">
                      {Array.from({ length: getTotalPasses() }, (_, i) => i + 1).map((pageNum) => (
                        <div
                          key={pageNum}
                          className={`h-2 flex-1 rounded-full transition-colors ${
                            pageNum < activePassIndex ? 'bg-green-500' :
                            pageNum === activePassIndex ? 'bg-primary-500 animate-pulse' :
                            'bg-gray-200'
                          }`}
                          title={`Page ${pageNum}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Selected student</p>
                    <div className="border border-gray-200 rounded-lg p-2">
                      {activeSubmission ? (
                        <>
                          <p className="text-sm font-medium text-gray-900">{activeSubmission.student?.fullName}</p>
                          <p className="text-xs text-gray-500">{activeSubmission.student?.username}</p>
                          <div className="flex gap-2 mt-2">
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => setActivePassIndex((prev) => Math.max(1, prev - 1))}
                              disabled={activePassIndex <= 1}
                            >
                              Prev Pass
                            </button>
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => setActivePassIndex((prev) => Math.min(getTotalPasses(), prev + 1))}
                              disabled={activePassIndex >= getTotalPasses()}
                            >
                              Next Pass
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-gray-500">Auto mode is active. The system matches the student from page 1 of each scanned set.</p>
                      )}
                    </div>
                  </div>
                </div>
                <canvas ref={probeCanvasRef} className="hidden" />
                <canvas ref={captureCanvasRef} className="hidden" />
              </div>
            )}

            {workflowSummary && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-gray-900">Auto Grading Summary</p>
                <p className="text-xs text-gray-600">
                  Graded: {workflowSummary.gradedCount || 0} • Failed: {workflowSummary.failedCount || 0} • Identity mismatch: {workflowSummary.identityMismatchCount || 0}
                </p>
                {Array.isArray(workflowSummary.results) && workflowSummary.results.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-auto">
                    {workflowSummary.results.map((item: any) => (
                      <div key={item.submissionId} className="border border-gray-100 rounded-md p-2 text-xs">
                        <p className="font-medium text-gray-900">{item.studentName} ({item.studentCode}) - {item.status}</p>
                        <p className="text-gray-600">Objective: {item.objectiveScore} • Essay: {item.essayScore} • Total: {item.totalScore}</p>
                        {Array.isArray(item.warnings) && item.warnings.length > 0 && <p className="text-amber-700">Warnings: {item.warnings.join(' | ')}</p>}
                        {item.error && <p className="text-red-600">Error: {item.error}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {submissions.length === 0 ? (
              <p className="text-sm text-gray-500">No submissions for this session.</p>
            ) : (
              submissions.map((item) => {
                const scans = resolveScanEntries(item);
                const feedback = parseSubmissionFeedback(item);
                const mergedPdfUrl = feedback.mergedPdfUrl || scans.find((scan) => !!scan.mergedPdfUrl)?.mergedPdfUrl || null;

                return (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.student?.fullName} ({item.student?.username})</p>
                        <p className="text-xs text-gray-500">
                          Objective: {feedback.objectiveScore ?? '-'} • Essay: {feedback.essayScore ?? '-'} • Total: {feedback.totalScore ?? item.finalScore ?? '-'}
                        </p>
                        <p className="text-xs text-gray-500">AI: {item.aiScore ?? '-'} • Final: {item.finalScore ?? '-'} • Scans: {parseScanCount(item)}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button className="btn-secondary text-xs" onClick={() => void openCameraForSubmission(item)}>
                          <Camera size={14} className="inline mr-1" />Camera
                        </button>
                        <label className="btn-secondary text-xs cursor-pointer">
                          <Upload size={14} className="inline mr-1" />Upload Full Set
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              void uploadScanForSubmission(item, e.target.files);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                        <button className="btn-secondary text-xs" onClick={() => gradeAI(item.id)}>Batch AI Grade</button>
                        <button
                          className="btn-secondary text-xs"
                          onClick={() => handleRegrade(item.id)}
                          disabled={regradingSubmissionId === item.id}
                        >
                          <RefreshCw size={14} className="inline mr-1" />
                          {regradingSubmissionId === item.id ? 'Regrading...' : 'AI Regrade'}
                        </button>
                        <button className="btn-secondary text-xs" onClick={() => reviewScore(item.id, item.finalScore)}>Manual Review</button>
                      </div>
                    </div>

                    {mergedPdfUrl && (
                      <p className="text-xs text-primary-700">
                        <a href={mergedPdfUrl} target="_blank" rel="noreferrer" className="underline">Merged PDF</a>
                      </p>
                    )}

                    {scans.length > 0 && (
                      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {scans.map((scan, idx) => {
                          const href = scan.accessUrl || scan.url || (scan.filename ? `/uploads/scans/${encodeURIComponent(scan.filename)}` : '');
                          if (!href) return null;

                          return (
                            <a
                              key={`${item.id}-grading-${idx}`}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="border border-gray-200 rounded-md p-2 hover:border-primary-300 transition-colors"
                            >
                              <p className="text-xs text-primary-700 truncate">Uploaded {idx + 1} {scan.passIndex ? `(Pass ${scan.passIndex})` : ''}</p>
                              <img src={href} alt={`grading-scan-${idx + 1}`} className="mt-1 w-full h-20 object-cover rounded" loading="lazy" />
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'REPORT' && (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">Session Report</h2>
              <div className="flex gap-2">
                <button
                  className="btn-primary text-xs"
                  onClick={confirmAndPublishReport}
                  disabled={!selectedSessionId || publishingReport || report?.publish?.isPublishedToStudents}
                >
                  <CheckCircle2 size={14} className="inline mr-1" />
                  {report?.publish?.isPublishedToStudents ? 'Published' : publishingReport ? 'Publishing...' : 'Confirm & Publish'}
                </button>
                <button className="btn-secondary text-xs" onClick={downloadSessionReportFile} disabled={!selectedSessionId}>
                  <Download size={14} className="inline mr-1" />Export CSV
                </button>
              </div>
            </div>

            {/* Summary Stats Table */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Total Students', value: report?.totals?.submissions ?? 0, color: 'text-gray-900' },
                { label: 'Graded', value: report?.totals?.graded ?? 0, color: 'text-green-700' },
                { label: 'Average', value: report?.scoreStats?.average != null ? Number(report.scoreStats.average).toFixed(1) : '-', color: 'text-primary-700' },
                { label: 'Min', value: report?.scoreStats?.min ?? '-', color: 'text-amber-700' },
                { label: 'Max', value: report?.scoreStats?.max ?? '-', color: 'text-green-700' },
              ].map((stat) => (
                <div key={stat.label} className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">{stat.label}</p>
                  <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <p className={`text-sm ${report?.publish?.isPublishedToStudents ? 'text-green-700' : 'text-amber-700'}`}>
              {report?.publish?.isPublishedToStudents
                ? 'Published to student portal'
                : 'Not published yet. Confirm report to sync final results for students.'}
            </p>
            {workflowSummary && (
              <p className="text-sm text-green-700 flex items-center gap-1">
                <CheckCircle2 size={14} /> Latest auto grading run completed: {workflowSummary.gradedCount || 0} graded
              </p>
            )}

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">Submission Details</p>
              {(Array.isArray(report?.submissions) ? report.submissions : submissions).length === 0 ? (
                <p className="text-sm text-gray-500">No submissions available.</p>
              ) : (
                (Array.isArray(report?.submissions) ? report.submissions : submissions).map((item: ExamSubmission) => {
                  const scans = resolveScanEntries(item);
                  const feedback = parseSubmissionFeedback(item);
                  const mergedPdfUrl = feedback.mergedPdfUrl || scans.find((scan) => !!scan.mergedPdfUrl)?.mergedPdfUrl || null;
                  const isExpanded = expandedSubmissionId === item.id;
                  const isInlineEditing = inlineEditScore?.submissionId === item.id;
                  return (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{item.student?.fullName} ({item.student?.username})</p>
                          <div className="flex gap-4 text-xs text-gray-500 mt-0.5">
                            <span>Status: <span className={item.status === 'GRADED' ? 'text-green-700' : item.status === 'FINALIZED' ? 'text-primary-700' : 'text-gray-700'}>{item.status}</span></span>
                            <span>MCQ: <span className="font-medium text-blue-700">{feedback.objectiveScore ?? '-'}</span></span>
                            <span>Essay: <span className="font-medium text-orange-700">{feedback.essayScore ?? '-'}</span></span>
                            <span>Total: <span className="font-medium text-gray-900">{feedback.totalScore ?? item.finalScore ?? '-'}</span></span>
                            <span>Scans: {scans.length}</span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          <button className="btn-secondary text-[11px]" onClick={() => setExpandedSubmissionId(isExpanded ? null : item.id)}>
                            <Eye size={12} className="inline mr-0.5" />{isExpanded ? 'Hide' : 'Details'}
                          </button>
                          <button
                            className="btn-secondary text-[11px]"
                            onClick={() => handleRegrade(item.id)}
                            disabled={regradingSubmissionId === item.id}
                          >
                            <RefreshCw size={12} className="inline mr-0.5" />
                            {regradingSubmissionId === item.id ? '...' : 'AI Regrade'}
                          </button>
                          {isInlineEditing ? (
                            <div className="flex gap-1">
                              <input
                                type="number"
                                className="input-field text-xs w-20 py-0.5"
                                value={inlineEditScore.score}
                                onChange={(e) => setInlineEditScore({ ...inlineEditScore, score: e.target.value })}
                                onKeyDown={(e) => e.key === 'Enter' && saveInlineScore()}
                                autoFocus
                              />
                              <button className="btn-primary text-[10px] px-2" onClick={saveInlineScore}>✓</button>
                              <button className="btn-secondary text-[10px] px-2" onClick={() => setInlineEditScore(null)}>✗</button>
                            </div>
                          ) : (
                            <button
                              className="btn-secondary text-[11px]"
                              onClick={() => setInlineEditScore({ submissionId: item.id, score: String(item.finalScore ?? 0) })}
                            >
                              Edit Score
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 pt-2 space-y-2">
                          {mergedPdfUrl && (
                            <p className="text-xs text-primary-700">
                              <a href={mergedPdfUrl} target="_blank" rel="noreferrer" className="underline">Open merged submission PDF</a>
                            </p>
                          )}

                          {scans.length === 0 ? (
                            <p className="text-xs text-gray-500">No scan images available for this submission.</p>
                          ) : (
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {scans.map((scan, idx) => {
                                const href = scan.accessUrl || scan.url || (scan.filename ? `/uploads/scans/${encodeURIComponent(scan.filename)}` : '');
                                if (!href) return null;

                                return (
                                  <a
                                    key={`${item.id}-${idx}`}
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="border border-gray-200 rounded-md p-2 hover:border-primary-300 transition-colors"
                                  >
                                    <p className="text-xs text-primary-700 truncate">Scan {idx + 1} {scan.passIndex ? `(Pass ${scan.passIndex})` : ''}</p>
                                    <img src={href} alt={`scan-${idx + 1}`} className="mt-1 w-full h-24 object-cover rounded" loading="lazy" />
                                  </a>
                                );
                              })}
                            </div>
                          )}

                          {feedback.warnings.length > 0 && (
                            <p className="text-xs text-amber-700">Warnings: {feedback.warnings.join(' | ')}</p>
                          )}

                          {feedback.aiComments && (
                            <p className="text-xs text-blue-700">AI comments: {feedback.aiComments}</p>
                          )}

                          {feedback.aiReport && (
                            <div className="border border-gray-100 bg-gray-50 rounded-md p-2 space-y-1">
                              <p className="text-xs font-medium text-gray-900">AI Report</p>
                              {feedback.aiReport.summary && (
                                <p className="text-xs text-gray-700">Summary: {feedback.aiReport.summary}</p>
                              )}
                              {feedback.aiReport.strengths.length > 0 && (
                                <p className="text-xs text-green-700">Strengths: {feedback.aiReport.strengths.join(' | ')}</p>
                              )}
                              {feedback.aiReport.weaknesses.length > 0 && (
                                <p className="text-xs text-amber-700">Weaknesses: {feedback.aiReport.weaknesses.join(' | ')}</p>
                              )}
                              {feedback.aiReport.recommendations.length > 0 && (
                                <p className="text-xs text-blue-700">Recommendations: {feedback.aiReport.recommendations.join(' | ')}</p>
                              )}
                              {feedback.aiReport.integrityFlags.length > 0 && (
                                <p className="text-xs text-red-700">Integrity flags: {feedback.aiReport.integrityFlags.join(' | ')}</p>
                              )}
                            </div>
                          )}

                          {/* Grading Audit Log */}
                          {Array.isArray(item.grades) && item.grades.length > 0 && (
                            <div className="border border-gray-100 bg-gray-50 rounded-md p-2 space-y-1">
                              <p className="text-xs font-medium text-gray-900">Grading History</p>
                              {item.grades.map((grade) => (
                                <p key={grade.id} className="text-xs text-gray-600">
                                  {grade.method} — MCQ: {grade.objectiveScore} • Essay: {grade.essayScore} • Total: {grade.totalScore} • {new Date(grade.createdAt).toLocaleString()}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === 'EXAM_VIEW' && (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Session Exam</h2>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={exportExam}>Print Exam</button>
                <button className="btn-secondary text-xs" onClick={exportAnswerKey}>
                  <Download size={14} className="inline mr-1" />Answer Key
                </button>
              </div>
            </div>
            {!selectedExam || !selectedExam.questions ? (
              <p className="text-sm text-gray-500">No exam loaded.</p>
            ) : (
              selectedExam.questions.map((item, idx) => (
                <div key={item.question.id} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-gray-900">Q{idx + 1}. {item.question.content}</p>
                  <p className="text-xs text-gray-500">{item.question.type}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TeacherSessionManagement;
