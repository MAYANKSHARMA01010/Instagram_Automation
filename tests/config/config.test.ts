/**
 * Unit tests for config/index.ts
 *
 * Tests: validateConfig (missing required vars, ACCOUNTS_CONFIG vs legacy),
 *        loadConfig (correct parsing of env vars, parseInt defaults,
 *        parseAccountsConfig JSON/legacy/invalid JSON fallback).
 *
 * NOTE: Each test completely overrides process.env to avoid contamination
 * from the local .env file (which dotenv.config() loads at module import).
 */

// Mock dotenv so the .env file on disk never loads during tests
jest.mock('dotenv', () => ({ config: jest.fn() }));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateConfig()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    process.env = {}; // Clean slate for each test
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function withRequiredVars(extra: Record<string, string> = {}) {
    return {
      GOOGLE_CLIENT_ID: 'gcid',
      GOOGLE_CLIENT_SECRET: 'gcsecret',
      GOOGLE_REFRESH_TOKEN: 'grt',
      GRAPH_API_TOKEN: 'gat',
      API_KEY: 'apikey',
      PUBLIC_URL: 'https://example.com',
      INSTAGRAM_ACCOUNT_ID: 'ig123',
      GOOGLE_DRIVE_FOLDER_ID: 'folder123',
      GOOGLE_DRIVE_UPLOADED_FOLDER_ID: 'uploaded123',
      ...extra,
    };
  }

  it('should not throw when all required environment variables are set', () => {
    process.env = withRequiredVars();
    const { validateConfig } = require('../../src/config') as typeof import('../../src/config');
    expect(() => validateConfig()).not.toThrow();
  });

  it('should throw when required variables are missing', () => {
    process.env = {};
    const { validateConfig } = require('../../src/config') as typeof import('../../src/config');
    expect(() => validateConfig()).toThrow('Missing required environment variables');
  });

  it('should include missing var names in the error message', () => {
    process.env = {};
    const { validateConfig } = require('../../src/config') as typeof import('../../src/config');
    let msg = '';
    try {
      validateConfig();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('GOOGLE_CLIENT_ID');
    expect(msg).toContain('GRAPH_API_TOKEN');
    expect(msg).toContain('API_KEY');
  });

  it('should accept ACCOUNTS_CONFIG as the multi-account alternative', () => {
    process.env = {
      GOOGLE_CLIENT_ID: 'gcid',
      GOOGLE_CLIENT_SECRET: 'gcsecret',
      GOOGLE_REFRESH_TOKEN: 'grt',
      GRAPH_API_TOKEN: 'gat',
      API_KEY: 'apikey',
      PUBLIC_URL: 'https://example.com',
      ACCOUNTS_CONFIG: JSON.stringify([
        { instagramAccountId: 'ig1', driveFolderId: 'f1', driveUploadedFolderId: 'uf1' },
      ]),
    };
    const { validateConfig } = require('../../src/config') as typeof import('../../src/config');
    expect(() => validateConfig()).not.toThrow();
  });
});

describe('loadConfig()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    process.env = {};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const baseEnv = {
    GOOGLE_CLIENT_ID: 'gcid',
    GOOGLE_CLIENT_SECRET: 'gcs',
    GOOGLE_REFRESH_TOKEN: 'grt',
    GRAPH_API_TOKEN: 'gat',
    API_KEY: 'ak',
    PUBLIC_URL: 'https://example.com',
    INSTAGRAM_ACCOUNT_ID: 'ig123',
    GOOGLE_DRIVE_FOLDER_ID: 'f1',
    GOOGLE_DRIVE_UPLOADED_FOLDER_ID: 'uf1',
  };

  it('should parse integer env vars correctly when explicitly set', () => {
    process.env = {
      ...baseEnv,
      PORT: '4000',
      DAILY_UPLOAD_LIMIT: '10',
      MAX_RETRY_ATTEMPTS: '5',
    };
    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    expect(config.app.port).toBe(4000);
    expect(config.upload.dailyUploadLimit).toBe(10);
    expect(config.upload.maxRetryAttempts).toBe(5);
  });

  it('should use safe defaults when optional vars are absent', () => {
    process.env = { ...baseEnv };
    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    expect(config.app.port).toBe(3000); // default port
    expect(config.upload.dailyUploadLimit).toBe(0); // 0 = unlimited
    expect(config.upload.maxRetryAttempts).toBe(3);
    expect(config.upload.targetDailyLimit).toBe(32);
    expect(config.upload.enableHealthScoring).toBe(true);
    expect(config.upload.enableAdaptiveWarmup).toBe(true);
    expect(config.upload.pollingCron).toBe('*/5 * * * *');
  });
});

describe('parseAccountsConfig() (via loadConfig)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    process.env = {};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const baseEnv = {
    GOOGLE_CLIENT_ID: 'gcid',
    GOOGLE_CLIENT_SECRET: 'gcs',
    GOOGLE_REFRESH_TOKEN: 'grt',
    GRAPH_API_TOKEN: 'gat',
    API_KEY: 'ak',
    PUBLIC_URL: 'https://example.com',
    INSTAGRAM_ACCOUNT_ID: 'ig-legacy',
    GOOGLE_DRIVE_FOLDER_ID: 'folder-legacy',
    GOOGLE_DRIVE_UPLOADED_FOLDER_ID: 'uploaded-legacy',
  };

  it('should parse ACCOUNTS_CONFIG JSON and return multiple accounts', () => {
    process.env = {
      ...baseEnv,
      ACCOUNTS_CONFIG: JSON.stringify([
        {
          instagramAccountId: 'ig-json-1',
          driveFolderId: 'folder-1',
          driveUploadedFolderId: 'uploaded-1',
          accountName: 'JSON Account 1',
        },
      ]),
    };

    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].instagramAccountId).toBe('ig-json-1');
    expect(config.accounts[0].accountName).toBe('JSON Account 1');
  });

  it('should fall back to legacy vars when ACCOUNTS_CONFIG is absent', () => {
    process.env = { ...baseEnv };

    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    expect(config.accounts[0].instagramAccountId).toBe('ig-legacy');
    expect(config.accounts[0].driveFolderId).toBe('folder-legacy');
  });

  it('should fall back to legacy when ACCOUNTS_CONFIG is invalid JSON', () => {
    process.env = {
      ...baseEnv,
      ACCOUNTS_CONFIG: 'NOT_VALID_JSON',
    };

    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    // Should fall back to legacy
    expect(config.accounts[0].instagramAccountId).toBe('ig-legacy');
  });

  it('should parse isNewAccount from legacy env as boolean', () => {
    process.env = {
      ...baseEnv,
      IS_NEW_ACCOUNT: 'true',
      WARMUP_START_DATE: '2024-01-15',
    };

    const { loadConfig } = require('../../src/config') as typeof import('../../src/config');
    const config = loadConfig();

    expect(config.accounts[0].isNewAccount).toBe(true);
    expect(config.accounts[0].warmupStartDate).toBe('2024-01-15');
  });
});
