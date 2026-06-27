import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { validateConfig, getConfig } from './config';
import { closeDatabase, recoverStuckJobs } from './config/database';
import { getSchedulerService } from './services/scheduler.service';
import { getKeepAliveService } from './services/keepalive.service';
import { getDownloadWorker } from './workers/download.worker';
import { getNotificationService } from './services/notification.service';
import { ensureDir } from './utils/helpers';
import logger from './utils/logger';

let server: http.Server;

/**
 * Bootstrap function — validates config, initializes DB, starts workers.
 */
async function bootstrap(): Promise<void> {
  logger.info('Starting Instagram Reels Uploader...');

  // 1. Validate all required environment variables
  try {
    validateConfig();
  } catch (error) {
    logger.error('Configuration validation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const config = getConfig();

  // 2. Ensure required directories exist
  ensureDir('./logs');
  ensureDir('./tmp');
  ensureDir('./database');
  ensureDir('./public/cover');

  // 3. Recover stuck jobs from previous run
  try {
    // REQ-8: Reset any jobs that were stuck in-flight when server last crashed
    await recoverStuckJobs();
  } catch (error) {
    logger.error('Database initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // 4. Create and start HTTP server
  const app = createApp();
  server = http.createServer(app);

  server.listen(config.app.port, () => {
    logger.info(`Server listening on port ${config.app.port}`, {
      env: config.app.nodeEnv,
      port: config.app.port,
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.app.port} is already in use`);
    } else {
      logger.error('Server error', { error: error.message });
    }
    process.exit(1);
  });

  // 5. Start download worker (listens for queue events)
  const downloadWorker = getDownloadWorker();
  downloadWorker.start();

  // 6. Start the cron scheduler (polls Drive)
  const scheduler = getSchedulerService();
  scheduler.start();

  // 6.5. Start the database keepalive service
  const keepAliveService = getKeepAliveService();
  keepAliveService.start();

  // 7. Send startup notification
  const notificationService = getNotificationService();
  await notificationService.notifyStartup();

  logger.info('Instagram Reels Uploader started successfully', {
    port: config.app.port,
    pollingCron: config.upload.pollingCron,
    environment: config.app.nodeEnv,
  });
}

/**
 * Graceful shutdown handler.
 * Stops all services before process exit to prevent data corruption.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.warn('Forced server close after timeout');
        resolve();
      }, 10_000);
    });
  }

  // Stop the cron scheduler
  const scheduler = getSchedulerService();
  scheduler.stop();

  // Stop the keepalive service
  const keepAliveService = getKeepAliveService();
  keepAliveService.stop();

  // Stop the download worker
  const downloadWorker = getDownloadWorker();
  downloadWorker.stop();

  // Close database connection
  await closeDatabase();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// ── Signal handlers ────────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// ── Unhandled promise rejection handler ────────────────────────────────────────
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// ── Uncaught exception handler ─────────────────────────────────────────────────
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Start the application
void bootstrap();
