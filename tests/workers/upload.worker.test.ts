/**
 * Unit tests for UploadWorker
 *
 * Tests: successful upload pipeline, file validation failure, Meta API errors
 *        (including 'restrictAccount' mapping), cleanup (finally blocks).
 */
import { UploadWorker } from '../../src/workers/upload.worker';
import { makeMockJob } from '../fixtures';

// ─── Global Mocks (all inline to avoid TDZ issues) ─────────────────────────────

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/google-drive.service', () => {
  const mockService = {
    downloadFile: jest.fn(),
    findCaptionFile: jest.fn().mockResolvedValue(null),
    findCoverImage: jest.fn().mockResolvedValue(null),
    moveToUploaded: jest.fn().mockResolvedValue(undefined),
    listVideoFiles: jest.fn().mockResolvedValue([]),
  };
  return { getDriveService: jest.fn(() => mockService) };
});

jest.mock('../../src/services/instagram.service', () => {
  const mockService = {
    createReelContainer: jest.fn(),
    waitForContainerReady: jest.fn().mockResolvedValue(undefined),
    publishReel: jest.fn().mockResolvedValue({ id: 'media-xyz' }),
  };
  return { getInstagramService: jest.fn(() => mockService) };
});

jest.mock('../../src/services/caption.service', () => {
  const mockService = { getCaption: jest.fn().mockReturnValue('Test caption') };
  return { getCaptionService: jest.fn(() => mockService) };
});

jest.mock('../../src/utils/file-validator', () => ({
  validateFile: jest.fn((_f: string, _len: number) => ({ valid: true, errors: [] })),
}));

jest.mock('../../src/utils/helpers', () => ({
  safeDeleteFile: jest.fn(),
  elapsedMs: jest.fn(() => 2500),
  truncate: jest.fn((_str, _len) => _str),
}));

jest.mock('../../src/services/statistics.service', () => {
  return {
    getStatisticsService: jest.fn(() => ({
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      getDailySummary: jest.fn().mockReturnValue({ total: 1, success: 0, failed: 1, remaining: 0 }),
      categoriseError: jest.fn().mockReturnValue('Upload Failed'),
    })),
  };
});

jest.mock('../../src/services/health.service', () => {
  const mockService = { recordSuccess: jest.fn(), recordFailure: jest.fn() };
  return { getHealthService: jest.fn(() => mockService) };
});

jest.mock('../../src/queue/upload.queue', () => ({
  getUploadQueue: jest.fn(() => ({
    countPending: jest.fn().mockResolvedValue(0),
  })),
}));

jest.mock('../../src/services/notification.service', () => ({
  getNotificationService: jest.fn(() => ({
    notifySuccess: jest.fn().mockResolvedValue(undefined),
    notifyFailure: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/database/repository', () => ({
  ProcessedFileModel: { markProcessed: jest.fn().mockResolvedValue(undefined) },
  UploadLogModel: { create: jest.fn().mockResolvedValue(undefined) },
  UploadJobModel: {
    update: jest.fn().mockResolvedValue({}),
    updateStatus: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => require('../fixtures').mockConfig),
}));

// ─── Helpers to access the singletons ──────────────────────────────────────────

function getDriveService() {
  return require('../../src/services/google-drive.service').getDriveService();
}

function getInstagramService() {
  return require('../../src/services/instagram.service').getInstagramService();
}

function getValidator() {
  return require('../../src/utils/file-validator');
}

function getHelpers() {
  return require('../../src/utils/helpers');
}

function getRepository() {
  return require('../../src/database/repository');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UploadWorker', () => {
  let worker: UploadWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new UploadWorker();
  });

  function setupSuccessfulPipeline() {
    getValidator().validateFile.mockReturnValue({ valid: true, errors: [] });
    getDriveService().downloadFile.mockResolvedValue({
      filePath: '/tmp/test-video.mp4',
      fileSize: 50_000_000,
      mimeType: 'video/mp4',
    });
    getInstagramService().createReelContainer.mockResolvedValue({ id: 'container-abc' });
    getInstagramService().waitForContainerReady.mockResolvedValue(undefined);
    getInstagramService().publishReel.mockResolvedValue({ id: 'media-xyz' });
  }

  describe('processJob()', () => {
    describe('successful upload', () => {
      it('should return { success: true } and execute all pipeline steps', async () => {
        setupSuccessfulPipeline();
        const job = makeMockJob();

        const result = await worker.processJob(job);

        if (!result.success) {
          const loggerMock = require('../../src/utils/logger').default.error;
          throw new Error('Test failed. Logger calls: ' + JSON.stringify(loggerMock.mock.calls));
        }

        expect(result.success).toBe(true);
        expect(result.restrictAccount).toBeUndefined();

        const ig = getInstagramService();
        expect(getDriveService().downloadFile).toHaveBeenCalledWith(
          job.driveFileId,
          job.driveFileName,
        );
        expect(ig.createReelContainer).toHaveBeenCalledTimes(1);
        expect(ig.waitForContainerReady).toHaveBeenCalledWith('container-abc');
        expect(ig.publishReel).toHaveBeenCalledWith('ig-account-123', 'container-abc');
        expect(getDriveService().moveToUploaded).toHaveBeenCalledTimes(1);
      });

      it('should always clean up the temp file (finally block)', async () => {
        setupSuccessfulPipeline();
        await worker.processJob(makeMockJob());
        expect(getHelpers().safeDeleteFile).toHaveBeenCalledWith('/tmp/test-video.mp4');
      });
    });

    describe('file validation failure', () => {
      it('should return { success: false } and mark file as processed permanently', async () => {
        getDriveService().downloadFile.mockResolvedValue({
          filePath: '/tmp/bad.avi',
          fileSize: 100,
          mimeType: 'video/avi',
        });
        getValidator().validateFile.mockReturnValue({ valid: false, errors: ['Bad type'] });

        const result = await worker.processJob(makeMockJob());

        expect(result.success).toBe(false);
        expect(getRepository().ProcessedFileModel.markProcessed).toHaveBeenCalledWith(
          expect.objectContaining({ driveFileId: 'drive-file-001' }),
        );
      });

      it('should clean up temp file even on validation failure', async () => {
        getDriveService().downloadFile.mockResolvedValue({
          filePath: '/tmp/bad.avi',
          fileSize: 100,
          mimeType: 'video/avi',
        });
        getValidator().validateFile.mockReturnValue({ valid: false, errors: ['Bad type'] });

        await worker.processJob(makeMockJob());

        expect(getHelpers().safeDeleteFile).toHaveBeenCalledWith('/tmp/bad.avi');
      });
    });

    describe('container creation failure', () => {
      it('should propagate non-cover errors without retrying', async () => {
        setupSuccessfulPipeline();
        getInstagramService().createReelContainer.mockRejectedValue(
          new Error('500 Internal Server Error'),
        );

        const result = await worker.processJob(makeMockJob());

        expect(result.success).toBe(false);
        expect(getInstagramService().createReelContainer).toHaveBeenCalledTimes(1);
      });
    });

    describe('restrictAccount flag', () => {
      it('should set restrictAccount=true for "User access is restricted" error', async () => {
        setupSuccessfulPipeline();
        getInstagramService().createReelContainer.mockRejectedValue(
          new Error('Meta Error 400: User access is restricted'),
        );

        const result = await worker.processJob(makeMockJob());

        expect(result.success).toBe(false);
        expect(result.restrictAccount).toBe(true);
      });

      it('should NOT set restrictAccount for generic network errors', async () => {
        setupSuccessfulPipeline();
        getInstagramService().createReelContainer.mockRejectedValue(
          new Error('ETIMEDOUT: connect timeout'),
        );

        const result = await worker.processJob(makeMockJob());

        expect(result.success).toBe(false);
        expect(result.restrictAccount).toBeFalsy();
      });
    });
  });
});
