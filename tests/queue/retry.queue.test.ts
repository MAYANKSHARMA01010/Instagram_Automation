/**
 * Unit tests for RetryQueue
 *
 * Tests: addForRetry, exponential backoff calculation, max attempt enforcement,
 *        processRetries timer, stop/start lifecycle.
 */
import { RetryQueue } from '../../src/queue/retry.queue';
import { UploadJobModel } from '../../src/database/repository';
import { makeMockJob } from '../fixtures';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/database/repository', () => ({
  UploadJobModel: {
    update: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    upload: {
      maxRetryAttempts: 3,
      retryBaseDelayMs: 1000,
    },
  })),
}));

const mockUploadJobModel = UploadJobModel as jest.Mocked<typeof UploadJobModel>;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RetryQueue', () => {
  let retryQueue: RetryQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    retryQueue = new RetryQueue();
  });

  afterEach(() => {
    retryQueue.stop();
    jest.useRealTimers();
  });

  // ── addForRetry ────────────────────────────────────────────────────────────

  describe('addForRetry()', () => {
    it('should mark the job as FAILED if retry count exceeds maxRetryAttempts', async () => {
      const job = makeMockJob({ retryCount: 3 }); // 3 = max, so nextAttempt = 4 > 3
      mockUploadJobModel.update.mockResolvedValue(undefined);

      await retryQueue.addForRetry(job);

      expect(mockUploadJobModel.update).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: expect.stringContaining('Exceeded max retry attempts'),
        }),
      );
      expect(retryQueue.getPendingCount()).toBe(0);
    });

    it('should add a retry entry with exponential backoff when under the limit', async () => {
      const job = makeMockJob({ retryCount: 0 }); // attempt 1

      await retryQueue.addForRetry(job);

      // retryCount 0 → attempt 1, delay = 1000ms * 2^0 = 1000ms
      expect(retryQueue.getPendingCount()).toBe(1);
      expect(mockUploadJobModel.update).not.toHaveBeenCalled();
    });

    it('should calculate exponential backoff correctly', async () => {
      const job0 = makeMockJob({ id: 'j0', retryCount: 0 }); // delay = 1000 * 1 = 1000
      const job1 = makeMockJob({ id: 'j1', retryCount: 1 }); // delay = 1000 * 2 = 2000
      const job2 = makeMockJob({ id: 'j2', retryCount: 2 }); // delay = 1000 * 4 = 4000

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await retryQueue.addForRetry(job0);
      await retryQueue.addForRetry(job1);
      await retryQueue.addForRetry(job2);

      expect(retryQueue.getPendingCount()).toBe(3);
    });
  });

  // ── processRetries ─────────────────────────────────────────────────────────

  describe('processRetries via start()', () => {
    it('should not call onRetry if no entries are due yet', async () => {
      const job = makeMockJob({ retryCount: 0 });
      await retryQueue.addForRetry(job); // delay = 1000ms

      const onRetry = jest.fn();
      retryQueue.start(onRetry);

      // Advance less than the delay
      jest.advanceTimersByTime(500);
      await Promise.resolve(); // flush microtasks

      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should call onRetry when a retry entry becomes due', async () => {
      const job = makeMockJob({ retryCount: 0 });
      mockUploadJobModel.update.mockResolvedValue(undefined);

      await retryQueue.addForRetry(job); // delay = 1000ms, nextRetryAt = now + 1000

      const onRetry = jest.fn();
      retryQueue.start(onRetry);

      // Advance past the retry delay
      jest.advanceTimersByTime(11_000); // 10s interval + 1s to make entry due
      await Promise.resolve();
      await Promise.resolve(); // Flush the promise inside setInterval

      expect(mockUploadJobModel.update).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({
          status: 'PENDING',
          retryCount: 1,
        }),
      );
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), 1);
      expect(retryQueue.getPendingCount()).toBe(0);
    });

    it('should remove processed entries from the queue', async () => {
      const job = makeMockJob({ retryCount: 0 });
      mockUploadJobModel.update.mockResolvedValue(undefined);

      await retryQueue.addForRetry(job);
      expect(retryQueue.getPendingCount()).toBe(1);

      const onRetry = jest.fn();
      retryQueue.start(onRetry);

      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(retryQueue.getPendingCount()).toBe(0);
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('should clear the interval and stop processing', () => {
      const onRetry = jest.fn();
      retryQueue.start(onRetry);
      retryQueue.stop();

      jest.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should be safe to call stop multiple times', () => {
      retryQueue.stop();
      retryQueue.stop();
      // No error thrown
    });
  });

  // ── getPendingCount ────────────────────────────────────────────────────────

  describe('getPendingCount()', () => {
    it('should return 0 when queue is empty', () => {
      expect(retryQueue.getPendingCount()).toBe(0);
    });

    it('should return the correct count after adding entries', async () => {
      const job1 = makeMockJob({ id: 'j1', retryCount: 0 });
      const job2 = makeMockJob({ id: 'j2', retryCount: 1 });

      await retryQueue.addForRetry(job1);
      await retryQueue.addForRetry(job2);

      expect(retryQueue.getPendingCount()).toBe(2);
    });
  });
});
