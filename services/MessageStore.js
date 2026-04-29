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
    this.db.pragma('journal_mode = WAL');
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
        emailThreadId TEXT,
        requestFollowUp INTEGER DEFAULT 1
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

    // Migration: Ensure all required columns exist for those updating from older versions
    const tableInfo = this.db.prepare("PRAGMA table_info(messages)").all();
    const columns = tableInfo.map(c => c.name);
    const requiredColumns = [
      { name: 'subject', type: 'TEXT' },
      { name: 'emailMessageId', type: 'TEXT' },
      { name: 'emailThreadId', type: 'TEXT' },
      { name: 'requestFollowUp', type: 'INTEGER DEFAULT 1' }
    ];
    requiredColumns.forEach(col => {
      if (!columns.includes(col.name)) {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${col.name} ${col.type}`);
      }
    });
  }

  migrateFromJson() {
    const jsonPath = path.join(__dirname, '../data/messages.json');
    const count = this.db.prepare('SELECT count(*) as count FROM messages').get().count;
    
    if (count === 0 && fs.existsSync(jsonPath)) {
      console.log('[MessageStore] Migrating legacy JSON data to SQLite...');
      const legacyData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      for (const msg of legacyData) {
        const msgTimestamp = (msg.timestamp instanceof Date) ? msg.timestamp.toISOString() : msg.timestamp;
        this.db.prepare(`INSERT INTO messages (id, name, email, message, source, timestamp, adminResponse, adminResponseTime) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          msg.id, msg.name, msg.email, msg.message, msg.source, msgTimestamp, msg.adminResponse, msg.adminResponseTime
        );
        if (msg.conversation) {
          for (const entry of msg.conversation) {
            const entryTimestamp = (entry.timestamp instanceof Date) ? entry.timestamp.toISOString() : entry.timestamp;
            this.db.prepare(`INSERT INTO conversation_entries (message_id, role, content, html, sentEmailHtml, timestamp, emailMessageId, emailThreadId, hidden) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              msg.id, entry.role, entry.content, entry.html, entry.sentEmailHtml, entryTimestamp, entry.emailMessageId, entry.emailThreadId, entry.hidden ? 1 : 0
            );
          }
        }
      }
      console.log(`[MessageStore] Migration complete. ${legacyData.length} records moved.`);
    }
  }

  async addMessage(messageData) {
    const id = crypto.randomBytes(8).toString('hex');
    // Ensure timestamp is always an ISO string
    const timestamp = (messageData.timestamp instanceof Date) 
      ? messageData.timestamp.toISOString() 
      : (messageData.timestamp || new Date().toISOString());
    
    const insertMsg = this.db.prepare(`INSERT INTO messages (id, name, email, message, subject, source, timestamp, emailMessageId, emailThreadId, requestFollowUp) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    insertMsg.run(id, messageData.name, messageData.email, messageData.message, messageData.subject || null, 
      messageData.source || 'contact_form', timestamp, messageData.emailMessageId || null, messageData.emailThreadId || null, messageData.requestFollowUp !== false ? 1 : 0);

    await this.addConversationEntry(id, 'user', messageData.message, null, null, messageData.emailMessageId, messageData.emailThreadId);
    return this.getMessage(id);
  }

  async getAllMessages(limit = null, offset = 0, before = null, after = null) {
    let query = 'SELECT * FROM messages';
    let params = [];
    let clauses = [];

    if (before) {
      clauses.push('timestamp < ?');
      params.push(before);
    }
    if (after) {
      clauses.push('timestamp > ?');
      params.push(after);
    }

    if (clauses.length > 0) {
      query += ' WHERE ' + clauses.join(' AND ');
    }

    // If fetching new updates, go ASC. If fetching history/initial, go DESC to get latest.
    if (after) {
      query += ' ORDER BY timestamp ASC';
    } else {
      query += ' ORDER BY timestamp DESC';
    }

    if (limit !== null) {
      query += ' LIMIT ?';
      params.push(parseInt(limit) + 1); // Fetch one extra to determine hasMore
    }

    if (offset) {
      query += ' OFFSET ?';
      params.push(parseInt(offset));
    }

    const rows = this.db.prepare(query).all(...params);
    
    let hasMore = false;
    let messages = rows;
    if (limit !== null && messages.length > limit) {
      hasMore = true;
      messages.pop();
    }

    for (const msg of messages) {
      msg.conversation = this.getConversationEntries(msg.id);
    }
    return { messages, hasMore };
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

  async searchMessages(query) {
    const searchTerm = `%${query}%`;
    const messages = this.db.prepare(`
      SELECT DISTINCT m.* 
      FROM messages m
      LEFT JOIN conversation_entries ce ON m.id = ce.message_id
      WHERE m.name LIKE ? 
         OR m.email LIKE ? 
         OR m.message LIKE ? 
         OR m.subject LIKE ? 
         OR ce.content LIKE ?
      ORDER BY m.timestamp DESC
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    
    for (const msg of messages) {
      msg.conversation = this.getConversationEntries(msg.id);
    }
    return messages;
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

    // Update the main 'message' column if a user is speaking, so 'message.message' reflects the latest input
    if (role === 'user') {
      this.db.prepare('UPDATE messages SET message = ? WHERE id = ?').run(content, id);
    }
    
    return this.getMessage(id);
  }

  async getMessagesByEmail(email) {
    const messages = this.db.prepare('SELECT * FROM messages WHERE email = ? ORDER BY timestamp DESC').all(email);
    for (const msg of messages) {
      msg.conversation = this.getConversationEntries(msg.id);
    }
    return messages;
  }
}

module.exports = MessageStore;
