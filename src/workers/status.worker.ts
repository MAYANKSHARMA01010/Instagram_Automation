import { getInstagramService } from '../services/instagram.service';
import { UploadJobModel } from '../database/repository';
import logger from '../utils/logger';
import { getConfig } from '../config';
import { AccountNetworkContext } from '../types/network.types';

/**
 * Status worker utility for manually checking Instagram container status.
 * Used by the API endpoint to query the current processing status of a container.
 */
export class StatusWorker {
  /**
   * Polls the current status of an Instagram media container.
   */
  async checkContainerStatus(
    context: AccountNetworkContext,
    containerId: string,
  ): Promise<{
    containerId: string;
    status: string;
    isReady: boolean;
    errorCode?: number;
    errorMessage?: string;
  }> {
    logger.debug('Checking container status', { containerId });

    const instagramService = getInstagramService();
    const containerStatus = await instagramService.getContainerStatus(context, containerId);

    const isReady = containerStatus.status === 'FINISHED';
    const isError = containerStatus.status === 'ERROR' || containerStatus.status === 'EXPIRED';

    if (isError) {
      logger.warn('Container in error state', {
        containerId,
        status: containerStatus.status,
        errorCode: containerStatus.errorCode,
        errorMessage: containerStatus.errorMessage,
      });
    }

    return {
      containerId,
      status: containerStatus.status,
      isReady,
      errorCode: containerStatus.errorCode,
      errorMessage: containerStatus.errorMessage,
    };
  }

  /**
   * Returns the status summary of all jobs currently in PROCESSING state.
   */
  async getProcessingJobsStatus(): Promise<
    Array<{
      jobId: string;
      fileName: string;
      containerId: string;
      instagramStatus?: string;
    }>
  > {
    const processingJobs = await UploadJobModel.findByStatus('PROCESSING');
    const results = [];

    for (const job of processingJobs) {
      if (!job.instagramContainerId) continue;

      try {
        const accountId = job.instagramAccountId ?? getConfig().accounts[0].instagramAccountId;
        const account = getConfig().accounts.find((a) => a.instagramAccountId === accountId);
        const context = { accountId, proxyUrl: account?.proxyUrl };

        const status = await this.checkContainerStatus(context, job.instagramContainerId);
        results.push({
          jobId: job.id,
          fileName: job.driveFileName,
          containerId: job.instagramContainerId,
          instagramStatus: status.status,
        });
      } catch (error) {
        results.push({
          jobId: job.id,
          fileName: job.driveFileName,
          containerId: job.instagramContainerId,
          instagramStatus: 'UNKNOWN',
        });
      }
    }

    return results;
  }
}

// Singleton
let statusWorker: StatusWorker | null = null;

export function getStatusWorker(): StatusWorker {
  if (!statusWorker) {
    statusWorker = new StatusWorker();
  }
  return statusWorker;
}
