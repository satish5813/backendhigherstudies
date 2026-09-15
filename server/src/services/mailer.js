import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
let verified = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.mail.host) return null;

  const isOffice365 = /office365|outlook|microsoft/i.test(env.mail.host);

  transporter = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure, // true for 465, false for 587 (STARTTLS)
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    // Office 365 only accepts STARTTLS on 587 and rejects a plaintext session,
    // so upgrade explicitly rather than leaving it to negotiation.
    requireTLS: !env.mail.secure,
    // M365 throttles hard: one connection, modest batch, generous timeouts.
    pool: true,
    maxConnections: isOffice365 ? 1 : 3,
    maxMessages: isOffice365 ? 20 : 50,
    rateDelta: isOffice365 ? 1000 : undefined,
    rateLimit: isOffice365 ? 3 : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    tls: { minVersion: 'TLSv1.2' },
  });
  return transporter;
}

/**
 * SMTP failures are famously cryptic, and the Microsoft 365 ones are the worst
 * of them — the error that matters most ("your tenant has Basic Auth switched
 * off") arrives as a bare 535. Translate the common ones into the actual fix.
 */
export function explainSmtpError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.responseCode ?? err?.code ?? '';

  // Order matters: the specific Exchange codes all contain the word
  // "authenticated", so they must be matched before the generic 535 branch.
  if (/5\.7\.60|SendAsDenied|not allowed to send as/i.test(msg)) {
    return 'The account is not allowed to send as that From address. MAIL_FROM_ADDRESS must match SMTP_USER exactly, or be an alias the mailbox owns.';
  }
  if (/5\.7\.57/i.test(msg)) {
    return 'The server accepted the connection but the session was not authenticated (5.7.57). SMTP_USER and SMTP_PASS are probably empty, or the provider expects STARTTLS before AUTH — port 587 needs SMTP_SECURE=false.';
  }
  if (/535|5\.7\.139|authenticat/i.test(msg)) {
    return [
      'The mailbox rejected the username or password (535).',
      'On a KL University / Microsoft 365 account this is almost never a typo —',
      'Microsoft disabled basic SMTP authentication for Exchange Online, so your',
      'normal Outlook password will not work no matter how many times you retype it.',
      'Ask IT to enable "Authenticated SMTP" for this mailbox, or use a relay or',
      'transactional provider instead. See docs/EMAIL-SETUP.md.',
    ].join(' ');
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(String(code) + msg)) {
    return `Could not reach ${env.mail.host}:${env.mail.port}. Check the host and port, and that outbound SMTP is not blocked by the network or firewall.`;
  }
  if (/self.signed|certificate|TLS|SSL/i.test(msg)) {
    return 'TLS negotiation failed. Port 587 needs SMTP_SECURE=false (STARTTLS); port 465 needs SMTP_SECURE=true.';
  }
  if (/4\.7\.|throttl|too many/i.test(msg)) {
    return 'The provider is throttling this mailbox. Microsoft 365 caps a normal mailbox at roughly 30 messages/minute and 10,000 recipients/day — too tight for a 650-student cohort. Use a transactional provider for bulk sending.';
  }
  return msg;
}

/** Called once at boot so a bad SMTP config shows up in the log, not in a user's face. */
export async function verifyMailer() {
  const tx = getTransporter();
  if (!tx) {
    verified = false;
    console.warn('[mail] SMTP_HOST not set — mail delivery is disabled');
    return false;
  }
  // The From address is its own variable, and that catches people out: change
  // SMTP_USER to a new mailbox, forget MAIL_FROM_ADDRESS, and every message
  // still goes out under the old name. Worse, Microsoft 365 refuses to send as
  // an address the authenticated mailbox does not own (5.7.60), so a mismatch
  // is not merely cosmetic - it stops delivery entirely.
  if (env.mail.user && env.mail.fromAddress.toLowerCase() !== env.mail.user.toLowerCase()) {
    console.warn(`[mail] MAIL_FROM_ADDRESS (${env.mail.fromAddress}) is not SMTP_USER (${env.mail.user}).`);
    console.warn('[mail] messages are sent as MAIL_FROM_ADDRESS, and Microsoft 365 rejects that unless it is an alias this mailbox owns.');
  }

  try {
    await tx.verify();
    verified = true;
    console.log(`[mail] SMTP ready: ${env.mail.user || '(no auth)'}@${env.mail.host}:${env.mail.port}`);
    return true;
  } catch (err) {
    verified = false;
    console.error(`[mail] SMTP verification FAILED: ${err.message}`);
    console.error(`[mail] ${explainSmtpError(err)}`);
    console.error('[mail] check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in .env');
    return false;
  }
}

export function mailerStatus() {
  return { configured: Boolean(env.mail.host), verified, devEcho: env.mail.devEcho && !env.isProd };
}

/**
 * @returns {Promise<{sent: boolean, messageId?: string, error?: string}>}
 * Never throws — callers decide what to tell the user.
 */
export async function sendMail({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) {
    console.warn(`[mail] would send "${subject}" to ${to} (SMTP not configured)`);
    return { sent: false, error: 'SMTP not configured' };
  }
  try {
    const info = await tx.sendMail({
      from: `"${env.mail.fromName}" <${env.mail.fromAddress}>`,
      to,
      subject,
      text: text || stripHtml(html),
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const reason = explainSmtpError(err);
    console.error(`[mail] send failed to ${to}: ${err.message}`);
    if (reason !== err.message) console.error(`[mail] ${reason}`);
    return { sent: false, error: reason };
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
