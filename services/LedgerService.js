/**
 * LedgerService
 * Tracks the issuance and circulation of Alphacoins.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class LedgerService {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/alphacoin.db');
    this.initLedger();
  }

  initLedger() {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userEmail TEXT,
        amount REAL,
        reason TEXT,
        timestamp DATETIME
      );
    `);
    this.migrateFromJson();
  }

  migrateFromJson() {
    const jsonPath = path.join(__dirname, '../data/ledger.json');
    if (fs.existsSync(jsonPath)) {
      const count = this.db.prepare('SELECT count(*) as count FROM ledger').get().count;
      if (count === 0) {
        console.log('[LedgerService] Migrating legacy ledger data to SQLite...');
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const insert = this.db.prepare('INSERT INTO ledger (userEmail, amount, reason, timestamp) VALUES (?, ?, ?, ?)');
        for (const tx of data.transactions) {
          insert.run(tx.to || tx.userEmail, tx.amount, tx.reason, tx.timestamp);
        }
        console.log(`[LedgerService] Migrated ${data.transactions.length} transactions.`);
      }
    }
  }

  async issueCoins(userEmail, amount, reason) {
    const timestamp = new Date().toISOString();
    const info = this.db.prepare('INSERT INTO ledger (userEmail, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
      .run(userEmail, parseFloat(amount), reason, timestamp);
    
    return {
      id: info.lastInsertRowid,
      to: userEmail,
      amount: parseFloat(amount),
      reason: reason,
      timestamp: timestamp
    };
  }

  async getTotalSupply() {
    const result = this.db.prepare('SELECT SUM(amount) as total FROM ledger').get();
    return result.total || 0;
  }

  async getUserBalance(email) {
    const result = this.db.prepare('SELECT SUM(amount) as total FROM ledger WHERE userEmail = ?').get(email);
    return result.total || 0;
  }
}

module.exports = LedgerService;