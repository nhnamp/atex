import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { config } from '../config';

let initialized = false;

const ensureCloudinaryConfigured = () => {
  if (initialized) return;

  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
  }

  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true,
  });

  initialized = true;
};

const uploadBuffer = async (buffer: Buffer, options: UploadApiOptions): Promise<string> => {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result?.secure_url) {
        reject(error || new Error('Cloudinary upload failed'));
        return;
      }
      resolve(result.secure_url);
    });

    stream.end(buffer);
  });
};

export const uploadImageToCloudinary = async (buffer: Buffer, fileName: string): Promise<string> => {
  const publicId = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return uploadBuffer(buffer, {
    folder: 'nt208/scans',
    resource_type: 'image',
    public_id: `${Date.now()}_${publicId}`,
    overwrite: true,
  });
};

export const uploadPdfToCloudinary = async (buffer: Buffer, fileName: string): Promise<string> => {
  const publicId = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return uploadBuffer(buffer, {
    folder: 'nt208/merged-pdfs',
    resource_type: 'raw',
    public_id: `${Date.now()}_${publicId}`,
    format: 'pdf',
    overwrite: true,
  });
};
