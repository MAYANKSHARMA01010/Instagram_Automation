/**
 * Integration tests for HealthService
 *
 * Tests: DB integration for account health scoring, tracking restrictions,
 *        cooldown management, and threshold triggering.
 */
import { HealthService } from '../../src/services/health.service';
import { AccountHealthModel } from '../../src/database/repository';
import { getDatabase } from '../../src/config/database';

jest.mock('../../src/config/database', () => {
  const db: any[] = [];
  return {
    getDatabase: jest.fn(() => ({
      accountHealth: {
        deleteMany: jest.fn().mockImplementation(() => {
          db.length = 0;
          return Promise.resolve();
        }),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(
            db.find((h) => h.instagramAccountId === where.instagramAccountId) || null,
          );
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const fullData = {
            successfulUploads: 0,
            failedUploads: 0,
            restrictionCount: 0,
            challengeCount: 0,
            checkpointCount: 0,
            retryCount: 0,
            ...data,
          };
          db.push(fullData);
          return Promise.resolve(fullData);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const idx = db.findIndex((h) => h.instagramAccountId === where.instagramAccountId);
          if (idx !== -1) {
            db[idx] = { ...db[idx], ...data };
            return Promise.resolve(db[idx]);
          }
          return Promise.reject(new Error('Not found'));
        }),
        upsert: jest.fn().mockImplementation(({ where, create, update }: any) => {
          const idx = db.findIndex((h) => h.instagramAccountId === where.instagramAccountId);
          if (idx !== -1) {
            db[idx] = { ...db[idx], ...update };
            return Promise.resolve(db[idx]);
          }
          const fullData = {
            successfulUploads: 0,
            failedUploads: 0,
            restrictionCount: 0,
            challengeCount: 0,
            checkpointCount: 0,
            retryCount: 0,
            ...create,
          };
          db.push(fullData);
          return Promise.resolve(fullData);
        }),
      },
      $disconnect: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock config and notifications to avoid external side-effects
jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    upload: {
      enableHealthScoring: true,
      defaultCooldownHours: 24, // 24 hours for easy testing
    },
    accounts: [{ instagramAccountId: 'int-account-1' }],
  })),
}));

jest.mock('../../src/services/notification.service', () => ({
  getNotificationService: jest.fn(() => ({
    notifyRestrictionDetected: jest.fn().mockResolvedValue(undefined),
    notifyCooldownStarted: jest.fn().mockResolvedValue(undefined),
    notifyCooldownEnded: jest.fn().mockResolvedValue(undefined),
    notifyHealthDegraded: jest.fn().mockResolvedValue(undefined),
    notifyHealthRecovered: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('HealthService (Integration)', () => {
  const ACCOUNT_ID = 'int-account-1';
  let healthService: HealthService;

  beforeAll(async () => {
    healthService = new HealthService();
    await getDatabase().accountHealth.deleteMany({});
  });

  afterEach(async () => {
    await getDatabase().accountHealth.deleteMany({});
  });

  afterAll(async () => {
    await getDatabase().$disconnect();
  });

  it('should create a new health record with score 100 on first access', async () => {
    const health = await healthService.getHealth(ACCOUNT_ID);

    expect(health.healthScore).toBe(100);
    expect(health.successfulUploads).toBe(0);
    expect(health.failedUploads).toBe(0);

    const dbRecord = await getDatabase().accountHealth.findUnique({
      where: { instagramAccountId: ACCOUNT_ID },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.healthScore).toBe(100);
  });

  it('should increase score on 5th success (capped at 100)', async () => {
    // Manually create record at 95 score and 4 successes
    await AccountHealthModel.getOrCreate(ACCOUNT_ID);
    await AccountHealthModel.update(ACCOUNT_ID, { healthScore: 95, successfulUploads: 4 });

    await healthService.recordSuccess(ACCOUNT_ID); // 5th success

    const dbRecord = await getDatabase().accountHealth.findUnique({
      where: { instagramAccountId: ACCOUNT_ID },
    });
    expect(dbRecord?.healthScore).toBe(96);
    expect(dbRecord?.successfulUploads).toBe(5);
  });

  it('should penalize score and trigger cooldown when a restriction occurs', async () => {
    await AccountHealthModel.getOrCreate(ACCOUNT_ID);
    await AccountHealthModel.update(ACCOUNT_ID, { healthScore: 50 }); // Close to critical (40)

    // 'action_blocked' is a 40 point penalty, dropping score to 10
    await healthService.recordFailure(ACCOUNT_ID, 'action_blocked');

    const dbRecord = await getDatabase().accountHealth.findUnique({
      where: { instagramAccountId: ACCOUNT_ID },
    });

    expect(dbRecord?.healthScore).toBe(10);
    expect(dbRecord?.restrictionCount).toBe(1);
    expect(dbRecord?.cooldownUntil).not.toBeNull();
    expect(dbRecord?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('should trigger cooldown without reducing health score for infrastructure errors', async () => {
    await AccountHealthModel.getOrCreate(ACCOUNT_ID);
    await AccountHealthModel.update(ACCOUNT_ID, { healthScore: 100 });

    // 'ECONNREFUSED' is an infrastructure error
    await healthService.recordFailure(ACCOUNT_ID, 'ECONNREFUSED');

    const dbRecord = await getDatabase().accountHealth.findUnique({
      where: { instagramAccountId: ACCOUNT_ID },
    });

    expect(dbRecord?.healthScore).toBe(100); // Score remains untouched
    expect(dbRecord?.cooldownUntil).not.toBeNull(); // Cooldown is triggered
    expect(dbRecord?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('should reset cooldown via checkCooldown() once it has expired', async () => {
    await AccountHealthModel.getOrCreate(ACCOUNT_ID);
    // Set cooldown to the past
    const pastDate = new Date(Date.now() - 3600 * 1000);
    await AccountHealthModel.update(ACCOUNT_ID, { cooldownUntil: pastDate });

    const inCooldown = await healthService.checkCooldown(ACCOUNT_ID);
    expect(inCooldown).toBe(false); // Cooldown expired, so it returns false

    const dbRecord = await getDatabase().accountHealth.findUnique({
      where: { instagramAccountId: ACCOUNT_ID },
    });

    expect(dbRecord?.cooldownUntil).toBeNull(); // Must be cleared
  });
});
