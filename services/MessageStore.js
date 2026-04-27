/**
 * MessageStore
 * Simple in-memory store for messages (can be swapped for database later)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MessageStore {
  constructor() {
    this.messagesFile = path.join(__dirname, '../data/messages.json');
    this.ensureDataDir();
    this.messages = this.loadMessages();
  }

  ensureDataDir() {
    const dataDir = path.dirname(this.messagesFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadMessages() {
    try {
      if (fs.existsSync(this.messagesFile)) {
        const data = fs.readFileSync(this.messagesFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
    return [];
  }

  saveMessages() {
    try {
      fs.writeFileSync(
        this.messagesFile,
        JSON.stringify(this.messages, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('Error saving messages:', error);
      throw error;
    }
  }

  /**
   * Add a new message
   */
  async addMessage(messageData) {
    const message = {
      id: crypto.randomBytes(8).toString('hex'),
      ...messageData,
      adminResponse: null,
      adminResponseTime: null
    };

    this.messages.push(message);
    this.saveMessages();

    return message;
  }

  /**
   * Get all messages (for feed)
   * Returns messages sorted by timestamp, oldest first
   */
  async getAllMessages() {
    return this.messages.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(id) {
    return this.messages.find(msg => msg.id === id);
  }

  /**
   * Add response to a message
   */
  async addResponse(id, response, emailHtml = null, responseHtml = null) {
    const message = await this.getMessage(id);
    
    if (!message) {
      throw new Error(`Message not found: ${id}`);
    }

    message.adminResponse = response;
    message.adminResponseHtml = responseHtml;
    message.sentEmailHtml = emailHtml;
    message.adminResponseTime = new Date();

    this.saveMessages();
    return message;
  }

  /**
   * Get messages for a specific email address
   */
  async getMessagesByEmail(email) {
    return this.messages.filter(msg => msg.email === email);
  }
}

module.exports = MessageStore;
