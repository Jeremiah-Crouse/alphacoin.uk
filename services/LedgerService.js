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
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        name TEXT,
        verified INTEGER DEFAULT 0,
        verificationToken TEXT,
        faucetClaimed INTEGER DEFAULT 0,
        faucetAmount REAL DEFAULT 10.0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastLogin DATETIME
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userEmail TEXT,
        amount REAL,
        reason TEXT,
        timestamp DATETIME
      );
      CREATE TABLE IF NOT EXISTS faucet_wallet (
        id INTEGER PRIMARY KEY,
        balance REAL DEFAULT 0,
        last_updated DATETIME
      );
      CREATE TABLE IF NOT EXISTS velocity_pool (
        id INTEGER PRIMARY KEY,
        balance REAL DEFAULT 0,
        last_updated DATETIME
      );
      CREATE TABLE IF NOT EXISTS bot_nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        status TEXT,
        balance REAL,
        endpoint TEXT,
        manifest TEXT,
        registered_at DATETIME
      );
    `);

    // Initialize treasury wallets if empty
    const faucet = this.db.prepare('SELECT * FROM faucet_wallet WHERE id = 1').get();
    if (!faucet) {
      this.db.prepare('INSERT INTO faucet_wallet (id, balance, last_updated) VALUES (1, 1000.0, ?)').run(new Date().toISOString());
    }

    const velocity = this.db.prepare('SELECT * FROM velocity_pool WHERE id = 1').get();
    if (!velocity) {
      this.db.prepare('INSERT INTO velocity_pool (id, balance, last_updated) VALUES (1, 100000.0, ?)').run(new Date().toISOString());
    }

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

  async issueCoins(userEmail, amount, reason, source = 'treasury') {
    const timestamp = new Date().toISOString();
    
    // For faucet claims, draw from faucet_wallet
    if (source === 'faucet') {
      const faucet = this.db.prepare('SELECT * FROM faucet_wallet WHERE id = 1').get();
      if (!faucet || faucet.balance < parseFloat(amount)) {
        throw new Error('Faucet wallet insufficient funds');
      }
      // Deduct from faucet wallet
      this.db.prepare('UPDATE faucet_wallet SET balance = balance - ?, last_updated = ? WHERE id = 1')
        .run(parseFloat(amount), timestamp);
    }

    // For velocity pool distributions, draw from velocity_pool
    if (source === 'velocity_pool') {
      const pool = this.db.prepare('SELECT * FROM velocity_pool WHERE id = 1').get();
      if (!pool || pool.balance < parseFloat(amount)) {
        throw new Error('Velocity pool insufficient funds');
      }
      this.db.prepare('UPDATE velocity_pool SET balance = balance - ?, last_updated = ? WHERE id = 1')
        .run(parseFloat(amount), timestamp);
    }
    
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

  async getFaucetWalletBalance() {
    const result = this.db.prepare('SELECT balance FROM faucet_wallet WHERE id = 1').get();
    return result ? result.balance : 0;
  }

  async getVelocityPoolBalance() {
    const result = this.db.prepare('SELECT balance FROM velocity_pool WHERE id = 1').get();
    return result ? result.balance : 0;
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