// @ts-ignore
import { HttpsProxyAgent } from 'https-proxy-agent';
// @ts-ignore
import { SocksProxyAgent } from 'socks-proxy-agent';
import { AccountNetworkContext } from '../types/network.types';
import { AxiosRequestConfig } from 'axios';

// Cache by proxy URL to reuse agents across jobs
const agentCache = new Map<string, any>();

/**
 * Builds Axios request config extensions (e.g. proxy agents) based on context.
 * If no proxy is configured, returns an empty object (backward compatibility).
 */
export function buildRequestConfig(context?: AccountNetworkContext): Partial<AxiosRequestConfig> {
  if (!context || !context.proxyUrl) {
    return {};
  }

  const { proxyUrl } = context;

  // Return cached agent if available
  if (agentCache.has(proxyUrl)) {
    return {
      httpsAgent: agentCache.get(proxyUrl),
      proxy: false, // Ensure Axios doesn't use its default proxy logic
    };
  }

  const urlLower = proxyUrl.toLowerCase();
  let agent: any;

  if (urlLower.startsWith('http://') || urlLower.startsWith('https://')) {
    agent = new HttpsProxyAgent(proxyUrl);
  } else if (urlLower.startsWith('socks5://') || urlLower.startsWith('socks://')) {
    agent = new SocksProxyAgent(proxyUrl);
  } else {
    throw new Error(`Unsupported proxy protocol for URL: ${proxyUrl}. Supported: http, https, socks4, socks5.`);
  }

  agentCache.set(proxyUrl, agent);

  return {
    httpsAgent: agent,
    proxy: false,
  };
}

/**
 * For testing purposes to prevent leakage between suites.
 */
export function clearAgentCache(): void {
  agentCache.clear();
}
