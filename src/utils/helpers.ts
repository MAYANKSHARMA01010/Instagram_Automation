import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

/**
 * Generates a new UUID v4.
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * Formats a Date object to an ISO string.
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Calculates the elapsed time in milliseconds from a start time.
 */
export function elapsedMs(startTime: Date): number {
  return Date.now() - startTime.getTime();
}

/**
 * Creates a directory recursively if it does not exist.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Returns a safe temporary file path for a downloaded video.
 */
export function getTempFilePath(fileName: string): string {
  const tmpDir = path.join(process.cwd(), 'tmp');
  ensureDir(tmpDir);
  return path.join(tmpDir, `${Date.now()}_${fileName}`);
}

/**
 * Deletes a file safely, ignoring errors if it doesn't exist.
 */
export function safeDeleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Silently ignore cleanup errors
  }
}

/**
 * Truncates a string to the specified maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Converts seconds to a human-readable duration string (e.g. "2m 30s").
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Parses a string value to a boolean.
 */
export function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

/**
 * Returns the current UTC timestamp as a formatted string.
 */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Checks if a string is a valid URL.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
