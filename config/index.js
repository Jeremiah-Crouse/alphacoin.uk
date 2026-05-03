/**
 * Configuration module
 * Centralizes environment variable access and validation
 */

require('dotenv').config();

const config = {
  port: process.env.PORT || 8003,
  admin: {
    apiKey: process.env.ADMIN_API_KEY,
    model: process.env.ADMIN_MODEL || 'opencode',
    modelName: process.env.ADMIN_MODEL_NAME || 'big-pickle',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI,
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    modelName: process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash-lite',
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
  },
  serper: {
    apiKey: process.env.SERPER_API_KEY,
  },
  baseUrl: process.env.BASE_URL || 'https://alphacoin.uk',
  opencode: {
    zenUrl: process.env.OPENCODE_ZEN_URL || 'https://opencode.ai/zen/v1',
  },
  polling: {
    gmailInterval: process.env.GMAIL_POLLING_INTERVAL || 5 * 60 * 1000,
    telegramInterval: 90 * 1000,
    streamDelay: process.env.STREAM_DELAY || 60 * 1000,
  },
  faucet: {
    amount: 25,
  },
};

module.exports = config;
