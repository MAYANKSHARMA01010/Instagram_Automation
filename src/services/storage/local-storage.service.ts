import { IMediaStorage } from './media-storage.interface';
import { getConfig } from '../../config';
import fs from 'fs';

/**
 * Local implementation of IMediaStorage.
 * Serves files via the Express /public/tmp route.
 */
export class LocalStorageService implements IMediaStorage {
  // eslint-disable-next-line @typescript-eslint/require-await
  async uploadFile(localFilePath: string, _mimeType: string): Promise<string> {
    // For local storage, the object key is just the filename
    return localFilePath.split('/').pop() ?? 'video.mp4';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateSignedUrl(objectKey: string, _expiresInSeconds?: number): Promise<string> {
    const config = getConfig();
    const host = process.env.PUBLIC_URL ?? `http://localhost:${config.app.port}`;
    return `${host}/public/tmp/${objectKey}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteFile(_objectKey: string): Promise<void> {
    // Handled by the upload worker's finally block which deletes the local temp file directly
    // based on localFilePath, so this is a no-op for LocalStorageService.
    return Promise.resolve();
  }

  async exists(objectKey: string): Promise<boolean> {
    const filePath = `/tmp/${objectKey}`; // Assuming /tmp based on our download logic
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async healthCheck(): Promise<boolean> {
    return true; // Local storage is always "healthy" if the process is running
  }
}
