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
  confidence: number;
  warnings: string[];
}

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
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
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
 * Match a partial student code (with '?' wildcards) against a list of enrolled students.
 * Returns the best matching student ID, or null if no unique match is found.
 */
export const fuzzyMatchStudentCode = (
  detectedCode: string,
  enrolledStudents: Array<{ id: number; username: string; fullName: string }>,
): { studentId: number | null; matchCount: number; candidates: Array<{ id: number; username: string; fullName: string }> } => {
  if (!detectedCode || detectedCode.replace(/\?/g, '').length === 0) {
    return { studentId: null, matchCount: 0, candidates: [] };
  }

  const candidates: Array<{ id: number; username: string; fullName: string; score: number }> = [];

  for (const student of enrolledStudents) {
    // Match against username (typically contains the MSSV)
    const username = student.username || '';
    let matchDigits = 0;
    let totalDigits = 0;

    for (let i = 0; i < detectedCode.length; i++) {
      if (detectedCode[i] === '?') continue;
      totalDigits++;
      if (i < username.length && detectedCode[i] === username[i]) {
        matchDigits++;
      }
    }

    if (totalDigits > 0 && matchDigits === totalDigits) {
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
