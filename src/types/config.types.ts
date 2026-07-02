/**
 * Configuration types for the Instagram Reels Uploader
 */

export interface AppConfig {
  port: number;
  nodeEnv: string;
  apiKey: string;
  publicUrl: string;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  driveFolderId: string;
  driveUploadedFolderId: string;
}

export interface InstagramConfig {
  accountId: string;
  facebookPageId: string;
  graphApiToken: string;
  graphApiVersion: string;
  /** ISO date string (YYYY-MM-DD) of when the Graph API token expires */
  tokenExpiryDate?: string;
}

export interface ContentConfig {
  captionFile: string;
  coverImage: string;
}

export interface UploadConfig {
  maxFileSizeBytes: number;
  maxDurationSeconds: number;
  pollingCron: string;
  maxRetryAttempts: number;
  retryBaseDelayMs: number;
  statusPollIntervalMs: number;
  statusPollTimeoutMs: number;
  /** Seconds to wait between sequential uploads (default: 120) */
  uploadDelaySeconds: number;
  /** Max uploads per day across all accounts. 0 = unlimited */
  dailyUploadLimit: number;
  /** Send a Telegram warning if queue grows beyond this size */
  largeQueueWarningThreshold: number;
}

export interface DatabaseConfig {
  sqlitePath: string;
  databaseUrl?: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface LogConfig {
  level: string;
  dir: string;
}

export interface AccountMapping {
  instagramAccountId: string;
  driveFolderId: string;
  driveUploadedFolderId: string;
  accountName?: string;
  telegramThreadId?: string;
}

export interface Config {
  app: AppConfig;
  google: GoogleConfig;
  instagram: InstagramConfig;
  content: ContentConfig;
  upload: UploadConfig;
  database: DatabaseConfig;
  telegram: TelegramConfig;
  log: LogConfig;
  accounts: AccountMapping[];
}
