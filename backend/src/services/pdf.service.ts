import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

export const mergeImagesToPdfBuffer = async (imagePaths: string[]): Promise<Buffer> => {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('No image provided for PDF merge');
  }

  const pdf = await PDFDocument.create();

  for (const imagePath of imagePaths) {
    const pipeline = sharp(imagePath);
    const metadata = await pipeline.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);

    if (!width || !height) {
      throw new Error(`Cannot read image dimensions for PDF merge: ${imagePath}`);
    }

    const pngBuffer = await sharp(imagePath).png().toBuffer();
    const embeddedImage = await pdf.embedPng(pngBuffer);
    const page = pdf.addPage([width, height]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
};
