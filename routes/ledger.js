/**
 * Ledger & Protocol Statistics Routes
 * Public endpoints for checking balances and protocol stats
 * Factory function accepts shared service instances
 */

const express = require('express');

module.exports = (services = {}) => {
  const router = express.Router();
  const { ledgerService, userStore } = services;

  // API: Get user balance
  router.get('/balance/:email', async (req, res) => {
    try {
      const { email } = req.params;
      const balance = await ledgerService.getUserBalance(email);
      res.json({ email, balance });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  });

  // API: Get protocol statistics (public)
  router.get('/stats', async (req, res) => {
    try {
      const faucetStats = userStore.getFaucetStats();
      const totalSupply = await ledgerService.getTotalSupply();
      const userCount = userStore.getUserCount();
      const faucetBalance = await ledgerService.getFaucetWalletBalance();
      const velocityBalance = await ledgerService.getVelocityPoolBalance();

      res.json({
        totalSupply,
        totalUsers: userCount,
        faucet: {
          totalAllocated: faucetStats.totalAllocated,
          remaining: faucetBalance,
          usersClaimed: faucetStats.usersClaimed
        },
        treasury: {
          genesis: 1000000,
          velocityPool: velocityBalance,
          strategicReserve: 900000
        }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return router;
};
