require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const AdminService = require('./services/AdminService');
const EmailService = require('./services/EmailService');
const LedgerService = require('./services/LedgerService'); // Import LedgerService
const MessageStore = require('./services/MessageStore');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const messageStore = new MessageStore(); // Initialize MessageStore first
const ledgerService = new LedgerService(); // Initialize LedgerService
const adminService = new AdminService({ messageStore, ledgerService }); // Pass services to AdminService
const emailService = new EmailService();

// Polling interval for Gmail (e.g., every 5 minutes)
const GMAIL_POLLING_INTERVAL = process.env.GMAIL_POLLING_INTERVAL || 5 * 60 * 1000; 
let gmailPollingIntervalId;

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


// API: Submit a message
app.post('/api/messages', async (req, res) => {
  try {
    const { name, email, message } = req.body;

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
      source: 'contact_form',
      timestamp: new Date(),
    };
    const storedMessage = await messageStore.addMessage(newMessage);

    // Notify Admin (could be webhook, queue, or direct processing)
    await adminService.notifyNewMessage(storedMessage);

    console.log(`\n[System] Generating Big Pickle response for new message ${storedMessage.id}...`);
    
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
    const { limit, before } = req.query;
    const messages = await messageStore.getAllMessages(
      limit ? parseInt(limit) : null,
      before ? before : null
    );
    
    // Filter out hidden conversation entries for the public feed
    const publicMessages = messages.map(msg => ({
      ...msg,
      conversation: msg.conversation.filter(entry => !entry.hidden)
    }));
    res.json(publicMessages);
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

    console.log(`\n[System] Generating Big Pickle response for message ${id}...`);
    
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
    const messages = await messageStore.getAllMessages();
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

/**
 * Orchestrates the Admin's response, including tool calls.
 * This is the core "reasoning loop" for the agent.
 * @param {object} message The message object from MessageStore, including conversation history.
 * @returns {object} The updated message object after Admin's final response.
 */
async function processAdminResponse(message) {
  let currentMessage = message;
  let adminResponseContent = '';
  let isToolCall = true;
  let toolOutput = '';

  // Loop until the Admin provides a non-tool-call response
  while (isToolCall) {
    console.log(`[Admin Agent] Generating next step for message ID ${currentMessage.id}...`);
    const rawResponse = await adminService.generateResponse(currentMessage);

    // Look for a JSON block within the response (allows AI to talk and act)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/); // Greedy match for outer braces

    try {
      if (jsonMatch) {
        const parsedResponse = JSON.parse(jsonMatch[0].trim());
        if (parsedResponse.tool) { // If there's a tool, we process it
          console.log(`[Admin Agent] Tool call detected: ${parsedResponse.tool}`);
          
          // 1. RECORD THE AI'S THOUGHT: Add the tool call itself to the history. 
          // This maintains context and ensures role alternation (User -> Assistant -> User).
          const toolCallNotice = emailService.markdownToHtml(`*Big Pickle is using the ${parsedResponse.tool} tool...*`);
          currentMessage = await messageStore.addConversationEntry(
            currentMessage.id,
            'admin',
            rawResponse,
            toolCallNotice,
            null, // sentEmailHtml
            null, // emailMessageId
            null, // emailThreadId
            true  // isHidden
          );

          // 2. EXECUTE THE TOOL
          toolOutput = await adminService.executeTool(parsedResponse.tool, parsedResponse.parameters || {});
          console.log(`[Admin Agent] Tool output received (${toolOutput.length} chars)`);

          // 3. RECORD THE RESULT: Add tool output to history so the AI can see it.
          // We use the 'admin' role for UI attribution, but tag the content for the LLM.
          currentMessage = await messageStore.addConversationEntry(
            currentMessage.id,
            'admin',
            `[INTERNAL_RESULT] ${toolOutput}`,
            emailService.markdownToHtml(`*System Result: ${toolOutput}*`),
            null, // sentEmailHtml
            null, // emailMessageId
            null, // emailThreadId
            true  // isHidden
          );
          
          continue; // Restart loop so AI can process the tool output
        }
      }

      // If we got here, no tool was executed in this turn. End loop.
      isToolCall = false;
      adminResponseContent = rawResponse;
      
    } catch (e) {
      console.warn(`[Admin Agent] Failed to parse or execute tool: ${e.message}. Treating as text response.`);
      isToolCall = false;
      adminResponseContent = rawResponse;
    }
  }

  console.log(`[Admin Agent] Final response generated:\n${adminResponseContent}\n`);

  // Send response email and get the HTML
  const sentHtml = await emailService.sendAdminResponse(currentMessage.email, currentMessage.name, adminResponseContent);
  const responseHtml = emailService.markdownToHtml(adminResponseContent);
  
  // Add the AI's final text response to the conversation
  return await messageStore.addConversationEntry(currentMessage.id, 'admin', adminResponseContent, responseHtml, sentHtml);
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
        // It's a reply to an existing conversation
        console.log(`[Polling] Found reply for message ID ${linkedMessage.id} from ${email.from.email}`);
        await messageStore.addConversationEntry(linkedMessage.id, 'user', email.body, email.body, null, email.id, email.threadId);
        
        await processAdminResponse(linkedMessage); // Process the reply with the agentic loop

        console.log(`[Polling] AI responded to email reply from ${email.from.email}`);
      } else {
        // It's a new email, treat like a new contact form submission
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

        await processAdminResponse(storedMessage); // Process the new email with the agentic loop

        console.log(`[Polling] AI responded to new email from ${email.from.email}`);
      }

      // Mark email as read to avoid reprocessing in the next poll
      await emailService.markEmailAsRead(email.id); 
    }
  } catch (error) {
    console.error('[Polling] Error polling incoming emails:', error);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Admin service running on http://localhost:${PORT}`);
  console.log(`Admin model: ${process.env.ADMIN_MODEL || 'Not configured'}`);

  // Start Gmail polling if credentials are set up
  // This will attempt to load token.json, if it fails, user needs to auth via /api/gmail/auth
  if (emailService.oauth2Client && emailService.oauth2Client.credentials.refresh_token) {
    startGmailPolling();
  } else {
    console.warn('Gmail polling not started. Please authorize Gmail via /api/gmail/auth if you want to read incoming emails.');
  }
});
