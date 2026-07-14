// @ts-ignore
import { HttpsProxyAgent } from 'https-proxy-agent';
// @ts-ignore
import { SocksProxyAgent } from 'socks-proxy-agent';
import { AccountNetworkContext } from '../types/network.types';
import { AxiosRequestConfig } from 'axios';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CachedProxyAgent {
  agent: any;
  consecutiveTimeouts: number;
  createdAt: number;
  lastUsedAt: number;
  state: CircuitState;
  cooldownUntil?: number;
  probeInFlight?: boolean;
}

// Cache by proxy URL to reuse agents across jobs
const agentCache = new Map<string, CachedProxyAgent>();

const STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export function getProxyMetrics() {
  let active = 0, open = 0, halfOpen = 0;
  for (const p of agentCache.values()) {
    if (p.state === 'CLOSED') active++;
    else if (p.state === 'OPEN') open++;
    else if (p.state === 'HALF_OPEN') halfOpen++;
  }
  return { active_agents: active, open_circuit_breakers: open, half_open: halfOpen };
}

function createAgent(proxyUrl: string): any {
  const urlLower = proxyUrl.toLowerCase();
  if (urlLower.startsWith('http://') || urlLower.startsWith('https://')) {
    return new HttpsProxyAgent(proxyUrl);
  } else if (urlLower.startsWith('socks5://') || urlLower.startsWith('socks://') || urlLower.startsWith('socks4://')) {
    return new SocksProxyAgent(proxyUrl);
  }
  throw new Error(`Unsupported proxy protocol for URL: ${proxyUrl}.`);
}

/**
 * Builds Axios request config extensions based on context.
 * Uses Circuit Breaker and Stale Eviction.
 */
export function buildRequestConfig(context?: AccountNetworkContext): Partial<AxiosRequestConfig> {
  if (!context || !context.proxyUrl) {
    return {};
  }

  const { proxyUrl } = context;
  const now = Date.now();

  let cached = agentCache.get(proxyUrl);

  if (cached) {
    // 1. Stale Eviction
    if (now - cached.createdAt > STALE_AGE_MS) {
      if (typeof cached.agent.destroy === 'function') cached.agent.destroy();
      cached = undefined;
    } 
    // 2. Circuit Breaker Enforcement
    else if (cached.state === 'HALF_OPEN') {
      if (cached.probeInFlight) {
        const err = new Error(`Proxy circuit breaker HALF_OPEN (probe in flight) for ${proxyUrl}`) as any;
        err.code = 'ECONNABORTED'; // Treat as infrastructure error
        throw err;
      }
      cached.probeInFlight = true;
    }
    else if (cached.state === 'OPEN') {
      if (cached.cooldownUntil && now > cached.cooldownUntil) {
        cached.state = 'HALF_OPEN';
        cached.probeInFlight = true;
        cached.agent = createAgent(proxyUrl);
      } else {
        const err = new Error(`Proxy circuit breaker OPEN for ${proxyUrl}`) as any;
        err.code = 'ECONNABORTED'; // Treat as infrastructure error
        throw err;
      }
    }
  }

  if (!cached) {
    cached = {
      agent: createAgent(proxyUrl),
      consecutiveTimeouts: 0,
      createdAt: now,
      lastUsedAt: now,
      state: 'CLOSED'
    };
    agentCache.set(proxyUrl, cached);
  }

  cached.lastUsedAt = now;

  return {
    httpsAgent: cached.agent,
    proxy: false,
  };
}

/**
 * Reports success for a proxy, closing HALF_OPEN circuits.
 */
export function reportProxySuccess(proxyUrl?: string) {
  if (!proxyUrl) return;
  const cached = agentCache.get(proxyUrl);
  if (cached) {
    cached.consecutiveTimeouts = 0;
    if (cached.state === 'HALF_OPEN') {
      cached.state = 'CLOSED';
      cached.probeInFlight = false;
    }
  }
}

/**
 * Reports a timeout for a proxy, triggering circuit breaker if threshold met.
 */
export function reportProxyTimeout(proxyUrl?: string) {
  if (!proxyUrl) return;
  const cached = agentCache.get(proxyUrl);
  if (cached) {
    cached.consecutiveTimeouts++;
    if (cached.state === 'HALF_OPEN') {
      cached.state = 'OPEN';
      cached.probeInFlight = false;
      cached.cooldownUntil = Date.now() + COOLDOWN_MS;
      if (typeof cached.agent.destroy === 'function') cached.agent.destroy();
    } else if (cached.consecutiveTimeouts >= 3 && cached.state !== 'OPEN') {
      cached.state = 'OPEN';
      cached.cooldownUntil = Date.now() + COOLDOWN_MS;
      if (typeof cached.agent.destroy === 'function') cached.agent.destroy();
    }
  }
}

/**
 * For testing purposes to prevent leakage between suites.
 */
export function clearAgentCache(): void {
  agentCache.clear();
}
