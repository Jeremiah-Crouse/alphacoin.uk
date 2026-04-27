require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const AdminService = require('./services/AdminService');
const EmailService = require('./services/EmailService');
const MessageStore = require('./services/MessageStore');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const adminService = new AdminService();
const emailService = new EmailService();
const messageStore = new MessageStore();

// Routes

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

app.get('/feed.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feed.html'));
});

// API: Submit a message
app.post('/api/messages', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store the message
    const storedMessage = await messageStore.addMessage({
      name,
      email,
      message,
      timestamp: new Date(),
      adminResponse: null,
      adminResponseTime: null
    });

    // Notify Admin (could be webhook, queue, or direct processing)
    await adminService.notifyNewMessage(storedMessage);

    console.log(`\n[System] Generating Big Pickle response for new message ${storedMessage.id}...`);
    
    // Generate response using Big Pickle
    const generatedResponse = await adminService.generateResponse(storedMessage);

    console.log(`[System] Response generated:\n${generatedResponse}\n`);
    
    // Send response email and get the HTML
    const sentHtml = await emailService.sendAdminResponse(storedMessage.email, storedMessage.name, generatedResponse);
    const responseHtml = emailService.markdownToHtml(generatedResponse);
    
    // Store the response and the HTML
    const updatedMessage = await messageStore.addResponse(storedMessage.id, generatedResponse, sentHtml, responseHtml);

    console.log(`[System] Initial AI response sent to ${updatedMessage.email}\n`);

    res.json({ success: true, messageId: updatedMessage.id, adminResponse: updatedMessage.adminResponse, adminResponseHtml: updatedMessage.adminResponseHtml });
  } catch (error) {
    console.error('Error submitting message:', error);
    res.status(500).json({ error: 'Failed to submit message' });
  }
});

// API: Get all messages and responses (for feed.html)
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await messageStore.getAllMessages();
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// API: Admin adds response (protected - needs auth in future)
app.post('/api/messages/:id/response', async (req, res) => {
  try {
    const { id } = req.params;
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Missing response' });
    }

    const existingMessage = await messageStore.getMessage(id);
    if (!existingMessage) return res.status(404).json({ error: 'Message not found' });

    // Send response email to original sender
    const sentHtml = await emailService.sendAdminResponse(existingMessage.email, existingMessage.name, response);
    const responseHtml = emailService.markdownToHtml(response);
    const updatedMessage = await messageStore.addResponse(id, response, sentHtml, responseHtml);

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error('Error adding response:', error);
    res.status(500).json({ error: 'Failed to add response' });
  }
});

// API: Generate responses for pending messages using Big Pickle
app.post('/api/messages/:id/generate-response', async (req, res) => {
  try {
    const { id } = req.params;
    const message = await messageStore.getMessage(id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.adminResponse) {
      return res.status(400).json({ error: 'Message already has a response' });
    }

    console.log(`\n[System] Generating Big Pickle response for message ${id}...`);
    
    // Generate response using Big Pickle
    const generatedResponse = await adminService.generateResponse(message);

    console.log(`[System] Response generated:\n${generatedResponse}\n`);
    
    // Send response email and get the HTML
    const sentHtml = await emailService.sendAdminResponse(message.email, message.name, generatedResponse);
    const responseHtml = emailService.markdownToHtml(generatedResponse);
    
    // Store the response and the HTML
    const updatedMessage = await messageStore.addResponse(id, generatedResponse, sentHtml, responseHtml);

    console.log(`[System] Response sent to ${updatedMessage.email}\n`);

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// API: Generate responses for all pending messages
app.post('/api/messages/generate-all-responses', async (req, res) => {
  try {
    const messages = await messageStore.getAllMessages();
    const pendingMessages = messages.filter(msg => !msg.adminResponse);

    if (pendingMessages.length === 0) {
      return res.json({ success: true, generated: 0, message: 'No pending messages' });
    }

    console.log(`\n[System] Generating responses for ${pendingMessages.length} pending message(s)...\n`);

    const results = [];
    for (const msg of pendingMessages) {
      try {
        const generatedResponse = await adminService.generateResponse(msg);
        const sentHtml = await emailService.sendAdminResponse(msg.email, msg.name, generatedResponse);
        const responseHtml = emailService.markdownToHtml(generatedResponse);
        const updatedMessage = await messageStore.addResponse(msg.id, generatedResponse, sentHtml, responseHtml);
        results.push({ id: msg.id, success: true });
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Admin service running on http://localhost:${PORT}`);
  console.log(`Admin model: ${process.env.ADMIN_MODEL || 'Not configured'}`);
});
