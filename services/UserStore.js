/**
 * UserStore
 * Manages user accounts, authentication, and onboarding state.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

class UserStore {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/alphacoin.db');
    this.initUsers();
  }

  initUsers() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Create users table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        name TEXT,
        verified INTEGER DEFAULT 0,
        verificationToken TEXT,
        faucetClaimed INTEGER DEFAULT 0,
        faucetAmount REAL DEFAULT 25.0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastLogin DATETIME
      );
    `);

    // Create faucet_reserve table for tracking faucet pool
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS faucet_reserve (
        id INTEGER PRIMARY KEY,
        total_allocated REAL DEFAULT 0,
        last_updated DATETIME
      );
    `);

    // Initialize faucet reserve if empty
    const reserve = this.db.prepare('SELECT * FROM faucet_reserve WHERE id = 1').get();
    if (!reserve) {
      this.db.prepare('INSERT INTO faucet_reserve (id, total_allocated, last_updated) VALUES (1, 0, ?)').run(new Date().toISOString());
    }

    console.log('[UserStore] User database initialized.');
  }

  async createUser(email, password, name = null) {
    // Check if user exists
    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new Error('User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = this.generateToken();

    const result = this.db.prepare(`
      INSERT INTO users (email, passwordHash, name, verificationToken)
      VALUES (?, ?, ?, ?)
    `).run(email, passwordHash, name || email.split('@')[0], verificationToken);

    return {
      id: result.lastInsertRowid,
      email,
      name: name || email.split('@')[0],
      verificationToken,
      faucetClaimed: false
    };
  }

  async verifyUser(token) {
    const user = this.db.prepare('SELECT * FROM users WHERE verificationToken = ? AND verified = 0').get(token);
    if (!user) {
      throw new Error('Invalid or expired verification token');
    }

    this.db.prepare('UPDATE users SET verified = 1, verificationToken = NULL WHERE id = ?').run(user.id);
    return { id: user.id, email: user.email, name: user.name };
  }

  async authenticateUser(email, password) {
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    this.db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?').run(new Date().toISOString(), user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      verified: user.verified === 1,
      faucetClaimed: user.faucetClaimed === 1
    };
  }

  async getUser(email) {
    const user = this.db.prepare('SELECT id, email, name, verified, faucetClaimed, faucetAmount, createdAt, lastLogin FROM users WHERE email = ?').get(email);
    if (!user) return null;
    return {
      ...user,
      verified: user.verified === 1,
      faucetClaimed: user.faucetClaimed === 1
    };
  }

  async getUserById(id) {
    const user = this.db.prepare('SELECT id, email, name, verified, faucetClaimed, faucetAmount, createdAt, lastLogin FROM users WHERE id = ?').get(id);
    if (!user) return null;
    return {
      ...user,
      verified: user.verified === 1,
      faucetClaimed: user.faucetClaimed === 1
    };
  }

  async claimFaucet(email) {
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.verified) {
      throw new Error('User not verified');
    }
    if (user.faucetClaimed) {
      throw new Error('Faucet already claimed');
    }

    // Mark as claimed
    this.db.prepare('UPDATE users SET faucetClaimed = 1 WHERE id = ?').run(user.id);

    // Update faucet reserve tracking
    const newTotal = this.db.prepare('SELECT total_allocated FROM faucet_reserve WHERE id = 1').get().total_allocated + 25;
    this.db.prepare('UPDATE faucet_reserve SET total_allocated = ?, last_updated = ? WHERE id = 1').run(newTotal, new Date().toISOString());

    return { email: user.email, amount: 25, faucetClaimed: true };
  }

  getFaucetStats() {
    const reserve = this.db.prepare('SELECT * FROM faucet_reserve WHERE id = 1').get();
    const users = this.db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN faucetClaimed = 1 THEN 1 ELSE 0 END) as claimed FROM users').get();
    const totalAllocated = reserve ? reserve.total_allocated : 0;
    
    return {
      totalAllocated,
      totalUsers: users ? users.total : 0,
      usersClaimed: users ? users.claimed : 0
    };
  }

  getAllUsers() {
    return this.db.prepare('SELECT id, email, name, verified, faucetClaimed, createdAt, lastLogin FROM users ORDER BY createdAt DESC').all();
  }

  getUserCount() {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM users').get();
    return result.count;
  }

  generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = UserStore;
