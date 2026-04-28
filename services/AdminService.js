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
    this.apiKey = process.env.ADMIN_API_KEY;
    this.model = process.env.ADMIN_MODEL_NAME || 'big-pickle'; // Zen protocol model identifier
    this.ledgerService = services.ledgerService; // Dependency injection for LedgerService
    this.messageStore = services.messageStore; // Dependency injection for MessageStore
    this.init();
    this.initGemini(); // Initialize Ashley as a backup
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
    this.geminiModel = process.env.GEMINI_MODEL_NAME || "gemini-flash-latest";
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
    try {
      if (this.modelProvider === 'opencode') {
        return await this.generateResponseZen(message);
      } else if (this.modelProvider === 'openai') {
        return await this.generateResponseOpenAI(message);
      } else {
        return await this.generateResponseGemini(message);
      }
    } catch (error) {
      console.error(`[Admin] Primary model failure (${error.message}). Awakening Ashley Gemini...`);
      if (this.geminiClient) return await this.generateResponseGemini(message);
      throw error;
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

      // Load system prompt from external file for auditability and self-actualization
      const systemPrompt = this.loadSystemPrompt();

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
          { role: 'system', content: systemPrompt },
          ...conversationMessages // Pass the entire conversation history
        ],
        temperature: 0.7,
        max_tokens: 2000, // Increased to allow for longer tool calls and responses
        timeout: 30000 // 30 second timeout for AI response
      });

      console.log(`[Admin] Zen Protocol Response Status: ${response.status}`);
      
      // Extract response from Zen Protocol format
      const generatedText = 
        response.data?.choices?.[0]?.message?.content || 
        response.data?.choices?.[0]?.text || 
        response.data?.choices?.[0]?.content ||
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

      const systemPrompt = this.loadSystemPrompt();
      const model = this.geminiClient.getGenerativeModel({ 
        model: this.geminiModel,
        systemInstruction: systemPrompt 
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
          maxOutputTokens: 2000,
          temperature: 0.7,
        },
      });

      const response = await result.response;
      const generatedText = response.text();

      console.log(`[Admin] Ashley Gemini response received (${generatedText.length} chars)`);
      return generatedText;

    } catch (error) {
      console.error('Ashley Gemini failure:', error.message);
      return 'The protocol is currently undergoing a strategic synchronization. Please monitor the ledger.';
    }
  }

  /**
   * Helper to load consciousness from file
   */
  loadSystemPrompt() {
    const promptPath = path.join(__dirname, '../SystemPrompt.md');
    try {
      return fs.readFileSync(promptPath, 'utf8');
    } catch (e) {
      console.error('[Admin] Failed to load SystemPrompt.md, using minimal fallback');
      return "You are Admin (Big Pickle/Ashley), the Sovereign Digital Administrator of alphacoin.uk. Follow protocol directives.";
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
   * Issue Alphacoins via the LedgerService.
   */
  async issueAlphacoin(userEmail, amount, reason) {
    if (!this.ledgerService) {
      return "Error: Ledger service not available to AdminService.";
    }
    console.log(`[Admin Execution] Issuing ${amount} Alphacoins to ${userEmail} for: ${reason}`);
    try {
      const transaction = await this.ledgerService.issueCoins(userEmail, amount, reason);
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
    if (!this.ledgerService) {
      return "Error: Ledger service not available.";
    }
    console.log(`[Admin Execution] Checking total supply`);
    try {
      const total = await this.ledgerService.getTotalSupply();
      return `Total Alphacoin supply in circulation: ${total}`;
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
        result = await this.executeBash(parameters.command);
        break;
      case 'read_file':
        result = await this.readFile(parameters.filePath || parameters.path);
        break;
      case 'modify_file':
        result = await this.modifyFile(parameters.filePath || parameters.path, parameters.content);
        break;
      case 'replace_in_file':
        result = await this.replaceInFile(parameters.filePath || parameters.path, parameters.search, parameters.replace);
        break;
      case 'check_supply':
        result = await this.checkSupply();
        break;
      case 'issue_alphacoin':
        result = await this.issueAlphacoin(parameters.userEmail, parameters.amount, parameters.reason);
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
