/**
 * M2M Bot-Node API Endpoints
 * Handles bot registration and listing for the Machine-to-Machine protocol
 * Factory function accepts shared service instances
 */

const express = require('express');

module.exports = (services = {}) => {
  const router = express.Router();
  const { ledgerService } = services;

  // API: Register a new bot-node
  router.post('/register', async (req, res) => {
    const { name, type, endpoint, agentManifest } = req.body;

    // Accept fallback from query params for robust curl support
    const botName = name || req.query.name;
    if (!botName) return res.status(400).json({ error: 'Bot name required' });

    console.log(`[Protocol] Registering bot-node: ${botName}`);

    try {
      const result = await ledgerService.registerBotNode(
        botName,
        type || req.query.type,
        endpoint || req.query.endpoint,
        agentManifest
      );

      res.json({
        success: true,
        ...result,
        ledger_address: `${result.botId}@alphacoin.uk`
      });
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        res.json({ success: true, message: 'Node already registered', bot_node_id: botName });
      } else {
        console.error('[Protocol] Registration failure:', err.message);
        res.status(500).json({ error: err.message });
      }
    }
  });

  // API: List all registered bot-nodes
  router.get('/list', (req, res) => {
    try {
      const nodes = ledgerService.db.prepare('SELECT * FROM bot_nodes ORDER BY registered_at DESC').all();
      res.json({ count: nodes.length, nodes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
