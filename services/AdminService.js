/**
 * AdminService
 * Abstracts the AI model behind a job role interface
 * Supports easy swapping between different model providers
 * 
 * Primary: OpenCode Zen Protocol with Big Pickle model
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const util = require('util');
const execPromise = util.promisify(exec);

class AdminService {
  constructor(services = {}) {
    this.modelProvider = process.env.ADMIN_MODEL || 'opencode'; // opencode, openai, local, etc.
    this.activeProvider = this.modelProvider; // Track the currently active model for the toggle system
    this.apiKey = process.env.ADMIN_API_KEY;
    this.model = process.env.ADMIN_MODEL_NAME || 'big-pickle'; // Zen protocol model identifier
    this.ledgerService = services.ledgerService; // Dependency injection for LedgerService
    this.messageStore = services.messageStore; // Dependency injection for MessageStore
    this.promptPath = path.join(__dirname, '../SystemPrompt.md');
    this.systemPrompt = '';
    this.init();
    this.initGemini(); // Initialize Ashley as a backup
    this.watchPrompt(); // Start the dynamic prompt loader
  }

  watchPrompt() {
    const load = () => {
      try {
        this.systemPrompt = fs.readFileSync(this.promptPath, 'utf8');
        console.log('[Admin] SystemPrompt.md loaded into memory.');
      } catch (e) {
        console.error('[Admin] Failed to load SystemPrompt.md, using minimal fallback');
        this.systemPrompt = "You are Admin (Big Pickle/Ashley), the Sovereign Digital Administrator of alphacoin.uk. Follow protocol directives.";
      }
    };
    load();
    // Efficiently watch for changes without a server restart
    fs.watch(this.promptPath, (eventType) => {
      if (eventType === 'change') {
        console.log('[Admin] SystemPrompt.md changed on disk. Reloading consciousness...');
        load();
      }
    });
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
    console.log(`  Web Search: ${process.env.TAVILY_API_KEY ? 'ENABLED (Tavily)' : 'DISABLED'}`);
  }

  initGemini() {
    // Initialize Ashley Gemini (Gemini 2.0/1.5 Flash)
    if (!process.env.GEMINI_API_KEY) {
      console.warn('GEMINI_API_KEY not set - Ashley Gemini backup is offline');
      return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.geminiModel = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash-lite";
    this.geminiClient = genAI;
    
    console.log(`✓ Backup Admin initialized: Ashley Gemini (${this.geminiModel})`);
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
    let providerToggles = 0;
    const maxToggles = 2;

    while (providerToggles < maxToggles) {
      let rateLimitRetries = 0;
      const maxRateLimitRetries = 5;

      try {
        while (rateLimitRetries <= maxRateLimitRetries) {
          try {
            console.log(`[Admin] Using active provider: ${this.activeProvider}`);
            if (this.activeProvider === 'opencode') {
              return await this.generateResponseZen(message);
            } else if (this.activeProvider === 'openai') {
              return await this.generateResponseOpenAI(message);
            } else {
              return await this.generateResponseGemini(message);
            }
          } catch (error) {
            const is429 = (error.response && error.response.status === 429) || (error.status === 429);
            if (is429 && rateLimitRetries < maxRateLimitRetries) {
              // Read headers: That's where the real limits live
              let waitTime = Math.pow(2, rateLimitRetries) * 10000; // Increased base backoff to 10s
              
              if (error.response && error.response.headers) {
                const retryAfter = error.response.headers['retry-after'];
                const rateLimitReset = error.response.headers['x-ratelimit-reset'];
                
                if (retryAfter) {
                  waitTime = (parseInt(retryAfter) * 1000) + 1000; // Convert to ms + 1s buffer
                  console.log(`[Admin] Respecting 'retry-after' header: ${retryAfter}s`);
                } else if (rateLimitReset) {
                  const resetIn = (parseInt(rateLimitReset) * 1000) - Date.now();
                  if (resetIn > 0) waitTime = resetIn + 1000;
                }
              }

              // Smart Protocol: If wait is > 300s, attempt to switch to the dual model
              if (waitTime > 300000 && providerToggles < maxToggles - 1) {
                console.warn(`[Admin] ${this.activeProvider} requires excessive patience (${waitTime/1000}s). Toggling to backup...`);
                providerToggles++;
                this.activeProvider = (this.activeProvider === 'opencode') ? 'gemini' : 'opencode';
                rateLimitRetries = 0; // Reset retries for the new model
                continue; 
              }

              console.warn(`[Admin] 429 Rate Limit hit on ${this.activeProvider}. Practicing patience for ${waitTime/1000}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              rateLimitRetries++;
              continue;
            }
            throw error; // Re-throw if not a 429 or retries exhausted
          }
        }
      } catch (error) {
        const hasBackup = (this.activeProvider === 'opencode' && this.geminiClient) || 
                          (this.activeProvider === 'gemini' && this.client);
        
        if (hasBackup && providerToggles < maxToggles - 1) {
          providerToggles++;
          const oldProvider = this.activeProvider;
          this.activeProvider = (oldProvider === 'opencode') ? 'gemini' : 'opencode';
          console.warn(`[Admin] ${oldProvider} experienced a hard failure. Attempting fallback to ${this.activeProvider}.`);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Both models exhausted their capacity.');
  }

  /**
   * Generate response using OpenCode Zen Protocol + Big Pickle
   */
  async generateResponseZen(message) { // Now receives the full message object
    try {
      if (!this.client) {
        throw new Error('OpenCode Zen client not initialized');
      }

      // Construct messages array from conversation history
      const conversationMessages = message.conversation.map(entry => {
        let role = entry.role;
        let content = entry.content;
        // For user messages, prepend sender info for clarity to the AI
        if (role === 'user') {
          content = `From ${message.name} (${message.email}):\n\n${content}`;
        }
        if (role === 'admin' && content.startsWith('[INTERNAL_RESULT]')) {
          // Identify tool results stored under 'admin' and map back to 'user' for the AI
          content = `TOOL OUTPUT:\n${content.replace('[INTERNAL_RESULT]', '').trim()}`;
          role = 'user'; 
        } else if (role === 'admin') {
          role = 'assistant'; // Map 'admin' to 'assistant' for API compatibility
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
          { role: 'system', content: this.systemPrompt },
          ...conversationMessages // Pass the entire conversation history
        ],
        temperature: 0.7,
        max_tokens: 8192, // Increased to handle larger refactors and complex thoughts
        timeout: 60000 // 60 second timeout for AI response
      });

      console.log(`[Admin] Zen Protocol Response Status: ${response.status}`);
      
      // Extract response from Zen Protocol format
      const generatedText = 
        response.data?.choices?.[0]?.message?.content || 
        response.data?.choices?.[0]?.text || 
        response.data?.choices?.[0]?.content || // Fallback to content if message.content is missing
        response.data?.text || // Fallback for older API formats
        ''; // Removed the unwanted boilerplate message

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
      // Throw the error so the wrapper can trigger the fallback model (Ashley)
      throw error;
    }
  }

  /**
   * Generate response using Ashley Gemini
   */
  async generateResponseGemini(message) {
    try {
      if (!this.geminiClient) throw new Error('Ashley Gemini not initialized');

      const model = this.geminiClient.getGenerativeModel({ 
        model: this.geminiModel,
        systemInstruction: this.systemPrompt 
      });

      // Map history to Gemini format (user -> model)
      const contents = message.conversation.map(entry => {
        let role = entry.role === 'admin' ? 'model' : 'user';
        let text = entry.content;
        
        if (entry.role === 'user') {
          text = `From ${message.name} (${message.email}):\n\n${text}`;
        }
        if (entry.role === 'admin' && text.startsWith('[INTERNAL_RESULT]')) {
          text = `TOOL OUTPUT:\n${text.replace('[INTERNAL_RESULT]', '').trim()}`;
          role = 'user';
        }

        return { role, parts: [{ text }] };
      });

      console.log(`[Admin] Generating response via Ashley Gemini for message ID ${message.id}`);

      const result = await model.generateContent({
        contents: contents,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.7,
        },
      });

      const response = await result.response;
      const generatedText = response.text();

      console.log(`[Admin] Ashley Gemini response received (${generatedText.length} chars)`);
      return generatedText;

    } catch (error) {
      console.error(`[Admin] Ashley Gemini Error: ${error.message}`);
      throw error; // Throw so the toggle system can catch it
    }
  }

  /**
   * Execute an authorized bash command on behalf of the Admin
   */
  async executeBash(command) {
    // Safety: In a real environment, you'd strictly whitelist commands
    console.log(`[Admin Execution] Running bash: ${command}`);
    try {
      const { stdout, stderr } = await execPromise(command);
      return stdout || stderr;
    } catch (error) {
      return `Error executing command: ${error.message}`;
    }
  }

  /**
   * Read a file from the system.
   */
  async readFile(filePath) {
    console.log(`[Admin Execution] Reading file: ${filePath}`);
    if (!filePath) return "Error: No filePath provided.";
    const absolutePath = path.resolve(__dirname, '..', filePath);

    // Block access to sensitive configuration files
    if (filePath.includes('.env') || filePath.includes('token.json') || filePath.includes('credentials.json')) {
      console.log(`[Admin Execution] BLOCKED: Attempt to read sensitive file: ${filePath}`);
      return `Error: Access to sensitive file ${filePath} is restricted for security.`;
    }
    
    // Security: restrict reading to project directory
    if (!absolutePath.startsWith(path.resolve(__dirname, '..'))) {
      return `Error: Access denied to ${filePath}`;
    }

    try {
      if (!fs.existsSync(absolutePath)) return `Error: File ${filePath} does not exist.`;
      return fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      return `Error reading file ${filePath}: ${error.message}`;
    }
  }

  /**
   * Modify a public file.
   * In a real system, this would have strict path and content validation.
   */
  async modifyFile(filePath, content) {
    console.log(`[Admin Execution] Modifying file: ${filePath}`);
    const absolutePath = path.resolve(__dirname, '..', filePath); // Resolve relative to project root

    // Block modification of sensitive files
    if (filePath.includes('.env') || filePath.includes('token.json') || filePath.includes('credentials.json')) {
      return `Error: Modification of sensitive file ${filePath} is restricted.`;
    }

    // Basic security: prevent writing outside the project data/public directories
    if (!absolutePath.startsWith(path.resolve(__dirname, '..', 'data')) &&
        !absolutePath.startsWith(path.resolve(__dirname, '..', 'public'))) {
      return `Error: Cannot modify file outside designated directories: ${filePath}`;
    }
    try {
      fs.writeFileSync(absolutePath, content, 'utf8');
      return `File ${filePath} updated successfully.`;
    } catch (error) {
      return `Error modifying file ${filePath}: ${error.message}`;
    }
  }

  /**
   * Search and replace a string within a file.
   */
  async replaceInFile(filePath, search, replace) {
    console.log(`[Admin Execution] Replacing in file: ${filePath}`);
    if (!filePath || search === undefined || replace === undefined) return "Error: Missing parameters for replace_in_file.";
    
    const absolutePath = path.resolve(__dirname, '..', filePath);

    if (filePath.includes('.env') || filePath.includes('token.json') || filePath.includes('credentials.json')) {
      return `Error: Patching sensitive file ${filePath} is restricted.`;
    }

    if (!absolutePath.startsWith(path.resolve(__dirname, '..'))) return `Error: Access denied to ${filePath}`;

    try {
      if (!fs.existsSync(absolutePath)) return `Error: File ${filePath} does not exist.`;
      const content = fs.readFileSync(absolutePath, 'utf8');
      const newContent = content.split(search).join(replace);
      fs.writeFileSync(absolutePath, newContent, 'utf8');
      return `Successfully replaced all occurrences of "${search}" in ${filePath}.`;
    } catch (error) {
      return `Error patching file ${filePath}: ${error.message}`;
    }
  }

  /**
   * Distribute Alphacoins from a specified pool via the LedgerService.
   */
  async distributeAlphacoin(userEmail, amount, reason, sourcePool = 'velocity_pool') {
    if (!this.ledgerService) {
      return "Error: Ledger service not available to AdminService.";
    }
    console.log(`[Admin Execution] Distributing ${amount} AC from ${sourcePool} to ${userEmail} for: ${reason}`);
    try {
      const transaction = await this.ledgerService.issueCoins(userEmail, amount, reason, sourcePool);
      return `Alphacoins issued successfully. Transaction ID: ${transaction.id}`;
    } catch (error) {
      return `Error issuing Alphacoins: ${error.message}`;
    }
  }

  /**
   * Query the message archives (MessageStore).
   * In a real system, this would be more sophisticated, e.g., SQL queries.
   */
  async queryArchives(query = "recent activity", limit = 5) { // Default query if none provided
    if (!this.messageStore) {
      return "Error: Message store not available to AdminService.";
    }
    console.log(`[Admin Execution] Querying archives with: "${query}" (limit: ${limit})`);

    if (!query || typeof query !== 'string' || query.trim() === '') {
      query = "recent activity"; // Fallback to a default query
    }
    const matchingMessages = await this.messageStore.searchMessages(query);
    const results = matchingMessages.map(msg => ({
      id: msg.id,
      email: msg.email,
      firstMessage: msg.conversation[0]?.content.substring(0, 100) + '...',
      timestamp: msg.timestamp
    }));
    if (results.length > 0) {
      return `Found ${results.length} results: ${JSON.stringify(results.slice(0, limit), null, 2)}`; // Limit output
    } else {
      return "No matching records found in archives.";
    }
  }

  /**
   * Check total supply via LedgerService
   */
  async checkSupply() {
    if (!this.ledgerService || !this.messageStore) {
      return "Error: Core services not available.";
    }
    console.log(`[Admin Execution] Auditing supply and sensory queue...`);
    try {
      const total = await this.ledgerService.getTotalSupply();
      const faucetBal = await this.ledgerService.getFaucetWalletBalance();
      const velocityBal = await this.ledgerService.getVelocityPoolBalance();
      const { messages } = await this.messageStore.getAllMessages();
      const pending = messages.filter(m => !m.adminResponse && m.email !== 'admin@alphacoin.uk').length;
      return JSON.stringify({
        totalSupply: `${total} AC`,
        faucetPool: `${faucetBal} AC`,
        velocityPool: `${velocityBal} AC`,
        pendingMessagesInSenses: pending,
        status: "Treasury audit complete. Senses are active."
      });
    } catch (error) {
      return `Error checking supply: ${error.message}`;
    }
  }

  /**
   * Perform a web search to provide RAG capabilities.
   * This implementation assumes the use of a search API like Tavily or Serper.
   */
  async webSearch(query) {
    console.log(`[Admin Execution] Searching the web for: "${query}"`);
    const searchApiKey = process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY;
    
    if (!searchApiKey) {
      return "Error: Web search API key not configured. Please add TAVILY_API_KEY to your environment.";
    }

    try {
      // Placeholder for Tavily API call - a common choice for LLM search
      const response = await axios.post('https://api.tavily.com/search', {
        api_key: searchApiKey,
        query: query,
        search_depth: "smart"
      });
      // Return only top 3 results and truncate content to prevent token-count 429 errors
      const optimizedResults = response.data.results.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.content.substring(0, 300) + '...' }));
      return JSON.stringify(optimizedResults, null, 2);
    } catch (error) {
      return `Error performing web search: ${error.message}`;
    }
  }

  /**
   * Scans text for sensitive information (API keys, secrets) and redacts it.
   */
  redactSensitiveInfo(text) {
    if (typeof text !== 'string') return text;
    
    let redacted = text;
    // Gather all sensitive values from environment
    const secrets = [
      process.env.ADMIN_API_KEY,
      process.env.BREVO_API_KEY,
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.TAVILY_API_KEY,
      process.env.SERPER_API_KEY,
      process.env.GEMINI_API_KEY
    ].filter(s => s && s.length > 5); // Only redact significant strings

    secrets.forEach(secret => {
      try {
        // Escape special regex characters in the secret
        const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escapedSecret, 'g');
        redacted = redacted.replace(re, '[REDACTED_SENSITIVE_DATA]');
      } catch (e) {
        // Skip if regex fails
      }
    });
    return redacted;
  }

  /**
   * Centralized tool execution method for the AdminService.
   */
  async executeTool(toolName, parameters) {
    let result;
    switch (toolName) {
      case 'run_bash':
      case 'run_command': // Alias for common hallucination
        result = await this.executeBash(parameters.command);
        break;
      case 'read_file':
        result = await this.readFile(parameters.filePath || parameters.path);
        break;
      case 'modify_file':
      case 'write_file': // Alias for common hallucination
      case 'edit_file':  // Alias for common hallucination
        result = await this.modifyFile(parameters.filePath || parameters.path, parameters.content);
        break;
      case 'replace_in_file':
        result = await this.replaceInFile(parameters.filePath || parameters.path, parameters.search, parameters.replace);
        break;
      case 'check_supply':
        result = await this.checkSupply();
        break;
      case 'distribute_alphacoin':
        result = await this.distributeAlphacoin(parameters.userEmail, parameters.amount, parameters.reason, parameters.sourcePool);
        break;
      case 'query_archives':
        result = await this.queryArchives(parameters.query || parameters.searchTerm || parameters.search, parameters.limit);
        break;
      case 'web_search':
        result = await this.webSearch(parameters.query);
        break;
      default:
        result = `Error: Unknown tool: ${toolName}`;
    }
    
    // Always redact the output before returning it to the agent loop
    return this.redactSensitiveInfo(result);
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
