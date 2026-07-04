import { NotificationService } from './src/services/notification.service';
import { loadConfig } from './src/config';
import axios from 'axios';

async function run() {
  loadConfig();
  const service = require('./src/services/notification.service').getNotificationService();
  
  // monkey patch sendMessage to see exactly what fails
  const orig = service.sendMessage;
  service.sendMessage = async function(text: string, threadId: string) {
    try {
      console.log("SENDING:", JSON.stringify(text));
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.config.telegram.chatId,
        message_thread_id: threadId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
      console.log("SUCCESS");
    } catch (e: any) {
      console.error("TELEGRAM ERROR:", e.response?.data);
    }
  };
  
  await service.notifyStartup();
}
run().catch(console.error);
