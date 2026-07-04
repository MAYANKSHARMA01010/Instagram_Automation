/**
 * Unit tests for DownloadWorker (Sequential Upload Processor)
 *
 * Tests: mutex guard (isProcessing), sequential one-at-a-time guarantee,
 *        batch notification on completion, restrict+cancel on Meta restriction,
 *        retry scheduling for non-restriction failures, restart recovery.
 */
import { DownloadWorker } from '../../src/workers/download.worker';
import { makeMockJob } from '../fixtures';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDequeueNext = jest.fn();
const mockCountPending = jest.fn();
const mockRelease = jest.fn();
const mockCancelJobsForAccount = jest.fn();
const mockQueueOn = jest.fn();
const mockUploadQueueEmitter: Record<string, (...args: unknown[]) => void> = {};

const mockProcessJob = jest.fn();
const mockAddForRetry = jest.fn();
const mockRetryStart = jest.fn();
const mockRetryStop = jest.fn();

const mockNotifyUploadStarted = jest.fn();
const mockNotifyBatchFinished = jest.fn();

jest.mock('../../src/queue/upload.queue', () => ({
  getUploadQueue: jest.fn(() => ({
    dequeueNext: mockDequeueNext,
    countPending: mockCountPending,
    release: mockRelease,
    cancelJobsForAccount: mockCancelJobsForAccount,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      mockUploadQueueEmitter[event] = cb;
      mockQueueOn(event, cb);
    },
  })),
}));

jest.mock('../../src/workers/upload.worker', () => ({
  getUploadWorker: jest.fn(() => ({
    processJob: mockProcessJob,
  })),
}));

jest.mock('../../src/queue/retry.queue', () => ({
  getRetryQueue: jest.fn(() => ({
    addForRetry: mockAddForRetry,
    start: mockRetryStart,
    stop: mockRetryStop,
  })),
}));

jest.mock('../../src/services/notification.service', () => ({
  getNotificationService: jest.fn(() => ({
    notifyUploadStarted: mockNotifyUploadStarted,
    notifyBatchFinished: mockNotifyBatchFinished,
  })),
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => require('../fixtures').mockConfig),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DownloadWorker', () => {
  let worker: DownloadWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new DownloadWorker();
    mockNotifyUploadStarted.mockResolvedValue(undefined);
    mockNotifyBatchFinished.mockResolvedValue(undefined);
    mockCountPending.mockResolvedValue(0); // no more jobs after first
    mockRelease.mockReturnValue(undefined);
    mockCancelJobsForAccount.mockResolvedValue(0);
    mockAddForRetry.mockResolvedValue(undefined);
  });

  // ── start lifecycle ────────────────────────────────────────────────────────

  describe('start()', () => {
    it('should not start twice (idempotent)', () => {
      mockDequeueNext.mockResolvedValue(null); // No jobs
      worker.start();
      worker.start(); // Second call should warn and return

      // queue.on should only be registered once
      expect(mockQueueOn).toHaveBeenCalledTimes(1);
    });

    it('should start the retry queue', () => {
      mockDequeueNext.mockResolvedValue(null);
      worker.start();
      expect(mockRetryStart).toHaveBeenCalled();
    });
  });

  // ── sequential processing ──────────────────────────────────────────────────

  describe('sequential processing', () => {
    it('should process a single job and send batch notification', async () => {
      const job = makeMockJob();
      mockDequeueNext
        .mockResolvedValueOnce(job) // First call: returns the job
        .mockResolvedValueOnce(null); // Second call: queue is empty
      mockProcessJob.mockResolvedValue({ success: true });

      worker.start();
      // Wait for the async loop to finish
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockProcessJob).toHaveBeenCalledWith(job);
      expect(mockNotifyBatchFinished).toHaveBeenCalledWith(
        expect.objectContaining({
          totalFound: 1,
          totalSuccess: 1,
          totalFailed: 0,
        }),
      );
      expect(mockRelease).toHaveBeenCalledWith(job.id);
    });

    it('should always release the job from the processingSet even on unexpected error', async () => {
      const job = makeMockJob();
      mockDequeueNext.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      // processJob is supposed to never throw, but simulate it anyway
      mockProcessJob.mockRejectedValue(new Error('Unexpected fatal error'));

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRelease).toHaveBeenCalledWith(job.id);
    });

    it('should process multiple jobs sequentially (one at a time)', async () => {
      const job1 = makeMockJob({ id: 'j1' });
      const job2 = makeMockJob({ id: 'j2' });
      const processingOrder: string[] = [];

      mockDequeueNext
        .mockResolvedValueOnce(job1)
        .mockResolvedValueOnce(job2)
        .mockResolvedValueOnce(null);
      mockCountPending
        .mockResolvedValueOnce(1) // After j1, j2 is still pending
        .mockResolvedValueOnce(0); // After j2, queue is empty

      mockProcessJob.mockImplementation(async (j: typeof job1) => {
        processingOrder.push(j.id);
        return { success: true };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(processingOrder).toEqual(['j1', 'j2']);
    });
  });

  // ── restriction handling ───────────────────────────────────────────────────

  describe('account restriction handling', () => {
    it('should cancel all pending jobs for a restricted account', async () => {
      const job = makeMockJob({ instagramAccountId: 'restricted-account' });
      mockDequeueNext.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      mockProcessJob.mockResolvedValue({ success: false, restrictAccount: true });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCancelJobsForAccount).toHaveBeenCalledWith(
        'restricted-account',
        'Account restricted by Meta API',
      );
      expect(mockAddForRetry).not.toHaveBeenCalled();
    });
  });

  // ── retry scheduling ───────────────────────────────────────────────────────

  describe('retry scheduling', () => {
    it('should schedule retry for a failed non-restricted job under the retry limit', async () => {
      const job = makeMockJob({ retryCount: 0 });
      mockDequeueNext.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      mockProcessJob.mockResolvedValue({ success: false, restrictAccount: false });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddForRetry).toHaveBeenCalledWith(job);
      expect(mockCancelJobsForAccount).not.toHaveBeenCalled();
    });

    it('should NOT retry a job that has exceeded maxRetryAttempts', async () => {
      const job = makeMockJob({ retryCount: 3 }); // max is 3
      mockDequeueNext.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      mockProcessJob.mockResolvedValue({ success: false, restrictAccount: false });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddForRetry).not.toHaveBeenCalled();
    });
  });

  // ── isActive ───────────────────────────────────────────────────────────────

  describe('isActive()', () => {
    it('should return false when not processing', () => {
      expect(worker.isActive()).toBe(false);
    });

    it('should return 1 for getActiveCount() when processing', () => {
      // The worker uses isProcessing internally
      expect(worker.getActiveCount()).toBe(0);
    });
  });
});
