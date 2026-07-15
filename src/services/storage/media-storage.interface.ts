export interface IMediaStorage {
  /** Uploads a local file to storage and returns the unique object key */
  uploadFile(localFilePath: string, mimeType: string): Promise<string>;

  /** Generates a public URL (or Pre-Signed URL) for Instagram to consume */
  generateSignedUrl(objectKey: string, expiresInSeconds?: number): Promise<string>;

  /** Deletes the object from storage */
  deleteFile(objectKey: string): Promise<void>;

  /** Checks if the object exists */
  exists(objectKey: string): Promise<boolean>;

  /** Verifies connectivity and bucket access */
  healthCheck(): Promise<boolean>;
}
