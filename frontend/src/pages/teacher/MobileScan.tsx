import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Camera, CameraOff, CheckCircle2, RefreshCw, Upload, ScanLine, UserCheck, Save, RotateCcw } from 'lucide-react';

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

type ViewfinderVariant = 'omr' | 'identityEssay' | 'essayPage' | 'generic';

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

// Probe loop tuning.
const PROBE_INTERVAL_MS = 500;
const PROBE_MAX_SIDE = 1600; // downscale preview frames before sending; big enough for OMR to read MSSV bubbles
const PROBE_QUALITY = 0.7;
const STABLE_FRAMES_REQUIRED = 2; // same recognised student across N consecutive probes before auto-capture
const CAPTURE_MAX_SIDE = 2200; // final capture stays high-res for accurate grading
const CAPTURE_QUALITY = 0.92;

const TeacherMobileScan: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [context, setContext] = useState<MobileScanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Current paper buffer (held client-side until the whole set is finalised).
  const [pages, setPages] = useState<Record<number, BufferedPage>>({});
  const [activePassIndex, setActivePassIndex] = useState(1);

  // Identity resolution for the current paper.
  const [recognizedStudent, setRecognizedStudent] = useState<StudentLite | null>(null);
  const [manualStudentId, setManualStudentId] = useState<number | null>(null);

  // Live status.
  const [probeStatus, setProbeStatus] = useState('Đưa phiếu trắc nghiệm vào khung để tự nhận diện');
  const [captureReady, setCaptureReady] = useState(false);
  const [captureHint, setCaptureHint] = useState('Camera đang tắt');
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const getCameraSupportIssue = (): string | null => {
    if (!window.isSecureContext) {
      return 'Camera trực tiếp cần HTTPS (hoặc localhost). Trên link HTTP, hãy dùng nút Tải ảnh bên dưới.';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return 'Trình duyệt này không hỗ trợ camera trực tiếp. Hãy dùng nút Tải ảnh bên dưới.';
    }
    return null;
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

  const resetPaper = () => {
    setPages({});
    setActivePassIndex(1);
    setRecognizedStudent(null);
    setManualStudentId(null);
    stableRef.current = { studentId: null, count: 0 };
    setProbeStatus('Đưa phiếu trắc nghiệm vào khung để tự nhận diện');
  };

  const stopCamera = () => {
    if (loopTimerRef.current) {
      window.clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
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
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
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

  const grabScaledBlob = async (maxSide: number, quality: number): Promise<Blob | null> => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  };

  const makeThumb = (): string => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return '';
    const w = 160;
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 220;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.6);
  };

  const bufferPage = (passIndex: number, blob: Blob, thumb: string) => {
    setPages((prev) => ({
      ...prev,
      [passIndex]: { passIndex, purpose: getPassPurpose(passIndex), blob, thumb },
    }));
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

  const handleProbeResult = (result: ProbeResult) => {
    const parts: string[] = [`Neo ${result.aligned}/4`];
    parts.push(`MSSV ${result.studentCode || '…'}`);
    if (result.mcqCount > 0) parts.push(`Đáp án ${result.answeredCount}/${result.mcqCount}`);
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
    const selectedFile = files?.[0];
    if (!selectedFile) {
      toast.error('Chưa chọn ảnh');
      return;
    }
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Chỉ chấp nhận tệp ảnh');
      return;
    }
    const passIndex = activePassIndex;
    const thumb = URL.createObjectURL(selectedFile);
    bufferPage(passIndex, selectedFile, thumb);

    if (isIdentityPass(passIndex)) {
      try {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('frame', selectedFile, 'probe.jpg');
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
    } else {
      toast.success(`Đã thêm ảnh trang ${passIndex}`);
    }
    advanceAfterCapture(passIndex);
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

    setFinalizing(true);
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('studentId', String(effectiveStudentId));
      formData.append('fullSet', '1');
      formData.append('totalPasses', String(totalPasses));
      for (let p = 1; p <= totalPasses; p += 1) {
        const name = `scan_p${String(p).padStart(2, '0')}.jpg`;
        formData.append('files', new File([pages[p].blob], name, { type: 'image/jpeg' }));
      }
      const { data } = await publicApi.post('/exams/mobile-scan/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const name = data?.resolvedStudent?.fullName || effectiveStudent?.fullName || 'thí sinh';
      toast.success(`Đã lưu bài cho ${name}. Tiếp tục bài tiếp theo.`);
      resetPaper();
      await loadContext();
    } catch (err: any) {
      const payload = err?.response?.data as { error?: string; invalidScans?: Array<{ passIndex?: number }> };
      if (Array.isArray(payload?.invalidScans) && payload.invalidScans.length > 0) {
        const bad = payload.invalidScans.map((s) => s.passIndex).filter((v): v is number => Number.isFinite(v));
        toast.error(`Trang ${bad.join(', ')} chưa đạt chất lượng, hãy chụp lại.`);
        if (bad[0]) setActivePassIndex(bad[0]);
        return;
      }
      toast.error(payload?.error || 'Lưu bài thất bại');
    } finally {
      setFinalizing(false);
    }
  };

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
            <button
              className="btn-primary text-xs"
              onClick={captureManually}
              disabled={!cameraOpen || !captureReady || busy}
            >
              {busy ? 'Đang chụp…' : onIdentityPass ? 'Chụp tay trang đầu' : 'Chụp trang này'}
            </button>
          </div>

          {/* Captured thumbnails */}
          {Object.keys(pages).length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1">
              {Array.from({ length: totalPasses }, (_, i) => i + 1).map((p) =>
                pages[p] ? (
                  <button
                    key={p}
                    onClick={() => setActivePassIndex(p)}
                    className="relative shrink-0"
                    title={`Chụp lại trang ${p}`}
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
            disabled={!allCaptured || !effectiveStudentId || finalizing}
          >
            <Save size={15} />
            {finalizing
              ? 'Đang lưu…'
              : allCaptured
                ? `Lưu bài cho ${effectiveStudent?.fullName || 'thí sinh'}`
                : `Chụp đủ ${totalPasses} trang để lưu`}
          </button>

          {Object.keys(pages).length > 0 && (
            <button className="btn-secondary w-full text-xs flex items-center justify-center gap-1" onClick={resetPaper}>
              <RotateCcw size={13} /> Bỏ bài hiện tại, bắt đầu lại
            </button>
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
                capture="environment"
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

      <canvas ref={probeCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
};

export default TeacherMobileScan;
