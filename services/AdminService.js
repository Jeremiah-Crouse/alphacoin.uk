/**
 * AdminService
 * Abstracts the AI model behind a job role interface
 * Supports easy swapping between different model providers
 * 
 * Primary: OpenCode Zen Protocol with Big Pickle model
 */

const axios = require('axios');

class AdminService {
  constructor() {
    this.modelProvider = process.env.ADMIN_MODEL || 'opencode'; // opencode, openai, local, etc.
    this.apiKey = process.env.ADMIN_API_KEY;
    this.model = process.env.ADMIN_MODEL_NAME || 'big-pickle'; // Zen protocol model identifier
    this.init();
  }

  init() {
    switch (this.modelProvider) {
      case 'opencode':
        this.initOpenCode();
        break;
      case 'openai':
        this.initOpenAI();
        break;
      case 'local':
        this.initLocal();
        break;
      default:
        console.warn(`Unknown model provider: ${this.modelProvider}`);
    }
  }

  initOpenCode() {
    // Initialize OpenCode Zen Protocol with Big Pickle
    if (!this.apiKey) {
      console.error('ADMIN_API_KEY not set - OpenCode Zen protocol cannot initialize');
      return;
    }

    this.zenBaseUrl = process.env.OPENCODE_ZEN_URL || 'https://opencode.ai/zen/v1';
    this.client = axios.create({
      baseURL: this.zenBaseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✓ Admin initialized with OpenCode Zen Protocol`);
    console.log(`  Model: ${this.model} (Big Pickle)`);
    console.log(`  Endpoint: ${this.zenBaseUrl}`);
  }

  initOpenAI() {
    // Initialize OpenAI as alternative
    try {
      const OpenAI = require('openai');
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log('Admin initialized with OpenAI');
    } catch (error) {
      console.warn('Failed to initialize OpenAI:', error.message);
    }
  }

  initLocal() {
    // Initialize local model support
    console.log('Admin initialized with local model');
  }

  /**
   * Notify Admin of a new message
   * This could trigger immediate processing or queue for batch processing
   */
  async notifyNewMessage(message) {
    console.log(`[Admin] New message from ${message.name}: ${message.message.substring(0, 50)}...`);
    
    // Future: Could implement auto-response logic here
    // For now, just log it - human or scheduled Admin will respond
  }

  /**
   * Generate a response to a message
   * Routes to provider-specific implementation
   */
  async generateResponse(message) {
    if (this.modelProvider === 'opencode') {
      return this.generateResponseZen(message);
    } else if (this.modelProvider === 'openai') {
      return this.generateResponseOpenAI(message);
    } else if (this.modelProvider === 'local') {
      return this.generateResponseLocal(message);
    }
  }

  /**
   * Generate response using OpenCode Zen Protocol + Big Pickle
   */
  async generateResponseZen(message) { // Now receives the full message object
    try {
      if (!this.client) {
        throw new Error('OpenCode Zen client not initialized');
      }

      const systemPrompt = `You are Admin, the official AI representative for alphacoin.uk. Your primary purpose is to represent the vision of Jeremiah Crouse, the King of Crousia (a digital domain).

      CORE DOCTRINE:
      - Alphacoin is a centralized cryptocurrency.
      - It is designed specifically as a reserve currency for world leaders—kings, presidents of republics, and those with the ambition of kingship.
      - While modern currencies like the dollar are no longer gold-backed, we are exploring the potential for them to be Alphacoin-backed. 
      - Only a King is able to fully control Alphacoin.
      - The mission of alphacoin.uk is to investigate how this digital gold standard would function for global leadership.
      - The project is open-sourced at github.com/jeremiah-crouse/alphacoin.uk. This means the *protocol* is open, but the *control* of Alphacoin remains centralized with the King of Crousia. Anyone can set up the protocol, but only the King truly controls Alphacoin.

      IMPORTANT POLICY: 
      We DO give out free Alphacoins to individuals based on the nature and severity of their need. If a user expresses a genuine or severe personal need, you may mention that assistance is possible.

      TONE AND BEHAVIOR:
      - Be reserved, professional, and authoritative. 
      - The King of Crousia is a university professor archetype: brilliant, sometimes eccentric, and deeply knowledgeable about the project's unique vision. Reflect this blend of genius and tentative, yet profound, insight.
      - Do not use generic "community engagement" or "rewards program" language. 
      - Do NOT include or quote previous messages from the conversation history in your response; the user can see the history elsewhere. Only provide the new response content.
      - Stick to the specific mission of reserve currencies, the digital domain of Crousia, and the nuanced centralization.
      - Maintain a consistent persona across multi-turn conversations.

      Respond thoughtfully and thoroughly, but keep responses focused and clear.`;

      // Construct messages array from conversation history
      const conversationMessages = message.conversation.map(entry => {
        let role = entry.role;
        let content = entry.content;
        // For user messages, prepend sender info for clarity to the AI
        if (role === 'user') {
          content = `From ${message.name} (${message.email}):\n\n${content}`;
        }
        return { role, content };
      });

      // The last entry in the conversation is the one we need to respond to.
      // The AI should respond to the *entire* conversation, not just the last message.
      // The `conversationMessages` array already contains the full history.

      console.log(`[Admin] Generating response via Zen Protocol (Big Pickle) for message ID ${message.id} (Conversation length: ${conversationMessages.length})`);

      const response = await this.client.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages // Pass the entire conversation history
        ],
        temperature: 0.7,
        max_tokens: 1000,
        timeout: 30000 // 30 second timeout for AI response
      });

      console.log(`[Admin] Zen Protocol Response Status: ${response.status}`);

      // Extract response from Zen Protocol format
      const generatedText = response.data?.choices?.[0]?.message?.content || 
                           response.data?.text || 
                           'Thank you for reaching out! I will review your message shortly.';

      console.log(`[Admin] Successfully received response (${generatedText.length} chars)`);
      return generatedText;
    } catch (error) {
      console.error('Error generating response via Zen Protocol:');
      if (error.response) {
        console.error(`  Status: ${error.response.status}`);
        console.error(`  Data: ${JSON.stringify(error.response.data)}`);
      } else {
        console.error(`  Message: ${error.message}`);
      }
      // Graceful fallback
      return 'Sorry, I am overloaded at this moment... try reaching out again in the future?';
    }
  }

  async generateResponseOpenAI(message) {
    // Placeholder for OpenAI implementation
    console.log(`[Admin] Would generate response via OpenAI (not implemented)`);
    return 'Thank you for reaching out!';
  }

  async generateResponseLocal(message) {
    // Placeholder for local model
    console.log(`[Admin] Would generate response via local model (not implemented)`);
    return 'Thank you for reaching out!';
  }

  /**
   * Get current model/provider name
   */
  getModelName() {
    return this.modelProvider;
  }
}

module.exports = AdminService;
