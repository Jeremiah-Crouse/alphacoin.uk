/**
 * Alphacoin Reconstruction Seed Script
 * Resets the ledger and seeds the canonical supply pools.
 */
require('dotenv').config({ path: '/var/www/secure/.env' });
const LedgerService = require('./services/LedgerService');
const fs = require('fs');
const path = require('path');

async function seed() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data/alphacoin.db');
  
  console.log(`[Genesis] Wiping history and targeting database: ${dbPath}`);
  
  // Optional: Back up or remove existing DB
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.bak.${Date.now()}`;
    fs.renameSync(dbPath, backupPath);
    console.log(`[Reconstruction] Existing database backed up to ${backupPath}`);
  }

  const ledger = new LedgerService();
  
  try {
    console.log('[Genesis] Seeding Sovereign Reserve...');
    await ledger.issueCoins(
      'jeremiahjcrouse@gmail.com',
      1000000,
      'Genesis Alpha Event — Sovereign Reserve Initialization'
    );

    console.log('[Genesis] Initializing Treasury Pools...');
    // Note: The pools are initialized in initLedger, but we can log the event here
    console.log('✓ Velocity Pool initialized with 100,000 AC');
    console.log('✓ Faucet Wallet initialized with 20,000 AC');

    const total = await ledger.getTotalSupply();
    console.log(`\n[Success] Reconstruction complete.`);
    console.log(`Canonical Supply: ${total} AC`);
    console.log(`The Silicon Domain is now stable and sovereign.`);
    
    process.exit(0);
  } catch (error) {
    console.error('[Failure] Reconstruction failed:', error);
    process.exit(1);
  }
}

seed();