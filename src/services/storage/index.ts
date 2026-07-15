import { IMediaStorage } from './media-storage.interface';
import { LocalStorageService } from './local-storage.service';
import { R2StorageService } from './r2-storage.service';
import { getConfig } from '../../config';
import logger from '../../utils/logger';

let storageServiceInstance: IMediaStorage | null = null;
let isStorageHealthy = true;

/**
 * Returns the singleton storage service implementation based on the STORAGE_PROVIDER configuration.
 */
export function getStorageService(): IMediaStorage {
  if (!storageServiceInstance) {
    const config = getConfig();
    if (config.storage.provider === 'r2') {
      storageServiceInstance = new R2StorageService();
      logger.info('Initialized R2 Storage Provider');
    } else {
      storageServiceInstance = new LocalStorageService();
      logger.info('Initialized Local Storage Provider');
    }
  }
  return storageServiceInstance;
}

export function setStorageHealthy(status: boolean) {
  isStorageHealthy = status;
}

export function getStorageHealth(): boolean {
  return isStorageHealthy;
}

/** @internal For testing only */
export function _resetStorageServiceInstance() {
  storageServiceInstance = null;
}

export * from './media-storage.interface';
