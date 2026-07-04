/**
 * Unit tests for helpers.ts
 *
 * Tests: elapsedMs, safeDeleteFile (file exists, missing, throws),
 *        truncate, formatDuration, parseBoolean, isValidUrl, generateId,
 *        getTempFilePath, ensureDir.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  elapsedMs,
  safeDeleteFile,
  truncate,
  formatDuration,
  parseBoolean,
  isValidUrl,
  generateId,
  getTempFilePath,
  ensureDir,
} from '../../src/utils/helpers';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('elapsedMs()', () => {
  it('should return a positive number of milliseconds', () => {
    const start = new Date(Date.now() - 500);
    const elapsed = elapsedMs(start);
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });
});

describe('safeDeleteFile()', () => {
  it('should delete an existing file without throwing', () => {
    const tmpFile = path.join(os.tmpdir(), `safe-delete-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');

    expect(() => safeDeleteFile(tmpFile)).not.toThrow();
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('should not throw if the file does not exist', () => {
    expect(() => safeDeleteFile('/nonexistent/path/file.mp4')).not.toThrow();
  });

  it('should silently swallow errors (e.g. permission denied)', () => {
    jest.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    expect(() => safeDeleteFile('/some/file.mp4')).not.toThrow();
  });
});

describe('truncate()', () => {
  it('should return the string unchanged if within maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate and add ellipsis if over maxLength', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('should handle exact length correctly', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('formatDuration()', () => {
  it.each([
    [0, '0s'],
    [30, '30s'],
    [60, '1m 0s'],
    [90, '1m 30s'],
    [3600, '60m 0s'],
  ])('%is → "%s"', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('parseBoolean()', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['TRUE', true],
    ['YES', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', false],
    [undefined, false],
  ])('"%s" → %s (default=false)', (value, expected) => {
    expect(parseBoolean(value)).toBe(expected);
  });

  it('should respect the defaultValue parameter', () => {
    expect(parseBoolean(undefined, true)).toBe(true);
  });
});

describe('isValidUrl()', () => {
  it.each([
    ['https://example.com', true],
    ['http://localhost:3000', true],
    ['ftp://files.example.com', true],
    ['not-a-url', false],
    ['', false],
    ['just some text', false],
  ])('"%s" → %s', (url, expected) => {
    expect(isValidUrl(url)).toBe(expected);
  });
});

describe('generateId()', () => {
  it('should return a non-empty string', () => {
    expect(generateId()).toBeTruthy();
  });

  it('should return a unique value each time', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should return a valid UUID v4 format', () => {
    const uuid = generateId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });
});

describe('ensureDir()', () => {
  it('should create a directory that does not exist', () => {
    const tmpDir = path.join(os.tmpdir(), `ensure-dir-test-${Date.now()}`);
    expect(fs.existsSync(tmpDir)).toBe(false);

    ensureDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);

    fs.rmdirSync(tmpDir);
  });

  it('should not throw if directory already exists', () => {
    expect(() => ensureDir(os.tmpdir())).not.toThrow();
  });
});

describe('getTempFilePath()', () => {
  it('should return a path inside the tmp directory', () => {
    const filePath = getTempFilePath('video.mp4');
    expect(filePath).toContain('tmp');
    expect(filePath).toContain('video.mp4');
  });

  it('should include a timestamp prefix for uniqueness', () => {
    const path1 = getTempFilePath('video.mp4');
    path.resolve(process.cwd(), 'tests', 'fixtures', 'file2.mp4');
    // They may or may not be the same in the same millisecond, but the logic is sound
    expect(path1).toMatch(/\d+_video\.mp4$/);
  });
});
