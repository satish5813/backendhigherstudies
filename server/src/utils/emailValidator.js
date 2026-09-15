import dns from 'node:dns/promises';
import { env } from '../config/env.js';

// Deliberately strict-but-practical. Rejects the shapes that actually bounce:
// missing TLD, consecutive dots, leading/trailing dots, spaces.
const SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

const DISPOSABLE = new Set([
  'mailinator.com', 'yopmail.com', 'guerrillamail.com', 'temp-mail.org', 'tempmail.com',
  '10minutemail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com',
  'mailnesia.com', 'tempinbox.com', 'spamgourmet.com', 'grr.la', 'inboxbear.com',
]);

// Common fat-finger domains -> the domain the student meant.
const TYPOS = {
  'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
  'yahho.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'oulook.com': 'outlook.com',
};

const mxCache = new Map(); // domain -> { ok, at }
const MX_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * @returns {Promise<{ok: boolean, email?: string, domain?: string, reason?: string, suggestion?: string}>}
 */
export async function validateEmail(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return { ok: false, reason: 'Enter your email address.' };
  if (raw.length > 190) return { ok: false, reason: 'That email address is too long.' };
  if (/\s/.test(raw)) return { ok: false, reason: 'Email addresses cannot contain spaces.' };

  const email = raw.toLowerCase();
  if (!SHAPE.test(email)) return { ok: false, reason: 'That does not look like a valid email address.' };
  if (email.includes('..')) return { ok: false, reason: 'Email addresses cannot contain two dots in a row.' };

  const domain = email.split('@')[1];

  if (TYPOS[domain]) {
    return {
      ok: false,
      reason: `Did you mean ${email.split('@')[0]}@${TYPOS[domain]}?`,
      suggestion: `${email.split('@')[0]}@${TYPOS[domain]}`,
    };
  }

  if (DISPOSABLE.has(domain)) {
    return { ok: false, reason: 'Temporary/disposable email addresses are not accepted. Use your college or personal email.' };
  }

  const allowed = env.emailPolicy.allowedDomains;
  if (allowed.length && !allowed.includes(domain)) {
    return { ok: false, reason: `Only ${allowed.join(', ')} addresses can register here.` };
  }

  if (env.emailPolicy.validateMx) {
    const mxOk = await hasMx(domain);
    if (!mxOk) {
      return { ok: false, reason: `"${domain}" is not accepting mail — check the spelling of your address.` };
    }
  }

  return { ok: true, email, domain };
}

async function hasMx(domain) {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL_MS) return cached.ok;

  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
  } catch {
    // No MX is not automatically fatal — a few domains deliver on the A record.
    try {
      await dns.resolve(domain, 'A');
      ok = true;
    } catch {
      ok = false;
    }
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}
