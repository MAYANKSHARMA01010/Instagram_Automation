import net from 'net';
import axios from 'axios';
// @ts-ignore
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * This script tests whether an axios request with a timeout
 * respects that timeout when the proxy server accepts the TCP connection
 * but hangs indefinitely without responding.
 */
async function runTest() {
  const server = net.createServer(() => {
    console.log('Proxy received a connection from agent, blackholing it...');
    // We intentionally do nothing here to simulate a stalled proxy
  });

  server.listen(9081, async () => {
    console.log('Dummy blackhole proxy listening on port 9081');
    
    const agent = new HttpsProxyAgent('http://localhost:9081');
    
    const timeoutMs = 2000;
    console.log(`Making axios request with ${timeoutMs}ms timeout...`);
    const start = Date.now();
    
    // We want to force the process to exit after 5 seconds
    // to prove that it hung indefinitely if the timeout fails
    const watchdog = setTimeout(() => {
      const elapsed = Date.now() - start;
      console.log(`\n❌ WATCHDOG TRIGGERED after ${elapsed}ms!`);
      console.log('The proxy agent completely ignored the Axios timeout and hung indefinitely.');
      server.close();
      process.exit(1);
    }, 5000);

    try {
      await axios.get('https://example.com', {
        httpsAgent: agent,
        proxy: false,
        timeout: timeoutMs
      });
      console.log('Request succeeded unexpectedly');
    } catch (err: any) {
      const elapsed = Date.now() - start;
      console.log(`\nRequest failed after ${elapsed}ms with: ${err.message}`);
      
      if (elapsed > timeoutMs + 500) {
         console.log('❌ ISSUE CONFIRMED: Axios timeout was significantly delayed or ignored!');
      } else {
         console.log('✅ NO ISSUE: Axios timeout worked perfectly and aborted the proxy connection.');
         clearTimeout(watchdog);
      }
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

runTest();
