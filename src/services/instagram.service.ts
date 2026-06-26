import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  InstagramContainerCreateResponse,
  InstagramContainerStatus,
  InstagramPublishResponse,
  InstagramStatusCode,
  GraphApiErrorResponse,
} from '../types/instagram.types';
import { withRetry, pollUntil } from '../utils/retry';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * Service for interacting with the Meta (Instagram) Graph API.
 * Handles Reel container creation, status polling, and publishing.
 */
export class InstagramService {
  private client: AxiosInstance;
  private config = getConfig();
  private readonly baseUrl: string;

  constructor() {
    const { graphApiVersion } = this.config.instagram;
    this.baseUrl = `https://graph.facebook.com/${graphApiVersion}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60_000,
    });

    // Add token to all requests
    this.client.interceptors.request.use((config) => {
      config.params = {
        ...config.params,
        access_token: this.config.instagram.graphApiToken,
      };
      return config;
    });

    // Log API errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<GraphApiErrorResponse>) => {
        const graphError = error.response?.data?.error;
        if (graphError) {
          logger.error('Meta Graph API error', {
            code: graphError.code,
            type: graphError.type,
            message: graphError.message,
            fbtraceId: graphError.fbtraceId,
          });
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Creates a media container for a Reel.
   * The video must be publicly accessible via a URL.
   *
   * @param videoUrl - Publicly accessible URL to the video file
   * @param caption - Caption text for the Reel
   * @param coverUrl - Optional cover image URL
   */
  async createReelContainer(
    videoUrl: string,
    caption: string,
    coverUrl?: string,
  ): Promise<InstagramContainerCreateResponse> {
    const { accountId } = this.config.instagram;

    logger.info('Creating Instagram Reel container', {
      accountId,
      hasCaption: !!caption,
      hasCoverUrl: !!coverUrl,
    });

    return withRetry(
      async () => {
        const params: Record<string, string | boolean> = {
          media_type: 'REELS',
          video_url: videoUrl,
          caption,
          share_to_feed: true,
        };

        if (coverUrl) {
          params['cover_url'] = coverUrl;
        }

        try {
          const response = await this.client.post<InstagramContainerCreateResponse>(
            `/${accountId}/media`,
            null,
            { params },
          );

          logger.info('Reel container created', { containerId: response.data.id });
          return response.data;
        } catch (error: any) {
          if (error.response?.data?.error?.message) {
            error.message = `${error.message} - Meta API Error: ${error.response.data.error.message}`;
          }
          throw error;
        }
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
        shouldRetry: this.isRetryableApiError.bind(this),
      },
    );
  }

  /**
   * Checks the processing status of an Instagram media container.
   */
  async getContainerStatus(containerId: string): Promise<InstagramContainerStatus> {
    const response = await this.client.get<InstagramContainerStatus>(`/${containerId}`, {
      params: {
        fields: 'id,status_code',
      },
    });

    // The API returns status_code as the field name in some versions
    const data = response.data as unknown as Record<string, unknown>;
    const statusCode = (data['status_code'] ?? data['status']) as InstagramStatusCode;

    logger.debug('Container status', { containerId, status: statusCode });

    return {
      id: containerId,
      status: statusCode,
      errorCode: data['error_code'] as number | undefined,
      errorMessage: data['error_message'] as string | undefined,
    };
  }

  /**
   * Waits for an Instagram container to finish processing.
   * Polls at regular intervals until FINISHED status or timeout.
   */
  async waitForContainerReady(containerId: string): Promise<void> {
    logger.info('Waiting for container to be ready', { containerId });

    let lastStatus: InstagramStatusCode = 'IN_PROGRESS';

    await pollUntil(
      async () => {
        const status = await this.getContainerStatus(containerId);
        lastStatus = status.status;

        if (status.status === 'ERROR' || status.status === 'EXPIRED') {
          throw new Error(
            `Instagram container ${containerId} failed with status: ${status.status}` +
              (status.errorMessage ? ` — ${status.errorMessage}` : ''),
          );
        }

        return status.status === 'FINISHED';
      },
      this.config.upload.statusPollIntervalMs,
      this.config.upload.statusPollTimeoutMs,
      `container ${containerId}`,
    );

    logger.info('Container is ready for publishing', { containerId, lastStatus });
  }

  /**
   * Publishes a media container as an Instagram Reel.
   */
  async publishReel(containerId: string): Promise<InstagramPublishResponse> {
    const { accountId } = this.config.instagram;

    logger.info('Publishing Instagram Reel', { accountId, containerId });

    return withRetry(
      async () => {
        try {
          const response = await this.client.post<InstagramPublishResponse>(
            `/${accountId}/media_publish`,
            null,
            {
              params: { creation_id: containerId },
            },
          );

          logger.info('Reel published successfully', {
            mediaId: response.data.id,
            containerId,
          });

          return response.data;
        } catch (error: any) {
          if (error.response?.data?.error?.message) {
            error.message = `${error.message} - Meta API Error: ${error.response.data.error.message}`;
          }
          throw error;
        }
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
        shouldRetry: this.isRetryableApiError.bind(this),
      },
    );
  }

  /**
   * Determines if an API error should trigger a retry.
   */
  private isRetryableApiError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const graphError = error.response?.data as GraphApiErrorResponse | undefined;
      const code = graphError?.error?.code;

      // Rate limit errors
      if (code === 4 || code === 17 || code === 32 || code === 613) {
        return true;
      }

      // Temporary server errors
      if (status !== undefined && status >= 500) {
        return true;
      }

      // Network errors (no response)
      if (!error.response) {
        return true;
      }

      // Don't retry on 4xx client errors (except rate limits above)
      if (status !== undefined && status >= 400 && status < 500) {
        return false;
      }
    }

    return false;
  }
}

// Singleton instance
let instagramService: InstagramService | null = null;

export function getInstagramService(): InstagramService {
  if (!instagramService) {
    instagramService = new InstagramService();
  }
  return instagramService;
}
