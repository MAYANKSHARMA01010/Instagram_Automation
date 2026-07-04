/**
 * Unit tests for retry utilities.
 *
 * Tests: withRetry, pollUntil
 */
import { withRetry, pollUntil } from '../../src/utils/retry';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('retry.util', () => {
  describe('withRetry()', () => {
    it('should return the result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');

      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors and succeed', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValue('ok');

      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('action_blocked'));

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          baseDelayMs: 1,
          shouldRetry: () => false,
        }),
      ).rejects.toThrow('action_blocked');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting all attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('network timeout'));

      await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(
        'network timeout',
      );

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback on each retry', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('ok');

      const onRetry = jest.fn();

      await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
    });

    it('should cap delay at maxDelayMs', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('ok');

      const start = Date.now();
      await withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2 });
      const elapsed = Date.now() - start;

      // Because maxDelayMs is 2, and jitter is up to 1000, it shouldn't wait more than ~1050ms
      expect(elapsed).toBeLessThan(1500);
    });

    it('should respect abort signal', async () => {
      const abortController = new AbortController();
      const mockFn = jest.fn().mockImplementation(async () => {
        abortController.abort();
        throw new Error('Some error');
      });

      await expect(
        withRetry(mockFn, {
          maxAttempts: 3,
          baseDelayMs: 10,
          label: 'abort-test',
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow('The operation was aborted');

      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('pollUntil()', () => {
    it('should resolve when condition returns true', async () => {
      let calls = 0;
      const condition = async () => ++calls === 3;

      const start = Date.now();
      await pollUntil(condition, 20, 200, 'test');
      const elapsed = Date.now() - start;

      expect(calls).toBe(3);
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('should throw a timeout error if condition never returns true', async () => {
      const condition = async () => false;

      await expect(pollUntil(condition, 10, 50, 'test condition')).rejects.toThrow(
        'Polling timeout after 50ms for: test condition',
      );
    });
  });
});
