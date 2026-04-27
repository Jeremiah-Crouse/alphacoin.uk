/**
 * EmailService
 * Handles email sending via Brevo and reading from Gmail
 */

const SibApiV3Sdk = require('sib-api-v3-sdk');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const MarkdownIt = require('markdown-it');

class EmailService {
  constructor() {
    this.md = new MarkdownIt();
    this.brevoApiKey = process.env.BREVO_API_KEY;
    this.initBrevo();
    this.initGmail();
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
        
        this.oauth2Client = new google.auth.OAuth2(
          client_id,
          client_secret,
          redirect_uris[0]
        );

        console.log('Gmail service initialized');
      } catch (error) {
        console.warn('Error parsing Gmail credentials:', error.message);
      }
    } else {
      console.warn('Gmail credentials not found at', credentialsPath);
    }
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
  async sendAdminResponse(toEmail, userName, responseMarkdown) {
    try {
      if (!this.brevoClient) {
        console.warn('Brevo not configured, skipping response email');
        return;
      }

      // Convert markdown to HTML
      const htmlContent = this.markdownToHtml(responseMarkdown);

      // Add acl.svg image at top (would need to be inline or linked)
      const fullHtmlContent = `
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="cid:acl-logo" style="max-width: 200px;" alt="alphacoin">
        </div>
        ${htmlContent}
        <hr>
        <p style="font-size: 12px; color: #666;">
          alphacoin.uk - Admin
        </p>
      `;

      await this.brevoClient.sendTransacEmail({
        sender: { email: 'admin@alphacoin.uk', name: 'Admin' },
        to: [{ email: toEmail, name: userName }],
        subject: 'Response to Your Message - alphacoin.uk',
        htmlContent: fullHtmlContent
      });

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
   * Read new emails from Gmail
   * Requires proper OAuth2 setup
   */
  async getNewEmails() {
    try {
      if (!this.oauth2Client) {
        console.warn('Gmail not configured');
        return [];
      }

      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      
      // Get messages from the last hour
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'newer_than:1h'
      });

      const messages = res.data.messages || [];
      console.log(`Found ${messages.length} new emails`);
      
      return messages;
    } catch (error) {
      console.error('Error reading Gmail:', error);
      return [];
    }
  }
}

module.exports = EmailService;
