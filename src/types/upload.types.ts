/**
 * Upload job and log type definitions
 */

export type UploadStatus =
  | 'PENDING'
  | 'DOWNLOADING'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'PUBLISHING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface UploadJob {
  id: string;
  driveFileId: string;
  driveFileName: string;
  localFilePath?: string;
  status: UploadStatus;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  instagramContainerId?: string;
  instagramMediaId?: string;
  errorMessage?: string;
  errorStack?: string;
}

export interface UploadLog {
  id: string;
  driveFileId: string;
  driveFileName: string;
  status: UploadStatus;
  instagramMediaId?: string;
  errorMessage?: string;
  durationMs: number;
  queueStartTime: string; // ISO — when the batch/job was enqueued
  uploadStartTime: string; // ISO — when processing began
  uploadEndTime: string; // ISO — when processing finished
  retryCount: number;
  createdAt: Date;
}

export interface ProcessedFile {
  id: string;
  driveFileId: string;
  driveFileName: string;
  processedAt: Date;
  instagramMediaId?: string;
}

export interface UploadTriggerRequest {
  driveFileId?: string;
  force?: boolean;
}

export interface UploadStatusResponse {
  jobId: string;
  status: UploadStatus;
  driveFileName: string;
  instagramMediaId?: string;
  errorMessage?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FileValidationOptions {
  filePath: string;
  mimeType: string;
  fileSize: number;
}

export interface BatchSummary {
  totalFound: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  totalProcessingMs: number;
}
