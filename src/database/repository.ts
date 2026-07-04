import { getDatabase } from '../config/database';
import { Prisma } from '@prisma/client';
import {
  UploadLog,
  ProcessedFile,
  UploadJob,
  UploadStatus,
  QueueStats,
} from '../types/upload.types';
import { generateId } from '../utils/helpers';

// ─── Upload Logs ──────────────────────────────────────────────────────────────

export const UploadLogModel = {
  /**
   * Creates a new upload log entry.
   */
  async create(data: Omit<UploadLog, 'id' | 'createdAt'>): Promise<UploadLog> {
    const db = getDatabase();
    const id = generateId();

    const created = await db.uploadLog.create({
      data: {
        id,
        driveFileId: data.driveFileId,
        driveFileName: data.driveFileName,
        status: data.status,
        instagramAccountId: data.instagramAccountId ?? null,
        uploadedDriveFolderId: data.uploadedDriveFolderId ?? null,
        instagramMediaId: data.instagramMediaId ?? null,
        errorMessage: data.errorMessage ?? null,
        durationMs: data.durationMs,
        queueStartTime: new Date(data.queueStartTime),
        uploadStartTime: new Date(data.uploadStartTime),
        uploadEndTime: new Date(data.uploadEndTime),
        retryCount: data.retryCount,
      },
    });

    return mapUploadLog(created);
  },

  /**
   * Updates an existing upload log.
   */
  async update(id: string, data: Partial<UploadLog>): Promise<void> {
    const db = getDatabase();

    await db.uploadLog.update({
      where: { id },
      data: {
        status: data.status,
        instagramMediaId: data.instagramMediaId ?? undefined,
        errorMessage: data.errorMessage ?? undefined,
        durationMs: data.durationMs,
      },
    });
  },

  /**
   * Returns all upload logs, newest first.
   */
  async findAll(limit = 100): Promise<UploadLog[]> {
    const db = getDatabase();
    const logs = await db.uploadLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return logs.map(mapUploadLog);
  },

  /**
   * Returns the most recent upload logs for a given Drive file ID.
   */
  async findByDriveFileId(driveFileId: string): Promise<UploadLog[]> {
    const db = getDatabase();
    const logs = await db.uploadLog.findMany({
      where: { driveFileId },
      orderBy: { createdAt: 'desc' },
    });
    return logs.map(mapUploadLog);
  },

  /**
   * Returns the count of successfully completed uploads today (UTC).
   */
  async countTodaySuccess(): Promise<number> {
    const db = getDatabase();

    // Calculate start and end of today in UTC
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );

    const count = await db.uploadLog.count({
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });
    return count;
  },

  /**
   * Returns the count of successfully completed uploads today for a specific account (UTC).
   */
  async countTodaySuccessByAccount(instagramAccountId: string): Promise<number> {
    const db = getDatabase();

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );

    const count = await db.uploadLog.count({
      where: {
        status: 'COMPLETED',
        instagramAccountId,
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });
    return count;
  },

  /**
   * Returns true if a file with the given name was already uploaded today for a given account.
   * Used to prevent re-uploading same-named videos on the same day across multiple accounts.
   */
  async wasUploadedTodayByName(
    driveFileName: string,
    instagramAccountId: string,
  ): Promise<boolean> {
    const db = getDatabase();

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );

    const count = await db.uploadLog.count({
      where: {
        status: 'COMPLETED',
        driveFileName,
        instagramAccountId,
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });
    return count > 0;
  },

  /**
   * Returns the count of upload logs matching a given status.
   */
  async countByStatus(status: UploadStatus): Promise<number> {
    const db = getDatabase();
    return db.uploadLog.count({ where: { status } });
  },
};

// ─── Processed Files ──────────────────────────────────────────────────────────

export const ProcessedFileModel = {
  /**
   * Marks a Google Drive file as processed.
   */
  async markProcessed(data: Omit<ProcessedFile, 'id' | 'processedAt'>): Promise<ProcessedFile> {
    const db = getDatabase();
    const id = generateId();

    const processed = await db.processedFile.upsert({
      where: { driveFileId: data.driveFileId },
      update: {
        driveFileName: data.driveFileName,
        instagramMediaId: data.instagramMediaId ?? null,
        processedAt: new Date(),
      },
      create: {
        id,
        driveFileId: data.driveFileId,
        driveFileName: data.driveFileName,
        instagramMediaId: data.instagramMediaId ?? null,
      },
    });

    return mapProcessedFile(processed);
  },

  /**
   * Returns true if a Drive file has already been processed.
   */
  async isProcessed(driveFileId: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db.processedFile.count({
      where: { driveFileId },
    });
    return count > 0;
  },

  /**
   * Returns all processed files, newest first.
   */
  async findAll(limit = 100): Promise<ProcessedFile[]> {
    const db = getDatabase();
    const files = await db.processedFile.findMany({
      orderBy: { processedAt: 'desc' },
      take: limit,
    });
    return files.map(mapProcessedFile);
  },
};

// ─── Upload Jobs ──────────────────────────────────────────────────────────────

export const UploadJobModel = {
  /**
   * Creates a new upload job.
   */
  async create(
    data: Omit<UploadJob, 'id' | 'createdAt' | 'updatedAt' | 'retryCount'>,
  ): Promise<UploadJob> {
    const db = getDatabase();
    const id = generateId();

    const job = await db.uploadJob.create({
      data: {
        id,
        driveFileId: data.driveFileId,
        driveFileName: data.driveFileName,
        localFilePath: data.localFilePath ?? null,
        instagramAccountId: data.instagramAccountId ?? null,
        uploadedDriveFolderId: data.uploadedDriveFolderId ?? null,
        status: data.status,
        retryCount: 0,
        instagramContainerId: data.instagramContainerId ?? null,
        instagramMediaId: data.instagramMediaId ?? null,
        errorMessage: data.errorMessage ?? null,
        errorStack: data.errorStack ?? null,
      },
    });

    return mapUploadJob(job);
  },

  /**
   * Safely creates an upload job, returning null if a job with the same driveFileId already exists.
   */
  async createSafe(
    data: Omit<UploadJob, 'id' | 'createdAt' | 'updatedAt' | 'retryCount'>,
  ): Promise<UploadJob | null> {
    try {
      const db = getDatabase();
      const id = generateId();

      const job = await db.uploadJob.create({
        data: {
          id,
          driveFileId: data.driveFileId,
          driveFileName: data.driveFileName,
          localFilePath: data.localFilePath ?? null,
          instagramAccountId: data.instagramAccountId ?? null,
          uploadedDriveFolderId: data.uploadedDriveFolderId ?? null,
          status: data.status,
          processingAt: data.processingAt ?? null,
          retryCount: 0,
          instagramContainerId: data.instagramContainerId ?? null,
          instagramMediaId: data.instagramMediaId ?? null,
          errorMessage: data.errorMessage ?? null,
          errorStack: data.errorStack ?? null,
        },
      });
      return mapUploadJob(job);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  },

  /**
   * Updates a job's status and optional fields.
   */
  async update(id: string, data: Partial<UploadJob>): Promise<void> {
    const db = getDatabase();

    await db.uploadJob.update({
      where: { id },
      data: {
        status: data.status,
        localFilePath: data.localFilePath ?? undefined,
        instagramContainerId: data.instagramContainerId ?? undefined,
        instagramMediaId: data.instagramMediaId ?? undefined,
        retryCount: data.retryCount,
        errorMessage: data.errorMessage ?? undefined,
        errorStack: data.errorStack ?? undefined,
      },
    });
  },

  /**
   * Finds a job by its ID.
   */
  async findById(id: string): Promise<UploadJob | null> {
    const db = getDatabase();
    const job = await db.uploadJob.findUnique({ where: { id } });
    return job ? mapUploadJob(job) : null;
  },

  /**
   * Returns jobs in a specific status.
   */
  async findByStatus(status: UploadStatus): Promise<UploadJob[]> {
    const db = getDatabase();
    const jobs = await db.uploadJob.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
    });
    return jobs.map(mapUploadJob);
  },

  /**
   * Returns queue statistics.
   */
  async getStats(): Promise<QueueStats> {
    const db = getDatabase();

    const [pending, processing, completed, failed, total] = await Promise.all([
      db.uploadJob.count({ where: { status: 'PENDING' } }),
      db.uploadJob.count({
        where: { status: { in: ['DOWNLOADING', 'UPLOADING', 'PROCESSING', 'PUBLISHING'] } },
      }),
      db.uploadJob.count({ where: { status: 'COMPLETED' } }),
      db.uploadJob.count({ where: { status: 'FAILED' } }),
      db.uploadJob.count(),
    ]);

    return { pending, processing, completed, failed, total };
  },

  /**
   * Checks whether a Drive file has any job record (active or failed).
   * Used to prevent re-enqueuing failed jobs infinitely.
   */
  async hasJob(driveFileId: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db.uploadJob.count({
      where: { driveFileId },
    });
    return count > 0;
  },
};

// ─── Account Health ─────────────────────────────────────────────────────────────

export const AccountHealthModel = {
  /**
   * Upserts the health record for an account. Defaults to score 100 if new.
   */
  async getOrCreate(
    instagramAccountId: string,
  ): Promise<Prisma.AccountHealthGetPayload<Prisma.AccountHealthDefaultArgs>> {
    const db = getDatabase();
    return db.accountHealth.upsert({
      where: { instagramAccountId },
      create: { instagramAccountId, healthScore: 100 },
      update: {},
    });
  },

  /**
   * Retrieves the health record. Returns null if not found.
   */
  async get(
    instagramAccountId: string,
  ): Promise<Prisma.AccountHealthGetPayload<Prisma.AccountHealthDefaultArgs> | null> {
    const db = getDatabase();
    return db.accountHealth.findUnique({
      where: { instagramAccountId },
    });
  },

  /**
   * Updates specific fields of an account's health record.
   */
  async update(
    instagramAccountId: string,
    data: Prisma.AccountHealthUpdateInput,
  ): Promise<Prisma.AccountHealthGetPayload<Prisma.AccountHealthDefaultArgs>> {
    const db = getDatabase();
    return db.accountHealth.update({
      where: { instagramAccountId },
      data,
    });
  },
};

// ─── Row Mappers ──────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUploadLog(row: any): UploadLog {
  return {
    id: row.id,
    driveFileId: row.driveFileId,
    driveFileName: row.driveFileName,
    status: row.status as UploadStatus,
    instagramAccountId: row.instagramAccountId ?? undefined,
    uploadedDriveFolderId: row.uploadedDriveFolderId ?? undefined,
    instagramMediaId: row.instagramMediaId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    durationMs: row.durationMs,
    queueStartTime: row.queueStartTime.toISOString(),
    uploadStartTime: row.uploadStartTime.toISOString(),
    uploadEndTime: row.uploadEndTime.toISOString(),
    retryCount: row.retryCount,
    createdAt: row.createdAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProcessedFile(row: any): ProcessedFile {
  return {
    id: row.id,
    driveFileId: row.driveFileId,
    driveFileName: row.driveFileName,
    instagramMediaId: row.instagramMediaId ?? undefined,
    processedAt: row.processedAt,
  };
}

function mapUploadJob(row: any): UploadJob {
  return {
    id: row.id,
    driveFileId: row.driveFileId,
    driveFileName: row.driveFileName,
    localFilePath: row.localFilePath ?? undefined,
    instagramAccountId: row.instagramAccountId ?? undefined,
    uploadedDriveFolderId: row.uploadedDriveFolderId ?? undefined,
    status: row.status as UploadStatus,
    retryCount: row.retryCount,
    instagramContainerId: row.instagramContainerId ?? undefined,
    instagramMediaId: row.instagramMediaId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    errorStack: row.errorStack ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
