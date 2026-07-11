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
import { sanitizeError } from '../utils/error-sanitizer';
import { AccountNetworkContext } from '../types/network.types';
import { buildRequestConfig } from '../utils/proxy-agent';

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
      const params = (config.params || {}) as Record<string, unknown>;
      config.params = {
        ...params,
        access_token: this.config.instagram.graphApiToken,
      };
      return config;
    });

    // Log API errors and sanitize them before they propagate
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
        
        // Layer 1: Sanitize at the network boundary
        const safeError = sanitizeError(error);
        return Promise.reject(safeError);
      },
    );
  }

  /**
   * Creates a media container for a Reel.
   * The video must be publicly accessible via a URL.
   *
   * @param context - Network context including account ID and proxy configuration
   * @param videoUrl - Publicly accessible URL to the video file
   * @param caption - Caption text for the Reel
   * @param coverUrl - Optional cover image URL
   */
  async createReelContainer(
    context: AccountNetworkContext,
    videoUrl: string,
    caption: string,
    coverUrl?: string,
  ): Promise<InstagramContainerCreateResponse> {
    logger.info('Creating Instagram Reel container', {
      accountId: context.accountId,
      hasCaption: !!caption,
      hasCoverUrl: !!coverUrl,
    });

    const params: Record<string, string | boolean> = {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: true,
    };

    if (coverUrl) {
      params['cover_url'] = coverUrl;
    }

    return withRetry(
      async () => {
        try {
          const requestConfig = {
            params,
            ...buildRequestConfig(context),
          };
          
          const response = await this.client.post<InstagramContainerCreateResponse>(
            `/${context.accountId}/media`,
            null,
            requestConfig,
          );

          logger.info('Reel container created', { containerId: response.data.id });
          return response.data;
        } catch (err: unknown) {
          let errorToThrow = err as any;
          if (errorToThrow.response?.data?.error?.message) {
            errorToThrow.message = `${errorToThrow.message} - Meta API Error: ${errorToThrow.response.data.error.message}`;
          }
          throw sanitizeError(errorToThrow);
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
  async getContainerStatus(context: AccountNetworkContext, containerId: string): Promise<InstagramContainerStatus> {
    const requestConfig = {
      params: {
        fields: 'id,status_code',
      },
      ...buildRequestConfig(context),
    };

    const response = await this.client.get<InstagramContainerStatus>(`/${containerId}`, requestConfig);

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
  async waitForContainerReady(context: AccountNetworkContext, containerId: string): Promise<void> {
    logger.info('Waiting for container to be ready', { containerId });

    let lastStatus: InstagramStatusCode = 'IN_PROGRESS';

    await pollUntil(
      async () => {
        const status = await this.getContainerStatus(context, containerId);
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
  async publishReel(context: AccountNetworkContext, containerId: string): Promise<InstagramPublishResponse> {
    logger.info('Publishing Instagram Reel', { accountId: context.accountId, containerId });

    return withRetry(
      async () => {
        try {
          const requestConfig = {
            params: { creation_id: containerId },
            ...buildRequestConfig(context),
          };

          const response = await this.client.post<InstagramPublishResponse>(
            `/${context.accountId}/media_publish`,
            null,
            requestConfig,
          );

          logger.info('Reel published successfully', {
            mediaId: response.data.id,
            containerId,
          });

          return response.data;
        } catch (err: unknown) {
          let errorToThrow = err as any;
          if (errorToThrow.response?.data?.error?.message) {
            errorToThrow.message = `${errorToThrow.message} - Meta API Error: ${errorToThrow.response.data.error.message}`;
          }
          throw sanitizeError(errorToThrow);
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
