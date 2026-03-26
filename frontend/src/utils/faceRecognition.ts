import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';
let modelsLoaded = false;

/**
 * Load SSD MobileNet, face landmarks, and face recognition models.
 * Models are cached after first load.
 */
export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;

  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  modelsLoaded = true;
  console.log('✅ Face-api.js models loaded');
}

/**
 * Extract face descriptor(s) from an image or video element.
 * Returns array of 128-dim Float32Arrays (one per detected face).
 */
export async function extractDescriptors(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<Float32Array[]> {
  const detections = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map((d) => d.descriptor);
}

/**
 * Extract a single face descriptor from an input element.
 * Returns null if no face detected.
 */
export async function extractSingleDescriptor(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<Float32Array | null> {
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection?.descriptor ?? null;
}

export interface LabeledStudent {
  studentId: number;
  studentName: string;
  descriptors: number[][];
}

/**
 * Build a FaceMatcher from labeled student descriptors.
 * @param students - array of { studentId, studentName, descriptors: number[][] }
 * @param threshold - maximum Euclidean distance for a match (lower = stricter). Default 0.6
 */
export function buildMatcher(
  students: LabeledStudent[],
  threshold = 0.6
): faceapi.FaceMatcher | null {
  const labeledDescriptors = students
    .filter((s) => s.descriptors.length > 0)
    .map(
      (s) =>
        new faceapi.LabeledFaceDescriptors(
          `${s.studentId}|${s.studentName}`,
          s.descriptors.map((d) => new Float32Array(d))
        )
    );

  if (labeledDescriptors.length === 0) return null;

  return new faceapi.FaceMatcher(labeledDescriptors, threshold);
}

export interface FaceMatch {
  studentId: number;
  studentName: string;
  distance: number;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Detect and match all faces in a video frame against a FaceMatcher.
 * Returns an array of matches with bounding boxes.
 */
export async function detectAndMatch(
  video: HTMLVideoElement,
  matcher: faceapi.FaceMatcher
): Promise<FaceMatch[]> {
  const detections = await faceapi
    .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map((detection) => {
    const bestMatch = matcher.findBestMatch(detection.descriptor);
    const box = detection.detection.box;
    const label = bestMatch.label;

    if (label === 'unknown') {
      return {
        studentId: -1,
        studentName: 'Unknown',
        distance: bestMatch.distance,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    }

    const [studentId, studentName] = label.split('|');
    return {
      studentId: parseInt(studentId),
      studentName: studentName || 'Unknown',
      distance: bestMatch.distance,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  });
}

/**
 * Draw detection results on a canvas overlay.
 */
export function drawDetections(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  matches: FaceMatch[]
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Match canvas size to video display size
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const match of matches) {
    const { box, studentId, studentName, distance } = match;
    const isKnown = studentId !== -1;

    // Draw box
    ctx.strokeStyle = isKnown ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Draw label background
    const label = isKnown
      ? `${studentName} (${(1 - distance).toFixed(0)}%)`
      : `Unknown`;
    ctx.font = 'bold 14px Inter, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const labelHeight = 24;
    ctx.fillStyle = isKnown ? '#22c55e' : '#ef4444';
    ctx.fillRect(box.x, box.y - labelHeight, textWidth + 12, labelHeight);

    // Draw label text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, box.x + 6, box.y - 7);
  }
}

export { faceapi };
