/**
 * TelegramService
 * Provides a mobile command interface for Big Pickle and Ashley.
 */
const axios = require('axios');

class TelegramService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID || "@JeremiahCrouse"; // Your personal Telegram ID
    if (!this.botToken) {
      console.warn('TELEGRAM_BOT_TOKEN not configured');
    }
  }

  /**
   * Send a direct message to the Sovereign
   */
  async sendMessage(text) {
    if (!this.botToken || !this.chatId) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'HTML'
      });
      console.log('[Telegram] Message sent to Sovereign');
    } catch (error) {
      if (error.response && error.response.data) {
        console.error('[Telegram] Error:', error.response.data.description);
      } else {
        console.error('[Telegram] Error sending message:', error.message);
      }
    }
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