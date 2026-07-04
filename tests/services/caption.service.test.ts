/**
 * Unit tests for CaptionService
 *
 * Tests: initial load, caching, TTL expiration, invalidation,
 *        missing file, empty file, and length warning.
 */
import fs from 'fs';
import { CaptionService } from '../../src/services/caption.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    content: { captionFile: '/tmp/test-caption.txt' },
  })),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CaptionService', () => {
  let service: CaptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaptionService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getCaption()', () => {
    it('should read from the file on the first call', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('Hello, world! #test');

      const caption = service.getCaption();

      expect(caption).toBe('Hello, world! #test');
      expect(mockExistsSync).toHaveBeenCalledTimes(1);
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should cache the caption and not read from file on subsequent calls', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('Cached caption');

      service.getCaption(); // Initial read
      const caption = service.getCaption(); // Should use cache

      expect(caption).toBe('Cached caption');
      // Should still be 1 (wasn't called again)
      expect(mockExistsSync).toHaveBeenCalledTimes(1);
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should reload the caption if the cache TTL (60s) has expired', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync
        .mockReturnValueOnce('Initial caption')
        .mockReturnValueOnce('Updated caption');

      const caption1 = service.getCaption();
      expect(caption1).toBe('Initial caption');

      // Advance time by 61 seconds
      jest.advanceTimersByTime(61_000);

      const caption2 = service.getCaption();
      expect(caption2).toBe('Updated caption');
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });

    it('should throw an error if the caption file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => service.getCaption()).toThrow(/Caption file not found/);
    });

    it('should throw an error if the caption file is empty', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('   \n  '); // only whitespace

      expect(() => service.getCaption()).toThrow(/Caption file is empty/);
    });

    it('should warn if the caption length exceeds 2200 characters', () => {
      mockExistsSync.mockReturnValue(true);
      const longCaption = 'A'.repeat(2201);
      mockReadFileSync.mockReturnValue(longCaption);

      const { default: logger } = require('../../src/utils/logger') as { default: any };

      service.getCaption();

      expect(logger.warn).toHaveBeenCalledWith(
        'Caption exceeds Instagram 2200 character limit',
        expect.objectContaining({ length: 2201 }),
      );
    });
  });

  describe('invalidateCache()', () => {
    it('should force a reload on the next getCaption() call', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValueOnce('First load').mockReturnValueOnce('Second load');

      service.getCaption();
      service.invalidateCache();
      const caption2 = service.getCaption();

      expect(caption2).toBe('Second load');
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });
  });
});
