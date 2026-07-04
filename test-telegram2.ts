import { loadConfig } from './src/config';
import axios from 'axios';

async function run() {
  const config = loadConfig();
  const baseUrl = `https://api.telegram.org/bot${config.telegram.botToken}`;
  const text = `test with escaped \`. \- \+ \\!\``;
  
  try {
    await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: 'Markdown',
    });
    console.log("SUCCESS");
  } catch (e: any) {
    console.error("ERROR:", e.response?.data);
  }
}
run().catch(console.error);
