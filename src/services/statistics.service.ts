import logger from '../utils/logger';
import { getConfig } from '../config';
import { classifyError, ErrorCategory } from '../utils/error-classifier';

interface StageAverages {
  videoDownload: number;
  assetFetch: number;
  containerCreation: number;
  instagramProcessing: number;
  publish: number;
  total: number;
}

export interface AccountStats {
  accountName: string;
  instagramAccountId: string;
  uploads: number;
  failures: number;
  metaApiCalls: number;
  totalUploadMs: number;
}

export interface DailySummary {
  uploadsToday: number;
  failuresToday: number;
  retriesToday: number;
  successRate: string;
  metaApiCallsToday: number; // each upload = 2 calls (container + publish)
  avgUploadTimeSeconds: number;
  errorBreakdown: Record<string, number>;
  accountSummaries: AccountStats[];
}

export class StatisticsService {
  private currentDay: number;
  private uploadsToday = 0;
  private failuresToday = 0;
  private retriesToday = 0;
  private metaApiCallsToday = 0; // 2 per success (container + publish), 1 per failure
  private errorBreakdown: Record<string, number> = {};

  // Per-account tracking: keyed by instagramAccountId
  private accountStats: Map<string, AccountStats> = new Map();

  private timingSums = {
    videoDownload: 0,
    assetFetch: 0,
    containerCreation: 0,
    instagramProcessing: 0,
    publish: 0,
    total: 0,
  };

  constructor() {
    this.currentDay = new Date().getDate();
  }

  private checkReset(): void {
    const today = new Date().getDate();
    if (this.currentDay !== today) {
      this.currentDay = today;
      this.uploadsToday = 0;
      this.failuresToday = 0;
      this.retriesToday = 0;
      this.metaApiCallsToday = 0;
      this.errorBreakdown = {};
      this.accountStats = new Map();
      this.timingSums = {
        videoDownload: 0,
        assetFetch: 0,
        containerCreation: 0,
        instagramProcessing: 0,
        publish: 0,
        total: 0,
      };
    }
  }

  /**
   * Returns or initialises the per-account stats bucket for a given account ID.
   */
  private getAccountBucket(accountId: string): AccountStats {
    if (!this.accountStats.has(accountId)) {
      const config = getConfig();
      const account = config.accounts.find((a) => a.instagramAccountId === accountId);
      this.accountStats.set(accountId, {
        accountName: account?.accountName ?? accountId,
        instagramAccountId: accountId,
        uploads: 0,
        failures: 0,
        metaApiCalls: 0,
        totalUploadMs: 0,
      });
    }
    return this.accountStats.get(accountId)!;
  }

  /**
   * Categorises a Meta API error message into a short human-readable label.
   * Preserves legacy metric labels for additive metrics.
   */
  categoriseError(errorMessage: string): string {
    const category = classifyError(errorMessage);
    const msg = errorMessage.toLowerCase();

    // Preserve legacy specific label
    if (msg.includes('user access is restricted')) return 'Daily Limit Reached';

    if (category === ErrorCategory.INFRASTRUCTURE) return 'Infrastructure Error'; // New category
    if (category === ErrorCategory.AUTH) return 'Auth Error';
    if (category === ErrorCategory.RATE_LIMIT) return 'Rate Limited';
    if (category === ErrorCategory.PLATFORM) return 'Platform Restriction';
    if (category === ErrorCategory.VALIDATION) return 'Validation Error';
    return 'Other Error';
  }

  /**
   * Returns a snapshot of today's statistics for use in notifications.
   */
  getDailySummary(): DailySummary {
    this.checkReset();
    const totalAttempts = this.uploadsToday + this.failuresToday;
    const successRate =
      totalAttempts === 0 ? '0.0%' : `${((this.uploadsToday / totalAttempts) * 100).toFixed(1)}%`;
    const avgUploadTimeSeconds =
      this.uploadsToday === 0 ? 0 : Math.round(this.timingSums.total / this.uploadsToday / 1000);

    return {
      uploadsToday: this.uploadsToday,
      failuresToday: this.failuresToday,
      retriesToday: this.retriesToday,
      successRate,
      metaApiCallsToday: this.metaApiCallsToday,
      avgUploadTimeSeconds,
      errorBreakdown: { ...this.errorBreakdown },
      accountSummaries: Array.from(this.accountStats.values()),
    };
  }

  recordSuccess(timings: Partial<StageAverages>, retries: number, accountId?: string): void {
    this.checkReset();
    this.uploadsToday++;
    this.retriesToday += retries;
    this.metaApiCallsToday += 2; // 1 container creation + 1 publish

    this.timingSums.videoDownload += timings.videoDownload || 0;
    this.timingSums.assetFetch += timings.assetFetch || 0;
    this.timingSums.containerCreation += timings.containerCreation || 0;
    this.timingSums.instagramProcessing += timings.instagramProcessing || 0;
    this.timingSums.publish += timings.publish || 0;
    this.timingSums.total += timings.total || 0;

    // Per-account tracking
    if (accountId) {
      const bucket = this.getAccountBucket(accountId);
      bucket.uploads++;
      bucket.metaApiCalls += 2;
      bucket.totalUploadMs += timings.total || 0;
    }

    this.logSummary();
  }

  recordFailure(retries: number, errorMessage?: string, accountId?: string): void {
    this.checkReset();
    this.failuresToday++;
    this.retriesToday += retries;
    this.metaApiCallsToday += 1; // at least 1 container creation attempted

    if (errorMessage) {
      const category = this.categoriseError(errorMessage);
      this.errorBreakdown[category] = (this.errorBreakdown[category] || 0) + 1;
    }

    // Per-account tracking
    if (accountId) {
      const bucket = this.getAccountBucket(accountId);
      bucket.failures++;
      bucket.metaApiCalls += 1;
    }

    this.logSummary();
  }

  private logSummary(): void {
    const totalAttempts = this.uploadsToday + this.failuresToday;
    const successRate = totalAttempts === 0 ? 0 : (this.uploadsToday / totalAttempts) * 100;

    const avg = (sum: number): number => (this.uploadsToday === 0 ? 0 : sum / this.uploadsToday);

    logger.info('Daily Upload Summary Statistics', {
      uploadsToday: this.uploadsToday,
      failures: this.failuresToday,
      successRate: `${successRate.toFixed(1)}%`,
      retries: this.retriesToday,
      metaApiCalls: this.metaApiCallsToday,
      perAccount: Array.from(this.accountStats.values()),
      averagesMs: {
        videoDownload: Math.round(avg(this.timingSums.videoDownload)),
        assetFetch: Math.round(avg(this.timingSums.assetFetch)),
        containerCreation: Math.round(avg(this.timingSums.containerCreation)),
        instagramProcessing: Math.round(avg(this.timingSums.instagramProcessing)),
        publish: Math.round(avg(this.timingSums.publish)),
        total: Math.round(avg(this.timingSums.total)),
      },
    });
  }
}

// Singleton
let statisticsService: StatisticsService | null = null;

export function getStatisticsService(): StatisticsService {
  if (!statisticsService) {
    statisticsService = new StatisticsService();
  }
  return statisticsService;
}
