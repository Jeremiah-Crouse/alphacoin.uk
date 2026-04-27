/**
 * EmailService
 * Handles email sending via Brevo and reading from Gmail
 */

const SibApiV3Sdk = require('sib-api-v3-sdk');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Base64 } = require('js-base64'); // For decoding base64 email content
const MarkdownIt = require('markdown-it');

class EmailService {
  constructor() {
    this.md = new MarkdownIt();
    this.brevoApiKey = process.env.BREVO_API_KEY;
    this.initBrevo();
    this.initGmail();
    this.initLogo(); // Initialize logo conversion
  }

  initBrevo() {
    if (!this.brevoApiKey) {
      console.warn('Brevo API key not configured');
      return;
    }

    // SIB-API-V3-SDK initialization
    SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = this.brevoApiKey;
    this.brevoClient = new SibApiV3Sdk.TransactionalEmailsApi();
    console.log('Brevo email service initialized');
  }

  initGmail() {
    // Gmail setup would use OAuth2
    // This requires credentials.json from Google Cloud
    const credentialsPath = path.join(__dirname, '../credentials.json');
    
    if (fs.existsSync(credentialsPath)) {
      try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        const config = credentials.installed || credentials.web;
        
        if (!config) {
          console.warn('Gmail credentials format not recognized');
          return;
        }

        const { client_secret, client_id, redirect_uris } = config;
        
        const redirectUri = process.env.GMAIL_REDIRECT_URI || redirect_uris[0];
        this.oauth2Client = new google.auth.OAuth2(
          client_id,
          client_secret,
          redirectUri
        );

        console.log('Gmail service initialized');

        // Try to load saved tokens
        const tokenPath = path.join(__dirname, '../token.json');
        if (fs.existsSync(tokenPath)) {
          const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
          this.oauth2Client.setCredentials(tokens);
          console.log('Gmail tokens loaded.');
          // Refresh access token if expired
          this.oauth2Client.on('tokens', (tokens) => {
            if (tokens.refresh_token) {
              // Store the refresh_token in case it changes
              fs.writeFileSync(tokenPath, JSON.stringify(tokens), 'utf8');
              console.log('Gmail tokens refreshed and saved.');
            }
          });
        } else {
          console.warn('Gmail token.json not found. Please authorize via /api/gmail/auth');
        }

      } catch (error) {
        console.warn('Error parsing Gmail credentials:', error.message);
      }
    } else {
      console.warn('Gmail credentials not found at', credentialsPath);
    }
  }

  async initLogo() {
    this.svgLogoPath = path.join(__dirname, '../public/images/acl.svg');
    this.pngLogoPath = path.join(__dirname, '../public/images/acl-logo.png');

    // Ensure the images directory exists
    const imagesDir = path.dirname(this.pngLogoPath);
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Check if PNG exists, if not, generate it
    if (!fs.existsSync(this.pngLogoPath)) {
      console.log('Generating PNG logo from SVG...');
      try {
        await sharp(this.svgLogoPath)
          .resize(400) // Resize to a reasonable width for email
          .png({ quality: 90 }) // High quality PNG
          .toFile(this.pngLogoPath);
        console.log('PNG logo generated successfully.');
      } catch (error) {
        console.error('Error generating PNG logo:', error);
        // Fallback or handle error
      }
    }

    // Read the PNG into base64 for email attachment
    this.pngLogoBase64 = fs.readFileSync(this.pngLogoPath).toString('base64');
    console.log('PNG logo ready for email embedding.');
  }

  /**
   * Generates a Google OAuth URL for user authorization.
   */
  generateAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('Gmail client not initialized. Check credentials.json.');
    }
    const scopes = ['https://www.googleapis.com/auth/gmail.modify'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Important for getting a refresh token
      scope: scopes,
    });
  }

  /**
   * Exchanges an authorization code for tokens and saves them.
   */
  async getTokens(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    const tokenPath = path.join(__dirname, '../token.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens), 'utf8');
    console.log('Gmail tokens saved to token.json');
  }

  /**
   * Send confirmation email to user who submitted contact form
   */
  async sendContactConfirmation(toEmail, userName) {
    try {
      if (!this.brevoClient) {
        console.warn('Brevo not configured, skipping confirmation email');
        return;
      }

      const htmlContent = `
        <h2>Thank you for reaching out!</h2>
        <p>Hi ${userName},</p>
        <p>I've received your message and will get back to you as soon as possible.</p>
        <p>Best regards,<br>Admin</p>
      `;

      await this.brevoClient.sendTransacEmail({
        sender: { email: 'admin@alphacoin.uk', name: 'Admin' },
        to: [{ email: toEmail, name: userName }],
        subject: 'Message Received - alphacoin.uk',
        htmlContent
      });

      console.log(`Confirmation email sent to ${toEmail}`);
      return htmlContent;
    } catch (error) {
      console.error('Error sending confirmation email:', error);
      throw error;
    }
  }

  /**
   * Send Admin response to user
   */
  async sendAdminResponse(toEmail, userName, responseMarkdown, inReplyToId = null, subject = null) {
    try {
      if (!this.brevoClient) {
        console.warn('Brevo not configured, skipping response email');
        return;
      }

      if (!this.pngLogoBase64) {
        console.warn('PNG logo not available, proceeding without embedded logo.');
        // Attempt to re-initialize in case it failed first time
        await this.initLogo();
      }

      // Convert markdown to HTML
      const htmlContent = this.markdownToHtml(responseMarkdown);

      // Use direct Base64 Data URI for the logo
      const logoSrc = this.pngLogoBase64 ? `data:image/png;base64,${this.pngLogoBase64}` : '';

      const fullHtmlContent = `
        <div style="text-align: center; margin-bottom: 20px;">
          ${logoSrc ? `<img src="${logoSrc}" style="max-width: 200px;" alt="alphacoin">` : ''}
        </div>
        ${htmlContent}
        <hr>
        <p style="font-size: 12px; color: #666;">
          alphacoin.uk - Admin
        </p>
      `;

      const emailPayload = {
        sender: { email: 'admin@alphacoin.uk', name: 'Admin' },
        to: [{ email: toEmail, name: userName }],
        subject: subject || 'Response to Your Message - alphacoin.uk',
        htmlContent: fullHtmlContent,
      };

      // Add threading headers if this is a reply to an existing email
      if (inReplyToId) {
        emailPayload.headers = {
          'In-Reply-To': inReplyToId,
          'References': inReplyToId
        };
      }

      await this.brevoClient.sendTransacEmail(emailPayload);

      console.log(`Response email sent to ${toEmail}`);
      return fullHtmlContent;
    } catch (error) {
      console.error('Error sending response email:', error);
      throw error;
    }
  }

  /**
   * Simple markdown to HTML conversion
   * Could be extended or use a library
   */
  markdownToHtml(markdown) {
    return this.md.render(markdown);
  }

  /**
   * Mark an email as read by removing the UNREAD label
   */
  async markEmailAsRead(messageId) {
    try {
      if (!this.oauth2Client) return;
      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        resource: { removeLabelIds: ['UNREAD'] }
      });
      console.log(`[Email] Marked message ${messageId} as read`);
    } catch (error) {
      console.error(`[Email] Error marking email ${messageId} as read:`, error);
    }
  }

  /**
   * Strips quoted history from an email body to keep the conversation clean.
   */
  stripEmailHistory(text) {
    if (!text) return '';

    // Common patterns that indicate the start of a quoted reply/history
    const markers = [
      /On\s.+\s(at\s)?\d+:\d+.+wrote:/i,            // Gmail/Outlook style: On Oct 2, 2023, at 10:00 AM, User wrote:
      /-----?\s*Original Message\s*-----?/i,        // Traditional style: ----- Original Message -----
      /From:\s.+/i,                                 // Inline header: From: user@example.com
      /Sent:\s.+/i,                                 // Inline header: Sent: Monday, October 2, 2023
      /________________________________/            // Visual divider
    ];

    let cutIndex = text.length;
    for (const marker of markers) {
      const match = text.match(marker);
      if (match && match.index < cutIndex) {
        cutIndex = match.index;
      }
    }

    return text.substring(0, cutIndex).trim();
  }

  /**
   * Read new emails from Gmail
   * Requires proper OAuth2 setup
   */
  async getNewEmails() {
    try {
      if (!this.oauth2Client) {
        console.warn('Gmail not configured');
        return [];
      }

      // Ensure tokens are refreshed if needed
      await this.oauth2Client.refreshAccessToken();

      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      
      // Get messages from the last 24 hours, specifically for admin@alphacoin.uk
      // 'to:admin@alphacoin.uk' ensures we only process emails sent to our admin address
      // 'is:unread' helps avoid reprocessing, but we'll also track message IDs
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'newer_than:24h to:admin@alphacoin.uk is:unread' // Only unread emails to admin
      });

      const messages = res.data.messages || [];
      console.log(`Found ${messages.length} potential new emails for admin@alphacoin.uk`);
      
      const parsedEmails = [];
      for (const msg of messages) {
        try {
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full' // Get full message including headers and body
          });

          const headers = fullMessage.data.payload.headers;
          const getHeader = (name) => headers.find(h => h.name === name)?.value;

          const subject = getHeader('Subject');
          const fromHeader = getHeader('From');
          const date = getHeader('Date');
          const messageId = getHeader('Message-ID');
          const inReplyTo = getHeader('In-Reply-To'); // Crucial for linking replies
          const references = getHeader('References'); // Also helpful for threading

          // Extract sender name and email
          let senderName = 'Unknown';
          let senderEmail = 'unknown@example.com';
          if (fromHeader) {
            const match = fromHeader.match(/(.*)<(.*)>/);
            if (match && match[2]) {
              senderEmail = match[2].trim();
              senderName = match[1] ? match[1].replace(/"/g, '').trim() : senderEmail;
            } else {
              senderEmail = fromHeader.trim();
              senderName = fromHeader.trim();
            }
          }

          // Get email body
          const decode = (data) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
          
          const getBody = (payload) => {
            if (payload.body && payload.body.data) {
              return decode(payload.body.data);
            }
            if (payload.parts) {
              const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
              if (textPart && textPart.body && textPart.body.data) return decode(textPart.body.data);
              
              const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
              if (htmlPart && htmlPart.body && htmlPart.body.data) return decode(htmlPart.body.data);
              
              for (const part of payload.parts) {
                const result = getBody(part);
                if (result) return result;
              }
            }
            return '';
          };

          const body = getBody(fullMessage.data.payload);

          parsedEmails.push({
            id: msg.id, // Gmail message ID
            threadId: fullMessage.data.threadId, // Gmail thread ID
            messageId: messageId, // Standard email Message-ID header
            inReplyTo: inReplyTo,
            references: references,
            subject: subject,
            from: { name: senderName, email: senderEmail },
            date: new Date(date),
            body: this.stripEmailHistory(body),
          });
        } catch (parseError) {
          console.error(`Error parsing email ${msg.id}:`, parseError);
        }
      }
      return parsedEmails;
    } catch (error) {
      console.error('Error reading Gmail:', error);
      return [];
    }
  }
}
module.exports = EmailService;
