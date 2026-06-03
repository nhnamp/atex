import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  RefreshCw,
  Upload,
  ScanLine,
  UserCheck,
  Save,
  RotateCcw,
  Trash2,
  X,
  Image as ImageIcon,
  PlayCircle,
  Pencil,
  Zap,
} from 'lucide-react';

type StudentLite = {
  id: number;
  username: string;
  fullName: string;
};

type MobileScanStudent = {
  submissionId: number;
  studentId: number;
  student: StudentLite;
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
      mcqQuestionCount?: number;
      essayQuestionIds: number[];
      expectedPages?: number;
      passPurposeByIndex?: Record<string, string>;
    };
  };
  students: MobileScanStudent[];
};

type ProbeResult = {
  aligned: number;
  studentCode: string | null;
  confidence: number;
  answeredCount: number;
  mcqCount: number;
  recognized: boolean;
  resolvedStudentId: number | null;
  resolvedStudent: StudentLite | null;
  candidates: StudentLite[];
  warnings: string[];
};

type BufferedPage = {
  passIndex: number;
  purpose: string;
  blob: Blob;
  thumb: string;
};

type QueuedPaper = {
  clientId: string;
  student: StudentLite;
  pages: BufferedPage[];
  totalPasses: number;
  capturedAt: string;
};

type StoredQueuedPaper = {
  storageKey: string;
  sessionId: number;
  clientId: string;
  student: StudentLite;
  pages: Array<Omit<BufferedPage, 'thumb'>>;
  totalPasses: number;
  capturedAt: string;
};

type MobileStartGradingResponse = {
  message: string;
  syncedPaperCount: number;
  syncedImageCount: number;
  statusUrl?: string;
  reportUrl?: string;
  job?: {
    jobId: string;
    status: string;
    progress: number;
    message: string;
  };
};

type ViewfinderVariant = 'omr' | 'identityEssay' | 'essayPage' | 'generic';

type TorchCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
};

type TorchConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
};

/**
 * Anchor target centres (percentage of the A4 sheet), matching the canonical
 * sheet geometry used by the Python OMR processor: 5x5mm black squares whose
 * centres sit at (10,10),(200,10),(200,287),(10,287)mm on a 210x297 page.
 * Lining the real black squares up with these helps the OMR lock alignment fast.
 */
const ANCHOR_CENTERS = [
  { left: '4.76%', top: '3.37%' },
  { left: '95.24%', top: '3.37%' },
  { left: '95.24%', top: '96.63%' },
  { left: '4.76%', top: '96.63%' },
];

type ViewfinderZone = {
  id: string;
  top: string;
  left: string;
  width: string;
  height: string;
  label?: string;
};

// Box coordinates derived from the canonical 1050x1485 px reference frame.
const VIEWFINDER_ZONES: Record<ViewfinderVariant, ViewfinderZone[]> = {
  omr: [
    { id: 'info', top: '13%', left: '6%', width: '49%', height: '30%', label: 'HỌ TÊN · MÃ SỐ' },
    { id: 'mssv', top: '14%', left: '57%', width: '39%', height: '31%', label: 'MSSV' },
    { id: 'omr', top: '46%', left: '8%', width: '87%', height: '42%', label: 'TRẮC NGHIỆM' },
  ],
  identityEssay: [
    { id: 'info', top: '13%', left: '6%', width: '49%', height: '30%', label: 'HỌ TÊN · MÃ SỐ' },
    { id: 'mssv', top: '14%', left: '57%', width: '39%', height: '31%', label: 'MSSV' },
    { id: 'essay', top: '47%', left: '7%', width: '88%', height: '47%', label: 'PHẦN TỰ LUẬN' },
  ],
  essayPage: [
    { id: 'essay-header', top: '4%', left: '7%', width: '86%', height: '9%', label: 'TIÊU ĐỀ CÂU' },
    { id: 'essay-body', top: '15%', left: '7%', width: '86%', height: '75%', label: 'VÙNG TRẢ LỜI' },
  ],
  generic: [],
};

const ViewfinderOverlay: React.FC<{ variant: ViewfinderVariant }> = ({ variant }) => {
  const zones = VIEWFINDER_ZONES[variant];
  const showAnchors = variant === 'omr' || variant === 'identityEssay';

  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-[3%] rounded-lg border border-white/30" />

      {showAnchors &&
        ANCHOR_CENTERS.map((anchor, idx) => (
          <div
            key={`anchor-${idx}`}
            className="absolute flex items-center justify-center border border-white/80 bg-white/10"
            style={{
              width: '6%',
              height: '4%',
              left: anchor.left,
              top: anchor.top,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <span className="block h-1/2 w-1/2 bg-white/40" />
          </div>
        ))}

      {zones.map((zone) => (
        <div
          key={zone.id}
          className="absolute rounded-md border border-dashed border-white/40"
          style={{ top: zone.top, left: zone.left, width: zone.width, height: zone.height }}
        >
          {zone.label && (
            <span className="absolute left-1 top-1 text-[9px] uppercase tracking-wide text-white/60">
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

const MOBILE_SCAN_DB_NAME = 'nt208-mobile-scan';
const MOBILE_SCAN_DB_VERSION = 1;
const MOBILE_SCAN_STORE = 'queuedPapers';

const openMobileScanDb = (): Promise<IDBDatabase> => {
  if (!window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported by this browser'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(MOBILE_SCAN_DB_NAME, MOBILE_SCAN_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MOBILE_SCAN_STORE)) {
        const store = db.createObjectStore(MOBILE_SCAN_STORE, { keyPath: 'storageKey' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open mobile scan storage'));
  });
};

const runMobileScanStore = async <T,>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> => {
  const db = await openMobileScanDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(MOBILE_SCAN_STORE, mode);
    const store = tx.objectStore(MOBILE_SCAN_STORE);
    const request = action(store);
    let result: T | undefined;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error('Mobile scan storage request failed'));
    }

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Mobile scan storage transaction failed'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Mobile scan storage transaction aborted'));
    };
  });
};

const getQueuedPaperStorageKey = (sessionId: number, studentId: number) => {
  return `${sessionId}:student:${studentId}`;
};

const toStoredQueuedPaper = (sessionId: number, paper: QueuedPaper): StoredQueuedPaper => ({
  storageKey: getQueuedPaperStorageKey(sessionId, paper.student.id),
  sessionId,
  clientId: paper.clientId,
  student: paper.student,
  totalPasses: paper.totalPasses,
  capturedAt: paper.capturedAt,
  pages: paper.pages.map((page) => ({
    passIndex: page.passIndex,
    purpose: page.purpose,
    blob: page.blob,
  })),
});

const toQueuedPaper = (stored: StoredQueuedPaper): QueuedPaper => ({
  clientId: stored.clientId,
  student: stored.student,
  totalPasses: stored.totalPasses,
  capturedAt: stored.capturedAt,
  pages: stored.pages.map((page) => ({
    ...page,
    thumb: URL.createObjectURL(page.blob),
  })),
});

const saveQueuedPaperToStorage = async (sessionId: number, paper: QueuedPaper) => {
  await runMobileScanStore('readwrite', (store) => store.put(toStoredQueuedPaper(sessionId, paper)));
};

const deleteQueuedPaperFromStorage = async (sessionId: number, studentId: number) => {
  await runMobileScanStore('readwrite', (store) => store.delete(getQueuedPaperStorageKey(sessionId, studentId)));
};

const clearQueuedPapersFromStorage = async (sessionId: number) => {
  const records = await listQueuedPapersFromStorageRaw(sessionId);
  await runMobileScanStore('readwrite', (store) => {
    records.forEach((record) => store.delete(record.storageKey));
  });
};

const listQueuedPapersFromStorageRaw = async (sessionId: number): Promise<StoredQueuedPaper[]> => {
  const db = await openMobileScanDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(MOBILE_SCAN_STORE, 'readonly');
    const index = tx.objectStore(MOBILE_SCAN_STORE).index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => resolve((request.result || []) as StoredQueuedPaper[]);
    request.onerror = () => reject(request.error || new Error('Failed to load mobile scan queue'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Mobile scan queue load failed'));
    };
  });
};

const listQueuedPapersFromStorage = async (sessionId: number): Promise<QueuedPaper[]> => {
  const stored = await listQueuedPapersFromStorageRaw(sessionId);
  return stored.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).map(toQueuedPaper);
};

// Probe loop tuning.
const PROBE_INTERVAL_MS = 350;
const PROBE_MAX_SIDE = 1400; // downscale preview frames before sending; big enough for MSSV bubbles
const PROBE_QUALITY = 0.7;
const STABLE_FRAMES_REQUIRED = 1; // identity-only probe is fast; capture on first confident match
const CAPTURE_MAX_SIDE = 2200; // final capture stays high-res for accurate grading
const CAPTURE_QUALITY = 0.92;
const PAPER_ASPECT_RATIO = 210 / 297;

const createClientId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `paper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const TeacherMobileScan: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [context, setContext] = useState<MobileScanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);

  // Current paper buffer (held client-side until the whole set is finalised).
  const [pages, setPages] = useState<Record<number, BufferedPage>>({});
  const [activePassIndex, setActivePassIndex] = useState(1);
  const [queuedPapers, setQueuedPapers] = useState<QueuedPaper[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number | null>(null);

  // Identity resolution for the current paper.
  const [recognizedStudent, setRecognizedStudent] = useState<StudentLite | null>(null);
  const [manualStudentId, setManualStudentId] = useState<number | null>(null);

  // Live status.
  const [probeStatus, setProbeStatus] = useState('Đưa phiếu trắc nghiệm vào khung để tự nhận diện');
  const [captureReady, setCaptureReady] = useState(false);
  const [captureHint, setCaptureHint] = useState('Camera đang tắt');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopTimerRef = useRef<number | null>(null);
  const probeInFlightRef = useRef(false);
  const stableRef = useRef<{ studentId: number | null; count: number }>({ studentId: null, count: 0 });

  const effectiveStudentId = manualStudentId ?? recognizedStudent?.id ?? null;

  const effectiveStudent = useMemo<StudentLite | null>(() => {
    if (!effectiveStudentId) return null;
    if (recognizedStudent && recognizedStudent.id === effectiveStudentId) return recognizedStudent;
    return context?.students.find((item) => item.studentId === effectiveStudentId)?.student || null;
  }, [effectiveStudentId, recognizedStudent, context]);

  const totalPasses = useMemo(() => {
    if (!context) return 1;
    const expectedPages = Number.parseInt(String(context.session.exam.expectedPages), 10);
    if (Number.isFinite(expectedPages) && expectedPages > 0) return expectedPages;
    const essayCount = context.session.exam.essayQuestionIds.length;
    if (essayCount === 0) return 1;
    return context.session.exam.hasMcq ? essayCount + 1 : essayCount;
  }, [context]);

  const buildFallbackPassPurpose = (passIndex: number): string => {
    if (!context) return `PAGE_${passIndex}`;
    const essayIds = context.session.exam.essayQuestionIds;
    if (essayIds.length === 0) return 'IDENTITY_OMR';
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

  // Pass 1 always carries the identity block, so it drives auto-capture.
  const isIdentityPass = (passIndex: number): boolean => passIndex === 1;

  const viewfinderVariant = useMemo<ViewfinderVariant>(() => {
    const purpose = getPassPurpose(activePassIndex).toUpperCase();
    if (purpose.includes('IDENTITY_ESSAY')) return 'identityEssay';
    if (purpose.includes('ESSAY')) return 'essayPage';
    if (purpose.includes('OMR') || purpose.includes('IDENTITY')) return 'omr';
    return 'generic';
  }, [activePassIndex, context]);

  const passLabel = (passIndex: number): string => {
    const purpose = getPassPurpose(passIndex).toUpperCase();
    if (purpose.includes('IDENTITY_ESSAY')) return 'Trang định danh + tự luận';
    if (purpose.includes('IDENTITY') || purpose.includes('OMR')) return 'Trang định danh + trắc nghiệm';
    if (purpose.includes('ESSAY')) return 'Trang tự luận';
    return `Trang ${passIndex}`;
  };

  const allCaptured = useMemo(() => {
    for (let p = 1; p <= totalPasses; p += 1) {
      if (!pages[p]) return false;
    }
    return totalPasses > 0;
  }, [pages, totalPasses]);

  const currentPageCount = Object.keys(pages).length;

  const getOrderedCurrentPages = (): BufferedPage[] => {
    const ordered: BufferedPage[] = [];
    for (let p = 1; p <= totalPasses; p += 1) {
      if (pages[p]) ordered.push(pages[p]);
    }
    return ordered;
  };

  const revokeThumbIfNeeded = (thumb: string) => {
    if (thumb.startsWith('blob:')) {
      URL.revokeObjectURL(thumb);
    }
  };

  const getCameraSupportIssue = (): string | null => {
    if (!window.isSecureContext) {
      return 'Camera trực tiếp cần HTTPS (hoặc localhost). Trên link HTTP, hãy dùng nút Tải ảnh bên dưới.';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return 'Trình duyệt này không hỗ trợ camera trực tiếp. Hãy dùng nút Tải ảnh bên dưới.';
    }
    return null;
  };

  const getPrimaryVideoTrack = (): MediaStreamTrack | null => {
    return streamRef.current?.getVideoTracks()[0] || null;
  };

  const canUseTorch = (track: MediaStreamTrack | null): boolean => {
    if (!track || typeof track.getCapabilities !== 'function') return false;
    try {
      const capabilities = track.getCapabilities() as TorchCapabilities;
      return capabilities.torch === true;
    } catch {
      return false;
    }
  };

  const applyTorch = async (enabled: boolean): Promise<boolean> => {
    const track = getPrimaryVideoTrack();
    if (!canUseTorch(track)) {
      setTorchSupported(false);
      setTorchEnabled(false);
      if (enabled) {
        toast.error('Thiết bị hoặc trình duyệt không hỗ trợ bật flash từ web.');
      }
      return false;
    }

    try {
      await track!.applyConstraints({
        advanced: [{ torch: enabled } as TorchConstraintSet],
      });
      setTorchSupported(true);
      setTorchEnabled(enabled);
      return true;
    } catch (error: any) {
      if (enabled) {
        toast.error(error?.message || 'Không bật được flash trên camera này.');
      } else {
        toast.error(error?.message || 'Không tắt được flash trên camera này.');
      }
      return false;
    }
  };

  const toggleTorch = async () => {
    if (!cameraOpen || torchBusy) return;
    setTorchBusy(true);
    try {
      await applyTorch(!torchEnabled);
    } finally {
      setTorchBusy(false);
    }
  };

  const persistQueuedPaperInBackground = (paper: QueuedPaper) => {
    const sessionId = context?.session.id;
    if (!sessionId) return;

    void saveQueuedPaperToStorage(sessionId, paper).catch((error) => {
      toast.error('Không lưu được hàng đợi vào bộ nhớ trình duyệt. Nếu reload, ảnh có thể bị mất.');
      console.error('Persist mobile scan queue error:', error);
    });
  };

  const loadContext = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await publicApi.get<MobileScanContext>(
        `/exams/mobile-scan/context?token=${encodeURIComponent(token)}`
      );
      setContext(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Không tải được phiên quét');
    } finally {
      setLoading(false);
    }
  };

  const resetPaper = (revokeThumbs = true) => {
    if (revokeThumbs) {
      Object.values(pages).forEach((page) => revokeThumbIfNeeded(page.thumb));
    }
    setPages({});
    setActivePassIndex(1);
    setRecognizedStudent(null);
    setManualStudentId(null);
    setSelectedPageIndex(null);
    stableRef.current = { studentId: null, count: 0 };
    setProbeStatus('Đưa phiếu trắc nghiệm vào khung để tự nhận diện');
  };

  const stopCamera = () => {
    if (loopTimerRef.current) {
      window.clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    const track = getPrimaryVideoTrack();
    if (torchEnabled && canUseTorch(track)) {
      void track!.applyConstraints({ advanced: [{ torch: false } as TorchConstraintSet] }).catch(() => undefined);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setTorchSupported(false);
    setTorchEnabled(false);
    setTorchBusy(false);
    setCaptureReady(false);
    setCaptureHint('Camera đang tắt');
  };

  const startCamera = async () => {
    const supportIssue = getCameraSupportIssue();
    if (supportIssue) {
      toast.error(supportIssue);
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1080 },
            height: { ideal: 1920 },
            aspectRatio: { ideal: 210 / 297 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0] || null;
      setTorchSupported(canUseTorch(videoTrack));
      setTorchEnabled(false);
      setTorchBusy(false);
      videoTrack?.addEventListener('ended', () => {
        setTorchSupported(false);
        setTorchEnabled(false);
        setTorchBusy(false);
      });
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setTorchSupported(canUseTorch(videoTrack));
      setCameraOpen(true);
    } catch (error: any) {
      toast.error(error?.message || 'Không mở được camera');
    }
  };

  const computeMetrics = (): { brightness: number; edge: number; preGateOk: boolean } | null => {
    const video = cameraVideoRef.current;
    const canvas = probeCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    canvas.width = 240;
    canvas.height = 340;
    drawVideoFrameToCanvas(video, canvas);
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
    const brightness = brightnessTotal / Math.max(1, pixels);
    const edge = edgeTotal / Math.max(1, pixels);
    return { brightness, edge, preGateOk: brightness > 60 && brightness < 215 && edge > 7 };
  };

  const applyQualityHint = (metrics: { brightness: number; edge: number } | null) => {
    if (!metrics) {
      setCaptureReady(false);
      setCaptureHint('Đang chờ tín hiệu camera');
      return;
    }
    const ready = metrics.brightness > 65 && metrics.brightness < 210 && metrics.edge > 8;
    setCaptureReady(ready);
    if (ready) setCaptureHint('Ảnh đủ nét — chạm Chụp');
    else if (metrics.brightness <= 65) setCaptureHint('Thiếu sáng, tăng ánh sáng');
    else if (metrics.brightness >= 210) setCaptureHint('Quá chói, tránh loá');
    else setCaptureHint('Giữ yên và lấp đầy khung bằng tờ phiếu');
  };

  const getPaperCoverSourceRect = (video: HTMLVideoElement) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoAspect = vw / vh;

    if (videoAspect > PAPER_ASPECT_RATIO) {
      const sw = Math.round(vh * PAPER_ASPECT_RATIO);
      return {
        sx: Math.round((vw - sw) / 2),
        sy: 0,
        sw,
        sh: vh,
      };
    }

    const sh = Math.round(vw / PAPER_ASPECT_RATIO);
    return {
      sx: 0,
      sy: Math.round((vh - sh) / 2),
      sw: vw,
      sh,
    };
  };

  const drawVideoFrameToCanvas = (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    source = getPaperCoverSourceRect(video)
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(video, source.sx, source.sy, source.sw, source.sh, 0, 0, canvas.width, canvas.height);
    return true;
  };

  const grabScaledBlob = async (maxSide: number, quality: number): Promise<Blob | null> => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const source = getPaperCoverSourceRect(video);
    const h = Math.max(1, Math.round(Math.min(maxSide, source.sh)));
    const w = Math.max(1, Math.round(h * PAPER_ASPECT_RATIO));
    canvas.width = w;
    canvas.height = h;
    if (!drawVideoFrameToCanvas(video, canvas, source)) return null;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  };

  const makeThumb = (): string => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return '';
    const w = 160;
    const h = Math.round(w / PAPER_ASPECT_RATIO) || 226;
    canvas.width = w;
    canvas.height = h;
    if (!drawVideoFrameToCanvas(video, canvas)) return '';
    return canvas.toDataURL('image/jpeg', 0.6);
  };

  const bufferPage = (passIndex: number, blob: Blob, thumb: string) => {
    setPages((prev) => {
      if (prev[passIndex]) {
        revokeThumbIfNeeded(prev[passIndex].thumb);
      }
      return {
        ...prev,
        [passIndex]: { passIndex, purpose: getPassPurpose(passIndex), blob, thumb },
      };
    });
  };

  const deleteCapturedPage = (passIndex: number) => {
    setPages((prev) => {
      const next = { ...prev };
      if (next[passIndex]) {
        revokeThumbIfNeeded(next[passIndex].thumb);
        delete next[passIndex];
      }
      return next;
    });
    if (passIndex === 1) {
      setRecognizedStudent(null);
      setManualStudentId(null);
      stableRef.current = { studentId: null, count: 0 };
      setProbeStatus('Đưa phiếu trắc nghiệm vào khung để tự nhận diện');
    }
    setActivePassIndex(passIndex);
    setSelectedPageIndex(null);
  };

  const advanceAfterCapture = (passIndex: number) => {
    if (passIndex < totalPasses) {
      setActivePassIndex(passIndex + 1);
    }
    // When it was the last pass we stay on it; the Finalize button takes over.
  };

  const autoCapturePageOne = async (student: StudentLite) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await grabScaledBlob(CAPTURE_MAX_SIDE, CAPTURE_QUALITY);
      if (!blob) {
        toast.error('Không lấy được khung hình');
        return;
      }
      const thumb = makeThumb();
      bufferPage(1, blob, thumb);
      setRecognizedStudent(student);
      setManualStudentId(null);
      stableRef.current = { studentId: null, count: 0 };
      toast.success(`Đã nhận diện: ${student.fullName} (${student.username})`);
      advanceAfterCapture(1);
    } finally {
      setBusy(false);
    }
  };

  const probePickedIdentity = async (file: Blob) => {
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('frame', file, 'probe.jpg');
      const { data } = await publicApi.post<ProbeResult>('/exams/mobile-scan/probe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.resolvedStudent) {
        setRecognizedStudent(data.resolvedStudent);
        setManualStudentId(null);
        toast.success(`Đã nhận diện: ${data.resolvedStudent.fullName}`);
      } else {
        toast('Chưa nhận diện được MSSV — hãy chọn thí sinh thủ công.', { icon: '⚠️' });
      }
    } catch {
      toast('Chưa nhận diện được MSSV — hãy chọn thí sinh thủ công.', { icon: '⚠️' });
    }
  };

  const bufferPickedImage = async (files: FileList | null, passIndex: number, advance: boolean) => {
    const selectedFile = files?.[0];
    if (!selectedFile) {
      toast.error('Chưa chọn ảnh');
      return;
    }
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Chỉ chấp nhận tệp ảnh');
      return;
    }
    const thumb = URL.createObjectURL(selectedFile);
    bufferPage(passIndex, selectedFile, thumb);

    if (isIdentityPass(passIndex)) {
      await probePickedIdentity(selectedFile);
    } else {
      toast.success(`Đã thêm ảnh trang ${passIndex}`);
    }

    if (advance) {
      advanceAfterCapture(passIndex);
    }
  };

  const handleProbeResult = (result: ProbeResult) => {
    const parts: string[] = [`Neo ${result.aligned}/4`];
    parts.push(`MSSV ${result.studentCode || '…'}`);
    if (result.recognized) parts.push('Đã nhận diện sinh viên');
    setProbeStatus(parts.join(' · '));

    if (result.recognized && result.resolvedStudentId && result.resolvedStudent) {
      const prev = stableRef.current;
      const count = prev.studentId === result.resolvedStudentId ? prev.count + 1 : 1;
      stableRef.current = { studentId: result.resolvedStudentId, count };
      if (count >= STABLE_FRAMES_REQUIRED) {
        void autoCapturePageOne(result.resolvedStudent);
      }
    } else {
      stableRef.current = { studentId: null, count: 0 };
    }
  };

  const runProbe = async () => {
    if (probeInFlightRef.current) return;
    probeInFlightRef.current = true;
    try {
      const frame = await grabScaledBlob(PROBE_MAX_SIDE, PROBE_QUALITY);
      if (!frame) return;
      const formData = new FormData();
      formData.append('token', token);
      formData.append('frame', frame, 'probe.jpg');
      const { data } = await publicApi.post<ProbeResult>('/exams/mobile-scan/probe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      handleProbeResult(data);
    } catch {
      /* transient probe failure — keep polling */
    } finally {
      probeInFlightRef.current = false;
    }
  };

  // Single live loop: always refresh the quality hint; additionally probe for
  // identity on pass 1 until the page is captured.
  useEffect(() => {
    if (!cameraOpen) return;
    const tick = () => {
      const metrics = computeMetrics();
      applyQualityHint(metrics);
      const probing = isIdentityPass(activePassIndex) && !pages[activePassIndex] && !!context;
      if (probing && metrics?.preGateOk) {
        void runProbe();
      } else if (probing && !metrics?.preGateOk) {
        setProbeStatus(metrics ? 'Căn phiếu thẳng, đủ sáng, lấp đầy khung…' : 'Đang chờ tín hiệu camera');
      }
    };
    loopTimerRef.current = window.setInterval(tick, PROBE_INTERVAL_MS);
    return () => {
      if (loopTimerRef.current) {
        window.clearInterval(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, activePassIndex, pages, context]);

  const captureManually = async () => {
    if (!captureReady) {
      toast.error('Chờ chỉ báo xanh (đủ nét) trước khi chụp');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const passIndex = activePassIndex;
      const blob = await grabScaledBlob(CAPTURE_MAX_SIDE, CAPTURE_QUALITY);
      if (!blob) {
        toast.error('Không lấy được khung hình');
        return;
      }
      const thumb = makeThumb();
      bufferPage(passIndex, blob, thumb);

      if (isIdentityPass(passIndex)) {
        // Manual fallback for page 1 — try to resolve identity from this frame.
        try {
          const formData = new FormData();
          formData.append('token', token);
          formData.append('frame', blob, 'probe.jpg');
          const { data } = await publicApi.post<ProbeResult>('/exams/mobile-scan/probe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          if (data.resolvedStudent) {
            setRecognizedStudent(data.resolvedStudent);
            setManualStudentId(null);
            toast.success(`Đã nhận diện: ${data.resolvedStudent.fullName}`);
          } else {
            toast('Chưa nhận diện được MSSV — hãy chọn thí sinh ở danh sách bên trên.', { icon: '⚠️' });
          }
        } catch {
          toast('Chưa nhận diện được MSSV — hãy chọn thí sinh thủ công.', { icon: '⚠️' });
        }
      } else {
        toast.success(`Đã chụp trang ${passIndex}`);
      }
      advanceAfterCapture(passIndex);
    } finally {
      setBusy(false);
    }
  };

  const uploadFromPicker = async (files: FileList | null) => {
    await bufferPickedImage(files, activePassIndex, true);
  };

  const finalizePaper = async () => {
    if (!effectiveStudentId) {
      toast.error('Chưa xác định thí sinh — hãy chọn thí sinh trước khi lưu.');
      return;
    }
    const missing: number[] = [];
    for (let p = 1; p <= totalPasses; p += 1) {
      if (!pages[p]) missing.push(p);
    }
    if (missing.length > 0) {
      toast.error(`Còn thiếu ảnh trang ${missing.join(', ')}`);
      setActivePassIndex(missing[0]);
      return;
    }

    const student = effectiveStudent || context?.students.find((item) => item.studentId === effectiveStudentId)?.student || null;
    if (!student) {
      toast.error('Không tìm thấy thông tin thí sinh trong phiên quét.');
      return;
    }

    const queued: QueuedPaper = {
      clientId: createClientId(),
      student,
      pages: getOrderedCurrentPages().map((page) => ({ ...page })),
      totalPasses,
      capturedAt: new Date().toISOString(),
    };

    setQueuedPapers((prev) => {
      prev
        .filter((item) => item.student.id === student.id)
        .forEach((item) => item.pages.forEach((page) => revokeThumbIfNeeded(page.thumb)));
      const withoutSameStudent = prev.filter((item) => item.student.id !== student.id);
      return [...withoutSameStudent, queued];
    });
    persistQueuedPaperInBackground(queued);
    toast.success(`Đã lưu tạm bài cho ${student.fullName}. Có thể quét bài tiếp theo.`);
    resetPaper(false);
  };

  const editQueuedPaper = (paper: QueuedPaper) => {
    if (currentPageCount > 0) {
      toast.error('Hãy lưu tạm hoặc bỏ bài đang quét trước khi sửa bài trong hàng đợi.');
      return;
    }

    const restoredPages: Record<number, BufferedPage> = {};
    for (const page of paper.pages) {
      restoredPages[page.passIndex] = page;
    }

    setQueuedPapers((prev) => prev.filter((item) => item.clientId !== paper.clientId));
    setPages(restoredPages);
    setRecognizedStudent(paper.student);
    setManualStudentId(paper.student.id);
    setActivePassIndex(1);
    setSelectedPageIndex(null);
    toast.success(`Đang sửa bài của ${paper.student.fullName}`);
  };

  const deleteQueuedPaper = (paper: QueuedPaper) => {
    paper.pages.forEach((page) => revokeThumbIfNeeded(page.thumb));
    setQueuedPapers((prev) => prev.filter((item) => item.clientId !== paper.clientId));
    if (context?.session.id) {
      void deleteQueuedPaperFromStorage(context.session.id, paper.student.id).catch((error) => {
        toast.error('Không xóa được bài khỏi bộ nhớ trình duyệt.');
        console.error('Delete mobile scan queue error:', error);
      });
    }
    toast.success(`Đã xóa bài tạm của ${paper.student.fullName}`);
  };

  const syncQueueAndStartGrading = async () => {
    if (!context) {
      toast.error('Chưa tải được phiên thi.');
      return;
    }
    if (currentPageCount > 0) {
      toast.error('Hãy lưu tạm hoặc bỏ bài đang quét trước khi bắt đầu chấm.');
      return;
    }
    if (queuedPapers.length === 0) {
      toast.error('Chưa có bài nào trong hàng đợi RAM.');
      return;
    }

    setSyncing(true);
    setSyncStatus('Đang đồng bộ ảnh từ điện thoại sang backend...');
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('totalPasses', String(totalPasses));
      formData.append(
        'papers',
        JSON.stringify(
          queuedPapers.map((paper) => ({
            clientId: paper.clientId,
            studentId: paper.student.id,
            pageCount: paper.pages.length,
            pages: paper.pages.map((page) => ({
              passIndex: page.passIndex,
              purpose: page.purpose,
            })),
          }))
        )
      );

      queuedPapers.forEach((paper, paperIndex) => {
        const orderedPages = [...paper.pages].sort((a, b) => a.passIndex - b.passIndex);
        orderedPages.forEach((page) => {
          const name = `paper_${String(paperIndex + 1).padStart(4, '0')}_p${String(page.passIndex).padStart(3, '0')}.jpg`;
          formData.append('files', new File([page.blob], name, { type: page.blob.type || 'image/jpeg' }));
        });
      });

      const { data } = await publicApi.post<MobileStartGradingResponse>(
        '/exams/mobile-scan/start-grading',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      if (context?.session.id) {
        await clearQueuedPapersFromStorage(context.session.id);
      }
      queuedPapers.forEach((paper) => paper.pages.forEach((page) => revokeThumbIfNeeded(page.thumb)));
      setQueuedPapers([]);
      setSyncStatus(
        `Đã đồng bộ ${data.syncedPaperCount || 0} bài (${data.syncedImageCount || 0} ảnh) và bắt đầu chấm.`
      );
      toast.success('Đã đồng bộ ảnh và bắt đầu chấm.');
      await loadContext();
    } catch (err: any) {
      const payload = err?.response?.data as { error?: string; invalidScans?: Array<{ passIndex?: number }> };
      if (Array.isArray(payload?.invalidScans) && payload.invalidScans.length > 0) {
        const bad = payload.invalidScans.map((scan) => scan.passIndex).filter((value): value is number => Number.isFinite(value));
        toast.error(`Một số ảnh chưa đạt chất lượng: trang ${bad.join(', ')}`);
      } else {
        toast.error(payload?.error || 'Đồng bộ và bắt đầu chấm thất bại');
      }
      setSyncStatus('');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const sessionId = context?.session.id;
    if (!sessionId) return;

    let cancelled = false;
    void listQueuedPapersFromStorage(sessionId)
      .then((storedPapers) => {
        if (cancelled) {
          storedPapers.forEach((paper) => paper.pages.forEach((page) => revokeThumbIfNeeded(page.thumb)));
          return;
        }
        setQueuedPapers((prev) => {
          prev.forEach((paper) => paper.pages.forEach((page) => revokeThumbIfNeeded(page.thumb)));
          return storedPapers;
        });
        if (storedPapers.length > 0) {
          setSyncStatus(`Đã khôi phục ${storedPapers.length} bài đã lưu trong phiên quét này.`);
        }
      })
      .catch((error) => {
        toast.error('Không khôi phục được hàng đợi ảnh đã lưu.');
        console.error('Load mobile scan queue error:', error);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.session.id]);

  useEffect(() => {
    setActivePassIndex((prev) => Math.min(Math.max(prev, 1), totalPasses));
  }, [totalPasses]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-4">
          <p className="text-sm text-red-600">Link quét không hợp lệ: thiếu token.</p>
        </div>
      </div>
    );
  }

  const onIdentityPass = isIdentityPass(activePassIndex) && !pages[activePassIndex];
  const borderClass = onIdentityPass
    ? stableRef.current.count > 0
      ? 'border-green-500'
      : 'border-amber-400'
    : captureReady
      ? 'border-green-500'
      : 'border-red-400';

  return (
    <div className="min-h-screen bg-gray-100 p-3 pb-10">
      <div className="max-w-md mx-auto space-y-3">
        <div className="bg-white rounded-xl shadow p-4">
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ScanLine size={18} /> Quét bài bằng điện thoại
          </h1>
          {loading ? (
            <p className="text-sm text-gray-500 mt-3">Đang tải phiên thi…</p>
          ) : context ? (
            <div className="mt-3 text-sm space-y-1">
              <p className="text-gray-900 font-medium">{context.session.exam.title}</p>
              <p className="text-gray-600">Lớp: {context.session.class.name}</p>
              <p className="text-gray-600">
                Phiên #{context.session.id} • {context.session.status} • {totalPasses} trang/bài
              </p>
              <p className="text-gray-600">Hàng đợi RAM: {queuedPapers.length} bài</p>
            </div>
          ) : (
            <p className="text-sm text-red-600 mt-3">Không tải được dữ liệu phiên thi.</p>
          )}
          <button className="btn-secondary text-xs mt-3" onClick={loadContext}>
            <RefreshCw size={14} className="inline mr-1" />
            Làm mới
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          {/* Recognised / assignable student */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <UserCheck size={16} className={effectiveStudent ? 'text-green-600' : 'text-gray-400'} />
              {effectiveStudent ? (
                <span className="font-medium text-gray-900">
                  {effectiveStudent.fullName}{' '}
                  <span className="text-gray-500 font-normal">({effectiveStudent.username})</span>
                </span>
              ) : (
                <span className="text-gray-500">Chưa nhận diện thí sinh</span>
              )}
            </div>
            <label className="block text-[11px] font-medium text-gray-600">
              Gán lại thủ công (nếu nhận diện sai)
            </label>
            <select
              className="input-field"
              value={effectiveStudentId || ''}
              onChange={(e) => setManualStudentId(e.target.value ? parseInt(e.target.value, 10) : null)}
              disabled={!context || context.students.length === 0}
            >
              <option value="">-- Tự nhận diện từ trang đầu --</option>
              {context?.students.map((item) => (
                <option key={item.studentId} value={item.studentId}>
                  {item.student.fullName} ({item.student.username}) • đã lưu: {item.scanCount}
                </option>
              ))}
            </select>
          </div>

          {getCameraSupportIssue() && <p className="text-xs text-amber-700">{getCameraSupportIssue()}</p>}

          {/* Viewfinder */}
          <div className={`rounded-2xl border-2 overflow-hidden bg-black ${borderClass}`}>
            <div className="relative w-full aspect-[210/297]">
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
              <ViewfinderOverlay variant={viewfinderVariant} />
              {onIdentityPass && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white">
                  Tự động chụp khi nhận diện đủ
                </div>
              )}
            </div>
          </div>

          {/* Status line */}
          {onIdentityPass ? (
            <p className="text-xs text-blue-700 font-medium">{probeStatus}</p>
          ) : (
            <p className={`text-xs ${captureReady ? 'text-green-700' : 'text-amber-700'}`}>{captureHint}</p>
          )}

          {/* Pass progress */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">
              {passLabel(activePassIndex)} • {activePassIndex}/{totalPasses}
            </span>
            <div className="flex gap-1">
              {Array.from({ length: totalPasses }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePassIndex(p)}
                  title={passLabel(p)}
                  className={`h-6 w-6 rounded-full text-[10px] flex items-center justify-center border ${
                    p === activePassIndex
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : pages[p]
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-500'
                  }`}
                >
                  {pages[p] ? '✓' : p}
                </button>
              ))}
            </div>
          </div>

          {/* Camera + capture controls */}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-xs" onClick={() => (cameraOpen ? stopCamera() : startCamera())}>
              {cameraOpen ? <CameraOff size={14} className="inline mr-1" /> : <Camera size={14} className="inline mr-1" />}
              {cameraOpen ? 'Tắt camera' : 'Bật camera'}
            </button>
            {cameraOpen ? (
              <button
                className={`${torchEnabled ? 'btn-primary' : 'btn-secondary'} text-xs disabled:opacity-50`}
                onClick={toggleTorch}
                disabled={!torchSupported || torchBusy}
                title={
                  torchSupported
                    ? torchEnabled
                      ? 'Tắt flash'
                      : 'Bật flash'
                    : 'Camera này không hỗ trợ flash từ trình duyệt'
                }
              >
                <Zap size={14} className="inline mr-1" />
                {torchBusy ? 'Đang đổi…' : torchEnabled ? 'Tắt flash' : 'Bật flash'}
              </button>
            ) : null}
            <button
              className={`btn-primary text-xs ${cameraOpen ? 'col-span-2' : ''}`}
              onClick={captureManually}
              disabled={!cameraOpen || !captureReady || busy}
            >
              {busy ? 'Đang chụp…' : onIdentityPass ? 'Chụp tay trang đầu' : 'Chụp trang này'}
            </button>
          </div>
          {cameraOpen && !torchSupported && (
            <p className="text-[11px] text-gray-500">
              Flash không khả dụng trên camera hoặc trình duyệt hiện tại.
            </p>
          )}

          {/* Captured thumbnails */}
          {Object.keys(pages).length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1">
              {Array.from({ length: totalPasses }, (_, i) => i + 1).map((p) =>
                pages[p] ? (
                  <button
                    key={p}
                    onClick={() => {
                      setActivePassIndex(p);
                      setSelectedPageIndex(p);
                    }}
                    className="relative shrink-0"
                    title={`Xem/sửa trang ${p}`}
                  >
                    <img
                      src={pages[p].thumb}
                      alt={`Trang ${p}`}
                      className="h-20 w-14 object-cover rounded border border-gray-300"
                    />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center">
                      T{p}
                    </span>
                  </button>
                ) : null
              )}
            </div>
          )}

          {/* Finalize */}
          <button
            className="btn-primary w-full text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            onClick={finalizePaper}
            disabled={!allCaptured || !effectiveStudentId || syncing}
          >
            <Save size={15} />
            {allCaptured
              ? `Lưu tạm vào RAM cho ${effectiveStudent?.fullName || 'thí sinh'}`
              : `Chụp đủ ${totalPasses} trang để lưu tạm`}
          </button>

          {Object.keys(pages).length > 0 && (
            <button className="btn-secondary w-full text-xs flex items-center justify-center gap-1" onClick={() => resetPaper()}>
              <RotateCcw size={13} /> Bỏ bài hiện tại, bắt đầu lại
            </button>
          )}

          {queuedPapers.length > 0 && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-blue-900">Hàng đợi RAM ({queuedPapers.length} bài)</p>
                <button
                  className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                  onClick={syncQueueAndStartGrading}
                  disabled={syncing}
                >
                  <PlayCircle size={14} />
                  {syncing ? 'Đang đồng bộ…' : 'Start Grading'}
                </button>
              </div>

              <div className="space-y-2">
                {queuedPapers.map((paper, index) => (
                  <div key={paper.clientId} className="rounded-md border border-blue-200 bg-white p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {index + 1}. {paper.student.fullName}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {paper.student.username} • {paper.pages.length}/{paper.totalPasses} trang
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button className="btn-secondary text-[10px] px-2 py-1" onClick={() => editQueuedPaper(paper)}>
                          <Pencil size={12} className="inline mr-0.5" />
                          Sửa
                        </button>
                        <button className="btn-secondary text-[10px] px-2 py-1 text-red-600" onClick={() => deleteQueuedPaper(paper)}>
                          <Trash2 size={12} className="inline mr-0.5" />
                          Xóa
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-1 overflow-x-auto">
                      {paper.pages.map((page) => (
                        <img
                          key={`${paper.clientId}-${page.passIndex}`}
                          src={page.thumb}
                          alt={`Bài ${index + 1} trang ${page.passIndex}`}
                          className="h-12 w-9 shrink-0 rounded border border-gray-200 object-cover"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {syncStatus && <p className="text-xs text-blue-800">{syncStatus}</p>}
            </div>
          )}

          {/* Manual upload fallback */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">Tải ảnh thủ công (khi không dùng được camera)</p>
            <p className="text-xs text-gray-500">
              Ảnh tải lên sẽ được thêm vào trang {activePassIndex}. Trang đầu sẽ được thử nhận diện thí sinh.
            </p>
            <label className="btn-secondary text-xs cursor-pointer inline-flex items-center">
              <Upload size={14} className="inline mr-1" />
              Tải ảnh cho trang {activePassIndex}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void uploadFromPicker(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>

          {context && context.session.status === 'COMPLETED' && (
            <p className="text-xs text-green-700 flex items-center gap-1">
              <CheckCircle2 size={14} /> Phiên thi đã hoàn tất/đã công bố.
            </p>
          )}
        </div>
      </div>

      <input
        ref={replaceFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (selectedPageIndex !== null) {
            void bufferPickedImage(e.target.files, selectedPageIndex, false);
          }
          e.currentTarget.value = '';
        }}
      />

      {selectedPageIndex !== null && pages[selectedPageIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
          <div className="w-full max-w-md rounded-xl bg-white p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">
                Trang {selectedPageIndex} • {passLabel(selectedPageIndex)}
              </p>
              <button className="btn-secondary text-xs p-2" onClick={() => setSelectedPageIndex(null)}>
                <X size={14} />
              </button>
            </div>
            <img
              src={pages[selectedPageIndex].thumb}
              alt={`Trang ${selectedPageIndex}`}
              className="max-h-[70vh] w-full rounded-lg border border-gray-200 object-contain"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-secondary text-xs inline-flex items-center justify-center gap-1"
                onClick={() => replaceFileInputRef.current?.click()}
              >
                <ImageIcon size={14} />
                Thay ảnh
              </button>
              <button
                className="btn-secondary text-xs text-red-600 inline-flex items-center justify-center gap-1"
                onClick={() => deleteCapturedPage(selectedPageIndex)}
              >
                <Trash2 size={14} />
                Xóa ảnh
              </button>
            </div>
          </div>
        </div>
      )}

      <canvas ref={probeCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
};

export default TeacherMobileScan;
