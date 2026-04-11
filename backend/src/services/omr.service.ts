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
  warnings: string[];
}

const averageDarkness = (pixels: Buffer): number => {
  let total = 0;
  for (let i = 0; i < pixels.length; i++) {
    total += pixels[i];
  }
  return total / pixels.length;
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
        const rect = best.boundingRect();
        const areaRatio = (rect.width * rect.height) / Math.max(1, width * height);
        const ready = areaRatio > 0.5;

        return {
          ready,
          confidence: Number(Math.max(0, Math.min(1, areaRatio)).toFixed(3)),
          width,
          height,
          documentBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          warnings: ready ? [] : ['OpenCV detected document but frame coverage is low'],
        };
      }
    } catch {
      // Continue with fallback detector.
    }
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
