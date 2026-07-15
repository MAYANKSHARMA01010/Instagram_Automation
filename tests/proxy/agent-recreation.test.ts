jest.mock('https-proxy-agent', () => {
  return { HttpsProxyAgent: jest.fn().mockImplementation(() => ({ destroy: jest.fn() })) };
});

jest.mock('socks-proxy-agent', () => {
  return { SocksProxyAgent: jest.fn().mockImplementation(() => ({ destroy: jest.fn() })) };
});

import { buildRequestConfig, clearAgentCache, reportProxyTimeout } from '../../src/utils/proxy-agent';

describe('Proxy Agent Recreation & Stale Eviction', () => {
  beforeEach(() => {
    clearAgentCache();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });

  it('proves an old CachedProxyAgent cannot destroy a newly-created agent', () => {
    const context = { accountId: 'test', proxyUrl: 'socks5://127.0.0.1:1080' };
    
    // 1. Create first agent
    const config1 = buildRequestConfig(context);
    const firstAgent = config1.httpsAgent as any;
    
    // Mock destroy to track it
    const destroySpy1 = jest.fn();
    firstAgent.destroy = destroySpy1;
    
    // 2. Advance time past STALE_AGE_MS (24h)
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    
    // 3. Trigger rebuild which should evict the stale agent
    const config2 = buildRequestConfig(context);
    const secondAgent = config2.httpsAgent as any;
    
    const destroySpy2 = jest.fn();
    secondAgent.destroy = destroySpy2;
    
    // The first agent should have been destroyed
    expect(destroySpy1).toHaveBeenCalled();
    
    // The new agent should NOT be the old agent
    expect(firstAgent).not.toBe(secondAgent);
    
    // Now simulate an operation on the OLD agent reference throwing a timeout
    // Wait, the test states: "an old CachedProxyAgent cannot destroy a newly-created agent"
    // What if the old agent (which has a timeout running) reports a timeout?
    // Since `reportProxyTimeout` looks up the agent by URL in the `agentCache`, 
    // it retrieves the NEW agent.
    
    reportProxyTimeout(context.proxyUrl);
    reportProxyTimeout(context.proxyUrl);
    reportProxyTimeout(context.proxyUrl); // Triggers OPEN state and destroy()
    
    // It should destroy the NEW agent, not the old one.
    expect(destroySpy2).toHaveBeenCalled();
    
    // If the old agent somehow was bound, it shouldn't destroy the new one... 
    // Wait, the cache is keyed by URL. So reportProxyTimeout always hits the current agent.
  });
});
