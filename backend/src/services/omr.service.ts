import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

let cv: any = null;
try {
  // Optional native OpenCV runtime. If unavailable, heuristic fallback remains active.
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

  export interface Bubble {
    x: number;
    y: number;
    width: number;
    height: number;
    option: string;
  }

  export interface OmrQuestionRegion {
    questionId: number;
    bubbles: Bubble[];
  }

  export interface OmrTemplate {
    questions: OmrQuestionRegion[];
    darknessThreshold?: number;
    referenceWidth?: number;
    referenceHeight?: number;
  }

  export interface DocumentDetectionResult {
    ready: boolean;
    confidence: number;
    width: number;
    height: number;
    documentBox: { x: number; y: number; width: number; height: number };
    corners?: { x: number; y: number }[] | null;
    warnings: string[];
  }

export interface OmrIdentityResult {
  fullName: string | null;
  studentCode: string | null;
  confidence: number;
  warnings: string[];
}

const REFERENCE_WIDTH = 2480;
const REFERENCE_HEIGHT = 3508;

const STUDENT_CODE_GRID = {
  columns: 8,
  rows: 11, // include the top handwriting row + 10 bubble rows
};

// Tunable ROI percentages (relative to warped reference image).
// These were adjusted to tightly crop the black border around the MSSV box.
const STUDENT_CODE_ROI_PERCENT = {
  x: 0.68,
  y: 0.126,
  width: 0.245,
  height: 0.232,
};

const samplePatchDarkness = async (
  image: sharp.Sharp,
  centerX: number,
  centerY: number,
  size: number,
  imageWidth: number,
  imageHeight: number
): Promise<number> => {
  const offsets = [-0.2, 0, 0.2];
  let bestDarkness = 255;

  for (const offsetYFactor of offsets) {
    for (const offsetXFactor of offsets) {
      const offsetX = Math.round(size * offsetXFactor);
      const offsetY = Math.round(size * offsetYFactor);
      const left = Math.max(0, Math.round(centerX + offsetX - size / 2));
      const top = Math.max(0, Math.round(centerY + offsetY - size / 2));
      const extractWidth = Math.max(1, Math.min(Math.round(size), imageWidth - left));
      const extractHeight = Math.max(1, Math.min(Math.round(size), imageHeight - top));
      if (extractWidth <= 0 || extractHeight <= 0) {
        continue;
      }
      const patch = await image
        .clone()
        .extract({
          left,
          top,
          width: extractWidth,
          height: extractHeight,
        })
        .raw()
        .toBuffer();

      const sorted = Array.from(patch).sort((left, right) => left - right);
      const darkestCount = Math.max(8, Math.floor(sorted.length * 0.3));
      let total = 0;
      for (let index = 0; index < darkestCount; index += 1) {
        total += sorted[index];
      }

      const darkness = total / darkestCount;
      if (darkness < bestDarkness) {
        bestDarkness = darkness;
      }
    }
  }

  return bestDarkness;
};

const averageDarkness = (pixels: Buffer): number => {
  let total = 0;
  for (let i = 0; i < pixels.length; i++) {
    total += pixels[i];
  }
  return total / pixels.length;
};

interface DetectedCircle {
  x: number;
  y: number;
  radius: number;
}

interface GrayImageData {
  pixels: Buffer;
  width: number;
  height: number;
  isCvMat?: boolean;
  cvMat?: any;
}

interface ContourBubbleCandidate extends DetectedCircle {
  area: number;
  circularity: number;
  fillRatio: number;
}

const clampRect = (
  left: number,
  top: number,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number
): { left: number; top: number; width: number; height: number } => {
  const clampedLeft = Math.max(0, Math.min(Math.floor(left), Math.max(0, imageWidth - 1)));
  const clampedTop = Math.max(0, Math.min(Math.floor(top), Math.max(0, imageHeight - 1)));
  const clampedRight = Math.max(clampedLeft + 1, Math.min(Math.ceil(left + width), imageWidth));
  const clampedBottom = Math.max(clampedTop + 1, Math.min(Math.ceil(top + height), imageHeight));

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(1, clampedRight - clampedLeft),
    height: Math.max(1, clampedBottom - clampedTop),
  };
};

const extractStudentCodeRoi = async (
  image: sharp.Sharp
): Promise<{ color: Buffer; width: number; height: number }> => {
  const metadata = await image.metadata();
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);

  if (!imageWidth || !imageHeight) {
    throw new Error('Cannot determine working image dimensions');
  }

  const roi = {
    left: Math.round(imageWidth * STUDENT_CODE_ROI_PERCENT.x),
    top: Math.round(imageHeight * STUDENT_CODE_ROI_PERCENT.y),
    width: Math.round(imageWidth * STUDENT_CODE_ROI_PERCENT.width),
    height: Math.round(imageHeight * STUDENT_CODE_ROI_PERCENT.height),
  };
  const rect = clampRect(roi.left, roi.top, roi.width, roi.height, imageWidth, imageHeight);
  const color = await image
    .clone()
    .extract(rect)
    .png()
    .toBuffer();

  return { color, width: rect.width, height: rect.height };
};

const buildStudentCodeGrid = (roiWidth: number, roiHeight: number) => {
  const cellWidth = roiWidth / STUDENT_CODE_GRID.columns;
  const cellHeight = roiHeight / STUDENT_CODE_GRID.rows;
  const radius = Math.max(8, Math.floor(Math.min(cellWidth, cellHeight) * 0.31));

  const centers = Array.from({ length: STUDENT_CODE_GRID.columns }, (_, column) =>
    Array.from({ length: STUDENT_CODE_GRID.rows }, (_, row) => ({
      column,
      row,
      x: (column + 0.5) * cellWidth,
      y: (row + 0.5) * cellHeight,
      radius,
    }))
  );

  return { cellWidth, cellHeight, radius, centers };
};

// Sampling / scoring constants
const SAMPLE_RADIUS = 5; // pixels around center to average (patch scoring)
const MIN_MARK_THRESHOLD = 0.25; // minimal fill ratio to consider marked (lowered for faint pencil)
const TIE_GAP = 0.08; // minimal gap between top two candidates

const SHIFT_PIXELS = 5; // search up/down range in pixels for local calibration

const scoreFixedCircleFill = (grayImage: GrayImageData, circle: DetectedCircle): number => {
  const innerRadius = circle.radius * 0.08;
  const outerRadius = circle.radius * 0.58;
  const inner2 = innerRadius * innerRadius;
  const outer2 = outerRadius * outerRadius;

  // Try OpenCV first: apply adaptive threshold on a small patch around the bubble
  if (grayImage.isCvMat && cv && grayImage.cvMat) {
    try {
      const left = Math.max(0, Math.floor(circle.x - outerRadius));
      const right = Math.min(grayImage.width - 1, Math.ceil(circle.x + outerRadius));
      const top = Math.max(0, Math.floor(circle.y - outerRadius));
      const bottom = Math.min(grayImage.height - 1, Math.ceil(circle.y + outerRadius));
      const width = Math.max(1, right - left + 1);
      const height = Math.max(1, bottom - top + 1);

      const rect = new cv.Rect(left, top, width, height);
      const patchMat = grayImage.cvMat.getRegion(rect);

      // Use raw grayscale pixel buffer for per-patch adaptive processing (robust across bindings)
      const PW = width;
      const PH = height;
      let darkCount = 0;
      let sampleCount = 0;

      // compute mean/stddev over patch using grayImage.pixels
      let sum = 0;
      let sum2 = 0;
      for (let py = 0; py < PH; py += 1) {
        for (let px = 0; px < PW; px += 1) {
          const gx = left + px;
          const gy = top + py;
          const idx = gy * grayImage.width + gx;
          if (idx >= 0 && idx < grayImage.pixels.length) {
            const v = grayImage.pixels[idx];
            sum += v;
            sum2 += v * v;
          }
        }
      }
      const total = Math.max(1, PW * PH);
      const mean = sum / total;
      const variance = Math.max(0, sum2 / total - mean * mean);
      const stddev = Math.sqrt(variance);
      const threshold = Math.max(10, Math.round(mean - Math.max(15, Math.round(stddev * 0.5))));

      for (let py = 0; py < PH; py += 1) {
        for (let px = 0; px < PW; px += 1) {
          const gx = left + px;
          const gy = top + py;
          const dx = gx - circle.x;
          const dy = gy - circle.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < inner2 || dist2 > outer2) continue;
          const idx = gy * grayImage.width + gx;
          if (idx >= 0 && idx < grayImage.pixels.length) {
            const value = grayImage.pixels[idx];
            sampleCount += 1;
            if (value < threshold) darkCount += 1;
          }
        }
      }

      const score = darkCount / Math.max(1, sampleCount);
      if (process.env.OMR_DEBUG_PIXEL === '1') {
        // eslint-disable-next-line no-console
        console.log(`[PIXEL_DEBUG] OpenCV adaptive circle (${circle.x.toFixed(0)},${circle.y.toFixed(0)}) r=${circle.radius.toFixed(0)}: dark=${darkCount} samples=${sampleCount} score=${score.toFixed(3)}`);
      }

      return score;
    } catch (err) {
      if (process.env.OMR_DEBUG === '1') {
        // eslint-disable-next-line no-console
        console.log('[OMR_DEBUG] OpenCV per-patch scoring failed, falling back:', String(err).slice(0, 120));
      }
      // Fall through to pixel-based approach
    }
  }

  // Fallback: pixel-based scoring without OpenCV
  const left = Math.max(0, Math.floor(circle.x - outerRadius));
  const right = Math.min(grayImage.width - 1, Math.ceil(circle.x + outerRadius));
  const top = Math.max(0, Math.floor(circle.y - outerRadius));
  const bottom = Math.min(grayImage.height - 1, Math.ceil(circle.y + outerRadius));

  let darkCount = 0;
  let sampleCount = 0;
  // For fallback, compute local mean over the patch and use mean - offset as threshold
  const patchLeft = Math.max(0, Math.floor(circle.x - outerRadius));
  const patchTop = Math.max(0, Math.floor(circle.y - outerRadius));
  const patchRight = Math.min(grayImage.width - 1, Math.ceil(circle.x + outerRadius));
  const patchBottom = Math.min(grayImage.height - 1, Math.ceil(circle.y + outerRadius));

  // Collect pixels in the rectangular patch to compute mean
  let patchSum = 0;
  let patchCount = 0;
  for (let py = patchTop; py <= patchBottom; py += 1) {
    for (let px = patchLeft; px <= patchRight; px += 1) {
      const idx = py * grayImage.width + px;
      if (idx >= 0 && idx < grayImage.pixels.length) {
        patchSum += grayImage.pixels[idx];
        patchCount += 1;
      }
    }
  }

  const patchMean = patchCount > 0 ? patchSum / patchCount : 128;
  const offset = 20; // lower threshold below mean to capture faint pencil
  const darkThreshold = Math.max(10, patchMean - offset);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - circle.x;
      const dy = y - circle.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < inner2 || dist2 > outer2) continue;
      sampleCount += 1;
      const pixelIndex = y * grayImage.width + x;
      if (pixelIndex >= 0 && pixelIndex < grayImage.pixels.length) {
        const value = grayImage.pixels[pixelIndex];
        if (value < darkThreshold) darkCount += 1;
      }
    }
  }

  return darkCount / Math.max(1, sampleCount);
};

const detectDocumentBoxFromThreshold = async (imagePath: string): Promise<{ x: number; y: number; width: number; height: number } | null> => {
  const meta = await sharp(imagePath).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);

  if (!width || !height) {
    return null;
  }

  const probeWidth = 640;
  const probeHeight = Math.max(360, Math.round((height / width) * probeWidth));
  const pixels = await sharp(imagePath)
    .resize(probeWidth, probeHeight, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  let minX = probeWidth;
  let minY = probeHeight;
  let maxX = -1;
  let maxY = -1;
  let darkPixels = 0;
  const threshold = 245;

  for (let y = 0; y < probeHeight; y += 1) {
    for (let x = 0; x < probeWidth; x += 1) {
      const value = pixels[y * probeWidth + x] || 0;
      if (value >= threshold) continue;
      darkPixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (darkPixels < probeWidth * probeHeight * 0.02 || maxX < 0 || maxY < 0) {
    return null;
  }

  const paddingX = Math.max(4, Math.round((maxX - minX) * 0.03));
  const paddingY = Math.max(4, Math.round((maxY - minY) * 0.03));

  const left = Math.max(0, minX - paddingX);
  const top = Math.max(0, minY - paddingY);
  const right = Math.min(probeWidth - 1, maxX + paddingX);
  const bottom = Math.min(probeHeight - 1, maxY + paddingY);

  return {
    x: Math.round((left / probeWidth) * width),
    y: Math.round((top / probeHeight) * height),
    width: Math.max(1, Math.round(((right - left + 1) / probeWidth) * width)),
    height: Math.max(1, Math.round(((bottom - top + 1) / probeHeight) * height)),
  };
};

export const detectDocumentForOmr = async (imagePath: string): Promise<DocumentDetectionResult> => {
  const meta = await sharp(imagePath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (!width || !height) {
    return {
      ready: false,
      confidence: 0,
      width,
      height,
      documentBox: { x: 0, y: 0, width: 0, height: 0 },
      warnings: ['Cannot read image dimensions'],
    };
  }

  if (cv) {
    try {
      const mat = cv.imread(imagePath);
      const gray = mat.bgrToGray();
      const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
      const edges = blurred.canny(75, 200);
      const contours = edges.findContours(cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      if (Array.isArray(contours) && contours.length > 0) {
        const best = contours.sort((a: any, b: any) => b.area - a.area)[0];
        // Attempt polygon approximation to find quad corners for perspective rectification
        const peri = best.arcLength(true);
        const approx = best.approxPolyDP(0.02 * peri, true);
        if (approx && approx.length === 4) {
          // sort corners to TL, TR, BR, BL
          const pts = approx.map((p: any) => ({ x: p.x, y: p.y }));
          pts.sort((a: any, b: any) => a.x - b.x);
          const left = pts.slice(0, 2).sort((a: any, b: any) => a.y - b.y);
          const right = pts.slice(2, 4).sort((a: any, b: any) => a.y - b.y);
          const corners = [left[0], right[0], right[1], left[1]];
          const minX = Math.min(...corners.map((c: any) => c.x));
          const minY = Math.min(...corners.map((c: any) => c.y));
          const maxX = Math.max(...corners.map((c: any) => c.x));
          const maxY = Math.max(...corners.map((c: any) => c.y));
          const rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          const areaRatio = (rect.width * rect.height) / Math.max(1, width * height);
          const ready = areaRatio > 0.25; // allow smaller area if corners detected

          return {
            ready,
            confidence: Number(Math.max(0, Math.min(1, areaRatio)).toFixed(3)),
            width,
            height,
            documentBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            corners,
            warnings: ready ? [] : ['OpenCV found paper corners but frame coverage is low'],
          };
        }
        // fallback to bounding rect if polygon not found
        const rect = best.boundingRect();
        const areaRatio = (rect.width * rect.height) / Math.max(1, width * height);
        const ready = areaRatio > 0.5;

        return {
          ready,
          confidence: Number(Math.max(0, Math.min(1, areaRatio)).toFixed(3)),
          width,
          height,
          documentBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          corners: null,
          warnings: ready ? [] : ['OpenCV detected document but frame coverage is low'],
        };
      }
    } catch {
      // Continue with fallback detector.
    }
  }

  const thresholdBox = await detectDocumentBoxFromThreshold(imagePath);
  if (thresholdBox) {
    const areaRatio = (thresholdBox.width * thresholdBox.height) / Math.max(1, width * height);
    const ready = areaRatio > 0.45;

    return {
      ready,
      confidence: Number(Math.max(0, Math.min(1, areaRatio)).toFixed(3)),
      width,
      height,
      documentBox: thresholdBox,
      warnings: ready ? [] : ['Threshold-based document detection coverage is low'],
    };
  }

  const probeW = 320;
  const probeH = Math.max(180, Math.round((height / width) * probeW));
  const pixels = await sharp(imagePath)
    .resize(probeW, probeH, { fit: 'cover' })
    .greyscale()
    .raw()
    .toBuffer();

  let avg = 0;
  let edge = 0;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i];
    avg += value;
    if (i > 0) {
      edge += Math.abs(value - pixels[i - 1]);
    }
  }
  const avgBrightness = avg / Math.max(1, pixels.length);
  const edgeScore = edge / Math.max(1, pixels.length);

  const goodLight = avgBrightness > 55 && avgBrightness < 220;
  const goodEdge = edgeScore > 7;
  const ready = goodLight && goodEdge;
  const confidence = Math.max(0, Math.min(1, ((goodLight ? 0.55 : 0.2) + Math.min(edgeScore / 18, 0.45))));

  const marginX = Math.round(width * 0.05);
  const marginY = Math.round(height * 0.05);
  const warnings: string[] = [];
  if (!goodLight) warnings.push('Lighting is not ideal for OMR');
  if (!goodEdge) warnings.push('Document edges are not sharp enough');
  if (!cv) warnings.push('OpenCV runtime not found, using fallback document detector');

  return {
    ready,
    confidence: Number(confidence.toFixed(3)),
    width,
    height,
    documentBox: {
      x: marginX,
      y: marginY,
      width: width - marginX * 2,
      height: height - marginY * 2,
    },
    corners: null,
    warnings,
  };
};

export const calibrateOmrTemplate = (
  template: OmrTemplate,
  detection: DocumentDetectionResult
): OmrTemplate => {
  const refW = template.referenceWidth || detection.width;
  const refH = template.referenceHeight || detection.height;

  if (!refW || !refH) return template;

  const scaleX = detection.documentBox.width / refW;
  const scaleY = detection.documentBox.height / refH;

  return {
    ...template,
    questions: template.questions.map((question) => ({
      ...question,
      bubbles: question.bubbles.map((bubble) => ({
        ...bubble,
        x: detection.documentBox.x + bubble.x * scaleX,
        y: detection.documentBox.y + bubble.y * scaleY,
        width: Math.max(1, bubble.width * scaleX),
        height: Math.max(1, bubble.height * scaleY),
      })),
    })),
  };
};

export const detectMarkedOptions = async (
  imagePath: string,
  template: OmrTemplate
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const threshold = template.darknessThreshold ?? 165;

  const image = sharp(imagePath).greyscale();

  for (const question of template.questions) {
    let bestOption = '';
    let darkest = 255;

    for (const bubble of question.bubbles) {
      const patch = await image
        .clone()
        .extract({
          left: Math.max(0, Math.floor(bubble.x)),
          top: Math.max(0, Math.floor(bubble.y)),
          width: Math.max(1, Math.floor(bubble.width)),
          height: Math.max(1, Math.floor(bubble.height)),
        })
        .raw()
        .toBuffer();

      const darkness = averageDarkness(patch);
      if (darkness < darkest) {
        darkest = darkness;
        bestOption = bubble.option;
      }
    }

    if (bestOption && darkest <= threshold) {
      result[String(question.questionId)] = bestOption;
    }
  }

  return result;
};

export const extractStudentIdentityFromOmr = async (
  imagePath: string,
  options?: { exportWarpPath?: string; exportOverlayPath?: string; dumpScores?: boolean }
): Promise<OmrIdentityResult> => {
  const warnings: string[] = [];

  if (!imagePath) {
    return {
      fullName: null,
      studentCode: null,
      confidence: 0,
      warnings: ['Scan file path is empty'],
    };
  }

  const detection = await detectDocumentForOmr(imagePath);

  // Strict: if document edges/corners not detected confidently, stop and request manual review.
  if (!detection.ready) {
    return {
      fullName: null,
      studentCode: null,
      confidence: 0,
      warnings: [...new Set([...(detection.warnings || []), 'Document edges not detected - manual review required'])],
    };
  }

  let roiBuffer: Buffer;
  let roiWidth: number;
  let roiHeight: number;

  // Try perspective transform with OpenCV if available
  if (cv && detection.corners && detection.corners.length === 4) {
    try {
      const mat = cv.imread(imagePath);
      const src = detection.corners.map((corner) => new cv.Point2(Math.max(0, Math.round(corner.x)), Math.max(0, Math.round(corner.y))));
      const dst = [new cv.Point2(0, 0), new cv.Point2(REFERENCE_WIDTH - 1, 0), new cv.Point2(REFERENCE_WIDTH - 1, REFERENCE_HEIGHT - 1), new cv.Point2(0, REFERENCE_HEIGHT - 1)];
      const matrix = cv.getPerspectiveTransform(src, dst);
      const warped = mat.warpPerspective(matrix, new cv.Size(REFERENCE_WIDTH, REFERENCE_HEIGHT));
      const warpedBuffer = Buffer.from(cv.imencode('.png', warped));

      if (options?.exportWarpPath) {
        try {
          await fs.promises.mkdir(path.dirname(options.exportWarpPath), { recursive: true });
          await fs.promises.writeFile(options.exportWarpPath, warpedBuffer);
        } catch {
          // ignore export failures
        }
      }

      // Extract ROI from warped image
      const roi = await extractStudentCodeRoi(sharp(warpedBuffer));
      roiBuffer = roi.color;
      roiWidth = roi.width;
      roiHeight = roi.height;
    } catch {
      // Fall back to direct extraction
      warnings.push('Perspective transform failed, using direct ROI extraction');
      const roi = await extractStudentCodeRoi(sharp(imagePath));
      roiBuffer = roi.color;
      roiWidth = roi.width;
      roiHeight = roi.height;
    }
  } else {
    // Fallback: no OpenCV or corners not detected, extract ROI directly from original image
    if (cv || (detection.corners && detection.corners.length !== 4)) {
      warnings.push('OpenCV warp not available, using direct ROI extraction');
    }
    const roi = await extractStudentCodeRoi(sharp(imagePath));
    roiBuffer = roi.color;
    roiWidth = roi.width;
    roiHeight = roi.height;
  }

  // Load ROI image data
  let roiMat: GrayImageData;
  
  if (cv) {
    try {
      const cvMat = cv.imdecode(roiBuffer).bgrToGray();
      // Also extract raw grayscale pixels for robust per-patch processing
      const pixels = await sharp(Buffer.from(roiBuffer)).greyscale().raw().toBuffer();
      roiMat = {
        pixels,
        width: roiWidth,
        height: roiHeight,
        isCvMat: true,
        cvMat: cvMat,
      };
    } catch {
      // Fall back to pixel-based approach
      const pixels = await sharp(Buffer.from(roiBuffer))
        .greyscale()
        .raw()
        .toBuffer();
      roiMat = {
        pixels,
        width: roiWidth,
        height: roiHeight,
        isCvMat: false,
      };
    }
  } else {
    // No OpenCV, use pixel-based approach
    const pixels = await sharp(Buffer.from(roiBuffer))
      .greyscale()
      .raw()
      .toBuffer();
    roiMat = {
      pixels,
      width: roiWidth,
      height: roiHeight,
      isCvMat: false,
    };
  }
  
  const grid = buildStudentCodeGrid(roiWidth, roiHeight);

  const digits: string[] = [];
  let detectedColumns = 0;
  let totalConfidence = 0;
  const selectedCircles: DetectedCircle[] = [];

  // Prepare matrix [digit 0..9][column 0..7]
  const scoreMatrix: number[][] = Array.from({ length: 10 }, () => Array.from({ length: STUDENT_CODE_GRID.columns }, () => 0));

  for (let column = 0; column < grid.centers.length; column += 1) {
    const candidateCenters = grid.centers[column].filter((c) => c.row >= 1 && c.row <= 10);
    const scores: { row: number; ratio: number; circle: DetectedCircle }[] = [];

    for (const center of candidateCenters) {
      // local vertical search around center.y
      let bestRatio = -1;
      let bestY = center.y;
      for (let dy = -SHIFT_PIXELS; dy <= SHIFT_PIXELS; dy += 1) {
        const testY = center.y + dy;
        const ratio = scoreFixedCircleFill(roiMat, { x: center.x, y: testY, radius: center.radius });
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestY = testY;
        }
      }

      // store locked center (with adjusted y)
      const locked: DetectedCircle = { x: center.x, y: bestY, radius: center.radius };
      scoreMatrix[center.row - 1][column] = bestRatio;
      scores.push({ row: center.row, ratio: bestRatio, circle: locked });
    }

    scores.sort((left, right) => right.ratio - left.ratio);
    const best = scores[0];
    const second = scores[1] || { ratio: 0, row: -1, circle: best ? best.circle : { x: 0, y: 0, radius: 0 } };
    const fillGap = best ? best.ratio - second.ratio : 0;

    if (process.env.OMR_DEBUG === '1') {
      // eslint-disable-next-line no-console
      console.log('[OMR_DEBUG]', 'column', column + 1, 'all scores:', scores.map((item) => Number(item.ratio.toFixed(3))), 'top3:', scores.slice(0, 3).map((item) => ({ row: item.row, fillRatio: Number(item.ratio.toFixed(3)), x: Number(item.circle.x.toFixed(1)), y: Number(item.circle.y.toFixed(1)), digit: item.row - 1 })));
      if (best && best.ratio === 0) {
        // eslint-disable-next-line no-console
        console.log('[OMR_DEBUG] WARNING: All scores are 0! ROI dimensions:', roiWidth, 'x', roiHeight, 'grid center:', grid.centers[column][1]);
      }
    }

    if (!best || best.ratio < MIN_MARK_THRESHOLD || fillGap < TIE_GAP) {
      warnings.push(`MSSV column ${column + 1} is not confident enough`);
      digits.push('?');
      continue;
    }

    const digit = best.row - 1;
    digits.push(String(digit));
    detectedColumns += 1;
    totalConfidence += Math.max(0, Math.min(1, best.ratio));
    selectedCircles.push(best.circle);
  }

  // If dumpScores flag set, print a clear matrix: rows digit 0..9, columns 1..8
  if (options?.dumpScores) {
    // Print header
    // eslint-disable-next-line no-console
    console.log('SCORES MATRIX (rows=digits 0..9, cols=1..8)');
    for (let r = 0; r < 10; r += 1) {
      const rowStr = scoreMatrix[r].map((v) => v.toFixed(3).padStart(6)).join(' ');
      // eslint-disable-next-line no-console
      console.log(`digit ${r}: ${rowStr}`);
    }
  }

  const studentCode = digits.every((digit) => digit === '?') ? null : digits.join('');
  if (!studentCode) {
    warnings.push('OMR student code could not be resolved from the MSSV grid ROI');
  }

  const confidence = detectedColumns > 0 ? Number((totalConfidence / detectedColumns).toFixed(3)) : 0;

  if (options?.exportOverlayPath) {
    try {
      if (cv && roiMat.isCvMat && roiMat.cvMat) {
        // Use OpenCV for overlay if available
        const overlayMat = cv.imdecode(roiBuffer);
        // Draw ROI bounding rectangle (around the ROI image itself)
        const left = 0;
        const top = 0;
        const right = roiWidth - 1;
        const bottom = roiHeight - 1;
        overlayMat.drawLine(new cv.Point2(left, top), new cv.Point2(right, top), new cv.Vec3(255, 0, 0), 2);
        overlayMat.drawLine(new cv.Point2(right, top), new cv.Point2(right, bottom), new cv.Vec3(255, 0, 0), 2);
        overlayMat.drawLine(new cv.Point2(right, bottom), new cv.Point2(left, bottom), new cv.Vec3(255, 0, 0), 2);
        overlayMat.drawLine(new cv.Point2(left, bottom), new cv.Point2(left, top), new cv.Vec3(255, 0, 0), 2);

        // Draw all centers (including handwriting row) as small red circles
        for (const rowCenters of grid.centers) {
          for (const center of rowCenters) {
            overlayMat.drawCircle(new cv.Point2(Math.round(center.x), Math.round(center.y)), Math.max(1, Math.round(center.radius)), new cv.Vec3(0, 0, 255), 1);
          }
        }

        // Highlight chosen bubble per column (green)
        for (const candidate of selectedCircles) {
          overlayMat.drawCircle(new cv.Point2(Math.round(candidate.x), Math.round(candidate.y)), Math.max(2, Math.round(candidate.radius)), new cv.Vec3(0, 255, 0), 2);
        }

        // Draw row index labels (0..9) at right edge for rows 1..10
        const font = cv.FONT_HERSHEY_SIMPLEX;
        const fontScale = 0.6;
        const thickness = 1;
        for (let r = 1; r <= 10; r += 1) {
          const label = String(r - 1);
          const center = grid.centers[0][r];
          const org = new cv.Point2(Math.max(6, roiWidth - 24), Math.round(center.y) + 6);
          overlayMat.putText(label, org, font, fontScale, new cv.Vec3(0, 255, 255), thickness);
        }
        await fs.promises.mkdir(path.dirname(options.exportOverlayPath), { recursive: true });
        cv.imwrite(options.exportOverlayPath, overlayMat);
      } else {
        // Fallback: create overlay using sharp (draws SVG overlay)
        await fs.promises.mkdir(path.dirname(options.exportOverlayPath), { recursive: true });
        // For fallback, just copy the roi color image - full overlay drawing without cv would be complex
        await fs.promises.writeFile(options.exportOverlayPath, roiBuffer);
      }
    } catch (err) {
      // ignore overlay export failures
    }
  }

  return {
    fullName: null,
    studentCode,
    confidence,
    warnings: [...new Set([...detection.warnings, ...warnings])],
  };
};
