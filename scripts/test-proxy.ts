import axios from 'axios';
import { getProxyAgent } from '../src/utils/proxy-agent';

async function testProxy() {
  const proxyUrl = process.argv[2];

  if (!proxyUrl) {
    console.error('Usage: npx ts-node scripts/test-proxy.ts <proxy_url>');
    process.exit(1);
  }

  console.log(`Testing proxy: ${proxyUrl}`);

  try {
    const agent = getProxyAgent(proxyUrl);
    
    console.log('\n1. Requesting IP without proxy (Direct)...');
    const directRes = await axios.get('https://httpbin.org/ip', { timeout: 10000 });
    const directIp = directRes.data.origin;
    console.log(`Direct IP: ${directIp}`);

    console.log('\n2. Requesting IP with proxy...');
    const proxyRes = await axios.get('https://httpbin.org/ip', {
      httpsAgent: agent,
      timeout: 10000,
    });
    const proxyIp = proxyRes.data.origin;
    console.log(`Proxy IP:  ${proxyIp}`);

    if (directIp === proxyIp) {
      console.error('\n❌ Proxy Test FAILED: The outgoing IP did not change. The proxy is either misconfigured or not isolating traffic.');
      process.exit(1);
    } else {
      console.log('\n✅ Proxy Test PASSED: The outgoing IP changed successfully. Traffic is being isolated.');
      process.exit(0);
    }
  } catch (error: any) {
    console.error(`\n❌ Proxy Test FAILED: Network error when attempting to use proxy.`);
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

testProxy();
