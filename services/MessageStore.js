/**
 * MessageStore
 * Simple in-memory store for messages (can be swapped for database later)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

class MessageStore {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/alphacoin.db');
    this.ensureDataDir();
    this.db = new Database(this.dbPath);
    this.initDatabase();
    this.migrateFromJson();
  }

  ensureDataDir() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        message TEXT,
        subject TEXT,
        source TEXT,
        timestamp DATETIME,
        adminResponse TEXT,
        adminResponseHtml TEXT,
        adminResponseTime DATETIME,
        emailMessageId TEXT,
        emailThreadId TEXT
      );
      CREATE TABLE IF NOT EXISTS conversation_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        role TEXT,
        content TEXT,
        html TEXT,
        sentEmailHtml TEXT,
        timestamp DATETIME,
        emailMessageId TEXT,
        emailThreadId TEXT,
        hidden INTEGER DEFAULT 0,
        FOREIGN KEY(message_id) REFERENCES messages(id)
      );
    `);
  }

  migrateFromJson() {
    const jsonPath = path.join(__dirname, '../data/messages.json');
    const count = this.db.prepare('SELECT count(*) as count FROM messages').get().count;
    
    if (count === 0 && fs.existsSync(jsonPath)) {
      console.log('[MessageStore] Migrating legacy JSON data to SQLite...');
      const legacyData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      for (const msg of legacyData) {
        this.db.prepare(`INSERT INTO messages (id, name, email, message, source, timestamp, adminResponse, adminResponseTime) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          msg.id, msg.name, msg.email, msg.message, msg.source, msg.timestamp, msg.adminResponse, msg.adminResponseTime
        );
        if (msg.conversation) {
          for (const entry of msg.conversation) {
            this.db.prepare(`INSERT INTO conversation_entries (message_id, role, content, html, sentEmailHtml, timestamp, emailMessageId, emailThreadId, hidden) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              msg.id, entry.role, entry.content, entry.html, entry.sentEmailHtml, entry.timestamp, entry.emailMessageId, entry.emailThreadId, entry.hidden ? 1 : 0
            );
          }
        }
      }
      console.log(`[MessageStore] Migration complete. ${legacyData.length} records moved.`);
    }
  }

  async addMessage(messageData) {
    const id = crypto.randomBytes(8).toString('hex');
    const timestamp = messageData.timestamp || new Date().toISOString();
    
    const insertMsg = this.db.prepare(`INSERT INTO messages (id, name, email, message, subject, source, timestamp, emailMessageId, emailThreadId) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    insertMsg.run(id, messageData.name, messageData.email, messageData.message, messageData.subject || null, 
      messageData.source || 'contact_form', timestamp, messageData.emailMessageId || null, messageData.emailThreadId || null);

    await this.addConversationEntry(id, 'user', messageData.message, null, null, messageData.emailMessageId, messageData.emailThreadId);
    return this.getMessage(id);
  }

  async getAllMessages(limit = null, before = null) {
    let query = 'SELECT * FROM messages';
    let params = [];

    if (before) {
      query += ' WHERE timestamp < ?';
      params.push(before);
    }

    query += ' ORDER BY timestamp ASC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const messages = this.db.prepare(query).all(...params);
    for (const msg of messages) {
      msg.conversation = this.getConversationEntries(msg.id);
    }
    return messages;
  }

  getConversationEntries(messageId) {
    const entries = this.db.prepare('SELECT * FROM conversation_entries WHERE message_id = ? ORDER BY timestamp ASC').all(messageId);
    return entries.map(e => ({ ...e, hidden: !!e.hidden }));
  }

  async getMessage(id) {
    const msg = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (msg) {
      msg.conversation = this.getConversationEntries(id);
    }
    return msg;
  }

  async findMessageByEmailIdentifier(identifier) {
    if (!identifier) return null;
    const entry = this.db.prepare('SELECT message_id FROM conversation_entries WHERE emailThreadId = ? OR emailMessageId = ? LIMIT 1').get(identifier, identifier);
    return entry ? this.getMessage(entry.message_id) : null;
  }

  async findMessageBySubjectAndSender(subject, senderEmail) {
    const cleanSubject = subject.toLowerCase().replace(/^re:\s*/, '').trim();
    const msg = this.db.prepare('SELECT id FROM messages WHERE email = ? AND LOWER(subject) LIKE ? LIMIT 1')
      .get(senderEmail, `%${cleanSubject}%`);
    return msg ? this.getMessage(msg.id) : null;
  }

  async addConversationEntry(id, role, content, renderedHtml = null, sentEmailHtml = null, emailMessageId = null, emailThreadId = null, isHidden = false) {
    const timestamp = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO conversation_entries (message_id, role, content, html, sentEmailHtml, timestamp, emailMessageId, emailThreadId, hidden) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, role, content, renderedHtml, sentEmailHtml, timestamp, emailMessageId, emailThreadId, isHidden ? 1 : 0);

    // Update top-level fields for the 'messages' table if it's a public admin response
    if (role === 'admin' && !isHidden) {
      this.db.prepare(`
        UPDATE messages 
        SET adminResponse = ?, adminResponseHtml = ?, adminResponseTime = ? 
        WHERE id = ?
      `).run(content, renderedHtml, timestamp, id);
    }
    
    return this.getMessage(id);
  }

  async getMessagesByEmail(email) {
    const messages = this.db.prepare('SELECT * FROM messages WHERE email = ?').all(email);
    for (const msg of messages) {
      msg.conversation = this.getConversationEntries(msg.id);
    }
    return messages;
  }
}

module.exports = MessageStore;
