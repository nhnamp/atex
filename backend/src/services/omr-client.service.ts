/**
 * Python OMR Service Client
 *
 * Communicates with the Python OMR microservice via HTTP to process
 * exam scan images for student identity recognition and MCQ reading.
 */

import { config } from '../config';
import fs from 'fs';
import path from 'path';

export interface OmrProcessResult {
  studentCode: string | null;
  answers: Record<string, string>;
  mcqLayout?: {
    referenceWidth: number;
    referenceHeight: number;
    source?: string;
    table?: { left: number; top: number; right: number; bottom: number };
    questions: Array<{
      questionNumber: number;
      bubbles: Array<{ option: string; cx: number; cy: number; r: number }>;
    }>;
  } | null;
  identityLayout?: {
    referenceWidth: number;
    referenceHeight: number;
    source?: string;
    digits: Array<{ column: number; digit: number; cx: number; cy: number; r: number }>;
  } | null;
  confidence: number;
  /** How many of the 4 corner anchors locked onto their canonical position (0-4). */
  aligned?: number;
  warnings: string[];
}

/**
 * Derive the 6-digit sheet code (first 2 + last 4 digits of the MSSV) used by
 * the OMR answer sheet. The 3rd/4th digits of the full code are dropped on the
 * sheet, so e.g. "22521003" -> "221003". Non-digit characters are ignored.
 * Codes of 6 digits or fewer (already in sheet form) are returned unchanged.
 */
export const deriveMssvSixDigits = (value: unknown): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length <= 6) return digits;
  return digits.slice(0, 2) + digits.slice(-4);
};

/**
 * Call the Python OMR service to process a front page scan image.
 * Extracts both student identity (MSSV) and MCQ answers.
 */
export const processOmrImage = async (
  imagePath: string,
  totalQuestions: number = 52
): Promise<OmrProcessResult> => {
  const baseUrl = config.omrServiceUrl;

  if (!fs.existsSync(imagePath)) {
    throw new Error(`OMR: Image file not found: ${imagePath}`);
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  // Build multipart form data manually using the Fetch API
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'image/png' });
  formData.append('image', blob, filename);
  formData.append('total_questions', String(totalQuestions));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s timeout

  try {
    const response = await fetch(`${baseUrl}/api/omr/process`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OMR service responded with ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      studentCode?: string | null;
      answers?: Record<string, string>;
      mcqLayout?: OmrProcessResult['mcqLayout'];
      identityLayout?: OmrProcessResult['identityLayout'];
      confidence?: number;
      warnings?: string[];
      error?: string;
    };

    if (result.error) {
      throw new Error(`OMR processing error: ${result.error}`);
    }

    return {
      studentCode: result.studentCode ?? null,
      answers: result.answers ?? {},
      mcqLayout: result.mcqLayout ?? null,
      identityLayout: result.identityLayout ?? null,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      aligned: typeof (result as { aligned?: number }).aligned === 'number'
        ? (result as { aligned?: number }).aligned
        : undefined,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('OMR service request timed out (30s)');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Check if the Python OMR service is available.
 */
export const checkOmrServiceHealth = async (): Promise<boolean> => {
  const baseUrl = config.omrServiceUrl;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(`${baseUrl}/api/omr/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Match a detected MSSV (with '?' wildcards) against a list of enrolled students.
 * The OMR sheet encodes only 6 digits (first 2 + last 4 of the full MSSV), so
 * each student's username is reduced the same way before comparing positionally.
 * Returns the best matching student ID, or null if no unique match is found.
 */
export const fuzzyMatchStudentCode = (
  detectedCode: string,
  enrolledStudents: Array<{ id: number; username: string; fullName: string }>,
): { studentId: number | null; matchCount: number; candidates: Array<{ id: number; username: string; fullName: string }> } => {
  const detected = String(detectedCode || '').trim();
  if (!detected || detected.replace(/\?/g, '').length === 0) {
    return { studentId: null, matchCount: 0, candidates: [] };
  }

  const candidates: Array<{ id: number; username: string; fullName: string; score: number }> = [];

  for (const student of enrolledStudents) {
    // Reduce the enrolled MSSV to the same 6-digit sheet code before comparing.
    const expected = deriveMssvSixDigits(student.username);
    if (!expected || expected.length !== detected.length) continue;

    let matchDigits = 0;
    let totalDigits = 0;
    let allMatch = true;
    for (let i = 0; i < detected.length; i++) {
      if (detected[i] === '?') continue;
      totalDigits++;
      if (detected[i] === expected[i]) {
        matchDigits++;
      } else {
        allMatch = false;
        break;
      }
    }

    if (allMatch && totalDigits > 0) {
      candidates.push({ ...student, score: matchDigits });
    }
  }

  if (candidates.length === 1) {
    return { studentId: candidates[0].id, matchCount: 1, candidates };
  }

  if (candidates.length > 1) {
    // Multiple matches — sort by score and return as ambiguous
    candidates.sort((a, b) => b.score - a.score);
    return { studentId: null, matchCount: candidates.length, candidates };
  }

  return { studentId: null, matchCount: 0, candidates: [] };
};
