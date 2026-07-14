const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');
const net = require('net');

async function run() {
  const server = net.createServer(() => {
    // Just hang
  });
  
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  
  console.log("Server listening on port", port);
  const agent = new HttpsProxyAgent(`http://127.0.0.1:${port}`);
  
  const controller = new AbortController();
  setTimeout(() => {
    console.log("Aborting!");
    controller.abort();
  }, 100);

  const start = Date.now();
  try {
    await axios.get('https://example.com', {
      httpsAgent: agent,
      signal: controller.signal
    });
  } catch (err) {
    console.log("Caught:", err.name, err.message);
  }
  const duration = Date.now() - start;
  console.log("Duration:", duration, "ms");
  
  server.close();
}

run();
