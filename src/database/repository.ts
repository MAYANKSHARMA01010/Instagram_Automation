import { getDatabase } from '../config/database';
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

// ─── Row Mappers ──────────────────────────────────────────────────────────────

function mapUploadLog(row: any): UploadLog {
  return {
    id: row.id,
    driveFileId: row.driveFileId,
    driveFileName: row.driveFileName,
    status: row.status as UploadStatus,
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
