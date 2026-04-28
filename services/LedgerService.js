/**
 * LedgerService
 * Tracks the issuance and circulation of Alphacoins.
 */
const fs = require('fs');
const path = require('path');

class LedgerService {
  constructor() {
    this.ledgerFile = path.join(__dirname, '../data/ledger.json');
    this.initLedger();
  }

  initLedger() {
    if (!fs.existsSync(this.ledgerFile)) {
      fs.writeFileSync(this.ledgerFile, JSON.stringify({
        totalSupply: 0,
        transactions: []
      }, null, 2));
    }
  }

  async issueCoins(userEmail, amount, reason) {
    const data = JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8'));
    
    const transaction = {
      id: Date.now(),
      to: userEmail,
      amount: parseFloat(amount),
      reason: reason,
      timestamp: new Date()
    };

    data.transactions.push(transaction);
    data.totalSupply += transaction.amount;

    fs.writeFileSync(this.ledgerFile, JSON.stringify(data, null, 2));
    return transaction;
  }
}

module.exports = LedgerService;