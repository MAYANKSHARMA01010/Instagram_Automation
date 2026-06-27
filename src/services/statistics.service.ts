import logger from '../utils/logger';

interface StageAverages {
  videoDownload: number;
  assetFetch: number;
  containerCreation: number;
  instagramProcessing: number;
  publish: number;
  total: number;
}

class StatisticsService {
  private currentDay: number;
  private uploadsToday = 0;
  private failuresToday = 0;
  private retriesToday = 0;
  
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

  private checkReset() {
    const today = new Date().getDate();
    if (this.currentDay !== today) {
      this.currentDay = today;
      this.uploadsToday = 0;
      this.failuresToday = 0;
      this.retriesToday = 0;
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

  recordSuccess(timings: Partial<StageAverages>, retries: number) {
    this.checkReset();
    this.uploadsToday++;
    this.retriesToday += retries;

    this.timingSums.videoDownload += timings.videoDownload || 0;
    this.timingSums.assetFetch += timings.assetFetch || 0;
    this.timingSums.containerCreation += timings.containerCreation || 0;
    this.timingSums.instagramProcessing += timings.instagramProcessing || 0;
    this.timingSums.publish += timings.publish || 0;
    this.timingSums.total += timings.total || 0;

    this.logSummary();
  }

  recordFailure(retries: number) {
    this.checkReset();
    this.failuresToday++;
    this.retriesToday += retries;
    this.logSummary();
  }

  private logSummary() {
    const totalAttempts = this.uploadsToday + this.failuresToday;
    const successRate = totalAttempts === 0 ? 0 : (this.uploadsToday / totalAttempts) * 100;
    
    const avg = (sum: number) => this.uploadsToday === 0 ? 0 : sum / this.uploadsToday;

    logger.info('Daily Upload Summary Statistics', {
      uploadsToday: this.uploadsToday,
      failures: this.failuresToday,
      successRate: `${successRate.toFixed(1)}%`,
      retries: this.retriesToday,
      averagesMs: {
        videoDownload: Math.round(avg(this.timingSums.videoDownload)),
        assetFetch: Math.round(avg(this.timingSums.assetFetch)),
        containerCreation: Math.round(avg(this.timingSums.containerCreation)),
        instagramProcessing: Math.round(avg(this.timingSums.instagramProcessing)),
        publish: Math.round(avg(this.timingSums.publish)),
        total: Math.round(avg(this.timingSums.total)),
      }
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
