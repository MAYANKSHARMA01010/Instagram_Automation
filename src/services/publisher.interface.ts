import { AccountNetworkContext } from '../types/network.types';
import {
  InstagramContainerCreateResponse,
  InstagramPublishResponse,
  InstagramContainerStatus,
} from '../types/instagram.types';

export interface IInstagramPublisher {
  /**
   * Checks the status of a media container.
   *
   * @param context - Network context including account ID and proxy configuration
   * @param containerId - The ID of the container to check
   */
  getContainerStatus(
    context: AccountNetworkContext,
    containerId: string,
  ): Promise<InstagramContainerStatus>;
  /**
   * Creates a media container for a Reel.
   *
   * @param context - Network context including account ID and proxy configuration
   * @param videoUrl - Publicly accessible URL to the video file
   * @param caption - Caption text for the Reel
   * @param coverUrl - Optional cover image URL
   */
  createReelContainer(
    context: AccountNetworkContext,
    videoUrl: string,
    caption: string,
    coverUrl?: string,
  ): Promise<InstagramContainerCreateResponse>;

  /**
   * Polls the container status until it is FINISHED (ready for publishing).
   * Throws an error if the process fails or times out.
   *
   * @param context - Network context including account ID and proxy configuration
   * @param containerId - The ID of the container to check
   */
  waitForContainerReady(context: AccountNetworkContext, containerId: string): Promise<void>;

  /**
   * Publishes a successfully processed container.
   *
   * @param context - Network context including account ID and proxy configuration
   * @param containerId - The ID of the FINISHED container
   * @returns The resulting Media ID from Instagram
   */
  publishReel(
    context: AccountNetworkContext,
    containerId: string,
  ): Promise<InstagramPublishResponse>;
}
