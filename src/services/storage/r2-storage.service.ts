import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { IMediaStorage } from './media-storage.interface';
import { getConfig } from '../../config';

function mapToInfrastructureError(error: unknown): never {
  const err = error instanceof Error ? error : new Error(String(error));
  (err as any).isInfrastructureError = true;
  throw err;
}

/**
 * Cloudflare R2 implementation of IMediaStorage.
 */
export class R2StorageService implements IMediaStorage {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    const config = getConfig();
    const r2Config = config.storage.r2;

    if (!r2Config) {
      throw new Error('R2StorageService initialized but R2 configuration is missing.');
    }

    this.bucketName = r2Config.bucketName;

    // Configure AWS SDK v3 for Cloudflare R2
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
    });
  }

  async uploadFile(localFilePath: string, mimeType: string): Promise<string> {
    try {
      const config = getConfig();
      const accountId = config.instagram.accountId || 'unknown-account';
      const now = new Date();
      const year = now.getUTCFullYear().toString();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const env = config.app.nodeEnv;

      const objectKey = `${env}/${year}/${month}/${accountId}/${uuidv4()}.mp4`;

      const stats = await fs.promises.stat(localFilePath);
      const fileStream = fs.createReadStream(localFilePath);

      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucketName,
          Key: objectKey,
          Body: fileStream,
          ContentType: mimeType,
          ContentLength: stats.size,
          CacheControl: 'max-age=31536000',
        },
      });

      await upload.done();
      return objectKey;
    } catch (error) {
      mapToInfrastructureError(error);
    }
  }

  async generateSignedUrl(objectKey: string, expiresInSeconds: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });

      return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    } catch (error) {
      mapToInfrastructureError(error);
    }
  }

  async deleteFile(objectKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      await this.client.send(command);
    } catch (error) {
      mapToInfrastructureError(error);
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      mapToInfrastructureError(error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 1,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }
}
