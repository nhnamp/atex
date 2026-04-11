import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

let cv: any = null;
try {
  // Preferred native package.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cv = require('@u4/opencv4nodejs');
} catch {
  cv = null;
}

if (!cv) {
  try {
    // Legacy package fallback.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cv = require('opencv4nodejs');
  } catch {
    cv = null;
  }
}

type Point2D = {
  x: number;
  y: number;
};

export type PreprocessScanResult = {
  processedPath: string;
  warnings: string[];
  cleanup: () => void;
};

const ensureScansDir = (): string => {
  const scansDir = path.join(process.cwd(), 'uploads', 'scans');
  if (!fs.existsSync(scansDir)) {
    fs.mkdirSync(scansDir, { recursive: true });
  }
  return scansDir;
};

const buildOutputPath = (): string => {
  const scansDir = ensureScansDir();
  const fileName = `preprocessed_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
  return path.join(scansDir, fileName);
};

const toPoint = (x: number, y: number): any => {
  if (cv?.Point2 && typeof cv.Point2 === 'function') return new cv.Point2(x, y);
  if (cv?.Point2f && typeof cv.Point2f === 'function') return new cv.Point2f(x, y);
  if (cv?.Point && typeof cv.Point === 'function') return new cv.Point(x, y);
  return { x, y };
};

const toPointList = (raw: unknown): Point2D[] => {
  if (!raw) return [];

  const normalize = (item: unknown): Point2D | null => {
    if (!item || typeof item !== 'object') return null;
    const point = item as { x?: unknown; y?: unknown };
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  if (Array.isArray(raw)) {
    return raw.map(normalize).filter((item): item is Point2D => item !== null);
  }

  const maybeWithGetPoints = raw as { getPoints?: () => unknown };
  if (typeof maybeWithGetPoints.getPoints === 'function') {
    const points = maybeWithGetPoints.getPoints();
    if (Array.isArray(points)) {
      return points.map(normalize).filter((item): item is Point2D => item !== null);
    }
  }

  return [];
};

const distance = (a: Point2D, b: Point2D): number => {
  return Math.hypot(a.x - b.x, a.y - b.y);
};

const orderCorners = (points: Point2D[]): [Point2D, Point2D, Point2D, Point2D] => {
  if (points.length < 4) {
    throw new Error('Document contour does not have 4 corners');
  }

  const topLeft = points.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best), points[0]);
  const bottomRight = points.reduce((best, p) => (p.x + p.y > best.x + best.y ? p : best), points[0]);
  const topRight = points.reduce((best, p) => (p.y - p.x < best.y - best.x ? p : best), points[0]);
  const bottomLeft = points.reduce((best, p) => (p.y - p.x > best.y - best.x ? p : best), points[0]);

  return [topLeft, topRight, bottomRight, bottomLeft];
};

const detectDocumentCorners = (imageMat: any): Point2D[] | null => {
  const gray = imageMat.bgrToGray();
  const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
  const edges = blurred.canny(75, 200);
  const contours = edges.findContours(cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  if (!Array.isArray(contours) || contours.length === 0) {
    return null;
  }

  const largestContours = contours.sort((a: any, b: any) => b.area - a.area).slice(0, 10);
  for (const contour of largestContours) {
    const perimeter = contour.arcLength(true);
    const approx = contour.approxPolyDP(0.02 * perimeter, true);
    const points = toPointList(approx);
    if (points.length === 4) {
      return points;
    }
  }

  return null;
};

const preprocessWithOpenCv = async (inputPath: string, outputPath: string): Promise<string[]> => {
  const warnings: string[] = [];
  const imageMat = cv.imread(inputPath);

  if (!imageMat || !imageMat.rows || !imageMat.cols) {
    throw new Error('OpenCV could not decode image');
  }

  let working = imageMat;
  const corners = detectDocumentCorners(imageMat);

  if (corners) {
    const [tl, tr, br, bl] = orderCorners(corners);
    const maxWidth = Math.max(distance(br, bl), distance(tr, tl));
    const maxHeight = Math.max(distance(tr, br), distance(tl, bl));

    if (maxWidth > 50 && maxHeight > 50) {
      const src = [tl, tr, br, bl].map((point) => toPoint(point.x, point.y));
      const dst = [
        toPoint(0, 0),
        toPoint(maxWidth - 1, 0),
        toPoint(maxWidth - 1, maxHeight - 1),
        toPoint(0, maxHeight - 1),
      ];

      const transform = cv.getPerspectiveTransform(src, dst);
      working = imageMat.warpPerspective(transform, new cv.Size(Math.round(maxWidth), Math.round(maxHeight)));
    } else {
      warnings.push('Document contour detected but too small for perspective correction');
    }
  } else {
    warnings.push('Could not detect document corners for perspective correction');
  }

  const gray = typeof working.bgrToGray === 'function' ? working.bgrToGray() : working;
  const denoised = gray.gaussianBlur(new cv.Size(3, 3), 0);
  const thresholded = denoised.adaptiveThreshold(
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY,
    31,
    15
  );

  cv.imwrite(outputPath, thresholded);
  return warnings;
};

const preprocessWithSharpFallback = async (inputPath: string, outputPath: string): Promise<string[]> => {
  await sharp(inputPath)
    .rotate()
    .grayscale()
    .normalise()
    .sharpen()
    .threshold(170)
    .toFile(outputPath);

  return ['OpenCV runtime unavailable, used Sharp fallback preprocessing'];
};

export const preprocessScanForAnalysis = async (inputPath: string): Promise<PreprocessScanResult> => {
  if (!fs.existsSync(inputPath)) {
    throw new Error('Scan file not found');
  }

  const outputPath = buildOutputPath();
  const warnings: string[] = [];

  try {
    if (cv) {
      warnings.push(...await preprocessWithOpenCv(inputPath, outputPath));
    } else {
      warnings.push(...await preprocessWithSharpFallback(inputPath, outputPath));
    }
  } catch (error) {
    warnings.push(`OpenCV preprocessing failed; fallback applied: ${(error as Error).message}`);
    await preprocessWithSharpFallback(inputPath, outputPath);
  }

  return {
    processedPath: outputPath,
    warnings: [...new Set(warnings)],
    cleanup: () => {
      if (fs.existsSync(outputPath)) {
        fs.unlink(outputPath, () => undefined);
      }
    },
  };
};
