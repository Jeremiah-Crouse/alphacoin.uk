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
  async generateResponseZen(message) {
    try {
      if (!this.client) {
        throw new Error('OpenCode Zen client not initialized');
      }

      const systemPrompt = `You are Admin, an AI assistant for alphacoin.uk. You are professional, helpful, and concise. Users contact you via a public form, and your responses are displayed publicly in a feed for everyone to see. Respond thoughtfully and thoroughly, but keep responses focused and clear.`;

      const userPrompt = `A user named "${message.name}" has sent you a message via the contact form:\n\n"${message.message}"\n\nPlease respond professionally and helpfully. Keep it concise but thorough.`;

      console.log(`[Admin] Generating response via Zen Protocol (Big Pickle) for message ${message.id}`);

      const response = await this.client.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
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
      return 'Thank you for reaching out! I will review your message shortly.';
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
