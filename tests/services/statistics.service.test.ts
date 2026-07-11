/**
 * Unit tests for StatisticsService
 *
 * Tests: recordSuccess, recordFailure, categoriseError, getDailySummary,
 *        midnight rollover reset, per-account tracking.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Logger mock must be at top level (hoisted) — not inside beforeEach
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(() => ({
    accounts: [{ instagramAccountId: 'acct-1', accountName: 'Account One' }],
  })),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

// We import directly (not requireActual) since mocks are in place
import { StatisticsService } from '../../src/services/statistics.service';

describe('StatisticsService', () => {
  let service: StatisticsService;

  beforeEach(() => {
    // Fresh instance for each test to avoid cross-test state contamination
    service = new StatisticsService();
  });

  // ── categoriseError ────────────────────────────────────────────────────────

  describe('categoriseError()', () => {
    it.each([
      ['User access is restricted', 'Daily Limit Reached'],
      ['rate limit exceeded', 'Rate Limited'],
      ['too many calls', 'Rate Limited'],
      ['throttled request', 'Rate Limited'],
      ['oauth token invalid', 'Auth Error'],
      ['network error occurred', 'Infrastructure Error'],
      ['econnreset', 'Infrastructure Error'],
      ['request timeout', 'Infrastructure Error'],
      ['validation failed for field', 'Validation Error'],
      ['invalid media format', 'Validation Error'],
      ['some completely unknown error', 'Other Error'],
    ])('"%s" → "%s"', (errorMsg, category) => {
      expect(service.categoriseError(errorMsg)).toBe(category);
    });
  });

  // ── getDailySummary ────────────────────────────────────────────────────────

  describe('getDailySummary()', () => {
    it('should return 0% success rate with no activity', () => {
      const summary = service.getDailySummary();
      expect(summary.uploadsToday).toBe(0);
      expect(summary.successRate).toBe('0.0%');
    });

    it('should correctly accumulate success statistics', () => {
      service.recordSuccess(
        {
          total: 5000,
          videoDownload: 1000,
          containerCreation: 1000,
          instagramProcessing: 2000,
          publish: 500,
          assetFetch: 500,
        },
        0,
        'acct-1',
      );
      service.recordSuccess(
        {
          total: 3000,
          videoDownload: 500,
          containerCreation: 500,
          instagramProcessing: 1500,
          publish: 300,
          assetFetch: 200,
        },
        1,
        'acct-1',
      );

      const summary = service.getDailySummary();
      expect(summary.uploadsToday).toBe(2);
      expect(summary.retriesToday).toBe(1);
      expect(summary.metaApiCallsToday).toBe(4); // 2 per success
      expect(summary.successRate).toBe('100.0%');
    });

    it('should correctly calculate success rate with mixed results', () => {
      service.recordSuccess({ total: 5000 }, 0, 'acct-1');
      service.recordFailure(0, 'network error', 'acct-1');

      const summary = service.getDailySummary();
      expect(summary.uploadsToday).toBe(1);
      expect(summary.failuresToday).toBe(1);
      expect(summary.successRate).toBe('50.0%');
    });

    it('should track per-account statistics independently', () => {
      service.recordSuccess({ total: 5000 }, 0, 'acct-1');
      service.recordSuccess({ total: 3000 }, 0, 'acct-2');
      service.recordFailure(0, 'error', 'acct-1');

      const summary = service.getDailySummary();
      const acct1 = summary.accountSummaries.find((a) => a.instagramAccountId === 'acct-1');
      const acct2 = summary.accountSummaries.find((a) => a.instagramAccountId === 'acct-2');

      expect(acct1?.uploads).toBe(1);
      expect(acct1?.failures).toBe(1);
      expect(acct2?.uploads).toBe(1);
      expect(acct2?.failures).toBe(0);
    });

    it('should categorise errors in errorBreakdown', () => {
      service.recordFailure(0, 'rate limit exceeded', 'acct-1');
      service.recordFailure(0, 'rate limit exceeded', 'acct-1');
      service.recordFailure(0, 'oauth token invalid', 'acct-1');

      const summary = service.getDailySummary();
      expect(summary.errorBreakdown['Rate Limited']).toBe(2);
      expect(summary.errorBreakdown['Auth Error']).toBe(1);
    });
  });

  // ── midnight rollover ──────────────────────────────────────────────────────

  describe('midnight rollover reset', () => {
    it('should reset all counters when the day changes', () => {
      // Record some activity
      service.recordSuccess({ total: 5000 }, 0, 'acct-1');
      expect(service.getDailySummary().uploadsToday).toBe(1);

      // Simulate day change by mocking getDate to return a different day
      const originalGetDate = Date.prototype.getDate;
      jest.spyOn(Date.prototype, 'getDate').mockReturnValue(99); // different day

      // getDailySummary will call checkReset() which detects the day change
      const summary = service.getDailySummary();
      expect(summary.uploadsToday).toBe(0); // Reset!

      jest.spyOn(Date.prototype, 'getDate').mockRestore();
      // @ts-expect-error - restore prototype
      Date.prototype.getDate = originalGetDate;
    });
  });
});
