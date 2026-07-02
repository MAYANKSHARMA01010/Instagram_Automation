import fs from 'fs';
import path from 'path';
import { ValidationResult, FileValidationOptions } from '../types/upload.types';
import logger from './logger';

const ALLOWED_MIME_TYPES = ['video/mp4', 'video/quicktime'];
const ALLOWED_EXTENSIONS = ['.mp4', '.mov'];

/**
 * Validates that a file meets Instagram Reels upload requirements.
 */
export function validateFile(options: FileValidationOptions): ValidationResult {
  const errors: string[] = [];
  const { filePath, mimeType, fileSize } = options;

  // 1. Check file exists
  if (!fs.existsSync(filePath)) {
    errors.push(`File does not exist: ${filePath}`);
    return { valid: false, errors };
  }

  // 2. Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
    errors.push(`Unsupported MIME type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  // 3. Check file extension
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    errors.push(`Unsupported file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  // 4. Check file size (from config via env)
  const maxFileSizeBytes = parseInt(process.env.MAX_FILE_SIZE_BYTES ?? '1073741824', 10);
  if (fileSize > maxFileSizeBytes) {
    errors.push(
      `File size ${formatBytes(fileSize)} exceeds maximum allowed size ${formatBytes(maxFileSizeBytes)}`,
    );
  }

  if (fileSize === 0) {
    errors.push('File is empty (0 bytes)');
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger.warn('File validation failed', { filePath, errors });
  }

  return { valid, errors };
}

/**
 * Validates that the caption file exists and is not empty.
 */
export function validateCaptionFile(captionFilePath: string): ValidationResult {
  const errors: string[] = [];

  if (!fs.existsSync(captionFilePath)) {
    errors.push(`Caption file not found: ${captionFilePath}`);
    return { valid: false, errors };
  }

  const content = fs.readFileSync(captionFilePath, 'utf-8').trim();
  if (!content) {
    errors.push('Caption file is empty');
  }

  if (content.length > 2200) {
    errors.push(`Caption exceeds Instagram's 2200 character limit (current: ${content.length})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that the cover image file exists and is a JPEG.
 */
export function validateCoverImage(coverImagePath: string): ValidationResult {
  const errors: string[] = [];

  if (!coverImagePath) {
    // Cover image is optional
    return { valid: true, errors };
  }

  if (!fs.existsSync(coverImagePath)) {
    errors.push(`Cover image not found: ${coverImagePath}`);
    return { valid: false, errors };
  }

  const ext = path.extname(coverImagePath).toLowerCase();
  const allowedImageExts = ['.jpg', '.jpeg'];
  if (!allowedImageExts.includes(ext)) {
    errors.push(`Cover image must be a JPEG file. Got: ${ext}`);
  }

  const stats = fs.statSync(coverImagePath);
  const maxImageSize = 8 * 1024 * 1024; // 8 MB
  if (stats.size > maxImageSize) {
    errors.push(`Cover image ${formatBytes(stats.size)} exceeds maximum 8MB`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks if a filename represents an MP4 video file.
 */
export function isMp4File(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.mp4';
}

/**
 * Formats bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Sanitizes a filename to prevent path traversal attacks.
 */
export function sanitizeFileName(name: string): string {
  return path
    .basename(name)
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .replace(/\.{2,}/g, '.');
}
