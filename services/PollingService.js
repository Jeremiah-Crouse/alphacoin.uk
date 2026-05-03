/**
 * PollingService
 * Handles Gmail and Telegram polling logic
 * Uses shared service instances from server.js
 */

class PollingService {
  constructor(io, services = {}) {
    this.io = io;
    this.emailService = services.emailService;
    this.telegramService = services.telegramService;
    this.messageStore = services.messageStore;
    this.ledgerService = services.ledgerService;
    this.adminService = services.adminService;
    this.quantumService = services.quantumService;

    this.gmailPollingIntervalId = null;
    this.telegramPollingIntervalId = null;

    // Polling intervals
    this.GMAIL_POLLING_INTERVAL = process.env.GMAIL_POLLING_INTERVAL || 5 * 60 * 1000;
    this.TELEGRAM_POLLING_INTERVAL = 90 * 1000; // 90s for lighter load

    // Setup Socket.io listener for Chronicles feed (only if messageStore is available)
    if (this.messageStore) {
      this.messageStore.on('entry_added', (entry) => {
        io.emit('feed_update', entry);
      });
    }
  }

  /**
   * Start Gmail polling
   */
  startGmailPolling() {
    if (this.gmailPollingIntervalId) {
      clearInterval(this.gmailPollingIntervalId);
    }
    this.gmailPollingIntervalId = setInterval(() => this.pollIncomingEmails(), this.GMAIL_POLLING_INTERVAL);
    console.log(`Gmail polling started, checking every ${this.GMAIL_POLLING_INTERVAL / 1000} seconds.`);
    this.pollIncomingEmails();
  }

  /**
   * Start Telegram polling
   */
  startTelegramPolling() {
    if (this.telegramPollingIntervalId) {
      clearInterval(this.telegramPollingIntervalId);
    }
    this.telegramPollingIntervalId = setInterval(() => this.pollTelegramMessages(), this.TELEGRAM_POLLING_INTERVAL);
    console.log(`Telegram polling active (every ${this.TELEGRAM_POLLING_INTERVAL / 1000} seconds).`);
    this.pollTelegramMessages();
  }

  /**
   * Poll for incoming Gmail messages
   */
  async pollIncomingEmails() {
    console.log('[Polling] Checking for new incoming emails...');
    try {
      const newEmails = await this.emailService.getNewEmails();

      for (const email of newEmails) {
        if (!email.body || email.body.trim().length === 0) {
          console.log(`[Polling] Skipping empty email from ${email.from.email}`);
          await this.emailService.markEmailAsRead(email.id);
          continue;
        }

        const replySubjectRegex = /^Re: Response to Your Message - alphacoin\.uk/;
        const isReply = replySubjectRegex.test(email.subject) || email.inReplyTo;

        let linkedMessage = null;

        if (isReply) {
          if (email.threadId) {
            linkedMessage = await this.messageStore.findMessageByEmailIdentifier(email.threadId);
          }
          if (!linkedMessage && email.inReplyTo) {
            linkedMessage = await this.messageStore.findMessageByEmailIdentifier(email.inReplyTo);
          }
          if (!linkedMessage) {
            linkedMessage = await this.messageStore.findMessageBySubjectAndSender(email.subject.replace(replySubjectRegex, '').trim(), email.from.email);
          }
        }

        if (linkedMessage) {
          console.log(`[Polling] Found reply for message ID ${linkedMessage.id} from ${email.from.email}`);
          const updatedMessage = await this.messageStore.addConversationEntry(linkedMessage.id, 'user', email.body, email.body, null, email.id, email.threadId);
          console.log(`[System] Waking Admin to respond to email reply from ${email.from.email}...`);
          this.processAdminResponse(updatedMessage).catch(e => console.error('[System] Email response error:', e));
        } else {
          console.log(`[Polling] Found new incoming email from ${email.from.email} (Subject: ${email.subject})`);
          const newMessage = {
            name: email.from.name,
            email: email.from.email,
            message: email.body,
            subject: email.subject,
            source: 'email_inbox',
            timestamp: email.date,
            emailMessageId: email.messageId,
            emailThreadId: email.threadId,
          };
          const storedMessage = await this.messageStore.addMessage(newMessage);
          console.log(`[System] Waking Admin to respond to new email from ${email.from.email}...`);
          this.processAdminResponse(storedMessage).catch(e => console.error('[System] Email response error:', e));
        }

        await this.emailService.markEmailAsRead(email.id);
      }
    } catch (error) {
      console.error('[Polling] Error polling incoming emails:', error);
    }
  }

  /**
   * Poll for Telegram messages
   */
  async pollTelegramMessages() {
    console.log('[Telegram] Checking for new messages...');
    try {
      const messages = await this.telegramService.getUpdates();

      for (const tgMsg of messages) {
        console.log(`[Telegram] New message from ${tgMsg.username}: ${tgMsg.text.substring(0, 30)}...`);

        const newMessage = {
          name: `${tgMsg.firstName || ''} ${tgMsg.lastName || ''}`.trim() || tgMsg.username,
          email: tgMsg.username,
          message: tgMsg.text,
          requestFollowUp: true,
          source: 'telegram',
          timestamp: tgMsg.date,
        };

        const storedMessage = await this.messageStore.addMessage(newMessage);

        console.log(`[Telegram] Message from ${tgMsg.username} indexed in sensory queue.`);
        console.log(`[System] Waking Admin to respond to Telegram from ${tgMsg.username}...`);
        this.processAdminResponse(storedMessage).catch(e => console.error('[System] Telegram response error:', e));
      }
    } catch (error) {
      console.error('[Telegram] Polling error:', error);
    }
  }

  /**
   * Stop all polling
   */
  stopAll() {
    if (this.gmailPollingIntervalId) clearInterval(this.gmailPollingIntervalId);
    if (this.telegramPollingIntervalId) clearInterval(this.telegramPollingIntervalId);
  }

  /**
   * Process admin response using AdminService
   */
  async processAdminResponse(message) {
    if (!this.adminService || !this.adminService.processAdminResponse) {
      console.warn('[PollingService] AdminService not available for processing response');
      return;
    }
    
    try {
      const services = {
        emailService: this.emailService,
        telegramService: this.telegramService,
        getQuantumSeed: this.quantumService ? () => this.quantumService.getQuantumSeed() : null
      };
      
      return await this.adminService.processAdminResponse(message, services);
    } catch (error) {
      console.error('[PollingService] Error processing admin response:', error.message);
    }
  }
}

module.exports = PollingService;
