/**
 * Google Drive API type definitions
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  createdTime: string;
  modifiedTime: string;
  webContentLink?: string;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DriveDownloadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface DriveMoveResult {
  id: string;
  name: string;
  parents: string[];
}

export interface DriveListOptions {
  folderId: string;
  mimeType?: string;
  orderBy?: string;
  pageSize?: number;
}
