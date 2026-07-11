/**
 * Unit tests for HealthService
 *
 * Tests: getHealthBand, recordSuccess (score increase, 5-upload increment),
 *        recordFailure (penalty matrix, cooldown trigger, restriction tracking),
 *        checkCooldown (active, expired, reset).
 */
import { HealthService } from '../../src/services/health.service';
import { AccountHealthModel } from '../../src/database/repository';
import { makeMockHealth } from '../fixtures';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/database/repository', () => ({
  AccountHealthModel: {
    getOrCreate: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
}));

// Mock config — always returns enableHealthScoring: true unless overridden per test
jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    upload: {
      enableHealthScoring: true,
      defaultCooldownHours: 48,
    },
    accounts: [{ instagramAccountId: 'ig-account-123' }],
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

const mockAccountHealthModel = AccountHealthModel as jest.Mocked<typeof AccountHealthModel>;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HealthService', () => {
  const ACCOUNT_ID = 'ig-account-123';
  let service: HealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthService();
  });

  // ── getHealthBand ──────────────────────────────────────────────────────────

  describe('getHealthBand()', () => {
    it.each([
      [100, 'Excellent'],
      [95, 'Excellent'],
      [94, 'Healthy'],
      [80, 'Healthy'],
      [79, 'Caution'],
      [60, 'Caution'],
      [59, 'Danger'],
      [40, 'Danger'],
      [39, 'Critical'],
      [0, 'Critical'],
    ])('score %i → %s band', (score, expectedBand) => {
      expect(service.getHealthBand(score)).toBe(expectedBand);
    });
  });

  // ── recordSuccess ──────────────────────────────────────────────────────────

  describe('recordSuccess()', () => {
    it('should not change score for the first 4 successes (0 mod 5 ≠ 0)', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 90, successfulUploads: 0 }) as any,
      );

      await service.recordSuccess(ACCOUNT_ID);

      // successfulUploads becomes 1, 1 % 5 ≠ 0 → no score increase
      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ healthScore: 90, successfulUploads: 1 }),
      );
    });

    it('should increase score by 1 on every 5th success', async () => {
      // 4 existing successes + 1 new = 5th upload → 5 % 5 = 0
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 90, successfulUploads: 4 }) as any,
      );

      await service.recordSuccess(ACCOUNT_ID);

      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ healthScore: 91, successfulUploads: 5 }),
      );
    });

    it('should not exceed score of 100', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 100, successfulUploads: 4 }) as any,
      );

      await service.recordSuccess(ACCOUNT_ID);

      // 5th success would add 1, but capped at 100
      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ healthScore: 100 }),
      );
    });

    it('should skip update entirely if enableHealthScoring is false', async () => {
      // Override the config mock for this specific test only
      const { getConfig } = require('../../src/config') as { getConfig: jest.Mock };
      getConfig.mockReturnValueOnce({
        upload: { enableHealthScoring: false },
        accounts: [],
      });

      // Create a new service so it picks up the mock config
      const disabledService = new HealthService();
      await disabledService.recordSuccess(ACCOUNT_ID);

      expect(mockAccountHealthModel.getOrCreate).not.toHaveBeenCalled();
      expect(mockAccountHealthModel.update).not.toHaveBeenCalled();
    });
  });

  // ── recordFailure ──────────────────────────────────────────────────────────

  describe('recordFailure()', () => {
    // Parameterized test: [errorMessage, expectedPenalty, isRestriction]
    it.each([
      ['checkpoint_required', 30, true],
      ['action_blocked', 40, true],
      ['action blocked by platform', 40, true],
      ['not permitted to publish', 40, true],
      ['challenge_required', 25, true],
      ['feedback_required', 15, false],
      ['login_required', 20, false],
      ['auth error: token', 20, false],
      ['session_expired', 20, false],
    ])('error "%s" → penalty %i, isRestriction=%s', async (errorMsg, penalty, isRestriction) => {
      const initialScore = 80;
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: initialScore, failedUploads: 0, restrictionCount: 0 }) as any,
      );

      await service.recordFailure(ACCOUNT_ID, errorMsg);

      const expectedScore = Math.max(0, initialScore - penalty);
      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ healthScore: expectedScore }),
      );

      if (isRestriction) {
        expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
          ACCOUNT_ID,
          expect.objectContaining({ restrictionCount: 1 }),
        );
      }
    });

    it('should apply no penalty for pure infrastructure/network errors and trigger cooldown', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 80 }) as any,
      );

      await service.recordFailure(ACCOUNT_ID, 'ECONNRESET: network failure');

      // Score is omitted from update (no penalty), cooldown is applied
      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ 
          cooldownUntil: expect.any(Date),
          failedUploads: expect.any(Number) 
        }),
      );
      
      // Ensure healthScore was NOT updated
      const updateCallArgs = (mockAccountHealthModel.update as jest.Mock).mock.calls.find(c => c[0] === ACCOUNT_ID);
      expect(updateCallArgs[1].healthScore).toBeUndefined();
    });

    it('should trigger cooldown when score drops below 40', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 50, cooldownUntil: null }) as any,
      );

      // action_blocked = -40 → score goes from 50 to 10 (<40)
      await service.recordFailure(ACCOUNT_ID, 'action_blocked');

      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ cooldownUntil: expect.any(Date), healthScore: 10 }),
      );
    });

    it('should NOT re-trigger cooldown if account is already in active cooldown', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 30, cooldownUntil: futureDate }) as any,
      );

      await service.recordFailure(ACCOUNT_ID, 'action_blocked');

      const updateCall = mockAccountHealthModel.update.mock.calls[0][1] as Record<string, unknown>;
      expect(updateCall).not.toHaveProperty('cooldownUntil');
    });

    it('should increment restrictionCount for restriction-type errors', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ healthScore: 80, restrictionCount: 2 }) as any,
      );

      await service.recordFailure(ACCOUNT_ID, 'action_blocked');

      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ restrictionCount: 3 }),
      );
    });
  });

  // ── checkCooldown ──────────────────────────────────────────────────────────

  describe('checkCooldown()', () => {
    it('should return false if no cooldown is set', async () => {
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ cooldownUntil: null }) as any,
      );

      const result = await service.checkCooldown(ACCOUNT_ID);
      expect(result).toBe(false);
    });

    it('should return true if cooldown is active (future date)', async () => {
      const futureDate = new Date(Date.now() + 60_000);
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ cooldownUntil: futureDate }) as any,
      );

      const result = await service.checkCooldown(ACCOUNT_ID);
      expect(result).toBe(true);
      // Should NOT update the cooldown record
      expect(mockAccountHealthModel.update).not.toHaveBeenCalled();
    });

    it('should return false and reset cooldown if it has expired', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      mockAccountHealthModel.getOrCreate.mockResolvedValue(
        makeMockHealth({ cooldownUntil: pastDate, healthScore: 30 }) as any,
      );

      const result = await service.checkCooldown(ACCOUNT_ID);
      expect(result).toBe(false);
      expect(mockAccountHealthModel.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.objectContaining({ cooldownUntil: null }),
      );
    });
  });
});
