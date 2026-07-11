import { Request, Response } from 'express';
import { getUploadQueue } from '../queue/upload.queue';
import { getInstagramService } from '../services/instagram.service';
import { UploadJobModel } from '../database/repository';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * POST /api/webhook/n8n/upload
 * Receives webhook from n8n to initiate an upload for a specific Drive file.
 *
 * Body: {
 *   driveFileId: string,
 *   driveFileName: string,
 * }
 */
export async function handleN8nUpload(req: Request, res: Response): Promise<void> {
  const { driveFileId, driveFileName } = req.body as {
    driveFileId: string;
    driveFileName: string;
  };

  logger.info('Received n8n upload webhook', { driveFileId, driveFileName });

  try {
    const queue = getUploadQueue();
    const defaultAccount = getConfig().accounts[0];
    const job = await queue.enqueueById(
      driveFileId,
      driveFileName,
      defaultAccount.instagramAccountId,
      defaultAccount.driveUploadedFolderId,
    );

    res.json({
      success: true,
      message: 'Upload job created from n8n webhook',
      data: {
        jobId: job.id,
        driveFileId,
        driveFileName,
        status: job.status,
      },
    });
  } catch (error) {
    logger.error('n8n webhook upload failed', {
      driveFileId,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to process n8n webhook',
    });
  }
}

/**
 * POST /api/webhook/n8n/status
 * Checks the Instagram container status for a given job.
 *
 * Body: { jobId: string }
 */
export async function handleN8nStatusCheck(req: Request, res: Response): Promise<void> {
  const { jobId } = req.body as { jobId: string };

  const job = await UploadJobModel.findById(jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  if (!job.instagramContainerId) {
    res.json({
      success: true,
      data: {
        jobId,
        status: job.status,
        containerId: null,
        instagramStatus: null,
        isReady: false,
      },
    });
    return;
  }

  try {
    const instagramService = getInstagramService();
    const accountId = job.instagramAccountId ?? getConfig().accounts[0].instagramAccountId;
    const account = getConfig().accounts.find(a => a.instagramAccountId === accountId);
    const context = { accountId, proxyUrl: account?.proxyUrl };

    const containerStatus = await instagramService.getContainerStatus(context, job.instagramContainerId);

    res.json({
      success: true,
      data: {
        jobId,
        status: job.status,
        containerId: job.instagramContainerId,
        instagramStatus: containerStatus.status,
        isReady: containerStatus.status === 'FINISHED',
        errorCode: containerStatus.errorCode,
        errorMessage: containerStatus.errorMessage,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check container status',
    });
  }
}

/**
 * POST /api/webhook/n8n/publish
 * Publishes a ready Reel container.
 *
 * Body: { jobId: string, containerId: string }
 */
export async function handleN8nPublish(req: Request, res: Response): Promise<void> {
  const { jobId, containerId } = req.body as { jobId: string; containerId: string };

  logger.info('Received n8n publish webhook', { jobId, containerId });

  try {
    const job = await UploadJobModel.findById(jobId);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    const instagramService = getInstagramService();
    const accountId = job.instagramAccountId ?? getConfig().accounts[0].instagramAccountId;
    const account = getConfig().accounts.find(a => a.instagramAccountId === accountId);
    const context = { accountId, proxyUrl: account?.proxyUrl };

    const publishResult = await instagramService.publishReel(context, containerId);

    await UploadJobModel.update(jobId, {
      status: 'COMPLETED',
      instagramMediaId: publishResult.id,
    });

    res.json({
      success: true,
      message: 'Reel published successfully',
      data: {
        jobId,
        instagramMediaId: publishResult.id,
      },
    });
  } catch (error) {
    logger.error('n8n publish webhook failed', {
      jobId,
      containerId,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to publish Reel',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
