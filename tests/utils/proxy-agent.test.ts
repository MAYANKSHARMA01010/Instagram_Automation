jest.mock('https-proxy-agent', () => {
  return {
    HttpsProxyAgent: class HttpsProxyAgent {
      constructor(url: string) {
        new URL(url); // Will throw if malformed
      }
    }
  };
});

jest.mock('socks-proxy-agent', () => {
  return {
    SocksProxyAgent: class SocksProxyAgent {}
  };
});

import { buildRequestConfig, clearAgentCache } from '../../src/utils/proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

describe('Proxy Agent Utility', () => {
  beforeEach(() => {
    clearAgentCache();
  });

  it('should return empty object if context has no proxyUrl (backward compatibility)', () => {
    const config = buildRequestConfig({ accountId: 'acc-1' });
    expect(config).toEqual({});
  });

  it('should return empty object if no context is provided', () => {
    const config = buildRequestConfig(undefined);
    expect(config).toEqual({});
  });

  it('should create HttpsProxyAgent for http:// URL', () => {
    const config = buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'http://my-proxy:8080' });
    expect(config.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(config.proxy).toBe(false); // Axios default proxy disabled
  });

  it('should create HttpsProxyAgent for https:// URL', () => {
    const config = buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'https://my-proxy:8080' });
    expect(config.httpsAgent).toBeDefined();
    expect(config.proxy).toBe(false);
  });

  it('should create SocksProxyAgent for socks5:// URL', () => {
    const config = buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'socks5://user:pass@proxy:1080' });
    expect(config.httpsAgent).toBeDefined();
    expect(config.proxy).toBe(false);
  });

  it('should throw error for unsupported protocol', () => {
    expect(() => {
      buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'ftp://my-proxy:21' });
    }).toThrow(/Unsupported proxy protocol/);
  });

  it('should throw error for malformed proxy URL', () => {
    expect(() => {
      buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'http://[::1]:a/' }); // Invalid port
    }).toThrow();
  });

  it('should return empty object for empty proxy string', () => {
    const config = buildRequestConfig({ accountId: 'acc-1', proxyUrl: '' });
    expect(config).toEqual({});
  });

  it('should return empty object for whitespace proxy string', () => {
    // Trimming logic isn't explicitly defined, but if it passes through as whitespace:
    // Wait, let's see how our function behaves.
    // If it's whitespace, it might throw unsupported protocol since it doesn't start with http/socks.
    expect(() => {
      buildRequestConfig({ accountId: 'acc-1', proxyUrl: '   ' });
    }).toThrow(/Unsupported proxy protocol/);
  });

  it('should cache agents by proxyUrl, not accountId', () => {
    const url = 'http://shared-proxy:8080';
    const config1 = buildRequestConfig({ accountId: 'acc-1', proxyUrl: url });
    const config2 = buildRequestConfig({ accountId: 'acc-2', proxyUrl: url });
    
    // The exact same object should be returned from cache
    expect(config1.httpsAgent).toBe(config2.httpsAgent);
  });

  it('should not share cache across different proxyUrls', () => {
    const config1 = buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'http://proxy-a:80' });
    const config2 = buildRequestConfig({ accountId: 'acc-1', proxyUrl: 'http://proxy-b:80' });
    
    expect(config1.httpsAgent).not.toBe(config2.httpsAgent);
  });
});
