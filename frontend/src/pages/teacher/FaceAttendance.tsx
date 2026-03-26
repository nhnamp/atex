import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  StopCircle,
  CheckCircle,
  ScanFace,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import {
  loadModels,
  buildMatcher,
  detectAndMatch,
  drawDetections,
  LabeledStudent,
  FaceMatch,
} from '../../utils/faceRecognition';
import type * as faceapiTypes from '@vladmandic/face-api';

interface SessionInfo {
  id: number;
  classId: number;
  status: string;
  method: string;
}

const FaceAttendance: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelsReady, setModelsReady] = useState(false);
  const [matcherReady, setMatcherReady] = useState(false);
  const [noFacesEnrolled, setNoFacesEnrolled] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [matchedStudents, setMatchedStudents] = useState<Map<number, { name: string; distance: number }>>(new Map());
  const [currentMatches, setCurrentMatches] = useState<FaceMatch[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const matcherRef = useRef<faceapiTypes.FaceMatcher | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const scanningRef = useRef(false);

  // Fetch session info
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const { data } = await api.get(`/attendance/sessions/${sessionId}/status`);
        setSession(data);
      } catch {
        toast.error('Failed to load session');
        navigate('/teacher/classes');
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [sessionId, navigate]);

  // Load models + build matcher
  useEffect(() => {
    if (!session) return;

    const init = async () => {
      try {
        await loadModels();
        setModelsReady(true);

        // Fetch enrolled descriptors for the class
        const { data } = await api.get(`/face/descriptors/${session.classId}`);
        const labeledStudents: LabeledStudent[] = data
          .filter((s: any) => s.enrolled)
          .map((s: any) => ({
            studentId: s.student.id,
            studentName: s.student.fullName,
            descriptors: s.descriptors,
          }));

        if (labeledStudents.length === 0) {
          toast.error('No students have enrolled face data in this class. Please enroll faces first.');
          setNoFacesEnrolled(true);
          return;
        }

        const matcher = buildMatcher(labeledStudents, 0.5);
        matcherRef.current = matcher;
        setMatcherReady(true);
        toast.success(`Ready! ${labeledStudents.length} student(s) loaded for matching.`);
      } catch (err) {
        console.error(err);
        toast.error('Failed to initialize face recognition');
      }
    };

    init();

    return () => {
      stopScanning();
    };
  }, [session]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      toast.error('Camera access denied');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const scanFrame = useCallback(async () => {
    if (!scanningRef.current || !videoRef.current || !canvasRef.current || !matcherRef.current) {
      return;
    }

    try {
      const matches = await detectAndMatch(videoRef.current, matcherRef.current);
      drawDetections(canvasRef.current, videoRef.current, matches);
      setCurrentMatches(matches);

      // Accumulate matched students
      setMatchedStudents((prev) => {
        const newMap = new Map(prev);
        for (const m of matches) {
          if (m.studentId !== -1) {
            const existing = newMap.get(m.studentId);
            // Keep the best (lowest distance) match
            if (!existing || m.distance < existing.distance) {
              newMap.set(m.studentId, { name: m.studentName, distance: m.distance });
            }
          }
        }
        return newMap;
      });
    } catch (err) {
      console.error('Scan error:', err);
    }

    if (scanningRef.current) {
      animFrameRef.current = requestAnimationFrame(scanFrame);
    }
  }, []);

  const startScanning = async () => {
    if (!matcherRef.current) {
      toast.error('Face matcher not ready. Are faces enrolled for this class?');
      return;
    }
    await startCamera();
    setScanning(true);
    scanningRef.current = true;
    // Wait a moment for the video to be ready
    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(scanFrame);
    }, 500);
  };

  const stopScanning = () => {
    scanningRef.current = false;
    setScanning(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    stopCamera();
    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleSubmit = async () => {
    if (matchedStudents.size === 0) {
      toast.error('No students have been recognized yet');
      return;
    }

    setSubmitting(true);
    try {
      const studentIds = Array.from(matchedStudents.keys());
      const { data } = await api.post(`/attendance/sessions/${sessionId}/face-submit`, {
        studentIds,
      });
      toast.success(data.message || `Marked ${data.markedCount} student(s) as present`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to submit attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnd = async () => {
    setEnding(true);
    try {
      stopScanning();
      await api.put(`/attendance/sessions/${sessionId}/end`);
      toast.success('Session ended');
      navigate(session?.classId ? `/teacher/classes/${session.classId}` : '/teacher/classes');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to end session');
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  const recognizedCount = matchedStudents.size;
  const knownInFrame = currentMatches.filter((m) => m.studentId !== -1).length;
  const unknownInFrame = currentMatches.filter((m) => m.studentId === -1).length;

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div>
          <Link
            to={session?.classId ? `/teacher/classes/${session.classId}` : '/teacher/classes'}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft size={16} /> Back to Class
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ScanFace size={28} className="text-primary-600" />
                Face Attendance — Session #{sessionId}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Point your camera at students to recognize and mark attendance.
                {!modelsReady && <span className="ml-2 text-amber-600 font-medium">⏳ Loading models...</span>}
              </p>
            </div>
            <div className="flex gap-2">
              {session?.status === 'ACTIVE' && (
                <button
                  onClick={handleEnd}
                  disabled={ending}
                  className="btn-danger flex items-center gap-2"
                >
                  <StopCircle size={16} />
                  {ending ? 'Ending...' : 'End Session'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Camera + Canvas */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="card p-4">
              <div
                className="relative bg-black rounded-xl overflow-hidden"
                style={{ minHeight: 360 }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full"
                  style={{ transform: 'scaleX(-1)' }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                />
                {!scanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80 gap-4">
                    <ScanFace size={48} className="text-gray-400" />
                    {!modelsReady && (
                      <p className="text-white text-sm">⏳ Loading face recognition models...</p>
                    )}
                    {modelsReady && noFacesEnrolled && (
                      <p className="text-amber-400 text-sm text-center px-4">No students have enrolled face data.<br/>Go back and use "Manage Faces" to enroll first.</p>
                    )}
                    {modelsReady && !noFacesEnrolled && !matcherReady && (
                      <p className="text-white text-sm">⏳ Building face matcher...</p>
                    )}
                    {matcherReady && (
                      <>
                        <p className="text-white text-sm">Camera is off</p>
                        <button onClick={startScanning} className="btn-primary flex items-center gap-2">
                          <Camera size={16} /> Start Scanning
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex gap-3">
                  {scanning ? (
                    <button onClick={stopScanning} className="btn-secondary flex items-center gap-2">
                      <StopCircle size={16} /> Pause Scanning
                    </button>
                  ) : (
                    matcherReady && (
                      <button onClick={startScanning} className="btn-primary flex items-center gap-2">
                        <Camera size={16} /> Start Scanning
                      </button>
                    )
                  )}
                </div>

                {scanning && (
                  <div className="text-sm text-gray-500">
                    <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse mr-1.5" />
                    Live — {knownInFrame} recognized, {unknownInFrame} unknown in frame
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recognized Students Sidebar */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Recognized ({recognizedCount})
              </h2>
              {recognizedCount > 0 && (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
                >
                  <Send size={12} />
                  {submitting ? 'Submitting...' : 'Submit All'}
                </button>
              )}
            </div>

            {recognizedCount === 0 ? (
              <div className="p-8 text-center">
                <ScanFace size={36} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">
                  No students recognized yet.
                  <br />
                  Start scanning to detect faces.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                {Array.from(matchedStudents.entries()).map(([studentId, { name, distance }]) => (
                  <div key={studentId} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                      <p className="text-xs text-gray-500">
                        Confidence: {((1 - distance) * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default FaceAttendance;
