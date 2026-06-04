import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Camera, Check, X, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { loadModels, warmupFaceRecognition, extractSingleDescriptor } from '../../utils/faceRecognition';

interface StudentFaceInfo {
  student: { id: number; username: string; fullName: string };
  descriptors: number[][];
  enrolled: boolean;
}

const FaceEnrollment: React.FC = () => {
  const { id: classId } = useParams<{ id: string }>();
  const [students, setStudents] = useState<StudentFaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsReady, setModelsReady] = useState(false);
  const [preparingModels, setPreparingModels] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<StudentFaceInfo | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [capturedDescriptors, setCapturedDescriptors] = useState<number[][]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const MAX_PHOTOS = 1;

  const fetchStudents = useCallback(async () => {
    try {
      const { data } = await api.get<StudentFaceInfo[]>(`/face/descriptors/${classId}`);
      setStudents(data);
    } catch {
      toast.error('Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        setPreparingModels(true);
        await loadModels();
        await warmupFaceRecognition();
        if (!cancelled) {
          setModelsReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error('Failed to load face recognition models');
        }
        console.error(err);
      } finally {
        if (!cancelled) {
          setPreparingModels(false);
        }
      }
      await fetchStudents();
    };
    init();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [fetchStudents]);

  const startCamera = async () => {
    if (!modelsReady) {
      toast.error('Face recognition is still preparing. Please wait.');
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCapturing(true);
    } catch (err) {
      toast.error('Camera access denied. Please allow camera permission.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCapturing(false);
  };

  const handleSelectStudent = (student: StudentFaceInfo) => {
    if (!modelsReady) {
      toast.error('Face recognition is still preparing. Please wait.');
      return;
    }

    setSelectedStudent(student);
    setCapturedDescriptors([]);
    void startCamera();
  };

  const handleCapture = async () => {
    if (!videoRef.current || !modelsReady) return;

    const descriptor = await extractSingleDescriptor(videoRef.current);
    if (!descriptor) {
      toast.error('No face detected. Please ensure your face is visible and well-lit.');
      return;
    }

    const newDescriptors = [...capturedDescriptors, Array.from(descriptor)];
    setCapturedDescriptors(newDescriptors);
    toast.success(`Photo ${newDescriptors.length}/${MAX_PHOTOS} captured ✅`);

    if (newDescriptors.length >= MAX_PHOTOS) {
      // Auto-stop camera after reaching capture limit
      stopCamera();
    }
  };

  const handleEnroll = async () => {
    if (!selectedStudent || capturedDescriptors.length === 0) return;

    setEnrolling(true);
    try {
      await api.post('/face/enroll', {
        studentId: selectedStudent.student.id,
        descriptors: capturedDescriptors,
      });
      toast.success(`Face enrolled for ${selectedStudent.student.fullName}`);
      setSelectedStudent(null);
      setCapturedDescriptors([]);
      stopCamera();
      fetchStudents();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to enroll face');
    } finally {
      setEnrolling(false);
    }
  };

  const handleDelete = async (studentId: number, name: string) => {
    if (!confirm(`Delete face data for ${name}?`)) return;

    try {
      await api.delete(`/face/descriptors/${studentId}`);
      toast.success(`Face data deleted for ${name}`);
      fetchStudents();
    } catch {
      toast.error('Failed to delete face data');
    }
  };

  const handleCancel = () => {
    setSelectedStudent(null);
    setCapturedDescriptors([]);
    stopCamera();
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <Link
            to={`/teacher/classes/${classId}`}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft size={16} /> Back to Class
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Face Enrollment</h1>
          <p className="text-gray-500 mt-1">
            Capture student faces for face-recognition attendance.
            {preparingModels && (
              <span className="ml-2 text-amber-600 font-medium">
                Preparing face models...
              </span>
            )}
          </p>
        </div>

        {/* Capture Section */}
        {selectedStudent && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Enrolling: {selectedStudent.student.fullName}
                </h2>
                <p className="text-sm text-gray-500">
                  {selectedStudent.student.username} — Capture 1 photo
                </p>
              </div>
              <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="relative bg-black rounded-xl overflow-hidden mb-4" style={{ maxWidth: 640 }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full"
                style={{ transform: 'scaleX(-1)' }}
              />
              {!capturing && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                  <p className="text-white text-sm">Camera stopped</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              {capturing && capturedDescriptors.length < MAX_PHOTOS && (
                <button
                  onClick={handleCapture}
                  disabled={!modelsReady}
                  className="btn-primary flex items-center gap-2"
                >
                  <Camera size={16} />
                  Capture Photo ({capturedDescriptors.length}/{MAX_PHOTOS})
                </button>
              )}

              {!capturing && capturedDescriptors.length < MAX_PHOTOS && (
                <button onClick={startCamera} className="btn-secondary flex items-center gap-2">
                  <Camera size={16} /> Resume Camera
                </button>
              )}

              {capturedDescriptors.length > 0 && (
                <button
                  onClick={handleEnroll}
                  disabled={enrolling}
                  className="btn-primary flex items-center gap-2 bg-green-600 hover:bg-green-700"
                >
                  <Check size={16} />
                  {enrolling ? 'Enrolling...' : `Enroll (${capturedDescriptors.length} photo${capturedDescriptors.length > 1 ? 's' : ''})`}
                </button>
              )}

              {/* Progress dots */}
              <div className="flex gap-2 ml-auto">
                {Array.from({ length: MAX_PHOTOS }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-all ${
                      i < capturedDescriptors.length
                        ? 'bg-green-500'
                        : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Student List */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Students</h2>
          </div>
          {!students.length ? (
            <div className="p-8 text-center">
              <p className="text-gray-400">No students in this class</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {students.map((s) => (
                <div
                  key={s.student.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                        s.enrolled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <User size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.student.fullName}</p>
                      <p className="text-xs text-gray-500">
                        {s.student.username}
                        {s.enrolled && (
                          <span className="ml-2 text-green-600 font-medium">
                            ✅ Face enrolled ({s.descriptors.length} descriptor{s.descriptors.length > 1 ? 's' : ''})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.enrolled && (
                      <button
                        onClick={() => handleDelete(s.student.id, s.student.fullName)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="Delete face data"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => handleSelectStudent(s)}
                      disabled={!modelsReady || preparingModels || (selectedStudent?.student.id === s.student.id)}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      {s.enrolled ? 'Re-enroll' : 'Enroll Face'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default FaceEnrollment;
