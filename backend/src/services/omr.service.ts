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

const IDENTITY_GRID = {
  x: 1748,
  y: 300,
  width: 545,
  height: 430,
  columns: 8,
  rows: 10,
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
  options?: { exportWarpPath?: string }
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

  // If corners are available and OpenCV is present, warp to canonical reference size for percent-based ROI
  let workingImage: sharp.Sharp;
  let inputImageWidth = detection.width || REFERENCE_WIDTH;
  let inputImageHeight = detection.height || REFERENCE_HEIGHT;

  if (cv && detection.corners && detection.corners.length === 4) {
    try {
      const mat = cv.imread(imagePath);
      const src = detection.corners.map((c) => new cv.Point2(Math.max(0, Math.round(c.x)), Math.max(0, Math.round(c.y))));
      const dst = [new cv.Point2(0, 0), new cv.Point2(REFERENCE_WIDTH - 1, 0), new cv.Point2(REFERENCE_WIDTH - 1, REFERENCE_HEIGHT - 1), new cv.Point2(0, REFERENCE_HEIGHT - 1)];
      const M = cv.getPerspectiveTransform(src, dst);
      const warped = mat.warpPerspective(M, new cv.Size(REFERENCE_WIDTH, REFERENCE_HEIGHT));
      const png = cv.imencode('.png', warped);
      const warpedBuffer = Buffer.from(png);
      // Export warped image if requested (test/debugging)
      if (options && options.exportWarpPath) {
        // write the warpedBuffer directly to disk
        // eslint-disable-next-line node/no-unsupported-features/es-builtins
        const fs = await import('fs');
        try {
          await fs.promises.mkdir(require('path').dirname(options.exportWarpPath), { recursive: true });
          await fs.promises.writeFile(options.exportWarpPath, warpedBuffer);
        } catch (e) {
          // ignore write errors for export
        }
      }
      workingImage = sharp(warpedBuffer).greyscale();
      inputImageWidth = REFERENCE_WIDTH;
      inputImageHeight = REFERENCE_HEIGHT;
    } catch (err) {
      // if warp fails, fall back to using documentBox region via sharp
      warnings.push('Perspective rectification via OpenCV failed, falling back to document-box crop');
      workingImage = sharp(imagePath).greyscale();
    }
  } else {
    // No corners or no OpenCV: work on the original image but use documentBox for relative ROI
    workingImage = sharp(imagePath).greyscale();
    inputImageWidth = detection.width || inputImageWidth;
    inputImageHeight = detection.height || inputImageHeight;
  }

  // Compute grid coordinates relative to the working image.
  // If we warped to reference size, IDENTITY_GRID is absolute; otherwise map from detection.documentBox
  let gridX: number;
  let gridY: number;
  let gridWidth: number;
  let gridHeight: number;
  if (inputImageWidth === REFERENCE_WIDTH && inputImageHeight === REFERENCE_HEIGHT) {
    gridX = IDENTITY_GRID.x;
    gridY = IDENTITY_GRID.y;
    gridWidth = IDENTITY_GRID.width;
    gridHeight = IDENTITY_GRID.height;
  } else {
    const scaleX = detection.documentBox.width / REFERENCE_WIDTH;
    const scaleY = detection.documentBox.height / REFERENCE_HEIGHT;
    // Try to auto-locate the identity grid within the detected document box if available
    const located = await (async () => {
      try {
        const docLeft = Math.max(0, Math.floor(detection.documentBox.x));
        const docTop = Math.max(0, Math.floor(detection.documentBox.y));
        const docW = Math.max(1, Math.floor(detection.documentBox.width));
        const docH = Math.max(1, Math.floor(detection.documentBox.height));
        const probeW = Math.min(1200, Math.max(200, docW));
        const probeH = Math.max(200, Math.round((docH / docW) * probeW));

        const cropped = await sharp(imagePath)
          .extract({ left: docLeft, top: docTop, width: docW, height: docH })
          .resize(probeW, probeH, { fit: 'fill' })
          .greyscale()
          .raw()
          .toBuffer();

        // compute vertical projection (dark pixels per column)
        const colSums: number[] = new Array(probeW).fill(0);
        const thresh = 200;
        for (let y = 0; y < probeH; y += 1) {
          for (let x = 0; x < probeW; x += 1) {
            const v = cropped[y * probeW + x] || 255;
            if (v < thresh) colSums[x] += 1;
          }
        }

        const expectedGridW = Math.max(20, Math.round((IDENTITY_GRID.width / REFERENCE_WIDTH) * probeW));
        // sliding window to find area with maximum dark activity (candidate grid X)
        let bestX = 0;
        let bestSum = -1;
        let windowSum = 0;
        for (let x = 0; x < probeW; x += 1) {
          windowSum += colSums[x] || 0;
          if (x >= expectedGridW) windowSum -= colSums[x - expectedGridW] || 0;
          if (x >= expectedGridW - 1) {
            const left = x - (expectedGridW - 1);
            if (windowSum > bestSum) {
              bestSum = windowSum;
              bestX = left;
            }
          }
        }

        // horizontal projection to find vertical placement
        const rowSums: number[] = new Array(probeH).fill(0);
        for (let y = 0; y < probeH; y += 1) {
          let s = 0;
          for (let x = bestX; x < Math.min(probeW, bestX + expectedGridW); x += 1) {
            const v = cropped[y * probeW + x] || 255;
            if (v < thresh) s += 1;
          }
          rowSums[y] = s;
        }

        const expectedGridH = Math.max(60, Math.round((IDENTITY_GRID.height / REFERENCE_HEIGHT) * probeH));
        let bestY = 0;
        let bestRowSum = -1;
        let rowWindow = 0;
        for (let y = 0; y < probeH; y += 1) {
          rowWindow += rowSums[y] || 0;
          if (y >= expectedGridH) rowWindow -= rowSums[y - expectedGridH] || 0;
          if (y >= expectedGridH - 1) {
            const top = y - (expectedGridH - 1);
            if (rowWindow > bestRowSum) {
              bestRowSum = rowWindow;
              bestY = top;
            }
          }
        }

        const scaleBackX = docW / probeW;
        const scaleBackY = docH / probeH;
        const mappedX = docLeft + Math.max(0, Math.round(bestX * scaleBackX));
        const mappedY = docTop + Math.max(0, Math.round(bestY * scaleBackY));
        const mappedW = Math.max(1, Math.round(expectedGridW * scaleBackX));
        const mappedH = Math.max(1, Math.round(expectedGridH * scaleBackY));

        return { x: mappedX, y: mappedY, width: mappedW, height: mappedH };
      } catch (err) {
        return null;
      }
    })();

    if (located) {
      gridX = located.x;
      gridY = located.y;
      gridWidth = located.width;
      gridHeight = located.height;
    } else {
      gridX = (detection.documentBox.x || 0) + IDENTITY_GRID.x * scaleX;
      gridY = (detection.documentBox.y || 0) + IDENTITY_GRID.y * scaleY;
      gridWidth = Math.max(1, IDENTITY_GRID.width * scaleX);
      gridHeight = Math.max(1, IDENTITY_GRID.height * scaleY);
    }
  }

  const cellWidth = gridWidth / IDENTITY_GRID.columns;
  const cellHeight = gridHeight / IDENTITY_GRID.rows;
  const bubbleSize = Math.max(8, Math.min(cellWidth, cellHeight) * 0.75);

  const digits: string[] = [];
  let detectedColumns = 0;
  let totalConfidence = 0;

  for (let column = 0; column < IDENTITY_GRID.columns; column += 1) {
    // For each column, score an annulus around the bubble core so the printed numeral in empty circles does not dominate.
    const fillRatios: { row: number; ratio: number }[] = [];
    for (let row = 0; row < IDENTITY_GRID.rows; row += 1) {
      const left = Math.max(0, Math.floor(gridX + column * cellWidth));
      const top = Math.max(0, Math.floor(gridY + row * cellHeight));
      const w = Math.max(1, Math.floor(cellWidth));
      const h = Math.max(1, Math.floor(cellHeight));
      const probeWidth = Math.max(1, Math.floor(w * 0.72));
      const probeHeight = Math.max(1, Math.floor(h * 0.72));
      const probeLeft = Math.max(0, left + Math.floor((w - probeWidth) / 2));
      const probeTop = Math.max(0, top + Math.floor((h - probeHeight) / 2));

      try {
        let ratio = 0;
        if (cv) {
          const patch = await workingImage
            .clone()
            .extract({ left: probeLeft, top: probeTop, width: probeWidth, height: probeHeight })
            .png()
            .toBuffer();

          const patchMat = cv.imdecode(patch);
          const patchGray = patchMat.channels > 1 ? patchMat.bgrToGray() : patchMat;
          const binary = patchGray.threshold(0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
          const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
          const eroded = binary.erode(kernel).erode(kernel).erode(kernel);
          const contours = eroded.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          let bestArea = 0;
          for (const contour of contours) {
            if (contour.area > bestArea) {
              bestArea = contour.area;
            }
          }
          ratio = bestArea / Math.max(1, probeWidth * probeHeight);
        } else {
          const patch = await workingImage
            .clone()
            .extract({ left: probeLeft, top: probeTop, width: probeWidth, height: probeHeight })
            .raw()
            .toBuffer();

          const threshold = 180;
          const centerX = (probeWidth - 1) / 2;
          const centerY = (probeHeight - 1) / 2;
          const outerRadius = Math.min(probeWidth, probeHeight) * 0.42;
          const innerRadius = Math.min(probeWidth, probeHeight) * 0.18;
          let darkCount = 0;
          let maskCount = 0;

          for (let py = 0; py < probeHeight; py += 1) {
            for (let px = 0; px < probeWidth; px += 1) {
              const dx = px - centerX;
              const dy = py - centerY;
              const dist2 = dx * dx + dy * dy;
              if (dist2 > outerRadius * outerRadius || dist2 < innerRadius * innerRadius) continue;
              maskCount += 1;
              const value = patch[py * probeWidth + px] || 255;
              if (value < threshold) darkCount += 1;
            }
          }

          ratio = darkCount / Math.max(1, maskCount);
        }
        fillRatios.push({ row, ratio });
      } catch (err) {
        fillRatios.push({ row, ratio: 0 });
      }
    }

    fillRatios.sort((a, b) => b.ratio - a.ratio);
    const best = fillRatios[0];
    const second = fillRatios[1] || { ratio: 0, row: -1 };
    const ratioGap = best.ratio - second.ratio;

    if (process.env.OMR_DEBUG === '1') {
      // eslint-disable-next-line no-console
      console.log(
        '[OMR_DEBUG]',
        'column',
        column + 1,
        fillRatios.slice(0, 3).map((item) => ({ row: item.row, ratio: Number(item.ratio.toFixed(3)) }))
      );
    }

    // Accept only when fill ratio sufficiently high and clearly separated
    if (best.ratio < 0.08 || ratioGap < 0.03) {
      warnings.push(`Unable to confidently read MSSV digit at column ${column + 1}`);
      digits.push('?');
      continue;
    }

    digits.push(String(best.row));
    detectedColumns += 1;
    totalConfidence += Math.max(0, Math.min(1, best.ratio));
  }

  const studentCode = digits.every((digit) => digit === '?') ? null : digits.join('');
  if (!studentCode) {
    warnings.push('OMR student code could not be resolved from the MSSV grid');
  }

  const confidence = detectedColumns > 0 ? Number((totalConfidence / detectedColumns).toFixed(3)) : 0;

  return {
    fullName: null,
    studentCode,
    confidence,
    warnings: [...new Set([...detection.warnings, ...warnings])],
  };
};
