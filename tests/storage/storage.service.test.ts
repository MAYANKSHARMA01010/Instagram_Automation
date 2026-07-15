import { LocalStorageService } from '../../src/services/storage/local-storage.service';
import { R2StorageService } from '../../src/services/storage/r2-storage.service';
import { getConfig } from '../../src/config';

jest.mock('../../src/config', () => ({
  getConfig: jest.fn(),
  validateConfig: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  ListObjectsV2Command: jest.fn(),
}));

describe('Storage Service Factory & Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { _resetStorageServiceInstance } = require('../../src/services/storage');
    _resetStorageServiceInstance();
  });

  describe('Configuration Validation', () => {
    it('should initialize LocalStorageService when provider is local', () => {
      (getConfig as jest.Mock).mockReturnValue({
        storage: { provider: 'local' },
      });

      // Require dynamically to avoid caching issues with singletons in tests
      const { getStorageService } = require('../../src/services/storage');

      const service = getStorageService();

      expect(service).toBeInstanceOf(LocalStorageService);
    });

    it('should initialize R2StorageService when provider is r2 and config is valid', () => {
      (getConfig as jest.Mock).mockReturnValue({
        storage: {
          provider: 'r2',
          r2: {
            accountId: 'test-id',
            accessKeyId: 'test-access',
            secretAccessKey: 'test-secret',
            bucketName: 'test-bucket',
          },
        },
      });

      const { getStorageService } = require('../../src/services/storage');
      const service = getStorageService();

      expect(service).toBeInstanceOf(R2StorageService);
    });

    it('should throw an error if R2StorageService is initialized without config', () => {
      (getConfig as jest.Mock).mockReturnValue({
        storage: {
          provider: 'r2',
          // r2 config missing
        },
      });

      expect(() => {
        new R2StorageService();
      }).toThrow('R2StorageService initialized but R2 configuration is missing.');
    });
  });

  describe('HealthCheck Mocking', () => {
    it('LocalStorageService should always be healthy', async () => {
      const service = new LocalStorageService();
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });

    it('R2StorageService healthCheck should return true for skeleton MVP', async () => {
      (getConfig as jest.Mock).mockReturnValue({
        storage: {
          provider: 'r2',
          r2: {
            accountId: 'test-id',
            accessKeyId: 'test-access',
            secretAccessKey: 'test-secret',
            bucketName: 'test-bucket',
          },
        },
      });

      const service = new R2StorageService();
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('Startup Validation State', () => {
    it('should update storage health state correctly', () => {
      const { setStorageHealthy, getStorageHealth } = require('../../src/services/storage');

      setStorageHealthy(false);
      expect(getStorageHealth()).toBe(false);

      setStorageHealthy(true);
      expect(getStorageHealth()).toBe(true);
    });
  });
});
