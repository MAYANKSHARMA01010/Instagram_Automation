/**
 * Shared test fixtures used across all test files.
 * Provides type-safe mock objects that mirror the real data shapes.
 */
import { UploadJob, QueueStats } from '../../src/types/upload.types';
import { Config } from '../../src/types/config.types';

// ─── Mock Config ──────────────────────────────────────────────────────────────

export const mockConfig: Config = {
  app: {
    port: 3000,
    nodeEnv: 'test',
    apiKey: 'test-api-key',
    publicUrl: 'http://localhost:3000',
  },
  google: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
    driveFolderId: 'drive-folder-id',
    driveUploadedFolderId: 'drive-uploaded-folder-id',
  },
  instagram: {
    accountId: 'ig-account-123',
    facebookPageId: 'fb-page-123',
    graphApiToken: 'test-graph-token',
    graphApiVersion: 'v19.0',
    tokenExpiryDate: undefined,
  },
  content: {
    captionFile: '/tmp/test-caption.txt',
    coverImage: '',
  },
  upload: {
    maxFileSizeBytes: 1073741824,
    maxDurationSeconds: 900,
    pollingCron: '*/5 * * * *',
    maxRetryAttempts: 3,
    retryBaseDelayMs: 100, // Fast for tests
    statusPollIntervalMs: 100,
    statusPollTimeoutMs: 5000,
    uploadDelaySeconds: 0, // No delay in tests
    dailyUploadLimit: 0,
    largeQueueWarningThreshold: 10,
    targetDailyLimit: 32,
    defaultCooldownHours: 48,
    enableAdaptiveWarmup: true,
    enableHealthScoring: true,
    postingWindowStart: '00:00',
    postingWindowEnd: '23:59',
  },
  database: {
    sqlitePath: './test.db',
    databaseUrl: 'postgresql://test',
  },
  telegram: {
    botToken: 'test-bot-token',
    chatId: 'test-chat-id',
  },
  log: {
    level: 'silent',
    dir: './logs',
  },
  accounts: [
    {
      instagramAccountId: 'ig-account-123',
      driveFolderId: 'drive-folder-id',
      driveUploadedFolderId: 'drive-uploaded-folder-id',
      accountName: 'Test Account',
      isNewAccount: false,
      enableWarmup: false,
      enableAdaptiveWarmup: false,
    },
  ],
};

// ─── Mock UploadJob ───────────────────────────────────────────────────────────

export function makeMockJob(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'job-id-001',
    driveFileId: 'drive-file-001',
    driveFileName: 'test-video.mp4',
    localFilePath: '/tmp/test-video.mp4',
    status: 'PENDING',
    processingAt: null,
    retryCount: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    instagramAccountId: 'ig-account-123',
    uploadedDriveFolderId: 'drive-uploaded-folder-id',
    instagramContainerId: undefined,
    instagramMediaId: undefined,
    errorMessage: undefined,
    errorStack: undefined,
    ...overrides,
  };
}

// ─── Mock AccountHealth ───────────────────────────────────────────────────────

export function makeMockHealth(
  overrides: Partial<{
    healthScore: number;
    successfulUploads: number;
    failedUploads: number;
    restrictionCount: number;
    challengeCount: number;
    checkpointCount: number;
    retryCount: number;
    cooldownUntil: Date | null;
    lastRestrictionTime: Date | null;
    lastSuccessfulUpload: Date | null;
    lastUploadFailure: Date | null;
    lastUploadTime: Date | null;
  }> = {},
) {
  return {
    instagramAccountId: 'ig-account-123',
    healthScore: 100,
    successfulUploads: 0,
    failedUploads: 0,
    restrictionCount: 0,
    challengeCount: 0,
    checkpointCount: 0,
    retryCount: 0,
    cooldownUntil: null,
    lastRestrictionTime: null,
    lastSuccessfulUpload: null,
    lastUploadFailure: null,
    lastUploadTime: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Mock QueueStats ──────────────────────────────────────────────────────────

export const mockQueueStats: QueueStats = {
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  total: 0,
};
