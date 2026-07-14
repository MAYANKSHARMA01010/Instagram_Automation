import axios from 'axios';
import http from 'http';
import net from 'net';

class HangingAgent extends http.Agent {
  createConnection(_options: any, _cb: any) {
    // Return a dummy object that looks like a socket or just do nothing
    // Wait, createConnection can return a socket. 
    return new net.Socket();
  }
}

async function run() {
  console.log("Starting request...");
  const agent = new HangingAgent();
  const controller = new AbortController();
  setTimeout(() => {
    console.log("Aborting!");
    controller.abort();
  }, 100);

  try {
    await axios.get('http://example.com', {
      httpAgent: agent,
      signal: controller.signal
    });
    console.log("Success");
  } catch (err: any) {
    console.log("Caught:", err.name, err.message);
  }
}
run();
