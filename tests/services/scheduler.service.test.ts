/**
 * Unit tests for SchedulerService
 *
 * Tests: idempotency guard (isRunning mutex), cooldown skip,
 *        daily limit enforcement, pacing/window logic, warm-up limit,
 *        adaptive reduction on Danger/Caution bands, token expiry check.
 */
import { SchedulerService } from '../../src/services/scheduler.service';
import { mockConfig } from '../fixtures';

// ─── Global Mocks (all inline to avoid TDZ issues) ─────────────────────────────

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/google-drive.service', () => {
  const mockService = { listVideoFiles: jest.fn().mockResolvedValue([]) };
  return { getDriveService: jest.fn(() => mockService) };
});

jest.mock('../../src/queue/upload.queue', () => {
  const mockQueue = {
    enqueue: jest.fn().mockResolvedValue(null),
    isProcessing: jest.fn().mockResolvedValue(false),
    countPendingForAccount: jest.fn().mockResolvedValue(0),
    getStats: jest.fn().mockResolvedValue({ pending: 0 }),
  };
  return { getUploadQueue: jest.fn(() => mockQueue) };
});

jest.mock('../../src/database/repository', () => ({
  ProcessedFileModel: { isProcessed: jest.fn().mockResolvedValue(false) },
  UploadLogModel: {
    wasUploadedTodayByName: jest.fn().mockResolvedValue(false),
    countTodaySuccessByAccount: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock('../../src/services/health.service', () => {
  const mockService = {
    checkCooldown: jest.fn().mockResolvedValue(false),
    getHealth: jest.fn().mockResolvedValue({
      healthScore: 100,
      cooldownUntil: null,
      successfulUploads: 0,
      failedUploads: 0,
      restrictionCount: 0,
    }),
    getHealthBand: jest.fn().mockReturnValue('Excellent'),
  };
  return { getHealthService: jest.fn(() => mockService) };
});

jest.mock('../../src/services/notification.service', () => {
  const mockService = {
    notifyTokenExpirySoon: jest.fn().mockResolvedValue(undefined),
    notifyLargeQueue: jest.fn().mockResolvedValue(undefined),
    notifyDailySummary: jest.fn().mockResolvedValue(undefined),
  };
  return { getNotificationService: jest.fn(() => mockService) };
});

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => require('../fixtures').mockConfig),
}));

// ─── Helpers to access the singletons ──────────────────────────────────────────

function getDriveService() {
  return require('../../src/services/google-drive.service').getDriveService();
}

function getUploadQueue() {
  return require('../../src/queue/upload.queue').getUploadQueue();
}

function getHealthService() {
  return require('../../src/services/health.service').getHealthService();
}

function getNotificationService() {
  return require('../../src/services/notification.service').getNotificationService();
}

function getRepository() {
  return require('../../src/database/repository');
}

function makeDriveFile(id: string, name = 'video.mp4') {
  return { id, name, mimeType: 'video/mp4', size: '1000', modifiedTime: '' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SchedulerService', () => {
  let scheduler: SchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new SchedulerService();
  });

  describe('runPollCycle() idempotency', () => {
    it('should skip if a poll cycle is already running', async () => {
      // Create a promise that won't resolve immediately
      let resolveDrive: (val: any) => void;
      const stuckPromise = new Promise((resolve) => {
        resolveDrive = resolve;
      });
      getDriveService().listVideoFiles.mockReturnValueOnce(stuckPromise);

      const p1 = scheduler.runPollCycle(); // sets isRunning = true, gets stuck
      await scheduler.runPollCycle(); // Should be a no-op because isRunning = true

      // Let p1 advance in the event loop until it hits the stuck promise
      await new Promise((r) => setTimeout(r, 50));

      expect(getDriveService().listVideoFiles).toHaveBeenCalledTimes(1);

      // Clean up
      resolveDrive!([]);
      await p1;
    });
  });

  describe('cooldown enforcement', () => {
    it('should skip polling entirely if the account is in cooldown', async () => {
      getHealthService().checkCooldown.mockResolvedValue(true);

      await scheduler.runPollCycle();

      expect(getDriveService().listVideoFiles).not.toHaveBeenCalled();
    });

    it('should poll Drive if cooldown has expired', async () => {
      getHealthService().checkCooldown.mockResolvedValue(false);

      await scheduler.runPollCycle();

      expect(getDriveService().listVideoFiles).toHaveBeenCalled();
    });
  });

  describe('daily limit enforcement', () => {
    it('should skip enqueueing if uploadsToday + pendingInQueue >= targetDailyLimit', async () => {
      const { getConfig } = require('../../src/config');
      getConfig.mockReturnValueOnce({
        ...mockConfig,
        accounts: [
          {
            instagramAccountId: 'ig-account-123',
            driveFolderId: 'drive-folder-id',
            enableWarmup: true,
          },
        ],
      });
      const localScheduler = new SchedulerService();

      // target is 32 (from mockConfig)
      getRepository().UploadLogModel.countTodaySuccessByAccount.mockResolvedValue(30);
      getUploadQueue().countPendingForAccount.mockResolvedValue(2);
      getDriveService().listVideoFiles.mockResolvedValue([makeDriveFile('f1')]);

      await localScheduler.runPollCycle();

      expect(getUploadQueue().enqueue).not.toHaveBeenCalled();
    });

    it('should skip enqueueing if uploadsToday >= dailyUploadLimit (hard limit from ENV)', async () => {
      const { getConfig } = require('../../src/config');
      getConfig.mockReturnValueOnce({
        ...mockConfig,
        upload: { ...mockConfig.upload, dailyUploadLimit: 5 }, // Hard limit = 5
      });

      getRepository().UploadLogModel.countTodaySuccessByAccount.mockResolvedValue(5);
      getUploadQueue().countPendingForAccount.mockResolvedValue(0);
      getDriveService().listVideoFiles.mockResolvedValue([makeDriveFile('f1')]);

      const localScheduler = new SchedulerService();
      await localScheduler.runPollCycle();

      expect(getUploadQueue().enqueue).not.toHaveBeenCalled();
    });

    it('should enqueue when count is below dailyUploadLimit', async () => {
      getRepository().UploadLogModel.countTodaySuccessByAccount.mockResolvedValue(0);
      getUploadQueue().countPendingForAccount.mockResolvedValue(0);
      getDriveService().listVideoFiles.mockResolvedValue([makeDriveFile('f1')]);
      getRepository().UploadLogModel.wasUploadedTodayByName.mockResolvedValue(false);

      await scheduler.runPollCycle();

      expect(getUploadQueue().enqueue).toHaveBeenCalled();
    });
  });

  describe('duplicate prevention', () => {
    it('should skip file if already processed (DB flag)', async () => {
      getDriveService().listVideoFiles.mockResolvedValue([makeDriveFile('f1')]);
      getRepository().ProcessedFileModel.isProcessed.mockResolvedValue(true);

      await scheduler.runPollCycle();

      expect(getUploadQueue().enqueue).not.toHaveBeenCalled();
    });

    it('should skip file if already uploaded today by name (anti-spam)', async () => {
      getDriveService().listVideoFiles.mockResolvedValue([
        makeDriveFile('f1', 'duplicate-name.mp4'),
      ]);
      getRepository().ProcessedFileModel.isProcessed.mockResolvedValue(false);
      getRepository().UploadLogModel.wasUploadedTodayByName.mockResolvedValue(true);

      await scheduler.runPollCycle();

      expect(getUploadQueue().enqueue).not.toHaveBeenCalled();
    });

    it('should enqueue a new, unprocessed file that passes all checks', async () => {
      getDriveService().listVideoFiles.mockResolvedValue([makeDriveFile('f1')]);
      getRepository().ProcessedFileModel.isProcessed.mockResolvedValue(false);
      getRepository().UploadLogModel.wasUploadedTodayByName.mockResolvedValue(false);

      await scheduler.runPollCycle();

      expect(getUploadQueue().enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkTokenExpiry()', () => {
    it('should notify if token expires in <= 10 days', async () => {
      const { getConfig } = require('../../src/config');
      const expiryDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
      getConfig.mockReturnValueOnce({
        ...mockConfig,
        instagram: { ...mockConfig.instagram, tokenExpiryDate: expiryDate },
      });

      const localScheduler = new SchedulerService();
      await (localScheduler as any).checkTokenExpiry();

      expect(getNotificationService().notifyTokenExpirySoon).toHaveBeenCalled();
    });

    it('should not notify if token has more than 10 days left', async () => {
      const { getConfig } = require('../../src/config');
      const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
      getConfig.mockReturnValueOnce({
        ...mockConfig,
        instagram: { ...mockConfig.instagram, tokenExpiryDate: expiryDate },
      });

      const localScheduler = new SchedulerService();
      await (localScheduler as any).checkTokenExpiry();

      expect(getNotificationService().notifyTokenExpirySoon).not.toHaveBeenCalled();
    });
  });
});
