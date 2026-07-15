/**
 * Integration tests for UploadQueue
 *
 * Tests: DB integration for enqueueing and dequeueing.
 */
import { UploadQueue } from '../../src/queue/upload.queue';
import { UploadJobModel, ProcessedFileModel } from '../../src/database/repository';
import { getDatabase } from '../../src/config/database';

jest.mock('../../src/config/database', () => {
  const db: any[] = [];
  const processed: any[] = [];
  return {
    getDatabase: jest.fn(() => ({
      uploadJob: {
        deleteMany: jest.fn().mockImplementation(() => {
          db.length = 0;
          return Promise.resolve();
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const job = { ...data, id: 'mock-id-' + db.length, createdAt: new Date() };
          db.push(job);
          return Promise.resolve(job);
        }),
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.status) return Promise.resolve(db.filter((j) => j.status === where.status));
          return Promise.resolve(db);
        }),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(db.find((j) => j.id === where.id) || null);
        }),
        count: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(db.filter((j) => j.status === (where?.status || j.status)).length);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const idx = db.findIndex((j) => j.id === where.id);
          if (idx !== -1) {
            db[idx] = { ...db[idx], ...data };
            return Promise.resolve(db[idx]);
          }
          return Promise.reject(new Error('Not found'));
        }),
      },
      processedFile: {
        deleteMany: jest.fn().mockImplementation(() => {
          processed.length = 0;
          return Promise.resolve();
        }),
        count: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(
            processed.filter((p) => p.driveFileId === where.driveFileId).length,
          );
        }),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(
            processed.find((p) => p.driveFileId === where.driveFileId) || null,
          );
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          processed.push(data);
          return Promise.resolve(data);
        }),
        upsert: jest.fn().mockImplementation(({ where, create, update }: any) => {
          const idx = processed.findIndex((p) => p.driveFileId === where.driveFileId);
          if (idx !== -1) {
            processed[idx] = { ...processed[idx], ...update };
            return Promise.resolve(processed[idx]);
          }
          processed.push(create);
          return Promise.resolve(create);
        }),
      },
      accountHealth: {
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({ instagramAccountId: where.instagramAccountId, healthScore: 100 })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
      $disconnect: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('UploadQueue (Integration)', () => {
  let queue: UploadQueue;

  beforeAll(async () => {
    queue = new UploadQueue();
    // Clear relevant tables before tests
    await getDatabase().uploadJob.deleteMany({});
    await getDatabase().processedFile.deleteMany({});
  });

  afterEach(async () => {
    // Clear after each test
    await getDatabase().uploadJob.deleteMany({});
    await getDatabase().processedFile.deleteMany({});
  });

  afterAll(async () => {
    await getDatabase().$disconnect();
  });

  it('should enqueue a new job into the database successfully', async () => {
    const driveFile = {
      id: 'drive-file-int-1',
      name: 'integration.mp4',
      mimeType: 'video/mp4',
      size: '1000',
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
    };

    const job = await queue.enqueue(driveFile, 'account-1', 'uploaded-folder-1');

    expect(job).not.toBeNull();
    expect(job?.status).toBe('PENDING');
    expect(job?.instagramAccountId).toBe('account-1');

    // Verify it was actually written to DB
    const dbJob = await getDatabase().uploadJob.findUnique({ where: { id: job!.id } });
    expect(dbJob).not.toBeNull();
    expect(dbJob?.driveFileId).toBe('drive-file-int-1');
  });

  it('should not enqueue if the file is already marked as processed', async () => {
    // Mark it as processed
    await ProcessedFileModel.markProcessed({
      driveFileId: 'drive-file-int-2',
      driveFileName: 'already.mp4',
    });

    const driveFile = {
      id: 'drive-file-int-2',
      name: 'already.mp4',
      mimeType: 'video/mp4',
      size: '1000',
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
    };

    const job = await queue.enqueue(driveFile, 'account-1', 'uploaded-folder-1');

    expect(job).toBeNull();
  });

  it('should dequeue the oldest PENDING job and mark it as DOWNLOADING', async () => {
    // Create two jobs manually
    const job1 = await UploadJobModel.createSafe({
      driveFileId: 'drive-file-int-3',
      driveFileName: 'first.mp4',
      status: 'PENDING',
      instagramAccountId: 'account-1',
      uploadedDriveFolderId: 'folder-1',
    });

    // Wait a tiny bit to ensure different createdAt
    await new Promise((r) => setTimeout(r, 10));

    await UploadJobModel.createSafe({
      driveFileId: 'drive-file-int-4',
      driveFileName: 'second.mp4',
      status: 'PENDING',
      instagramAccountId: 'account-1',
      uploadedDriveFolderId: 'folder-1',
    });

    const dequeuedJob = await queue.dequeueNext();

    expect(dequeuedJob).not.toBeNull();
    // It should be the first one created
    expect(dequeuedJob?.id).toBe(job1?.id);
    expect(dequeuedJob?.status).toBe('PENDING'); // UploadWorker marks it as DOWNLOADING

    // Verify in DB
    const dbJob = await getDatabase().uploadJob.findUnique({ where: { id: dequeuedJob!.id } });
    expect(dbJob?.status).toBe('PENDING');
  });
});
