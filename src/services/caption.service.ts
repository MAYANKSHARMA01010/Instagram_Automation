import fs from 'fs';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * Service for reading and caching the Reel caption from the configured file.
 * The caption is read once and cached for subsequent calls.
 */
export class CaptionService {
  private cachedCaption: string | null = null;
  private lastReadAt: Date | null = null;
  private readonly CACHE_TTL_MS = 60_000; // Re-read caption every 60 seconds

  /**
   * Returns the current caption, reading from disk if the cache is stale.
   */
  getCaption(): string {
    const config = getConfig();
    const captionFile = config.content.captionFile;

    const now = new Date();
    const isStale =
      !this.lastReadAt || now.getTime() - this.lastReadAt.getTime() > this.CACHE_TTL_MS;

    if (!this.cachedCaption || isStale) {
      this.cachedCaption = this.readFromFile(captionFile);
      this.lastReadAt = now;
    }

    return this.cachedCaption;
  }

  /**
   * Reads the caption file from disk.
   */
  private readFromFile(captionFile: string): string {
    if (!fs.existsSync(captionFile)) {
      throw new Error(
        `Caption file not found: ${captionFile}\n` +
          `Please create the file and add your caption text.\n` +
          `See CAPTION_FILE in .env`,
      );
    }

    const content = fs.readFileSync(captionFile, 'utf-8').trim();

    if (!content) {
      throw new Error(`Caption file is empty: ${captionFile}`);
    }

    if (content.length > 2200) {
      logger.warn('Caption exceeds Instagram 2200 character limit', {
        captionFile,
        length: content.length,
      });
    }

    logger.debug('Caption loaded from file', {
      captionFile,
      length: content.length,
    });

    return content;
  }

  /**
   * Forces a cache refresh by clearing the cached caption.
   */
  invalidateCache(): void {
    this.cachedCaption = null;
    this.lastReadAt = null;
  }
}

// Singleton
let captionService: CaptionService | null = null;

export function getCaptionService(): CaptionService {
  if (!captionService) {
    captionService = new CaptionService();
  }
  return captionService;
}
