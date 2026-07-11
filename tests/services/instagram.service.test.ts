import { InstagramService } from '../../src/services/instagram.service';
import axios, { AxiosError } from 'axios';
import { AccountNetworkContext } from '../../src/types/network.types';
import { sanitizeError } from '../../src/utils/error-sanitizer';

// --- Mocks ---
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    create: jest.fn(),
  };
});

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    instagram: { graphApiVersion: 'v20.0', graphApiToken: 'test-token' },
    upload: {
      maxRetryAttempts: 3,
      retryBaseDelayMs: 100,
      statusPollIntervalMs: 5000,
      statusPollTimeoutMs: 15000,
    },
  }),
}));

jest.mock('../../src/utils/proxy-agent', () => ({
  buildRequestConfig: jest.fn((ctx) => {
    if (ctx.proxyUrl) {
      return { httpsAgent: { isMockAgent: true }, proxy: false };
    }
    return {};
  }),
}));

const mockPost = jest.fn();
const mockGet = jest.fn();
let responseErrorInterceptor: any;
let requestInterceptor: any;

(axios.create as jest.Mock).mockImplementation(() => ({
  post: async (...args: any[]) => {
    try {
      if (requestInterceptor) args[2] = requestInterceptor(args[2] || {});
      return await mockPost(...args);
    } catch (err) {
      if (responseErrorInterceptor) return responseErrorInterceptor(err);
      throw err;
    }
  },
  get: async (...args: any[]) => {
    try {
      if (requestInterceptor) args[1] = requestInterceptor(args[1] || {});
      return await mockGet(...args);
    } catch (err) {
      if (responseErrorInterceptor) return responseErrorInterceptor(err);
      throw err;
    }
  },
  interceptors: {
    request: { use: (fn: any) => { requestInterceptor = fn; } },
    response: { use: (onSuccess: any, onError: any) => { responseErrorInterceptor = onError; } },
  },
}));

// Helper to create Axios errors
function createAxiosError(status: number, message: string, code?: number, type?: string): AxiosError {
  const err = new Error(message) as any;
  err.isAxiosError = true;
  err.name = 'AxiosError';
  err.response = {
    status,
    data: {
      error: { message, code, type },
    },
  };
  return err;
}

function createNetworkError(message: string): AxiosError {
  const err = new Error(message) as any;
  err.isAxiosError = true;
  err.name = 'AxiosError';
  // No response for network error
  return err;
}

describe('InstagramService', () => {
  let service: InstagramService;

  const flushPromises = () => new Promise((resolve) => {
    jest.requireActual('timers').setImmediate(resolve);
  });

  const flushTimers = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      await flushPromises();
      jest.runOnlyPendingTimers();
    }
    await flushPromises();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockReset();
    mockGet.mockReset();
    jest.spyOn(global.Math, 'random').mockReturnValue(0);
    jest.useFakeTimers();
    service = new InstagramService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const ctx: AccountNetworkContext = { accountId: 'ig-123', proxyUrl: 'http://user:pass@proxy.com:8080' };

  describe('Proxy Injection & Defaults', () => {
    it('should inject proxy config when proxyUrl is provided', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: '123' } });

      await service.createReelContainer(ctx, 'http://vid.mp4', 'caption');

      expect(mockPost).toHaveBeenCalledWith(
        '/ig-123/media',
        null,
        expect.objectContaining({
          httpsAgent: expect.anything(), // proxy agent injected
          proxy: false,
        }),
      );
    });

    it('should NOT inject proxy when proxyUrl is undefined (No-proxy regression test)', async () => {
      const emptyCtx: AccountNetworkContext = { accountId: 'ig-123' };
      mockPost.mockResolvedValueOnce({ data: { id: '123' } });

      await service.createReelContainer(emptyCtx, 'http://vid.mp4', 'caption');

      const configArg = mockPost.mock.calls[0][2];
      expect(configArg).not.toHaveProperty('httpsAgent');
      expect(configArg).not.toHaveProperty('socksAgent');
      expect(configArg).not.toHaveProperty('proxy');
    });

    it('should enforce proxy context isolation between concurrent requests', async () => {
      const ctxA: AccountNetworkContext = { accountId: 'acc-A', proxyUrl: 'http://proxyA.com' };
      const ctxB: AccountNetworkContext = { accountId: 'acc-B', proxyUrl: 'http://proxyB.com' };

      mockPost.mockResolvedValue({ data: { id: '123' } });

      // Fire both concurrently
      await Promise.all([
        service.createReelContainer(ctxA, 'vidA', 'capA'),
        service.createReelContainer(ctxB, 'vidB', 'capB'),
      ]);

      const callA = mockPost.mock.calls.find(c => c[0] === '/acc-A/media');
      const callB = mockPost.mock.calls.find(c => c[0] === '/acc-B/media');

      expect(callA[2].httpsAgent).not.toBe(callB[2].httpsAgent);
    });
  });

  describe('createReelContainer', () => {
    it('should successfully post and return container ID', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'container-123' } });

      const res = await service.createReelContainer(ctx, 'http://vid.mp4', 'my caption', 'http://cover.jpg');

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        '/ig-123/media',
        null,
        expect.objectContaining({
          params: expect.objectContaining({
            media_type: 'REELS',
            video_url: 'http://vid.mp4',
            caption: 'my caption',
            cover_url: 'http://cover.jpg',
            access_token: 'test-token',
          }),
        }),
      );
      expect(res).toEqual({ id: 'container-123' });
    });
  });

  describe('Retry Behavior & Retry Counts', () => {
    it('should retry network errors and succeed on 3rd attempt', async () => {
      mockPost
        .mockRejectedValueOnce(createNetworkError('ECONNRESET'))
        .mockRejectedValueOnce(createNetworkError('ETIMEDOUT'))
        .mockResolvedValueOnce({ data: { id: 'success-id' } });

      let res: any;
      service.createReelContainer(ctx, 'url', 'cap').then(r => { res = r; });
      
      await flushTimers(3);

      expect(mockPost).toHaveBeenCalledTimes(3);
      expect(res.id).toBe('success-id');
    });

    it('should throw after max retries exceeded', async () => {
      mockPost.mockRejectedValue(createNetworkError('ECONNRESET'));

      let caught: any;
      service.createReelContainer(ctx, 'url', 'cap').catch(e => { caught = e; });

      await flushTimers(4);

      expect(caught).toBeDefined();
      expect(caught.message).toContain('ECONNRESET');
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it('should retry Meta API rate limit errors (code 4)', async () => {
      mockPost
        .mockRejectedValueOnce(createAxiosError(403, 'Application request limit reached', 4))
        .mockResolvedValueOnce({ data: { id: '123' } });

      let res: any;
      service.createReelContainer(ctx, 'url', 'cap').then(r => { res = r; });
      
      await flushTimers(2);
      
      expect(mockPost).toHaveBeenCalledTimes(2);
      expect(res.id).toBe('123');
    });

    it('should NOT retry 400 Bad Request client errors', async () => {
      mockPost.mockRejectedValue(createAxiosError(400, 'Invalid parameter', 100));

      let caught: any;
      try {
        await service.createReelContainer(ctx, 'url', 'cap');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry 404 Not Found', async () => {
      mockPost.mockRejectedValue(createAxiosError(404, 'Media not found', 100));

      let caught: any;
      try {
        await service.createReelContainer(ctx, 'url', 'cap');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sanitizer + Retry Compatibility', () => {
    it('should preserve retryability after passing through error-sanitizer', () => {
      const rawError = createAxiosError(500, 'Internal Server Error');
      const safeError = sanitizeError(rawError);

      expect(axios.isAxiosError(safeError)).toBe(true);
      expect((safeError as any).response.status).toBe(500);
    });
  });

  describe('waitForContainerReady (Polling & Timeouts)', () => {
    it('should poll at the correct interval until FINISHED', async () => {
      mockGet
        .mockResolvedValueOnce({ data: { status_code: 'IN_PROGRESS' } })
        .mockResolvedValueOnce({ data: { status_code: 'IN_PROGRESS' } })
        .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } });

      let resolved = false;
      service.waitForContainerReady(ctx, 'cont-123').then(() => { resolved = true; });

      await flushTimers(1);
      expect(mockGet).toHaveBeenCalledTimes(2);

      await flushTimers(1);
      expect(mockGet).toHaveBeenCalledTimes(3);

      expect(resolved).toBe(true);
    });

    it('should throw immediately if container status is ERROR', async () => {
      mockGet.mockResolvedValue({ data: { status_code: 'ERROR', error_message: 'Video format invalid' } });

      let caught: Error | undefined;
      try {
        await service.waitForContainerReady(ctx, 'cont-123');
      } catch (e) {
        caught = e as Error;
      }
      
      expect(caught).toBeDefined();
      expect(caught!.message).toContain('failed with status: ERROR — Video format invalid');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should fail gracefully with a clear error when payload is empty or invalid', async () => {
      // Return null data
      mockGet.mockResolvedValue({ data: null });

      let caught: Error | undefined;
      try {
        await service.waitForContainerReady(ctx, 'cont-123');
      } catch (e) {
        caught = e as Error;
      }
      
      expect(caught).toBeDefined();
      expect(caught!.message).toContain('Unexpected empty or invalid payload');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should fail gracefully with a clear error when status_code is missing', async () => {
      // Return payload with no status_code
      mockGet.mockResolvedValue({ data: { id: 'cont-123' } });

      let caught: Error | undefined;
      try {
        await service.waitForContainerReady(ctx, 'cont-123');
      } catch (e) {
        caught = e as Error;
      }
      
      expect(caught).toBeDefined();
      expect(caught!.message).toContain('Missing status_code');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should throw if polling exceeds statusPollTimeoutMs', async () => {
      mockGet.mockResolvedValue({ data: { status_code: 'IN_PROGRESS' } });

      let caught: Error | undefined;
      service.waitForContainerReady(ctx, 'cont-123').catch(e => { caught = e; });

      // The timeout is set to 15000ms. Interval is 5000ms. Max polls is 3.
      await flushTimers(4);

      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/timeout/i);
    });
  });

  describe('Meta API Formatting', () => {
    it('should append Meta API error message to the thrown error', async () => {
      mockPost.mockRejectedValue(createAxiosError(400, 'checkpoint_required', 123));

      let caughtError: Error | null = null;
      try {
        await service.publishReel(ctx, 'cont-123');
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain('Meta API Error: checkpoint_required');
    });

    it('should correctly format action_blocked error', async () => {
      mockPost.mockRejectedValue(createAxiosError(400, 'action_blocked', 456));

      let caught: Error | undefined;
      try {
        await service.publishReel(ctx, 'cont-123');
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).toContain('Meta API Error: action_blocked');
    });
  });
});
