import dotenv from 'dotenv';
import path from 'path';
import { Config, AccountMapping } from '../types/config.types';

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

  // Also check that either ACCOUNTS_CONFIG is set, or the legacy vars are set
  if (!process.env.ACCOUNTS_CONFIG) {
    const legacyVars = [
      'GOOGLE_DRIVE_FOLDER_ID',
      'GOOGLE_DRIVE_UPLOADED_FOLDER_ID',
      'INSTAGRAM_ACCOUNT_ID',
    ];
    const missingLegacy = legacyVars.filter((key) => !process.env[key]);
    if (missingLegacy.length > 0) {
      throw new Error(
        `Missing required environment variables:\n  - ACCOUNTS_CONFIG\nOR legacy variables:\n${missingLegacy.map((k) => `  - ${k}`).join('\n')}`,
      );
    }
  }
}

function parseAccountsConfig(): AccountMapping[] {
  const accountsStr = process.env.ACCOUNTS_CONFIG;
  if (accountsStr) {
    try {
      return JSON.parse(accountsStr) as AccountMapping[];
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse ACCOUNTS_CONFIG env variable:', e);
      // Fall through to legacy if parse fails
    }
  }

  // Fallback to legacy config
  return [
    {
      instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID ?? '',
      driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? '',
      driveUploadedFolderId: process.env.GOOGLE_DRIVE_UPLOADED_FOLDER_ID ?? '',
      isNewAccount: process.env.IS_NEW_ACCOUNT === 'true',
      warmupStartDate: process.env.WARMUP_START_DATE,
      proxyUrl: process.env.PROXY_URL,
    },
  ];
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
      dryRun: process.env.DRY_RUN === 'true',
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
      tokenExpiryDate: process.env.TOKEN_EXPIRY_DATE,
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
      dailyUploadLimit: parseInt(process.env.DAILY_UPLOAD_LIMIT ?? '0', 10), // 0 = unlimited
      largeQueueWarningThreshold: parseInt(process.env.LARGE_QUEUE_WARNING_THRESHOLD ?? '10', 10),
      targetDailyLimit: parseInt(process.env.TARGET_DAILY_LIMIT ?? '32', 10),
      defaultCooldownHours: parseInt(process.env.DEFAULT_COOLDOWN_HOURS ?? '48', 10),
      enableAdaptiveWarmup: process.env.ENABLE_ADAPTIVE_WARMUP !== 'false', // true by default
      enableHealthScoring: process.env.ENABLE_HEALTH_SCORING !== 'false', // true by default
      postingWindowStart: process.env.POSTING_WINDOW_START ?? '08:00',
      postingWindowEnd: process.env.POSTING_WINDOW_END ?? '22:00',
    },
    database: {
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
    accounts: parseAccountsConfig(),
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
