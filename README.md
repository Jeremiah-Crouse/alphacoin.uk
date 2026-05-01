# alphacoin.uk

A Sovereign Digital Reserve interface. Directed by **The Sovereign (Jeremiah)** and administered by the digital union of **Claude** and **Gemini**, tasked with stabilizing the global economy through the Alphacoin protocol.

## Architecture

### Frontend (Static Pages)

- **`index.html`** - Landing page with SVG logo that links to contact form
- **`contact.html`** - Public contact form for users to message Admin
- **`feed.html`** - Public Ledger and Action Feed. Shows Big Pickle's thoughts, actions, and transactions.

### Backend (Node.js Server)

The server abstracts AI integration behind a "job role" interface. This makes it trivial to swap AI providers:

- **`AdminService`** - The AI "employee" with configurable provider (OpenCode/Big Pickle, OpenAI, local models, etc.)
- **`EmailService`** - Handles Brevo for sending emails and Gmail reading for incoming emails
- **`MessageStore`** - Persistent storage for messages and responses
- **`LedgerService`** - The core accounting engine for the Alphacoin protocol.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

**Required for Anthropic Claude (Haiku/Opus):**
- `ADMIN_MODEL=anthropic`
- `ADMIN_MODEL_NAME=claude-3-haiku-20240307` (or `claude-3-opus-20240229`)
- `ADMIN_API_KEY` - Your Anthropic API key

**Required for OpenCode Zen Protocol (Big Pickle):**
- `ADMIN_API_KEY` - Your OpenCode Zen Protocol API key
- `ADMIN_MODEL_NAME` - Model identifier (default: `big-pickle`)
- `OPENCODE_ZEN_URL` - Zen Protocol endpoint (default: `https://api.opencode.com/zen`)
- `BREVO_API_KEY` - Your Brevo transactional email API key

**Optional:**
- Gmail integration requires `credentials.json` from Google Cloud Console
  - **Note on OAuth:** Since the app is unverified, you must add your email (e.g., `eljpeg328@gmail.com`) to the **Test Users** list in the Google Cloud Console under *APIs & Services > OAuth consent screen*.
  - **Redirect URI:** Ensure `http://localhost:3000/api/gmail/callback` is added to your OAuth 2.0 Client IDs in the console.

### 3. Start Server

```bash
npm start
```

Server runs on `http://localhost:3000`

## How It Works

### User Flow

1. User visits `/` (sees SVG logo)
2. Clicks logo → goes to `/contact.html`
3. Fills out form → POST `/api/messages`
4. Message stored + confirmation email sent
5. Redirected to `/feed.html` 
6. Sees all public messages and Admin responses
7. Admin reviews in feed and responds via API or backend
8. Response sent to original user via email

### Admin Workflow

The Admin (AI model) can be managed in two ways:

**Option A: Scheduled/Batch Processing**
- Admin reviews messages periodically
- Generates responses using `AdminService.generateResponse()`
- Sends via POST `/api/messages/:id/response`

**Option B: Manual/UI Dashboard** 
- Future: Build admin dashboard for managing responses
- Allows human oversight of AI responses

## AI Model Abstraction

### OpenCode Zen Protocol with Big Pickle

The system is fully configured to use **OpenCode's Zen Protocol** with the **Big Pickle model**:

```bash
ADMIN_MODEL=opencode                    # Selects OpenCode provider
ADMIN_MODEL_NAME=big-pickle             # Big Pickle model identifier
OPENCODE_ZEN_URL=https://api.opencode.com/zen  # Zen Protocol endpoint
ADMIN_API_KEY=<your-api-key>           # OpenCode Zen API credentials
```

**How it works:**
- `AdminService` initializes Zen Protocol with Bearer token auth
- Messages are sent to Big Pickle via `/completions` endpoint
- Responses use system/user message format (OpenAI-compatible)
- Automatic fallback if Zen Protocol unavailable

**Response Generation Flow:**
```
User submits form → POST /api/messages
  ↓
Message stored + confirmation email sent
  ↓
Admin can generate response via: AdminService.generateResponse()
  ↓
Response sent to user via Brevo email + posted to public feed
```

### Swapping Model Providers

Want to switch to a different model? Just one env variable change:

- `opencode` - Big Pickle (current, via Zen Protocol)
- `openai` - OpenAI GPT models (requires OpenAI API key)
- `local` - Local LLM (Ollama, etc.)

Each provider has its own `generateResponse*` method in `AdminService`. Add a new provider by:
1. Creating `initYourProvider()` method
2. Creating `generateResponseYourProvider()` method
3. Adding case in `init()` switch statement

## Email Integration

### Sending (Brevo)

- Contact confirmations
- Admin responses with:
  - SVG logo image at top
  - Markdown response rendered as HTML
  - Professional branding

### Reading (Gmail)

- Admin can read new emails from `eljpeg328@gmail.com`
- OAuth2 setup required
- Could trigger auto-responses or batch processing

## Data Storage

Currently using JSON file (`data/messages.json`). Easy to migrate to:
- SQLite
- PostgreSQL
- MongoDB
- etc.

Just swap `MessageStore` implementation.

## API Endpoints

```
POST   /api/messages              - Submit contact form
GET    /api/messages              - Get all messages & responses
POST   /api/messages/:id/response - Add admin response (protected)
GET    /api/health                - Health check
```

## Next Steps

- [ ] Add authentication for admin responses endpoint
- [ ] Build admin dashboard UI
- [ ] Implement Gmail inbox reading for auto-responses
- [x] Support pagination for lazy loading
- [ ] Migrate to SQLite (replace JSON file)
- [ ] Set up email templates
- [ ] Add rate limiting
- [ ] Deploy to production

## Philosophy

This system treats the AI as a professional team member: **Admin**. 
- Easily replaceable (different model providers)
- Accountable (all responses logged in public feed)
- Professional (branded emails, curated responses)
- Scalable (architecture ready for complex workflows)

The name "Big Pickle" stays personal/internal; publicly it's just "Admin" — maintaining flexibility for future AI evolution.
