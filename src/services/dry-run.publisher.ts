import { IInstagramPublisher } from './publisher.interface';
import { AccountNetworkContext } from '../types/network.types';
import {
  InstagramContainerCreateResponse,
  InstagramPublishResponse,
  InstagramContainerStatus,
} from '../types/instagram.types';
import logger from '../utils/logger';
export class DryRunPublisher implements IInstagramPublisher {
  getContainerStatus(
    context: AccountNetworkContext,
    containerId: string,
  ): Promise<InstagramContainerStatus> {
    logger.info('DRY RUN: getContainerStatus called', {
      accountId: context.accountId,
      containerId,
    });

    return Promise.resolve({
      status: 'FINISHED',
      id: containerId,
    });
  }
  async createReelContainer(
    context: AccountNetworkContext,
    videoUrl: string,
    caption: string,
    coverUrl?: string,
  ): Promise<InstagramContainerCreateResponse> {
    logger.info('DRY RUN: createReelContainer called', {
      accountId: context.accountId,
      proxyUsed: !!context.proxyUrl,
      videoUrl,
      hasCaption: !!caption,
      hasCoverUrl: !!coverUrl,
    });

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      id: `dryrun-container-${Date.now()}`,
    };
  }

  async waitForContainerReady(context: AccountNetworkContext, containerId: string): Promise<void> {
    logger.info('DRY RUN: waitForContainerReady called', {
      accountId: context.accountId,
      containerId,
    });

    // Simulate polling latency
    await new Promise((resolve) => setTimeout(resolve, 2000));

    logger.info(`DRY RUN: Container ${containerId} is ready`);
  }

  async publishReel(
    context: AccountNetworkContext,
    containerId: string,
  ): Promise<InstagramPublishResponse> {
    logger.info('DRY RUN: publishReel called', {
      accountId: context.accountId,
      containerId,
      proxyUsed: !!context.proxyUrl,
    });

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      id: `DRY_RUN_MEDIA_ID_${Date.now()}`,
    };
  }
}
