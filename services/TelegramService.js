/**
 * TelegramService
 * Provides a mobile command interface for Big Pickle and Ashley.
 */
const axios = require('axios');

class TelegramService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID; 
    this.lastUpdateId = 0;
    if (!this.botToken) {
      console.warn('TELEGRAM_BOT_TOKEN not configured');
    }
    if (!this.chatId || this.chatId.startsWith('@')) {
      console.warn('[Telegram] TELEGRAM_CHAT_ID must be a numeric ID, not a username. Message @userinfobot to find yours.');
    }
  }

  /**
   * Fetch new messages from Telegram
   */
  async getUpdates() {
    if (!this.botToken) return [];

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;
      const response = await axios.get(url, {
        params: {
          offset: this.lastUpdateId + 1,
          timeout: 30
        }
      });

      const updates = response.data.result || [];
      const messages = [];

      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        if (update.message && update.message.text) {
          const msg = update.message;
          messages.push({
            id: msg.message_id,
            chatId: msg.chat.id,
            username: msg.from.username ? `@${msg.from.username}` : 'Unknown',
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            text: msg.text,
            date: new Date(msg.date * 1000)
          });
        }
      }
      return messages;
    } catch (error) {
      console.error('[Telegram] Error fetching updates:', error.message);
      return [];
    }
  }

  /**
   * Send a direct message to the Sovereign
   */
  async sendMessage(text) {
    if (!this.botToken || !this.chatId) return;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const chunks = text.match(/[\s\S]{1,4000}/g) || [];

    for (const chunk of chunks) {
      try {
        await axios.post(url, {
          chat_id: this.chatId,
          text: chunk,
          parse_mode: 'HTML'
        });
      } catch (error) {
        // Fallback if HTML parsing fails (common when chunking splits tags)
        try {
          await axios.post(url, { chat_id: this.chatId, text: chunk });
        } catch (retryError) {
          if (retryError.response && retryError.response.data) {
            console.error('[Telegram] Error:', retryError.response.data.description);
          } else {
            console.error('[Telegram] Error sending message:', retryError.message);
          }
        }
      }
    }
    console.log('[Telegram] Message sent to Sovereign');
  }

  /**
   * Alert the Sovereign of significant system events
   */
  async sendAlert(event, details) {
    const message = `<b>🚨 Protocol Alert: ${event}</b>\n\n${details}`;
    return this.sendMessage(message);
  }
  
  /**
   * Signal a successful heartbeat
   */
  async sendHeartbeatNotification(status) {
    return this.sendMessage(`<b>💓 Heartbeat:</b> ${status}`);
  }
}

module.exports = TelegramService;