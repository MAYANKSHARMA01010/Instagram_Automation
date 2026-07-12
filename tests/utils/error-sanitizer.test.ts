import axios, { AxiosError } from 'axios';
import { sanitizeError, sanitizeAxiosError, maskSensitiveStrings } from '../../src/utils/error-sanitizer';

describe('Error Sanitizer Security Utility', () => {
  describe('maskSensitiveStrings', () => {
    it('masks proxy URLs with credentials', () => {
      const msg = 'Failed to connect to proxy: http://admin:superSecretPassword123@proxy.example.com:8080';
      const safe = maskSensitiveStrings(msg);
      expect(safe).not.toContain('admin');
      expect(safe).not.toContain('superSecretPassword123');
      expect(safe).toContain('http://[REDACTED]:[REDACTED]@proxy.example.com:8080');
    });

    it('masks SOCKS5 proxy URLs', () => {
      const msg = 'Proxy error socks5://user:pass@127.0.0.1:1080/foo';
      const safe = maskSensitiveStrings(msg);
      expect(safe).not.toContain('user');
      expect(safe).not.toContain('pass');
      expect(safe).toContain('socks5://[REDACTED]:[REDACTED]@127.0.0.1:1080/foo');
    });

    it('masks SOCKS and SOCKS4 proxy URLs', () => {
      const msg1 = 'Proxy error socks://admin:secret@127.0.0.1:1080';
      const safe1 = maskSensitiveStrings(msg1);
      expect(safe1).not.toContain('admin');
      expect(safe1).not.toContain('secret');
      expect(safe1).toContain('socks://[REDACTED]:[REDACTED]@127.0.0.1:1080');

      const msg2 = 'Proxy error socks4://admin:secret@127.0.0.1:1080';
      const safe2 = maskSensitiveStrings(msg2);
      expect(safe2).not.toContain('admin');
      expect(safe2).not.toContain('secret');
      expect(safe2).toContain('socks4://[REDACTED]:[REDACTED]@127.0.0.1:1080');
    });

    it('masks access tokens', () => {
      const msg = 'Graph API Error for access_token=EAAGm0PX4ZC... and other details';
      const safe = maskSensitiveStrings(msg);
      expect(safe).not.toContain('EAAGm0PX4ZC');
      expect(safe).toContain('access_token=[REDACTED]');
    });

    it('masks Bearer tokens', () => {
      const msg = 'Authorization: Bearer mySecretJWTToken12345';
      const safe = maskSensitiveStrings(msg);
      expect(safe).not.toContain('mySecretJWTToken12345');
      expect(safe).toContain('Bearer [REDACTED]');
    });
  });

  describe('sanitizeAxiosError', () => {
    it('sanitizes headers, query params, and agents in an AxiosError', () => {
      const mockConfig: any = {
        url: 'https://graph.facebook.com/v19.0/me?access_token=SECRET_TOKEN&app_key=SECRET_KEY',
        method: 'post',
        headers: {
          'Authorization': 'Bearer SECRET_JWT',
          'Cookie': 'sessionid=abc12345;',
          'Content-Type': 'application/json',
          'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        },
        params: {
          access_token: 'SECRET_TOKEN',
          fbtrace_id: '12345',
        },
        httpsAgent: { options: { proxy: 'http://user:pass@host' } }, // Simulated proxy agent
      };

      const mockResponse: any = {
        status: 400,
        statusText: 'Bad Request',
        headers: { ...mockConfig.headers },
        data: { error: { message: 'Some graph error' } },
        config: mockConfig,
      };

      const rawError = new Error('Request failed with status code 400') as AxiosError;
      rawError.isAxiosError = true;
      rawError.config = mockConfig;
      rawError.response = mockResponse;
      rawError.request = { socket: { _host: 'graph.facebook.com' } } as any;

      const safeError = sanitizeAxiosError(rawError) as any;

      // Ensure sensitive headers are redacted
      expect(safeError.config.headers['Authorization']).toBe('[REDACTED]');
      expect(safeError.config.headers['Cookie']).toBe('[REDACTED]');
      expect(safeError.config.headers['Proxy-Authorization']).toBe('[REDACTED]');
      expect(safeError.response.headers['Authorization']).toBe('[REDACTED]');

      // Ensure safe headers are kept
      expect(safeError.config.headers['Content-Type']).toBe('application/json');

      // Ensure query params are redacted
      expect(safeError.config.params.access_token).toBe('[REDACTED]');
      expect(safeError.config.params.fbtrace_id).toBe('12345');

      // Ensure URLs are masked
      expect(safeError.config.url).toContain('access_token=[REDACTED]');
      expect(safeError.config.url).not.toContain('SECRET_TOKEN');

      // Ensure agents and sockets are stripped entirely
      expect(safeError.config.httpsAgent).toBeUndefined();
      expect(safeError.request.socket).toBeUndefined();
      expect(safeError.request._sanitized).toBe(true);

      // Ensure response body (used by our app logic) is preserved
      expect(safeError.response.data.error.message).toBe('Some graph error');
    });
  });

  describe('sanitizeError', () => {
    it('safely handles non-error objects', () => {
      const obj = { message: 'Failed to upload using http://user:pass@proxy.com', token: 'SECRET' };
      const safe = sanitizeError(obj);
      expect(safe).toBeInstanceOf(Error);
      expect(safe.message).not.toContain('user:pass');
      expect(safe.message).toContain('[REDACTED]:[REDACTED]');
    });

    it('safely handles standard Errors with credentials in stack', () => {
      const err = new Error('Graph token expired access_token=SUPER_SECRET');
      err.stack = 'Error: Graph token expired access_token=SUPER_SECRET\n  at SomeFunction (index.js:10:1)';
      
      const safe = sanitizeError(err);
      expect(safe.message).not.toContain('SUPER_SECRET');
      expect(safe.message).toContain('access_token=[REDACTED]');
      expect(safe.stack).not.toContain('SUPER_SECRET');
    });

    it('routes AxiosErrors through sanitizeAxiosError when passed to sanitizeError', () => {
      const rawError = new Error('Axios failed') as AxiosError;
      rawError.isAxiosError = true;
      rawError.response = { status: 500, config: { url: 'http://user:pass@host' }, headers: null } as any;
      const safe = sanitizeError(rawError) as any;
      expect(safe.response.status).toBe(500);
      expect(safe.response.config.url).toContain('[REDACTED]');
      expect(safe.response.headers).toBeNull(); // tests !headers
    });

    it('handles AxiosErrors without config or response', () => {
      const rawError = new Error('Axios without config') as AxiosError;
      rawError.isAxiosError = true;
      delete rawError.config;
      delete rawError.response;
      const safe = sanitizeError(rawError) as any;
      expect(safe.config).toBeUndefined(); // tests !config
    });

    it('handles falsy error objects', () => {
      const safe = sanitizeError(null);
      expect(safe).toBeInstanceOf(Error);
      expect(safe.message).toBe('Unknown error');
    });

    it('handles string errors', () => {
      const safe = sanitizeError('Failed on http://user:pass@proxy.com');
      expect(safe).toBeInstanceOf(Error);
      expect(safe.message).not.toContain('user:pass');
      expect(safe.message).toContain('[REDACTED]:[REDACTED]');
    });

    it('handles errors without stack', () => {
      const err = new Error('Test');
      delete err.stack;
      const safe = sanitizeError(err);
      expect(safe.stack).toBeUndefined();
    });

    it('safely handles objects with circular references', () => {
      const circular: any = { proxy: 'http://user:pass@proxy.com' };
      circular.self = circular; // Circular reference prevents JSON.stringify
      const safe = sanitizeError(circular);
      expect(safe.message).not.toContain('user:pass');
      expect(safe.message).toBe('[object Object]');
    });
  });
});
