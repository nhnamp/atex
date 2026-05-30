import dotenv from 'dotenv';
dotenv.config();

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

export const config = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'nt208_default_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  omrServiceUrl: process.env.OMR_SERVICE_URL || 'http://localhost:5001',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  uploadLimits: {
    mobileScanFiles: parsePositiveInt(process.env.EXAM_MOBILE_SCAN_MAX_FILES, 20),
    submissionScanFiles: parsePositiveInt(process.env.EXAM_SUBMISSION_SCAN_MAX_FILES, 20),
    bulkScanFiles: parsePositiveInt(process.env.EXAM_BULK_SCAN_MAX_FILES, 100),
    missingPageFiles: parsePositiveInt(process.env.EXAM_MISSING_PAGE_MAX_FILES, 20),
  },
};
