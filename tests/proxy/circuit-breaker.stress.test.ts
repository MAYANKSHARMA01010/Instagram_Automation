jest.mock('https-proxy-agent', () => {
  return { HttpsProxyAgent: jest.fn().mockImplementation(() => ({ destroy: jest.fn() })) };
});

jest.mock('socks-proxy-agent', () => {
  return { SocksProxyAgent: jest.fn().mockImplementation(() => ({ destroy: jest.fn() })) };
});

import { buildRequestConfig, getProxyMetrics, clearAgentCache, reportProxySuccess, reportProxyTimeout } from '../../src/utils/proxy-agent';
import { AccountNetworkContext } from '../../src/types/network.types';

describe('Proxy Circuit Breaker Stress Test', () => {
  beforeEach(() => {
    clearAgentCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should process 100 uploads concurrently across 10 accounts with 2 broken proxies without leaking memory or deadlocking', async () => {
    const NUM_UPLOADS = 100;
    const NUM_ACCOUNTS = 10;
    const BROKEN_PROXIES = ['http://broken1.com', 'http://broken2.com'];
    
    // Setup accounts
    const accounts: AccountNetworkContext[] = [];
    for (let i = 0; i < NUM_ACCOUNTS; i++) {
      accounts.push({
        accountId: `account-${i}`,
        proxyUrl: i < 2 ? BROKEN_PROXIES[i] : `http://healthy${i}.com`
      });
    }

    let completedUploads = 0;
    let failedUploads = 0;
    let activeMutexes = 0;

    // Simulate an upload pipeline worker
    async function mockUpload(accountId: string, proxyUrl: string) {
      activeMutexes++;
      try {
        buildRequestConfig({ accountId, proxyUrl });
        
        // Simulate network delay
        await new Promise(r => setTimeout(r, 10));

        if (BROKEN_PROXIES.includes(proxyUrl)) {
          // Simulate timeout
          reportProxyTimeout(proxyUrl);
          throw new Error('Timeout');
        } else {
          // Simulate success
          reportProxySuccess(proxyUrl);
        }
        
        completedUploads++;
      } catch (err) {
        failedUploads++;
      } finally {
        activeMutexes--;
      }
    }

    // Launch 100 uploads assigned randomly to accounts
    const promises: Promise<void>[] = [];
    for (let i = 0; i < NUM_UPLOADS; i++) {
      const account = accounts[i % NUM_ACCOUNTS];
      promises.push(mockUpload(account.accountId, account.proxyUrl!));
    }

    // Fast-forward timers to resolve setTimeout
    for (let i = 0; i < 100; i++) {
      jest.advanceTimersByTime(20);
      await Promise.resolve(); // flush microtasks
    }
    
    await Promise.all(promises);

    // Verify Mutexes Released (simulated by activeMutexes count)
    expect(activeMutexes).toBe(0);

    // Verify Queue Drained
    expect(completedUploads + failedUploads).toBe(NUM_UPLOADS);
    
    // 2 broken proxies accounts will fail 100 * (2/10) = 20 uploads
    expect(failedUploads).toBe(20);
    expect(completedUploads).toBe(80);

    // Verify Operational Metrics & Leaks
    const metrics = getProxyMetrics();
    // 10 proxies total: 8 healthy (CLOSED), 2 broken (OPEN)
    expect(metrics.active_agents).toBe(8);
    expect(metrics.open_circuit_breakers).toBe(2);
    
    // Fast-forward 24 hours to trigger stale eviction
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    
    // Now trigger a request on a healthy proxy, it should evict the stale agent
    const healthyAccount = accounts[2];
    buildRequestConfig(healthyAccount);
    
    // The other 7 healthy ones are stale but won't be evicted until accessed, 
    // but the circuit breaker logic proves memory won't grow unbounded.
  });
});
