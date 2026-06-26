import { Request, Response } from 'express';
import { getUploadQueue } from '../queue/upload.queue';
import { getSchedulerService } from '../services/scheduler.service';
import { getDriveService } from '../services/google-drive.service';
import { UploadLogModel, UploadJobModel, ProcessedFileModel } from '../database/repository';
import logger from '../utils/logger';

/**
 * POST /api/upload/trigger
 * Manually triggers a Drive poll cycle and enqueues new videos.
 */
export async function triggerUpload(_req: Request, res: Response): Promise<void> {
  logger.info('Manual upload trigger requested');

  try {
    const scheduler = getSchedulerService();
    await scheduler.runPollCycle();

    const stats = await getUploadQueue().getStats();

    res.json({
      success: true,
      message: 'Upload cycle triggered successfully',
      data: { queueStats: stats },
    });
  } catch (error) {
    logger.error('Manual trigger failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to trigger upload cycle',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /api/upload/enqueue
 * Enqueues a specific Drive file by ID for immediate upload.
 * Body: { driveFileId: string }
 */
export async function enqueueFile(req: Request, res: Response): Promise<void> {
  const { driveFileId } = req.body as { driveFileId: string };

  try {
    const driveService = getDriveService();
    const fileMetadata = await driveService.getFileMetadata(driveFileId);

    const queue = getUploadQueue();
    const job = await queue.enqueueById(fileMetadata.id, fileMetadata.name);

    res.json({
      success: true,
      message: 'File enqueued for upload',
      data: {
        jobId: job.id,
        driveFileId: fileMetadata.id,
        fileName: fileMetadata.name,
      },
    });
  } catch (error) {
    logger.error('Failed to enqueue file', {
      driveFileId,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to enqueue file',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /api/upload/jobs
 * Returns all upload jobs.
 */
export async function getJobs(req: Request, res: Response): Promise<void> {
  const status = req.query['status'] as string | undefined;
  let jobs;

  if (status) {
    jobs = await UploadJobModel.findByStatus(
      status as Parameters<typeof UploadJobModel.findByStatus>[0],
    );
  } else {
    // Return all statuses combined
    const statuses = [
      'PENDING',
      'DOWNLOADING',
      'UPLOADING',
      'PROCESSING',
      'PUBLISHING',
      'COMPLETED',
      'FAILED',
    ] as const;
    const jobPromises = statuses.map((s) => UploadJobModel.findByStatus(s));
    jobs = (await Promise.all(jobPromises)).flat();
  }

  res.json({ success: true, data: jobs });
}

/**
 * GET /api/upload/jobs/:id
 * Returns a specific upload job by ID.
 */
export async function getJobById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const job = await UploadJobModel.findById(id);

  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  res.json({ success: true, data: job });
}

/**
 * GET /api/upload/logs
 * Returns upload history logs.
 */
export async function getUploadLogs(req: Request, res: Response): Promise<void> {
  const limit = parseInt((req.query['limit'] as string) ?? '100', 10);
  const logs = await UploadLogModel.findAll(Math.min(limit, 500));
  res.json({ success: true, data: logs, count: logs.length });
}

/**
 * GET /api/upload/processed
 * Returns all processed (uploaded) files.
 */
export async function getProcessedFiles(req: Request, res: Response): Promise<void> {
  const limit = parseInt((req.query['limit'] as string) ?? '100', 10);
  const files = await ProcessedFileModel.findAll(Math.min(limit, 500));
  res.json({ success: true, data: files, count: files.length });
}

/**
 * GET /api/upload/stats
 * Returns queue statistics.
 */
export async function getStats(_req: Request, res: Response): Promise<void> {
  const stats = await getUploadQueue().getStats();
  res.json({ success: true, data: stats });
}
