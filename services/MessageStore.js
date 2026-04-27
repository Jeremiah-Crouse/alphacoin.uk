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
    // Initialize a new message with the first entry in the conversation
    const newMessage = {
      id: crypto.randomBytes(8).toString('hex'),
      ...messageData,
      conversation: [
        {
          role: 'user',
          content: messageData.message,
          timestamp: messageData.timestamp,
          source: messageData.source || 'contact_form',
          emailMessageId: messageData.emailMessageId, // For linking email replies
          emailThreadId: messageData.emailThreadId, // For linking email replies
        }
      ],
      // Keep adminResponse/adminResponseTime for backward compatibility or summary,
      // but primary interaction is now in conversation array
      adminResponse: null, 
      adminResponseTime: null,
    };

    this.messages.push(newMessage);
    this.saveMessages();

    return newMessage;
  }

  /**
   * Get all messages (for feed)
   * Returns messages sorted by timestamp, oldest first
   */
  async getAllMessages(limit = null, before = null) {
    let sorted = [...this.messages].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    if (before) {
      const beforeDate = new Date(before);
      sorted = sorted.filter(msg => new Date(msg.timestamp) < beforeDate);
    }

    if (limit) {
      // Slice from the end to get the most recent ones within the sorted list
      return sorted.slice(-Math.abs(limit));
    }

    return sorted;
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(id) {
    return this.messages.find(msg => msg.id === id);
  }

  /**
   * Find a message by its Gmail thread ID (for linking replies)
   */
  async findMessageByEmailThreadId(threadId) {
    // Find a message where any conversation entry has this threadId
    return this.messages.find(msg => 
      msg.conversation && msg.conversation.some(entry => entry.emailThreadId === threadId)
    );
  }

  /**
   * Find a message by subject and sender email (fallback for linking replies)
   * This is less reliable than threadId but can catch some cases.
   */
  async findMessageBySubjectAndSender(subject, senderEmail) {
    // This is a heuristic. We'll look for a message where the initial user message
    // has a similar subject (after stripping "Re:") and the same sender email.
    const cleanSubject = subject.toLowerCase().replace(/^re:\s*/, '').trim();
    return this.messages.find(msg => {
      if (!msg.conversation) return false;
      
      // Check top-level email and subject
      if (msg.email && msg.email.toLowerCase() === senderEmail.toLowerCase()) {
        const msgSubject = msg.subject ? msg.subject.toLowerCase().replace(/^re:\s*/, '').trim() : '';
        return msgSubject === cleanSubject;
      }
      return false;
    });
  }

  /**
   * Add a new entry (user message or admin response) to a message's conversation history
   */
  async addConversationEntry(id, role, content, renderedHtml = null, sentEmailHtml = null, emailMessageId = null, emailThreadId = null) {
    const message = await this.getMessage(id);
    
    if (!message) {
      throw new Error(`Message not found: ${id}`);
    }

    const newEntry = {
      role: role, // 'user' or 'admin'
      content: content, // Raw text content
      html: renderedHtml, // HTML version for display in feed
      sentEmailHtml: sentEmailHtml, // Full HTML sent in email (for admin audit)
      timestamp: new Date(),
      emailMessageId: emailMessageId, // Gmail message ID if from email
      emailThreadId: emailThreadId, // Gmail thread ID if from email
    };

    message.conversation.push(newEntry);

    // Update top-level adminResponse/adminResponseTime for convenience/backward compatibility
    if (role === 'admin') {
      message.adminResponse = content;
      message.adminResponseHtml = renderedHtml;
      message.adminResponseTime = newEntry.timestamp;
    }
    
    if (role === 'user') {
      message.message = content;
    }

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
