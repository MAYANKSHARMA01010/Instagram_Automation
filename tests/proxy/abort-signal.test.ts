import { buildRequestConfig, clearAgentCache } from '../../src/utils/proxy-agent';
import axios from 'axios';
import net from 'net';

describe('AbortSignal compatibility with ProxyAgent', () => {
  let hangingServer: net.Server;
  let serverPort: number;

  beforeAll((done) => {
    // Create a server that accepts TCP connections but never completes the TLS handshake
    // or sends HTTP responses. It just hangs the socket.
    hangingServer = net.createServer((socket) => {
      // Do nothing, leave socket hanging open
    });
    hangingServer.listen(0, '127.0.0.1', () => {
      serverPort = (hangingServer.address() as net.AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    hangingServer.close(done);
  });
  
  beforeEach(() => {
    clearAgentCache();
  });

  it('should timeout via AbortSignal despite hanging proxy connection', async () => {
    const proxyUrl = `http://127.0.0.1:${serverPort}`;
    const context = { accountId: 'test', proxyUrl };
    const requestConfig = buildRequestConfig(context);
    
    // We add an AbortSignal with a very short timeout
    const controller = new AbortController();
    const signal = controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    try {
      await axios.get('https://graph.facebook.com/v18.0', {
        ...requestConfig,
        signal,
      });
      clearTimeout(timeoutId);
      fail('Expected request to timeout and abort');
    } catch (err: any) {
      clearTimeout(timeoutId);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
      expect(err.name).toBe('CanceledError'); // Axios throws CanceledError on abort
    }
  }, 10000);
});
