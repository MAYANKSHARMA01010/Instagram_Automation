import { getDatabase } from '../config/database';
import logger from '../utils/logger';

/**
 * Service to keep the PostgreSQL database connection alive.
 * Executes a simple query every 5 minutes to prevent auto-suspension.
 */
export class KeepAliveService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Starts the keepalive interval.
   */
  start(): void {
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          await getDatabase().$queryRaw`SELECT 1`;
        } catch (error) {
          logger.warn('Database keepalive failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, this.INTERVAL_MS);

    logger.info('Database KeepAliveService started');
  }

  /**
   * Stops the keepalive interval.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Database KeepAliveService stopped');
    }
  }
}

// Singleton instance
let keepAliveService: KeepAliveService | null = null;

export function getKeepAliveService(): KeepAliveService {
  if (!keepAliveService) {
    keepAliveService = new KeepAliveService();
  }
  return keepAliveService;
}
