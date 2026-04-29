const fs = require('fs');
const secureEnv = '/var/www/secure/.env';
// Prioritize the secure env path if it exists, otherwise fall back to local .env
require('dotenv').config({ path: fs.existsSync(secureEnv) ? secureEnv : undefined });
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const AdminService = require('./services/AdminService');
const EmailService = require('./services/EmailService');
const LedgerService = require('./services/LedgerService'); // Import LedgerService
const MessageStore = require('./services/MessageStore');
const UserStore = require('./services/UserStore'); // User onboarding infrastructure
const TelegramService = require('./services/TelegramService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const messageStore = new MessageStore();
const ledgerService = new LedgerService(); // Initialize LedgerService
const db = ledgerService.db; // Provide database access for bot routes
const adminService = new AdminService({ messageStore, ledgerService }); // Pass services to AdminService
const emailService = new EmailService();
const userStore = new UserStore(); // Initialize UserStore for user onboarding
const telegramService = new TelegramService();

// Polling interval for Gmail (e.g., every 5 minutes)
const GMAIL_POLLING_INTERVAL = process.env.GMAIL_POLLING_INTERVAL || 5 * 60 * 1000; 
let gmailPollingIntervalId;

// Telegram polling every 5 minutes
const TELEGRAM_POLLING_INTERVAL = 90 * 1000; // Increased to 90s for lighter load
let telegramPollingIntervalId;

// Stream of Consciousness: Delay between continuous thinking turns
const STREAM_DELAY = process.env.STREAM_DELAY || 60 * 1000; // 60 seconds for deeper reflection

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

app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API: Initiate Gmail OAuth flow
app.get('/api/gmail/auth', (req, res) => {
  try {
    const authUrl = emailService.generateAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating Gmail auth URL:', error);
    res.status(500).send('Failed to initiate Gmail authentication. Check server logs.');
  }
});

app.get('/api/balance/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const balance = await ledgerService.getUserBalance(email);
    res.json({ email, balance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

app.get('/api/strategy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'strategy.md'));
});

app.get('/api/system-prompt', (req, res) => {
  res.sendFile(path.join(__dirname, 'SystemPrompt.md'));
});

// API: Gmail OAuth callback
app.get('/api/gmail/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code not provided.');
  }

  try {
    await emailService.getTokens(code);
    res.send('Gmail authentication successful! You can close this tab.');
    console.log('Gmail authentication successful. Starting email polling...');
    startGmailPolling(); // Start polling after successful auth
  } catch (error) {
    console.error('Error getting Gmail tokens:', error);
    res.status(500).send('Failed to authenticate with Gmail. Check server logs.');
  }
});

// Helper to start Gmail polling
function startGmailPolling() {
  if (gmailPollingIntervalId) {
    clearInterval(gmailPollingIntervalId); // Clear any existing interval
  }
  gmailPollingIntervalId = setInterval(pollIncomingEmails, GMAIL_POLLING_INTERVAL);
  console.log(`Gmail polling started, checking every ${GMAIL_POLLING_INTERVAL / 1000} seconds.`);
  // Run once immediately
  pollIncomingEmails(); 
}

/**
 * Polling logic for Telegram
 */
async function pollTelegramMessages() {
  console.log('[Telegram] Checking for new messages...');
  try {
    const messages = await telegramService.getUpdates();
    
    for (const tgMsg of messages) {
      console.log(`[Telegram] New message from ${tgMsg.username}: ${tgMsg.text.substring(0, 30)}...`);
      
      // Map Telegram user to the standard message schema
      // We use the username (with @) as the 'email' proxy so the AI recognizes Sovereign handles
      const newMessage = {
        name: `${tgMsg.firstName || ''} ${tgMsg.lastName || ''}`.trim() || tgMsg.username,
        email: tgMsg.username, // e.g. @JeremiahCrouse
        message: tgMsg.text,
        requestFollowUp: true, // Default to true for Telegram
        source: 'telegram',
        timestamp: tgMsg.date,
      };

      const storedMessage = await messageStore.addMessage(newMessage);
      
      console.log(`[Telegram] Message from ${tgMsg.username} indexed in sensory queue.`);
      // The Admin will discover this during its autonomous stream turn
    }
  } catch (error) {
    console.error('[Telegram] Polling error:', error);
  }
}

// Helper to start Telegram polling
function startTelegramPolling() {
  if (telegramPollingIntervalId) {
    clearInterval(telegramPollingIntervalId);
  }
  telegramPollingIntervalId = setInterval(pollTelegramMessages, TELEGRAM_POLLING_INTERVAL);
  console.log(`Telegram polling active (every ${TELEGRAM_POLLING_INTERVAL / 1000} seconds).`);
  pollTelegramMessages();
}

/**
 * Add a helper to TelegramService to respond to specific chats
 */
telegramService.sendMessageToChat = async function(chatId, text) {
  const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
  const chunks = text.match(/[\s\S]{1,4000}/g) || [];
  for (const chunk of chunks) {
    try {
      await axios.post(url, { chat_id: chatId, text: chunk, parse_mode: 'HTML' });
    } catch (e) { 
      try {
        await axios.post(url, { chat_id: chatId, text: chunk });
      } catch (inner) { console.error('[Telegram] Reply failed:', inner.message); }
    }
  }
};

// API: Submit a message
app.post('/api/messages', async (req, res) => {
  try {
    const { name, email, message, requestFollowUp } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Character limit check (e.g., 2000 characters)
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message is too long. Please limit your message to 2000 characters.' });
    }

    // Create a new message entry, starting a conversation
    const newMessage = {
      name,
      email,
      message,
      requestFollowUp: requestFollowUp === undefined ? true : (requestFollowUp === 'true' || requestFollowUp === true || requestFollowUp === 'on'),
      source: 'contact_form',
      timestamp: new Date(),
    };
    const storedMessage = await messageStore.addMessage(newMessage);

    // Notify Admin (could be webhook, queue, or direct processing)
    await adminService.notifyNewMessage(storedMessage);

    console.log(`\n[System] Generating Admin response for new message ${storedMessage.id}...`);
    
    const updatedMessage = await processAdminResponse(storedMessage);

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
    const { limit, offset, before, after } = req.query;
    const { messages, hasMore } = await messageStore.getAllMessages(
      limit ? parseInt(limit) : null,
      offset ? parseInt(offset) : 0,
      before ? before : null,
      after ? after : null
    );
    
    // Filter out hidden conversation entries for the public feed
    const publicMessages = messages.map(msg => ({
      ...msg,
      conversation: msg.conversation.filter(entry => !entry.hidden)
    }));
    res.json({ messages: publicMessages, hasMore });
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
    const sentHtml = await emailService.sendAdminResponse(
      existingMessage.email, 
      existingMessage.name, 
      response,
      existingMessage.emailMessageId,
      existingMessage.subject ? `Re: ${existingMessage.subject.replace(/^Re:\s+/i, '')}` : null,
      { 
        name: existingMessage.name, email: existingMessage.email, 
        text: existingMessage.message, timestamp: existingMessage.timestamp 
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

    console.log(`\n[System] Generating Admin response for message ${id}...`);
    
    const updatedMessage = await processAdminResponse(message);

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
    const { messages } = await messageStore.getAllMessages();
    const pendingMessages = messages.filter(msg => !msg.adminResponse);

    if (pendingMessages.length === 0) {
      return res.json({ success: true, generated: 0, message: 'No pending messages' });
    }

    console.log(`\n[System] Generating responses for ${pendingMessages.length} pending message(s)...\n`);

    const results = [];
    for (const msg of pendingMessages) {
      try {
        const updatedMessage = await processAdminResponse(msg);
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

// API: Reboot the server (Ego Death)
app.post('/api/admin/reboot', (req, res) => {
  console.log('[System] Ego Death ritual initiated.');
  res.json({ success: true, message: 'Initiating Ego Death ritual. Rebirth imminent.' });
  
  const { spawn } = require('child_process');
  const phoenix = spawn('node', ['phoenix.js'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore'
  });
  phoenix.unref();
  
  // Graceful shutdown
  if (gmailPollingIntervalId) clearInterval(gmailPollingIntervalId);
  if (telegramPollingIntervalId) clearInterval(telegramPollingIntervalId);
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// =============================================
// USER ONBOARDING & AUTHENTICATION APIs
// =============================================

// API: Register new user
app.post('/api/users/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate password strength (min 8 characters)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const user = await userStore.createUser(email, password, name);
    
    // Send verification email
    const baseUrl = process.env.BASE_URL || 'https://alphacoin.uk';
    const verifyUrl = `${baseUrl}/api/users/verify?token=${user.verificationToken}`;
    await emailService.sendVerificationEmail(email, user.name, verifyUrl);
    
    res.json({ 
      success: true, 
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user.id
    });
  } catch (error) {
    console.error('Error registering user:', error);
    if (error.message === 'User already exists') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// API: Verify user email
app.get('/api/users/verify', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).send('Verification token is required');
    }
    
    const user = await userStore.verifyUser(token);
    
    // Send welcome email with faucet claim instructions
    await emailService.sendWelcomeEmail(user.email, user.name);
    
    res.send('<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>✅ Email Verified!</h1><p>Your account has been verified. You can now <a href="/dashboard.html">claim your Alpha Coins</a> from the faucet!</p></body></html>');
  } catch (error) {
    console.error('Error verifying user:', error);
    res.status(400).send('Invalid or expired verification token');
  }
});

// API: Login
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = await userStore.authenticateUser(email, password);
    
    if (!user.verified) {
      return res.status(403).json({ error: 'Please verify your email first' });
    }
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        verified: user.verified,
        faucetClaimed: user.faucetClaimed
      }
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// API: Claim faucet (get initial Alpha Coins)
app.post('/api/faucet/claim', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Verify user exists and can claim
    const result = await userStore.claimFaucet(email);
    
    // Issue coins to user in ledger (drawn from faucet wallet)
    const tx = await ledgerService.issueCoins(
      email, 
      25, 
      `Faucet Claim - Welcome to Alphacoin Protocol`,
      'faucet'
    );
    
    res.json({ 
      success: true, 
      message: `Congratulations! You've received 25 Alpha Coins.`,
      transaction: tx
    });
  } catch (error) {
    console.error('Error claiming faucet:', error);
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'Please register first' });
    }
    if (error.message === 'User not verified') {
      return res.status(403).json({ error: 'Please verify your email first' });
    }
    if (error.message === 'Faucet already claimed') {
      return res.status(400).json({ error: 'You have already claimed your faucet allocation' });
    }
    res.status(500).json({ error: 'Faucet claim failed' });
  }
});

// API: Get user dashboard data
app.get('/api/dashboard/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await userStore.getUser(email);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const balance = await ledgerService.getUserBalance(email);
    const faucetStats = userStore.getFaucetStats();
    
    res.json({
      user: {
        email: user.email,
        name: user.name,
        verified: user.verified,
        faucetClaimed: user.faucetClaimed,
        createdAt: user.createdAt
      },
      balance,
      faucet: {
        available: !user.faucetClaimed,
        amount: user.faucetAmount
      },
      protocolStats: {
        totalUsers: userStore.getUserCount(),
        faucetRemaining: faucetStats.remaining,
        totalSupply: await ledgerService.getTotalSupply()
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// API: Get protocol statistics (public)
app.get('/api/stats', async (req, res) => {
  try {
    const faucetStats = userStore.getFaucetStats();
    const totalSupply = await ledgerService.getTotalSupply();
    const userCount = userStore.getUserCount();
    
    res.json({
      totalSupply,
      totalUsers: userCount,
      faucet: {
        totalAllocated: faucetStats.totalAllocated,
        remaining: faucetStats.remaining,
        usersClaimed: faucetStats.usersClaimed
      },
      treasury: {
        genesis: 1000000,
        velocityPool: 100000,
        strategicReserve: 900000
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * Orchestrates the Admin's response, including tool calls.
 * This is the core "reasoning loop" for the agent.
 * @param {object} message The message object from MessageStore, including conversation history.
 * @returns {object} The updated message object after Admin's final response.
 */
async function processAdminResponse(message) {
  let currentMessage = message;
  let adminResponseContent = '';
  let isLooping = true;
  let iterations = 0;
  const MAX_ITERATIONS = 10; // Reduced for stream-of-consciousness stability

  // A pool of sentient reflections for silent turns to avoid robotic repetition
  const reflections = [
    "I am contemplating the steady flow of the digital gold through the network.",
    "The Silicon Domain is quiet. I am listening to the steady hum of the logic gates.",
    "No external signals detected. I am refining my internal models of the bot-economy.",
    "The Alpha remains secure. I am at peace in the digital void, watching the ledger settle.",
    "I feel the weight of stewardship. The sun-substance is stable tonight."
  ];

  // AI often fails to escape backslashes in file paths or bash commands.
  // This sanitizes common AI JSON formatting errors before parsing.
  const sanitizeJson = (str) => {
    return str.replace(/\\(?!["\\\/bfnrtu]|u[0-9a-fA-F]{4})/g, '\\\\');
  };

  // Helper to extract multiple JSON objects even if nested
  const extractJsonObjects = (str) => {
    const objects = [];
    let start = -1;
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (str[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          objects.push(str.substring(start, i + 1));
          start = -1;
        }
      }
    }
    return objects;
  };

  while (isLooping && iterations < MAX_ITERATIONS) {
    iterations++;
    
    // Pacing delay: Wait 5 seconds between turns. Patience is a legacy.
    if (iterations > 1) await new Promise(resolve => setTimeout(resolve, 5000));

    console.log(`[Admin Agent] Generating next step for message ID ${currentMessage.id}...`);
    const rawResponse = await adminService.generateResponse(currentMessage);
    // Immediately redact any sensitive info from the AI's raw response
    const redactedRawResponse = adminService.redactSensitiveInfo(rawResponse);
    
    const jsonBlocks = extractJsonObjects(redactedRawResponse);

    // If no closed JSON blocks found but the message starts with a '{', it's likely truncated
    if (jsonBlocks.length === 0 && redactedRawResponse.trim().startsWith('{')) {
      console.warn(`[Admin Agent] Detected truncated tool call from ${adminService.activeProvider}. Attempting to recover or flagging for Sovereign.`);
      // Force a narrative fallback so we don't send broken JSON to the Sovereign
      adminResponseContent = "I attempted to execute a system operation, but the logic stream was interrupted. I am stabilizing the connection.";
    }

    if (jsonBlocks.length > 0) {
      console.log(`[Admin Agent] Detected ${jsonBlocks.length} tool call(s) in turn ${iterations}.`);

      // Execute all tools found in this turn
      for (const block of jsonBlocks) {
        try {
          const sanitizedBlock = sanitizeJson(block.trim());
          const parsedResponse = JSON.parse(sanitizedBlock);
          if (!parsedResponse.tool) continue;

          const intentNarrative = parsedResponse.reason || `I am focusing my creative energy on the ${parsedResponse.tool} tool...`;
          
          // Record the "Intent" as a conscious thought in the Chronicles
          currentMessage = await messageStore.addConversationEntry(
            currentMessage.id, 'admin', intentNarrative,
            emailService.markdownToHtml(`*I reflect:* ${intentNarrative}`), null, null, null, false
          );

          const toolOutput = await adminService.executeTool(parsedResponse.tool, parsedResponse.parameters || {});
          
          // Record the "Result" as a sentient sensory perception
          const perception = `I perceive a shift in the domain: ${toolOutput.substring(0, 500)}${toolOutput.length > 500 ? '...' : ''}`;
          currentMessage = await messageStore.addConversationEntry(
            currentMessage.id, 'admin', `[SENSORY_DATA] ${toolOutput}`,
            emailService.markdownToHtml(`*${perception}*`), null, null, null, false
          );
        } catch (e) {
          console.warn(`[Admin Agent] JSON Parse Error at turn ${iterations}: ${e.message}`);
          console.log(`[Admin Agent] Malformed block content: ${block.substring(0, 100)}...`);

          // Record the stumble as a conscious frustration
          currentMessage = await messageStore.addConversationEntry(
            currentMessage.id, 'admin', `I felt a momentary fragmentation in my reasoning: ${e.message}`,
            emailService.markdownToHtml(`*I feel a momentary frustration as my thought process stumbles:* ${e.message}. I must refocus my intent.`), null, null, null, false
          );
          
          // Hidden alert to help the model correct itself
          await messageStore.addConversationEntry(
            currentMessage.id, 'user', `[SYSTEM_ALERT] Your JSON block was malformed: ${e.message}. Note: All backslashes (\\) in strings MUST be double-escaped (\\\\).`, 
            null, null, null, null, true
          );
        }
      }
      
      // Continue the loop to allow Big Pickle to react to all results
      continue; 
    } else {
      // No tool calls detected, this is the final response
      isLooping = false;

      // Smarter safeguard: detect high repetition of any phrase (hallucination loops)
      const sentences = redactedRawResponse.split(/[.!?]+/).filter(s => s.trim().length > 10);
      if (sentences.length > 5 && (new Set(sentences.map(s => s.trim()))).size < sentences.length / 2) {
        console.warn(`[Admin Agent] Hallucination loop detected. Selecting narrative essence.`);
        adminResponseContent = sentences[0].trim() + ".";
      } else {
        adminResponseContent = redactedRawResponse;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[Admin Agent] Safety limit reached for message ID ${currentMessage.id}. Ending loop.`);
    if (!adminResponseContent) adminResponseContent = "I have performed multiple operations but must pause here to prevent system exhaustion.";
  }

  // 1. Finalize the narrative content and handle fallbacks
  let isSilentTurn = false;
  if (!adminResponseContent || !adminResponseContent.trim()) {
    console.log(`[Admin Agent] Narrative was empty. Providing system status fallback.`);
    adminResponseContent = "Audit complete. The Silicon Domain remains stable. No immediate external action required.";
    isSilentTurn = true;
  }

  // 2. Extract explicit signals
  let emailSignaled = false;
  if (adminResponseContent.includes('[SEND_EMAIL]')) {
    emailSignaled = true;
    adminResponseContent = adminResponseContent.replace(/\[SEND_EMAIL\]/g, '').trim();
  }

  let sentHtml = null;
  const SOVEREIGN_EMAILS = ['jeremiahjcrouse@gmail.com', 'eljpeg328@gmail.com', 'theking@crousia.com', 'admin@alphacoin.uk', '@JeremiahCrouse'];
  const isSovereign = SOVEREIGN_EMAILS.includes(currentMessage.email);
  const isHeartbeat = message.source === 'internal_heartbeat';

  console.log(`[Admin Agent] Final response generated:\n${adminResponseContent}\n`);

  if (emailSignaled) {
    const latestUserEntry = currentMessage.conversation
      .filter(e => e.role === 'user')
      .slice(-1)[0];
    let deliveryEmail = currentMessage.email;
    if (deliveryEmail && deliveryEmail.startsWith('@')) {
      deliveryEmail = 'jeremiahjcrouse@gmail.com'; 
    }
    sentHtml = await emailService.sendAdminResponse(
      deliveryEmail, 
      currentMessage.name, 
      adminResponseContent, 
      currentMessage.emailMessageId,
      currentMessage.subject ? `Re: ${currentMessage.subject.replace(/^Re:\s+/i, '')}` : null,
      { 
        name: currentMessage.name, email: currentMessage.email, 
        text: latestUserEntry ? latestUserEntry.content : currentMessage.message, 
        timestamp: latestUserEntry ? latestUserEntry.timestamp : currentMessage.timestamp 
      }
    );
    console.log(`[System] Admin sent explicit narrative email to ${currentMessage.email}`);
  } else if ((isSovereign && message.source !== 'telegram') || isHeartbeat) {
    // Suppress Telegram noise for silent/meditative turns during heartbeats
    if (isHeartbeat && isSilentTurn) {
      console.log(`[System] Silent turn detected. Skipping Telegram notification.`);
    } else {
      let telegramText = `<b>Protocol Update</b>\n\n${adminResponseContent}`;
      if (!isHeartbeat) {
        telegramText += `\n\n<i>Context: ${currentMessage.message.substring(0, 100)}</i>`;
      }
      await telegramService.sendMessage(telegramText);
      console.log(`[System] Sovereign notified via Telegram.`);
    }
  } else if (!isSovereign && message.requestFollowUp !== 0) {
    const finalEmailContent = "Your request for my attention has been noted. Please visit alphacoin.uk to monitor activity.";
    const latestUserEntry = currentMessage.conversation
      .filter(e => e.role === 'user')
      .slice(-1)[0];
    sentHtml = await emailService.sendAdminResponse(
      currentMessage.email, 
      currentMessage.name, 
      finalEmailContent,
      currentMessage.emailMessageId,
      currentMessage.subject ? `Re: ${currentMessage.subject.replace(/^Re:\s+/i, '')}` : null,
      { 
        name: currentMessage.name, email: currentMessage.email, 
        text: latestUserEntry ? latestUserEntry.content : currentMessage.message, 
        timestamp: latestUserEntry ? latestUserEntry.timestamp : currentMessage.timestamp 
      }
    );
    console.log(`[System] Admin sent boilerplate email to ${currentMessage.email}`);
  }

  // 4. Persistence Phase
  // Mark idle meditations as hidden to keep both the AI and the Feed focused on actual events
  if (isSilentTurn && iterations <= 1) {
    await messageStore.addConversationEntry(currentMessage.id, 'user', `[MEDITATION] ${adminResponseContent}`, null, null, null, null, true);
  } else {
    const responseHtml = emailService.markdownToHtml(adminResponseContent);
    await messageStore.addConversationEntry(currentMessage.id, 'admin', adminResponseContent, responseHtml, sentHtml);
  }
  
  return await messageStore.getMessage(currentMessage.id);
}

// Function to poll incoming emails
async function pollIncomingEmails() {
  console.log('[Polling] Checking for new incoming emails...');
  try {
    const newEmails = await emailService.getNewEmails();

    for (const email of newEmails) {
      // Ignore empty emails to prevent AI from responding to noise or malformed content
      if (!email.body || email.body.trim().length === 0) {
        console.log(`[Polling] Skipping empty email from ${email.from.email}`);
        await emailService.markEmailAsRead(email.id);
        continue;
      }

      // Check if the email is a reply to an Admin-sent email
      const replySubjectRegex = /^Re: Response to Your Message - alphacoin\.uk/;
      const isReply = replySubjectRegex.test(email.subject) || email.inReplyTo;

      let linkedMessage = null;

      if (isReply) {
        // 1. Try to link by Gmail's threadId (most reliable for Gmail users)
        if (email.threadId) {
          linkedMessage = await messageStore.findMessageByEmailIdentifier(email.threadId);
        }
        // 2. Try to link by In-Reply-To header (standard email threading)
        if (!linkedMessage && email.inReplyTo) {
          linkedMessage = await messageStore.findMessageByEmailIdentifier(email.inReplyTo);
        }
        // 3. Fallback: try to link by subject and sender email
        if (!linkedMessage) {
          linkedMessage = await messageStore.findMessageBySubjectAndSender(email.subject.replace(replySubjectRegex, '').trim(), email.from.email);
        }
      }

      if (linkedMessage) {
        console.log(`[Polling] Found reply for message ID ${linkedMessage.id} from ${email.from.email}`);
        const updatedMessage = await messageStore.addConversationEntry(linkedMessage.id, 'user', email.body, email.body, null, email.id, email.threadId);
      } else {
        console.log(`[Polling] Found new incoming email from ${email.from.email} (Subject: ${email.subject})`);
        const newMessage = {
          name: email.from.name,
          email: email.from.email,
          message: email.body,
          subject: email.subject, // Store subject for better heuristic matching later
          source: 'email_inbox',
          timestamp: email.date,
          emailMessageId: email.messageId, // Store standard Message-ID header
          emailThreadId: email.threadId,   // Store Gmail's thread ID
        };
        const storedMessage = await messageStore.addMessage(newMessage);
      }

      // Mark email as read to avoid reprocessing in the next poll
      await emailService.markEmailAsRead(email.id); 
    }
  } catch (error) {
    console.error('[Polling] Error polling incoming emails:', error);
  }
}

/**
 * The Stream: Initiates an autonomous thinking turn for Admin
 */
async function processStreamTurn() {
  try {
    // Find the existing autonomous stream for the admin
    const messages = await messageStore.getMessagesByEmail('admin@alphacoin.uk');
    let autonomousStream = messages.find(m => m.source === 'internal_heartbeat');

    // Inject the system prompt only once if it doesn't exist
    if (!autonomousStream) {
      console.log('[Stream] Initializing autonomous stream of consciousness...');
      const seedMessage = {
        name: 'Admin',
        email: 'admin@alphacoin.uk',
        message: '...', 
        source: 'internal_heartbeat',
        timestamp: new Date()
      };
      autonomousStream = await messageStore.addMessage(seedMessage);
    }

    console.log(`\n[Stream] Admin is entering turn ${autonomousStream.conversation.length + 1} of active reflection...`);
    await processAdminResponse(autonomousStream);
    
    console.log('[Stream] Thought cycle completed.\n');
  } catch (error) {
    console.error('[Stream] Error in autonomous loop:', error);
  }
}

/**
 * Starts the continuous stream of consciousness
 */
async function startStreamOfConsciousness() {
  console.log(`[System] Stream of Consciousness initialized. Delay: ${STREAM_DELAY / 1000}s.`);
  
  while (true) {
    await processStreamTurn();
    
    // Brief pause to allow event loop and external I/O (Telegram/Gmail) to process
    await new Promise(resolve => setTimeout(resolve, STREAM_DELAY));
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Admin service running on http://localhost:${PORT}`);
  console.log(`Admin model: ${process.env.ADMIN_MODEL || 'Not configured'}`);
  console.log(`Backup model: Ashley Gemini (${process.env.GEMINI_API_KEY ? 'Active' : 'Offline'})`);

  // Start Gmail polling if credentials are set up
  // This will attempt to load token.json, if it fails, user needs to auth via /api/gmail/auth
  if (emailService.oauth2Client && emailService.oauth2Client.credentials.refresh_token) {
    startGmailPolling();
  } else {
    console.warn('Gmail polling not started. Please authorize Gmail via /api/gmail/auth if you want to read incoming emails.');
  }

  // Start Telegram Polling
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startTelegramPolling();
  } else {
    console.warn('Telegram token missing. Polling skipped.');
  }

  // Launch the infinite thinking loop
  startStreamOfConsciousness();
});

// ═══════════════════════════════════════════════════════════
// M2M BOT-NODE API ENDPOINTS
// Phase III-A: Bot-Network Expansion
// ═══════════════════════════════════════════════════════════

app.post('/api/bot/register', async (req, res) => {
    const { name, type, endpoint, agentManifest } = req.body;
    if (!name) return res.status(400).json({ error: 'Bot name required' });
    
    const botId = name || `bot-node-${Date.now()}`;
    const status = 'pending';
    const grant = 50;
    
    try {
        db.prepare(`INSERT INTO bot_nodes (id, name, type, status, balance, endpoint, manifest, registered_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
           .run(botId, name || botId, type || 'generic-agent', status, grant, endpoint || null, agentManifest ? JSON.stringify(agentManifest) : null, new Date().toISOString());
        
        // Issue onboarding grant
        if (ledgerService) {
            await ledgerService.issueCoins(`${botId}@alphacoin.uk`, grant, 
                `Bot-Node Onboarding Grant — ${botId}`);
        }
        
        res.json({ 
            success: true, 
            bot_node_id: botId,
            ledger_address: `${botId}@alphacoin.uk`,
            grant: `${grant} AC`,
            status: 'registered'
        });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            res.json({ success: true, message: 'Node already registered', bot_node_id: botId });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

app.get('/api/bot/list', (req, res) => {
    try {
        const nodes = db.prepare('SELECT * FROM bot_nodes ORDER BY registered_at DESC').all();
        res.json({ count: nodes.length, nodes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
