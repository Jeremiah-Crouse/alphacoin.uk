/**
 * Message & Feed Routes
 * Handles contact form submissions, admin responses, and the Chronicles feed
 * Factory function accepts shared service instances
 */

const express = require('express');

module.exports = (services = {}) => {
  const router = express.Router();
  const { messageStore, adminService, emailService, telegramService, quantumService } = services;

  // API: Submit a message (contact form)
  router.post('/', async (req, res) => {
    try {
      const { name, email, message, requestFollowUp } = req.body;

      if (!name || !email || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (message.length > 2000) {
        return res.status(400).json({ error: 'Message is too long. Please limit your message to 2000 characters.' });
      }

      const newMessage = {
        name,
        email,
        message,
        requestFollowUp: requestFollowUp === undefined ? true : (requestFollowUp === 'true' || requestFollowUp === true || requestFollowUp === 'on'),
        source: 'contact_form',
        timestamp: new Date(),
      };
      const storedMessage = await messageStore.addMessage(newMessage);

      await adminService.notifyNewMessage(storedMessage);

      // Process response in background
      adminService.processAdminResponse(storedMessage, {
        emailService,
        telegramService,
        getQuantumSeed: () => quantumService.getQuantumSeed()
      }).catch(e => console.error('[System] Response processing error:', e));

      res.json({ success: true, messageId: storedMessage.id, status: 'Message queued for Admin reflection' });
    } catch (error) {
      console.error('Error submitting message:', error);
      res.status(500).json({ error: 'Failed to submit message' });
    }
  });

  // API: Get flat feed of all conversation entries
  router.get('/feed', async (req, res) => {
    try {
      const { limit, beforeId } = req.query;
      const entries = await messageStore.getFeed(
        limit ? parseInt(limit) : 20,
        beforeId ? parseInt(beforeId) : null
      );

      res.json({ entries: entries.reverse() });
    } catch (error) {
      console.error('Error fetching feed:', error);
      res.status(500).json({ error: 'Failed to fetch feed' });
    }
  });

  // API: Admin adds response
  router.post('/:id/response', async (req, res) => {
    try {
      const { id } = req.params;
      const { response } = req.body;

      if (!response) {
        return res.status(400).json({ error: 'Missing response' });
      }

      const existingMessage = await messageStore.getMessage(id);
      if (!existingMessage) return res.status(404).json({ error: 'Message not found' });

      const sentHtml = await emailService.sendAdminResponse(
        existingMessage.email,
        existingMessage.name,
        response,
        existingMessage.emailMessageId,
        existingMessage.subject ? `Re: ${existingMessage.subject.replace(/^Re:\s+/i, '')}` : null,
        {
          name: existingMessage.name,
          email: existingMessage.email,
          text: existingMessage.message,
          timestamp: existingMessage.timestamp
        }
      );
      const responseHtml = emailService.markdownToHtml(response);
      const updatedMessage = await messageStore.addConversationEntry(id, 'admin', response, responseHtml, sentHtml);

      res.json({ success: true, message: updatedMessage });
    } catch (error) {
      console.error('Error adding response:', error);
      res.status(500).json({ error: 'Failed to add response' });
    }
  });

  // API: Generate response for a specific message
  router.post('/:id/generate-response', async (req, res) => {
    try {
      const { id } = req.params;
      const message = await messageStore.getMessage(id);

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (message.adminResponse) {
        return res.status(400).json({ error: 'Message already has a response' });
      }

      console.log(`\n[System] Generating Admin response for message ${id}...`);

      const updatedMessage = await adminService.processAdminResponse(message, {
        emailService,
        telegramService,
        getQuantumSeed: () => quantumService.getQuantumSeed()
      });

      console.log(`[System] Response sent to ${updatedMessage.email}\n`);

      res.json({ success: true, message: updatedMessage });
    } catch (error) {
      console.error('Error generating response:', error);
      res.status(500).json({ error: 'Failed to generate response' });
    }
  });

  // API: Generate responses for all pending messages
  router.post('/generate-all-responses', async (req, res) => {
    try {
      const { messages } = await messageStore.getAllMessages();
      const pendingMessages = messages.filter(msg => !msg.adminResponse);

      if (pendingMessages.length === 0) {
        return res.json({ success: true, generated: 0, message: 'No pending messages' });
      }

      console.log(`\n[System] Generating responses for ${pendingMessages.length} pending message(s)...\n`);

      const results = [];
      for (const msg of pendingMessages) {
        try {
          const updatedMessage = await adminService.processAdminResponse(msg, {
            emailService,
            telegramService,
            getQuantumSeed: () => quantumService.getQuantumSeed()
          });
          console.log(`✓ Response sent to ${updatedMessage.email}`);
        } catch (error) {
          console.error(`✗ Failed to respond to message ${msg.id}:`, error.message);
          results.push({ id: msg.id, success: false, error: error.message });
        }
      }

      console.log(`\n[System] Batch generation complete\n`);

      res.json({ success: true, generated: results.filter(r => r.success).length, results });
    } catch (error) {
      console.error('Error in batch generation:', error);
      res.status(500).json({ error: 'Failed to generate responses' });
    }
  });

  return router;
};
