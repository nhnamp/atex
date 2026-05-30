import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Camera, CameraOff, CheckCircle2, RefreshCw, Upload } from 'lucide-react';

type MobileScanStudent = {
  submissionId: number;
  studentId: number;
  student: {
    id: number;
    username: string;
    fullName: string;
  };
  status: string;
  finalScore: number | null;
  scanCount: number;
};

type MobileScanContext = {
  session: {
    id: number;
    status: string;
    class: { id: number; name: string };
    exam: {
      id: number;
      title: string;
      hasMcq: boolean;
      essayQuestionIds: number[];
      expectedPages?: number;
      passPurposeByIndex?: Record<string, string>;
    };
  };
  students: MobileScanStudent[];
};

type MobileScanUploadResponse = {
  resolvedStudentId?: number;
  resolvedStudent?: {
    id: number;
    username: string;
    fullName: string;
  };
  extractedIdentity?: {
    fullName: string | null;
    studentCode: string | null;
  } | null;
  requiresManualSelection?: boolean;
  candidates?: Array<{
    id: number;
    username: string;
    fullName: string;
  }>;
  invalidScans?: Array<{
    fileName?: string;
    passIndex?: number;
    reasons?: string[];
  }>;
};

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
          style={{
            top: zone.top,
            left: zone.left,
            width: zone.width,
            height: zone.height,
          }}
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

const publicApi = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

const TeacherMobileScan: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [context, setContext] = useState<MobileScanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureHint, setCaptureHint] = useState('Camera is idle');
  const [capturing, setCapturing] = useState(false);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null);
  const [activePassIndex, setActivePassIndex] = useState(1);

  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qualityTimerRef = useRef<number | null>(null);

  const activeStudent = useMemo(
    () => context?.students.find((item) => item.studentId === activeStudentId) || null,
    [context, activeStudentId]
  );

  const getCameraSupportIssue = (): string | null => {
    if (!window.isSecureContext) {
      return 'Live camera requires HTTPS (or localhost). Use Upload/Rescan below on mobile HTTP links.';
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return 'This browser does not expose live camera API. Use Upload/Rescan below.';
    }

    return null;
  };

  const totalPasses = useMemo(() => {
    if (!context) return 1;

    const expectedPages = Number.parseInt(String(context.session.exam.expectedPages), 10);
    if (Number.isFinite(expectedPages) && expectedPages > 0) {
      return expectedPages;
    }

    const essayCount = context.session.exam.essayQuestionIds.length;
    if (essayCount === 0) return 1;
    return context.session.exam.hasMcq ? essayCount + 1 : essayCount;
  }, [context]);

  const buildFallbackPassPurpose = (passIndex: number): string => {
    if (!context) return `PAGE_${passIndex}`;

    const essayIds = context.session.exam.essayQuestionIds;
    if (essayIds.length === 0) {
      return 'IDENTITY_OMR';
    }

    if (context.session.exam.hasMcq) {
      if (passIndex === 1) return 'IDENTITY_OMR';
      const essayId = essayIds[passIndex - 2];
      return essayId ? `ESSAY_${essayId}` : `PAGE_${passIndex}`;
    }

    const essayId = essayIds[passIndex - 1];
    return essayId ? `IDENTITY_ESSAY_${essayId}` : `PAGE_${passIndex}`;
  };

  const getPassPurpose = (passIndex: number): string => {
    const mapped = context?.session?.exam?.passPurposeByIndex?.[String(passIndex)];
    return mapped ? String(mapped) : buildFallbackPassPurpose(passIndex);
  };

  const viewfinderVariant = useMemo<ViewfinderVariant>(() => {
    const purpose = getPassPurpose(activePassIndex).toUpperCase();
    if (purpose.includes('IDENTITY_ESSAY')) return 'identityEssay';
    if (purpose.includes('ESSAY')) return 'essayPage';
    if (purpose.includes('OMR')) return 'omr';
    return 'generic';
  }, [activePassIndex, context]);

  const loadContext = async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data } = await publicApi.get<MobileScanContext>(`/exams/mobile-scan/context?token=${encodeURIComponent(token)}`);
      setContext(data);
      setActiveStudentId((prev) => (prev && data.students.some((item) => item.studentId === prev) ? prev : null));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Cannot load mobile scan context');
    } finally {
      setLoading(false);
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
      const supportIssue = getCameraSupportIssue();
      if (supportIssue) {
        toast.error(supportIssue);
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 720 },
            height: { ideal: 1280 },
            aspectRatio: { ideal: 210 / 297 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
      }

      streamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }

      setCameraOpen(true);
      setCaptureHint('Align paper and wait for green status');
    } catch (error: any) {
      toast.error(error?.message || 'Cannot access camera');
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
      setCaptureHint('Green: readable, tap Capture');
    } else if (avgBrightness <= 65) {
      setCaptureHint('Too dark, increase light');
    } else if (avgBrightness >= 210) {
      setCaptureHint('Too bright, avoid glare');
    } else {
      setCaptureHint('Hold steady and fill frame with paper');
    }
  };

  const uploadScanFile = async (file: File) => {
    if (!token) {
      toast.error('Scan token is missing');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are allowed');
      return;
    }

    setCapturing(true);
    try {
      const formData = new FormData();
      formData.append('token', token);
      if (activeStudentId) {
        formData.append('studentId', String(activeStudentId));
      }
      formData.append('passIndex', String(activePassIndex));
      formData.append('totalPasses', String(totalPasses));
      formData.append('purpose', getPassPurpose(activePassIndex));
      formData.append('files', file);

      const { data } = await publicApi.post<MobileScanUploadResponse>('/exams/mobile-scan/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const resolvedStudentId = Number(data?.resolvedStudentId || activeStudentId || 0) || null;
      const resolvedStudentName = data?.resolvedStudent?.fullName
        || context?.students.find((item) => item.studentId === resolvedStudentId)?.student.fullName
        || 'student';

      if (resolvedStudentId) {
        setActiveStudentId(resolvedStudentId);
      }

      toast.success(`Uploaded for ${resolvedStudentName}`);

      if (activePassIndex < totalPasses) {
        setActivePassIndex((prev) => prev + 1);
      } else {
        setActivePassIndex(1);
        setActiveStudentId(null);
        toast.success('Completed one paper set. Continue with next student paper.');
      }

      await loadContext();
    } catch (err: any) {
      const payload = err?.response?.data as MobileScanUploadResponse & { error?: string };

      if (Array.isArray(payload?.invalidScans) && payload.invalidScans.length > 0) {
        toast.error(payload?.error || 'Ảnh bài làm bị mờ hoặc thiếu góc, vui lòng chụp lại rõ nét hơn.');
        return;
      }

      if (payload?.requiresManualSelection) {
        toast.error(payload?.error || 'Không nhận diện được tên hoặc MSSV, vui lòng kiểm tra lại ảnh trang đầu.');

        if (Array.isArray(payload?.candidates) && payload.candidates.length === 1) {
          setActiveStudentId(payload.candidates[0].id);
        }
        return;
      }

      toast.error(payload?.error || 'Upload failed');
    } finally {
      setCapturing(false);
    }
  };

  const captureAndUpload = async () => {
    if (!captureReady) {
      toast.error('Wait for green quality indicator before capture');
      return;
    }

    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera frame unavailable');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error('Cannot process frame');
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) {
      toast.error('Failed to capture frame');
      return;
    }

    const linkedStudentId = activeStudentId || 'auto';
    const file = new File([blob], `scan_${linkedStudentId}_${Date.now()}.jpg`, { type: 'image/jpeg' });
    await uploadScanFile(file);
  };

  const uploadFromPicker = async (files: FileList | null) => {
    const selectedFile = files?.[0];
    if (!selectedFile) {
      toast.error('No image selected');
      return;
    }
    await uploadScanFile(selectedFile);
  };

  useEffect(() => {
    loadContext();
  }, [token]);

  useEffect(() => {
    setActivePassIndex((prev) => Math.min(Math.max(prev, 1), totalPasses));
  }, [totalPasses]);

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
    return () => {
      stopCamera();
    };
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-4">
          <p className="text-sm text-red-600">Invalid scan link: token is missing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-3 pb-8">
      <div className="max-w-md mx-auto space-y-3">
        <div className="bg-white rounded-xl shadow p-4">
          <h1 className="text-lg font-semibold text-gray-900">Mobile Exam Scan</h1>
          <p className="text-xs text-gray-500 mt-1">Dedicated page for scanning papers from your phone camera</p>

          {loading ? (
            <p className="text-sm text-gray-500 mt-3">Loading session...</p>
          ) : context ? (
            <div className="mt-3 text-sm space-y-1">
              <p className="text-gray-900 font-medium">{context.session.exam.title}</p>
              <p className="text-gray-600">Class: {context.session.class.name}</p>
              <p className="text-gray-600">Session #{context.session.id} • {context.session.status}</p>
            </div>
          ) : (
            <p className="text-sm text-red-600 mt-3">Cannot load session context.</p>
          )}

          <button className="btn-secondary text-xs mt-3" onClick={loadContext}>
            <RefreshCw size={14} className="inline mr-1" />Refresh
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <label className="block text-xs font-medium text-gray-700">Student override (optional)</label>
          <select
            className="input-field"
            value={activeStudentId || ''}
            onChange={(e) => {
              const value = e.target.value;
              setActiveStudentId(value ? parseInt(value, 10) : null);
              setActivePassIndex(1);
            }}
            disabled={!context || context.students.length === 0}
          >
            <option value="">-- Auto match from scan --</option>
            {context?.students.map((item) => (
              <option key={item.studentId} value={item.studentId}>
                {item.student.fullName} ({item.student.username}) • scans: {item.scanCount}
              </option>
            ))}
          </select>

          {getCameraSupportIssue() && (
            <p className="text-xs text-amber-700">{getCameraSupportIssue()}</p>
          )}

          <div
            className={`rounded-2xl border-2 overflow-hidden bg-black ${captureReady ? 'border-green-500' : 'border-red-400'}`}
          >
            <div className="relative w-full aspect-[210/297]">
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
              <ViewfinderOverlay variant={viewfinderVariant} />
            </div>
          </div>

          <p className={`text-xs ${captureReady ? 'text-green-700' : 'text-amber-700'}`}>{captureHint}</p>
          <p className="text-xs text-gray-600">
            {activeStudent
              ? `${activeStudent.student.fullName} • Pass ${activePassIndex}/${totalPasses}`
              : `Auto mode • Pass ${activePassIndex}/${totalPasses} (auto match from page 1 identity block)`}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-xs" onClick={() => (cameraOpen ? stopCamera() : startCamera())}>
              {cameraOpen ? <CameraOff size={14} className="inline mr-1" /> : <Camera size={14} className="inline mr-1" />}
              {cameraOpen ? 'Stop' : 'Start'}
            </button>
            <button
              className="btn-primary text-xs"
              onClick={captureAndUpload}
              disabled={!cameraOpen || !captureReady || capturing}
            >
              {capturing ? 'Capturing...' : 'Capture'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">Upload/Rescan fallback</p>
            <p className="text-xs text-gray-500">
              Use this when live camera is unavailable, or when you want to re-upload a page manually.
            </p>
            <div className="flex gap-2">
              <label className="btn-secondary text-xs cursor-pointer">
                <Upload size={14} className="inline mr-1" />Upload Image
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void uploadFromPicker(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                className="btn-secondary text-xs"
                onClick={() => {
                  setActiveStudentId(null);
                  setActivePassIndex(1);
                }}
              >
                Reset to Auto Match
              </button>
            </div>
          </div>

          {context && context.session.status === 'COMPLETED' && (
            <p className="text-xs text-green-700 flex items-center gap-1">
              <CheckCircle2 size={14} /> Session already completed/published.
            </p>
          )}
        </div>
      </div>

      <canvas ref={probeCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
};

export default TeacherMobileScan;
