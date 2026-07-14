/**
 * Unit tests for UploadQueue
 *
 * Tests: enqueue, dequeue, duplicate prevention, processingSet mutex,
 *        cancelJobsForAccount, dequeueNext ordering.
 */
import { UploadQueue } from '../../src/queue/upload.queue';
import { UploadJobModel, ProcessedFileModel, AccountHealthModel } from '../../src/database/repository';
import { makeMockJob } from '../fixtures';
import { getHealthService } from '../../src/services/health.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/database/repository', () => ({
  UploadJobModel: {
    findByStatus: jest.fn(),
    createSafe: jest.fn(),
    update: jest.fn(),
    hasJob: jest.fn(),
    getStats: jest.fn(),
    count: jest.fn(),
  },
  ProcessedFileModel: {
    isProcessed: jest.fn(),
  },
  AccountHealthModel: {
    getOrCreate: jest.fn().mockResolvedValue({ healthScore: 100 }),
  },
}));

jest.mock('../../src/services/health.service', () => ({
  getHealthService: jest.fn(() => ({
    checkCooldown: jest.fn().mockResolvedValue(false)
  }))
}));

jest.mock('../../src/config/database', () => ({
  getDatabase: jest.fn(() => ({
    uploadJob: {
      count: jest.fn().mockResolvedValue(0),
    },
  })),
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => require('../fixtures').mockConfig),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUploadJobModel = UploadJobModel as jest.Mocked<typeof UploadJobModel>;
const mockProcessedFileModel = ProcessedFileModel as jest.Mocked<typeof ProcessedFileModel>;

function makeDriveFile(id = 'drive-file-001', name = 'test-video.mp4') {
  return {
    id,
    name,
    mimeType: 'video/mp4',
    size: '100000',
    modifiedTime: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UploadQueue', () => {
  let queue: UploadQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new UploadQueue();
  });

  // ── enqueue ────────────────────────────────────────────────────────────────

  describe('enqueue()', () => {
    it('should return null and skip if file is already processed', async () => {
      mockProcessedFileModel.isProcessed.mockResolvedValue(true);

      const result = await queue.enqueue(makeDriveFile(), 'ig-account-123', 'uploaded-folder');
      expect(result).toBeNull();
      expect(mockUploadJobModel.createSafe).not.toHaveBeenCalled();
    });

    it('should return null if a job already exists for the file', async () => {
      mockProcessedFileModel.isProcessed.mockResolvedValue(false);
      mockUploadJobModel.hasJob.mockResolvedValue(true);

      const result = await queue.enqueue(makeDriveFile(), 'ig-account-123', 'uploaded-folder');
      expect(result).toBeNull();
      expect(mockUploadJobModel.createSafe).not.toHaveBeenCalled();
    });

    it('should return null if createSafe returns null (race condition)', async () => {
      mockProcessedFileModel.isProcessed.mockResolvedValue(false);
      mockUploadJobModel.hasJob.mockResolvedValue(false);
      mockUploadJobModel.createSafe.mockResolvedValue(null);

      const result = await queue.enqueue(makeDriveFile(), 'ig-account-123', 'uploaded-folder');
      expect(result).toBeNull();
    });

    it('should return the created job and emit job:added on success', async () => {
      const mockJob = makeMockJob();
      mockProcessedFileModel.isProcessed.mockResolvedValue(false);
      mockUploadJobModel.hasJob.mockResolvedValue(false);
      mockUploadJobModel.createSafe.mockResolvedValue(mockJob);

      const emitSpy = jest.spyOn(queue, 'emit');
      const result = await queue.enqueue(makeDriveFile(), 'ig-account-123', 'uploaded-folder');

      expect(result).toEqual(mockJob);
      expect(emitSpy).toHaveBeenCalledWith('job:added', mockJob);
    });
  });

  // ── enqueueById ────────────────────────────────────────────────────────────

  describe('enqueueById()', () => {
    it('should throw if job already exists', async () => {
      mockUploadJobModel.createSafe.mockResolvedValue(null);

      await expect(
        queue.enqueueById('drive-001', 'video.mp4', 'ig-account-123', 'uploaded-folder'),
      ).rejects.toThrow('already in the queue or processed');
    });

    it('should return the job and emit job:added on success', async () => {
      const mockJob = makeMockJob();
      mockUploadJobModel.createSafe.mockResolvedValue(mockJob);

      const emitSpy = jest.spyOn(queue, 'emit');
      const result = await queue.enqueueById('drive-001', 'video.mp4', 'ig-account-123', 'folder');

      expect(result).toEqual(mockJob);
      expect(emitSpy).toHaveBeenCalledWith('job:added', mockJob);
    });
  });

  // ── dequeueNext ────────────────────────────────────────────────────────────

  describe('dequeueNext()', () => {
    it('should return null if no PENDING jobs exist', async () => {
      mockUploadJobModel.findByStatus.mockResolvedValue([]);

      const result = await queue.dequeueNext();
      expect(result).toBeNull();
    });

    it('should return the first available job and lock it in processingSet', async () => {
      const job1 = makeMockJob({ id: 'job-1', instagramAccountId: 'account-1' });
      const job2 = makeMockJob({ id: 'job-2', instagramAccountId: 'account-2' });
      mockUploadJobModel.findByStatus.mockResolvedValue([job1, job2]);

      const result = await queue.dequeueNext();
      expect(result).not.toBeNull();

      // A second dequeue should not return the same job (it's now locked)
      mockUploadJobModel.findByStatus.mockResolvedValue([job1, job2]);
      const result2 = await queue.dequeueNext();
      expect(result2?.id).not.toBe(result?.id);
    });

    it('should return null if all pending jobs are already in processingSet', async () => {
      const job = makeMockJob();
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);

      // Lock it
      await queue.dequeueNext();

      // Second call: job is still PENDING in DB but locked in memory
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);
      const result = await queue.dequeueNext();
      expect(result).toBeNull();
    });

    it('should sort jobs by account then by creation time (FIFO per account)', async () => {
      const job1 = makeMockJob({
        id: 'job-1',
        instagramAccountId: 'account-b',
        createdAt: new Date('2024-01-01T01:00:00Z'),
      });
      const job2 = makeMockJob({
        id: 'job-2',
        instagramAccountId: 'account-a',
        createdAt: new Date('2024-01-01T02:00:00Z'),
      });
      const job3 = makeMockJob({
        id: 'job-3',
        instagramAccountId: 'account-a',
        createdAt: new Date('2024-01-01T01:00:00Z'),
      });

      mockUploadJobModel.findByStatus.mockResolvedValue([job1, job2, job3]);

      const result = await queue.dequeueNext();
      // account-a sorts before account-b; job-3 is oldest for account-a
      expect(result?.id).toBe('job-3');
    });
  });

  // ── release ────────────────────────────────────────────────────────────────

  describe('release()', () => {
    it('should remove a job from the processingSet so it can be dequeued again', async () => {
      const job = makeMockJob();
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);

      // Lock it
      await queue.dequeueNext();

      // Release it
      queue.release(job.id);

      // Should now be available again
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);
      const result = await queue.dequeueNext();
      expect(result?.id).toBe(job.id);
    });
  });

  // ── cancelJobsForAccount ───────────────────────────────────────────────────

  describe('cancelJobsForAccount()', () => {
    it('should cancel all pending jobs for the account', async () => {
      const job1 = makeMockJob({ id: 'job-1', instagramAccountId: 'account-to-cancel' });
      const job2 = makeMockJob({ id: 'job-2', instagramAccountId: 'account-to-cancel' });
      const job3 = makeMockJob({ id: 'job-3', instagramAccountId: 'other-account' });
      mockUploadJobModel.findByStatus.mockResolvedValue([job1, job2, job3]);
      mockUploadJobModel.update.mockResolvedValue(undefined);

      const canceledCount = await queue.cancelJobsForAccount('account-to-cancel', 'test reason');

      expect(canceledCount).toBe(2);
      expect(mockUploadJobModel.update).toHaveBeenCalledTimes(2);
      expect(mockUploadJobModel.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          status: 'FAILED',
        }),
      );
    });

    it('should not cancel jobs that are already being processed (in processingSet)', async () => {
      const job = makeMockJob({ id: 'locked-job', instagramAccountId: 'account-to-cancel' });
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);

      // Lock it first
      await queue.dequeueNext();

      // Now try to cancel — should skip locked jobs
      mockUploadJobModel.findByStatus.mockResolvedValue([job]);
      const canceledCount = await queue.cancelJobsForAccount('account-to-cancel', 'restricted');
      expect(canceledCount).toBe(0);
    });
  });
});
