import { R2StorageService } from '../../src/services/storage/r2-storage.service';
import { getConfig } from '../../src/config';
import { HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';

jest.mock('../../src/config');
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    HeadObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    GetObjectCommand: jest.fn(),
  };
});
jest.mock('@aws-sdk/lib-storage');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
  },
  createReadStream: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

describe('R2StorageService', () => {
  let service: R2StorageService;
  let mockS3ClientSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (getConfig as jest.Mock).mockReturnValue({
      app: { nodeEnv: 'test' },
      instagram: { accountId: 'test-account' },
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

    service = new R2StorageService();
    // @ts-ignore
    mockS3ClientSend = service.client.send as jest.Mock;
  });

  describe('uploadFile', () => {
    it('should upload a file and return the object key', async () => {
      (fs.promises.stat as jest.Mock).mockResolvedValue({ size: 1024 });
      (fs.createReadStream as jest.Mock).mockReturnValue('mock-stream');
      
      const mockUploadDone = jest.fn().mockResolvedValue(true);
      (Upload as unknown as jest.Mock).mockImplementation(() => ({
        done: mockUploadDone,
      }));

      const key = await service.uploadFile('/tmp/file.mp4', 'video/mp4');

      expect(fs.promises.stat).toHaveBeenCalledWith('/tmp/file.mp4');
      expect(fs.createReadStream).toHaveBeenCalledWith('/tmp/file.mp4');
      expect(Upload).toHaveBeenCalledWith(expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'test-bucket',
          ContentType: 'video/mp4',
          ContentLength: 1024,
          CacheControl: 'max-age=31536000',
        }),
      }));
      expect(mockUploadDone).toHaveBeenCalled();
      expect(key).toMatch(/^test\/\d{4}\/\d{2}\/test-account\/test-uuid\.mp4$/);
    });

    it('should throw an InfrastructureError on upload failure', async () => {
      (fs.promises.stat as jest.Mock).mockResolvedValue({ size: 1024 });
      (fs.createReadStream as jest.Mock).mockReturnValue('mock-stream');
      
      const mockUploadDone = jest.fn().mockRejectedValue(new Error('Network error'));
      (Upload as unknown as jest.Mock).mockImplementation(() => ({
        done: mockUploadDone,
      }));

      await expect(service.uploadFile('/tmp/file.mp4', 'video/mp4')).rejects.toThrow('Network error');
      
      try {
        await service.uploadFile('/tmp/file.mp4', 'video/mp4');
      } catch (e: any) {
        expect(e.isInfrastructureError).toBe(true);
      }
    });
  });

  describe('generateSignedUrl', () => {
    it('should generate a signed URL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.url');

      const url = await service.generateSignedUrl('test-key');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key',
      });
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.any(Object), { expiresIn: 3600 });
      expect(url).toBe('https://signed.url');
    });

    it('should map errors to InfrastructureError', async () => {
      (getSignedUrl as jest.Mock).mockRejectedValue(new Error('Sign error'));

      await expect(service.generateSignedUrl('test-key')).rejects.toThrow('Sign error');
      
      try {
        await service.generateSignedUrl('test-key');
      } catch (e: any) {
        expect(e.isInfrastructureError).toBe(true);
      }
    });
  });

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      mockS3ClientSend.mockResolvedValue({});

      await service.deleteFile('test-key');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key',
      });
      expect(mockS3ClientSend).toHaveBeenCalled();
    });

    it('should map errors to InfrastructureError', async () => {
      mockS3ClientSend.mockRejectedValue(new Error('Delete error'));

      await expect(service.deleteFile('test-key')).rejects.toThrow('Delete error');
    });
  });

  describe('exists', () => {
    it('should return true if file exists', async () => {
      mockS3ClientSend.mockResolvedValue({});

      const exists = await service.exists('test-key');

      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key',
      });
      expect(exists).toBe(true);
    });

    it('should return false if file does not exist (NotFound)', async () => {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      mockS3ClientSend.mockRejectedValue(error);

      const exists = await service.exists('test-key');

      expect(exists).toBe(false);
    });

    it('should return false if file does not exist (404)', async () => {
      const error: any = new Error('HttpError');
      error.$metadata = { httpStatusCode: 404 };
      mockS3ClientSend.mockRejectedValue(error);

      const exists = await service.exists('test-key');

      expect(exists).toBe(false);
    });

    it('should map other errors to InfrastructureError', async () => {
      mockS3ClientSend.mockRejectedValue(new Error('Other error'));

      await expect(service.exists('test-key')).rejects.toThrow('Other error');
    });
  });

  describe('healthCheck', () => {
    it('should return true if healthy', async () => {
      mockS3ClientSend.mockResolvedValue({});

      const healthy = await service.healthCheck();

      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        MaxKeys: 1,
      });
      expect(healthy).toBe(true);
    });

    it('should return false if unhealthy', async () => {
      mockS3ClientSend.mockRejectedValue(new Error('Network error'));

      const healthy = await service.healthCheck();

      expect(healthy).toBe(false);
    });
  });
});
