import { Request, Response } from 'express';
import { getDatabase } from '../config/database';
import { getUploadQueue } from '../queue/upload.queue';
import { getSchedulerService } from '../services/scheduler.service';
import { getDownloadWorker } from '../workers/download.worker';
import { getStatusWorker } from '../workers/status.worker';

/**
 * GET /health
 * Returns the health status of the application and its dependencies.
 */
export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  const checks: Record<string, { status: 'ok' | 'error'; details?: string }> = {};

  // Check database
  try {
    const db = getDatabase();
    await db.$queryRawUnsafe('SELECT 1');
    checks['database'] = { status: 'ok' };
  } catch (error) {
    checks['database'] = {
      status: 'error',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check queue
  try {
    const queue = getUploadQueue();
    const stats = await queue.getStats();
    checks['queue'] = {
      status: 'ok',
      details: `pending: ${stats.pending}, processing: ${stats.processing}`,
    };
  } catch (error) {
    checks['queue'] = { status: 'error' };
  }

  // Check scheduler
  const scheduler = getSchedulerService();
  checks['scheduler'] = {
    status: scheduler.isActive() ? 'ok' : 'error',
    details: scheduler.isActive() ? 'active' : 'not running',
  };

  // Check processing jobs
  try {
    const statusWorker = getStatusWorker();
    const processingJobs = await statusWorker.getProcessingJobsStatus();
    checks['instagram_processing'] = {
      status: 'ok',
      details: `${processingJobs.length} job(s) in processing`,
    };
  } catch (error) {
    checks['instagram_processing'] = { status: 'error' };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');
  const responseTime = Date.now() - startTime;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    responseTimeMs: responseTime,
    version: process.env.npm_package_version ?? '1.0.0',
    checks,
  });
}

/**
 * GET /health/queue
 * Returns detailed queue statistics.
 */
export async function queueStats(_req: Request, res: Response): Promise<void> {
  const queue = getUploadQueue();
  const stats = await queue.getStats();
  const worker = getDownloadWorker();

  res.json({
    success: true,
    data: {
      ...stats,
      activeWorkers: worker ? 1 : 0,
    },
  });
}
