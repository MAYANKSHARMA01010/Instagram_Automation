import dotenv from 'dotenv';
import path from 'path';
import { Config } from '../types/config.types';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * List of required environment variables. The application will not start
 * if any of these are missing.
 */
const REQUIRED_VARS: string[] = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_UPLOADED_FOLDER_ID',
  'INSTAGRAM_ACCOUNT_ID',
  'GRAPH_API_TOKEN',
  'API_KEY',
  'PUBLIC_URL',
];

/**
 * Validates that all required environment variables are set.
 * Throws an error listing all missing variables if any are absent.
 */
export function validateConfig(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nSee .env.example for reference.`,
    );
  }
}

/**
 * Loads and returns the full application configuration from environment variables.
 * Call validateConfig() before this to ensure all required vars are present.
 */
export function loadConfig(): Config {
  return {
    app: {
      port: parseInt(process.env.PORT ?? '3000', 10),
      nodeEnv: process.env.NODE_ENV ?? 'development',
      apiKey: process.env.API_KEY ?? '',
      publicUrl: process.env.PUBLIC_URL ?? '',
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? '',
      driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? '',
      driveUploadedFolderId: process.env.GOOGLE_DRIVE_UPLOADED_FOLDER_ID ?? '',
    },
    instagram: {
      accountId: process.env.INSTAGRAM_ACCOUNT_ID ?? '',
      facebookPageId: process.env.FACEBOOK_PAGE_ID ?? '',
      graphApiToken: process.env.GRAPH_API_TOKEN ?? '',
      graphApiVersion: process.env.GRAPH_API_VERSION ?? 'v19.0',
    },
    content: {
      captionFile: path.resolve(process.cwd(), process.env.CAPTION_FILE ?? './caption.txt'),
      coverImage: process.env.COVER_IMAGE
        ? path.resolve(process.cwd(), process.env.COVER_IMAGE)
        : '',
    },
    upload: {
      maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES ?? '1073741824', 10),
      maxDurationSeconds: parseInt(process.env.MAX_DURATION_SECONDS ?? '900', 10),
      pollingCron: process.env.POLLING_CRON ?? '*/5 * * * *',
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS ?? '3', 10),
      retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS ?? '5000', 10),
      statusPollIntervalMs: parseInt(process.env.STATUS_POLL_INTERVAL_MS ?? '15000', 10),
      statusPollTimeoutMs: parseInt(process.env.STATUS_POLL_TIMEOUT_MS ?? '1800000', 10),
      uploadDelaySeconds: parseInt(process.env.UPLOAD_DELAY_SECONDS ?? '120', 10),
    },
    database: {
      sqlitePath: path.resolve(process.cwd(), process.env.SQLITE_PATH ?? './database/uploads.db'),
      databaseUrl: process.env.DATABASE_URL,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
    log: {
      level: process.env.LOG_LEVEL ?? 'info',
      dir: path.resolve(process.cwd(), process.env.LOG_DIR ?? './logs'),
    },
  };
}

// Singleton config instance
let _config: Config | null = null;

/**
 * Returns the singleton configuration instance.
 * Validates and loads config on first access.
 */
export function getConfig(): Config {
  if (!_config) {
    validateConfig();
    _config = loadConfig();
  }
  return _config;
}

export default getConfig;
