import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly'
];

/**
 * Resolve the gmail-credentials.json file path.
 * Checks repo root (local dev) and backend/ (Vercel).
 */
function getCredentialsPath() {
  const candidates = [
    path.join(__dirname, '../../../gmail-credentials.json'),
    path.join(__dirname, '../../gmail-credentials.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // default to repo root
}

/**
 * Load stored OAuth2 credentials and create an authenticated Gmail client.
 * Uses the refresh token to get a fresh access token if expired.
 */
function getAuth() {
  const credsPath = getCredentialsPath();
  if (!fs.existsSync(credsPath)) {
    throw new Error('Gmail credentials not found. Place gmail-credentials.json in the project root.');
  }

  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'urn:ietf:wg:oauth:2.0:oob' // not used for token refresh
  );

  oauth2Client.setCredentials({
    access_token: creds.token,
    refresh_token: creds.refresh_token,
    token_type: 'Bearer',
    expiry_date: creds.expiry ? new Date(creds.expiry).getTime() : 0,
  });

  // Auto-refresh and persist new tokens
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      creds.token = tokens.access_token;
    }
    if (tokens.refresh_token) {
      creds.refresh_token = tokens.refresh_token;
    }
    if (tokens.expiry_date) {
      creds.expiry = new Date(tokens.expiry_date).toISOString();
    }
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
  });

  return oauth2Client;
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getAuth() });
}

/**
 * Check if Gmail is connected and authenticated.
 */
export async function getGmailStatus() {
  try {
    const gmail = getGmail();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    return {
      connected: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/**
 * Build a MIME message with HTML body and PDF attachments.
 */
function buildMimeMessage({ to, subject, htmlBody, textBody, attachments = [] }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `alt_${boundary}`;

  let mime = '';
  mime += `From: david@liveluxeau.com\r\n`;
  mime += `To: ${to}\r\n`;
  mime += `Subject: ${subject}\r\n`;
  mime += `MIME-Version: 1.0\r\n`;

  if (attachments.length > 0) {
    mime += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    mime += `--${boundary}\r\n`;
    mime += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;

    // Text part
    if (textBody) {
      mime += `--${altBoundary}\r\n`;
      mime += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      mime += `${textBody}\r\n\r\n`;
    }

    // HTML part
    mime += `--${altBoundary}\r\n`;
    mime += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
    mime += `${htmlBody}\r\n\r\n`;
    mime += `--${altBoundary}--\r\n\r\n`;

    // Attachments
    for (const att of attachments) {
      mime += `--${boundary}\r\n`;
      mime += `Content-Type: ${att.contentType || 'application/pdf'}; name="${att.filename}"\r\n`;
      mime += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
      mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
      // Split base64 into 76-char lines per RFC 2045
      const b64 = att.content; // already base64 string
      for (let i = 0; i < b64.length; i += 76) {
        mime += b64.slice(i, i + 76) + '\r\n';
      }
      mime += '\r\n';
    }
    mime += `--${boundary}--\r\n`;
  } else {
    // No attachments — simple HTML email
    mime += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
    if (textBody) {
      mime += `--${altBoundary}\r\n`;
      mime += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      mime += `${textBody}\r\n\r\n`;
    }
    mime += `--${altBoundary}\r\n`;
    mime += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
    mime += `${htmlBody}\r\n\r\n`;
    mime += `--${altBoundary}--\r\n`;
  }

  return mime;
}

/**
 * Create a Gmail draft with HTML body and optional PDF attachments.
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlBody - HTML content
 * @param {string} options.textBody - Plain text fallback
 * @param {Array} options.attachments - [{ filename, content (base64), contentType }]
 * @returns {Object} Gmail draft object with id
 */
export async function createGmailDraft({ to, subject, htmlBody, textBody, attachments = [] }) {
  const gmail = getGmail();
  const mime = buildMimeMessage({ to, subject, htmlBody, textBody, attachments });
  const raw = Buffer.from(mime).toString('base64url');

  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  });

  return {
    id: draft.data.id,
    messageId: draft.data.message?.id,
  };
}

/**
 * Send a Gmail draft by its draft ID.
 * @param {string} draftId - The Gmail draft ID
 * @returns {Object} The sent message info
 */
export async function sendGmailDraft(draftId) {
  const gmail = getGmail();
  const result = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });
  return {
    messageId: result.data.id,
    threadId: result.data.threadId,
    labelIds: result.data.labelIds,
  };
}

/**
 * Delete a Gmail draft by its draft ID.
 */
export async function deleteGmailDraft(draftId) {
  const gmail = getGmail();
  await gmail.users.drafts.delete({ userId: 'me', id: draftId });
}

/**
 * List all Gmail drafts.
 */
export async function listGmailDrafts() {
  const gmail = getGmail();
  const drafts = [];
  let pageToken = null;
  do {
    const result = await gmail.users.drafts.list({
      userId: 'me',
      pageToken,
      maxResults: 100,
    });
    drafts.push(...(result.data.drafts || []));
    pageToken = result.data.nextPageToken;
  } while (pageToken);
  return drafts;
}
