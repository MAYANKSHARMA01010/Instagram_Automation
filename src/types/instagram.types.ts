/**
 * Instagram / Meta Graph API type definitions
 */

export interface InstagramContainerCreateParams {
  mediaType: 'REELS';
  videoUrl: string;
  caption: string;
  coverUrl?: string;
  shareToFeed?: boolean;
}

export interface InstagramContainerCreateResponse {
  id: string;
}

export interface InstagramContainerStatus {
  id: string;
  status: InstagramStatusCode;
  errorCode?: number;
  errorMessage?: string;
}

export type InstagramStatusCode = 'IN_PROGRESS' | 'FINISHED' | 'PUBLISHED' | 'ERROR' | 'EXPIRED';

export interface InstagramPublishParams {
  creationId: string;
}

export interface InstagramPublishResponse {
  id: string;
}

export interface InstagramMediaInsights {
  id: string;
  timestamp: string;
  permalink?: string;
}

export interface InstagramTokenInfo {
  appId: string;
  type: string;
  expiresAt: number;
  isValid: boolean;
}

export interface GraphApiErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtraceId: string;
  };
}
