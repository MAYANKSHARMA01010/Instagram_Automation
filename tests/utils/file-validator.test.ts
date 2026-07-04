/**
 * Unit tests for file-validator.ts
 *
 * Tests: validateFile (valid MP4, invalid MIME, unsupported extension,
 *        too large, zero bytes, missing file),
 *        validateCaptionFile, validateCoverImage, isMp4File, sanitizeFileName.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  validateFile,
  validateCaptionFile,
  validateCoverImage,
  isMp4File,
  sanitizeFileName,
  formatBytes,
} from '../../src/utils/file-validator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

function createTempFile(name: string, content = 'test'): string {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

function removeTempFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateFile()', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = createTempFile('test-video.mp4', 'x'.repeat(1000));
  });

  afterEach(() => {
    removeTempFile(tmpFile);
  });

  it('should return valid=true for a correctly sized MP4 file', () => {
    const result = validateFile({ filePath: tmpFile, mimeType: 'video/mp4', fileSize: 1000 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid=true for a MOV file (video/quicktime)', () => {
    const movFile = createTempFile('test-video.mov', 'x'.repeat(100));
    const result = validateFile({ filePath: movFile, mimeType: 'video/quicktime', fileSize: 100 });
    removeTempFile(movFile);
    expect(result.valid).toBe(true);
  });

  it('should reject unsupported MIME types', () => {
    const result = validateFile({ filePath: tmpFile, mimeType: 'video/avi', fileSize: 1000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unsupported MIME type'))).toBe(true);
  });

  it('should reject unsupported file extensions', () => {
    const aviFile = createTempFile('test-video.avi', 'x'.repeat(100));
    const result = validateFile({ filePath: aviFile, mimeType: 'video/mp4', fileSize: 100 });
    removeTempFile(aviFile);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unsupported file extension'))).toBe(true);
  });

  it('should reject files exceeding the size limit', () => {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE_BYTES ?? '1073741824', 10);
    const result = validateFile({
      filePath: tmpFile,
      mimeType: 'video/mp4',
      fileSize: maxSize + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
  });

  it('should reject empty files (0 bytes)', () => {
    const result = validateFile({ filePath: tmpFile, mimeType: 'video/mp4', fileSize: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
  });

  it('should return error if file does not exist', () => {
    const result = validateFile({
      filePath: '/nonexistent/video.mp4',
      mimeType: 'video/mp4',
      fileSize: 1000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateFile({
      filePath: tmpFile,
      mimeType: 'video/avi', // bad MIME
      fileSize: 0, // zero bytes
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateCaptionFile()', () => {
  let tmpCaption: string;

  afterEach(() => {
    if (tmpCaption) removeTempFile(tmpCaption);
  });

  it('should return valid=true for a valid caption file', () => {
    tmpCaption = createTempFile('caption.txt', 'My great caption!');
    expect(validateCaptionFile(tmpCaption).valid).toBe(true);
  });

  it('should return error if caption file does not exist', () => {
    const result = validateCaptionFile('/nonexistent/caption.txt');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  it('should return error if caption file is empty', () => {
    tmpCaption = createTempFile('empty-caption.txt', '   ');
    const result = validateCaptionFile(tmpCaption);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('empty');
  });

  it('should return error if caption exceeds 2200 characters', () => {
    tmpCaption = createTempFile('long-caption.txt', 'x'.repeat(2201));
    const result = validateCaptionFile(tmpCaption);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('2200');
  });
});

describe('validateCoverImage()', () => {
  it('should return valid=true if no cover image path is given (optional)', () => {
    expect(validateCoverImage('').valid).toBe(true);
  });

  it('should return error if cover image does not exist', () => {
    const result = validateCoverImage('/nonexistent/cover.jpg');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  it('should reject non-JPEG cover images', () => {
    const pngFile = createTempFile('cover.png', 'x'.repeat(100));
    const result = validateCoverImage(pngFile);
    removeTempFile(pngFile);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('JPEG');
  });
});

describe('isMp4File()', () => {
  it.each([
    ['video.mp4', true],
    ['VIDEO.MP4', true],
    ['video.mov', false],
    ['video.avi', false],
    ['no-extension', false],
  ])('"%s" → %s', (name, expected) => {
    expect(isMp4File(name)).toBe(expected);
  });
});

describe('sanitizeFileName()', () => {
  it('should remove path traversal characters', () => {
    expect(sanitizeFileName('../../../etc/passwd')).not.toContain('..');
  });

  it('should replace special characters with underscores', () => {
    const result = sanitizeFileName('my video <script>.mp4');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('should preserve safe characters', () => {
    expect(sanitizeFileName('my-video_2024.mp4')).toBe('my-video_2024.mp4');
  });
});

describe('formatBytes()', () => {
  it.each([
    [0, '0 Bytes'],
    [1024, '1 KB'],
    [1048576, '1 MB'],
    [1073741824, '1 GB'],
  ])('%i bytes → "%s"', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
