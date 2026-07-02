import { AccountHealthModel } from '../database/repository';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { getNotificationService } from './notification.service';
import { getConfig } from '../config';

export interface HealthState {
  healthScore: number;
  successfulUploads: number;
  failedUploads: number;
  restrictionCount: number;
  challengeCount: number;
  checkpointCount: number;
  retryCount: number;
  lastRestrictionTime?: Date | null;
  cooldownUntil?: Date | null;
  lastSuccessfulUpload?: Date | null;
  lastUploadFailure?: Date | null;
  lastUploadTime?: Date | null;
}

export type HealthBand = 'Excellent' | 'Healthy' | 'Caution' | 'Danger' | 'Critical';

export class HealthService {
  private readonly config = getConfig();

  /**
   * Retrieves the current health state for an account, initializing it if it doesn't exist.
   */
  async getHealth(accountId: string): Promise<HealthState> {
    const record = await AccountHealthModel.getOrCreate(accountId);
    return record as HealthState;
  }

  /**
   * Returns the qualitative health band based on the score.
   */
  getHealthBand(score: number): HealthBand {
    if (score >= 95) return 'Excellent';
    if (score >= 80) return 'Healthy';
    if (score >= 60) return 'Caution';
    if (score >= 40) return 'Danger';
    return 'Critical';
  }

  /**
   * Records a successful upload, marginally improving the health score.
   */
  async recordSuccess(accountId: string): Promise<void> {
    if (!this.config.upload.enableHealthScoring) return;

    const health = await this.getHealth(accountId);

    // Only increase score once every 5 successes
    const newSuccessfulUploads = health.successfulUploads + 1;
    let newScore = health.healthScore;
    if (newSuccessfulUploads % 5 === 0) {
      newScore = Math.min(100, health.healthScore + 1);
    }

    await AccountHealthModel.update(accountId, {
      healthScore: newScore,
      successfulUploads: newSuccessfulUploads,
      lastSuccessfulUpload: new Date(),
      lastUploadTime: new Date(),
    });

    // Notify if we recovered a band
    if (this.getHealthBand(health.healthScore) !== this.getHealthBand(newScore)) {
      await this.notifyBandChange(accountId, health.healthScore, newScore);
    }
  }

  /**
   * Records a failure, parsing the errorMessage to penalize the score.
   */
  async recordFailure(accountId: string, errorMessage: string): Promise<void> {
    if (!this.config.upload.enableHealthScoring) return;

    const health = await this.getHealth(accountId);
    const msg = errorMessage.toLowerCase();

    let penalty = 0; // Default: No penalty for random infra/network errors
    let isRestriction = false;

    if (msg.includes('checkpoint_required')) {
      penalty = 30;
      isRestriction = true;
    } else if (
      msg.includes('action_blocked') ||
      msg.includes('action blocked') ||
      msg.includes('not permitted')
    ) {
      penalty = 40;
      isRestriction = true;
    } else if (msg.includes('challenge_required')) {
      penalty = 25;
      isRestriction = true;
    } else if (msg.includes('feedback_required')) {
      penalty = 15;
    } else if (
      msg.includes('login_required') ||
      msg.includes('auth error') ||
      msg.includes('session_expired')
    ) {
      penalty = 20;
    }

    const newScore = Math.max(0, health.healthScore - penalty);

    const updateData: Prisma.AccountHealthUpdateInput = {
      healthScore: newScore,
      failedUploads: health.failedUploads + 1,
      lastUploadFailure: new Date(),
      lastUploadTime: new Date(),
    };

    if (isRestriction) {
      updateData.restrictionCount = health.restrictionCount + 1;
      updateData.lastRestrictionTime = new Date();
      logger.warn('Platform restriction detected', { accountId, errorMessage, newScore });
      await getNotificationService().notifyRestrictionDetected(accountId, errorMessage);
    }

    // Trigger cooldown if critical
    if (newScore < 40 && (!health.cooldownUntil || health.cooldownUntil < new Date())) {
      // Find the account mapping to get specific cooldown hours, else fallback to default
      const accountConfig = this.config.accounts.find((a) => a.instagramAccountId === accountId);
      const cooldownHours = accountConfig?.cooldownHours ?? this.config.upload.defaultCooldownHours;
      const cooldownDate = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);
      updateData.cooldownUntil = cooldownDate;

      logger.error('Account health critical, entering cooldown', {
        accountId,
        newScore,
        cooldownDate,
      });
      await getNotificationService().notifyCooldownStarted(accountId, cooldownHours, newScore);
    }

    await AccountHealthModel.update(accountId, updateData);

    // Notify if degraded
    if (this.getHealthBand(health.healthScore) !== this.getHealthBand(newScore)) {
      await this.notifyBandChange(accountId, health.healthScore, newScore);
    }
  }

  /**
   * Checks if an account is currently in cooldown.
   * Also resets the cooldown field if it has expired, triggering a notification.
   */
  async checkCooldown(accountId: string): Promise<boolean> {
    const health = await this.getHealth(accountId);

    if (health.cooldownUntil) {
      if (health.cooldownUntil > new Date()) {
        return true; // Still in cooldown
      } else {
        // Cooldown just expired
        await AccountHealthModel.update(accountId, { cooldownUntil: null });
        logger.info('Account cooldown expired', { accountId });
        await getNotificationService().notifyCooldownEnded(accountId, health.healthScore);
        return false;
      }
    }
    return false;
  }

  private async notifyBandChange(
    accountId: string,
    oldScore: number,
    newScore: number,
  ): Promise<void> {
    const oldBand = this.getHealthBand(oldScore);
    const newBand = this.getHealthBand(newScore);

    if (newScore < oldScore) {
      await getNotificationService().notifyHealthDegraded(accountId, oldBand, newBand, newScore);
    } else {
      await getNotificationService().notifyHealthRecovered(accountId, oldBand, newBand, newScore);
    }
  }
}

// Singleton
let healthService: HealthService | null = null;
export function getHealthService(): HealthService {
  if (!healthService) {
    healthService = new HealthService();
  }
  return healthService;
}
