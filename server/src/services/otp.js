import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { execute, query, queryOne } from '../config/db.js';
import { sendMail } from './mailer.js';
import { otpEmail } from '../templates/emails.js';

/** Cryptographically random numeric code, zero padded. */
function generateCode(length = env.otp.length) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, '0');
}

/**
 * Throttle checks before we spend an email.
 * @returns {Promise<{ok: true} | {ok: false, code: string, message: string, retryAfter?: number}>}
 */
export async function checkSendQuota(email) {
  const last = await queryOne(
    `SELECT created_at FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1`,
    [email]
  );
  if (last) {
    const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    const cooldown = env.otp.resendCooldownSeconds;
    if (elapsed < cooldown) {
      const retryAfter = Math.ceil(cooldown - elapsed);
      return {
        ok: false,
        code: 'cooldown',
        retryAfter,
        message: `Please wait ${retryAfter}s before requesting another code.`,
      };
    }
  }

  const [{ n }] = await query(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [email]
  );
  if (n >= env.otp.maxPerEmailPerHour) {
    return {
      ok: false,
      code: 'hourly_limit',
      retryAfter: 3600,
      message: `Too many codes requested for this address. Try again in an hour.`,
    };
  }
  return { ok: true };
}

/**
 * Creates an OTP row and emails it.
 * @returns {Promise<{sent: boolean, expiresAt: Date, devCode?: string, error?: string}>}
 */
export async function createAndSendOtp({ email, purpose = 'login', ip, userAgent, isNewUser }) {
  // one live code per address — invalidate anything still outstanding
  await execute(
    `UPDATE otp_codes SET consumed_at = NOW()
      WHERE email = ? AND consumed_at IS NULL AND expires_at > NOW()`,
    [email]
  );

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.otp.ttlMinutes * 60_000);

  await execute(
    `INSERT INTO otp_codes (email, code_hash, purpose, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [email, codeHash, purpose, expiresAt, ip, userAgent]
  );

  const { subject, html } = otpEmail({ code, ttlMinutes: env.otp.ttlMinutes, isNewUser });
  const result = await sendMail({ to: email, subject, html });

  const echo = env.mail.devEcho && !env.isProd;
  if (echo) {
    console.log(`\n  ┌──────────────────────────────────────────┐`);
    console.log(`  │  OTP for ${email.padEnd(30)} │`);
    console.log(`  │  CODE: ${code.padEnd(33)} │`);
    console.log(`  └──────────────────────────────────────────┘\n`);
  }

  return {
    sent: result.sent,
    error: result.error,
    expiresAt,
    devCode: echo ? code : undefined,
  };
}

/**
 * @returns {Promise<{ok: true, purpose: string} | {ok: false, message: string, attemptsLeft?: number}>}
 */
export async function verifyOtp({ email, code }) {
  const row = await queryOne(
    `SELECT id, code_hash, purpose, expires_at, attempts
       FROM otp_codes
      WHERE email = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [email]
  );

  if (!row) return { ok: false, message: 'No active code for this address. Request a new one.' };

  if (new Date(row.expires_at) < new Date()) {
    await execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
    return { ok: false, message: 'That code has expired. Request a new one.' };
  }

  if (row.attempts >= env.otp.maxVerifyAttempts) {
    await execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
    return { ok: false, message: 'Too many incorrect attempts. Request a new code.' };
  }

  const match = await bcrypt.compare(String(code || ''), row.code_hash);
  if (!match) {
    await execute(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    const attemptsLeft = env.otp.maxVerifyAttempts - (row.attempts + 1);
    return {
      ok: false,
      attemptsLeft: Math.max(attemptsLeft, 0),
      message: attemptsLeft > 0 ? `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : 'Too many incorrect attempts. Request a new code.',
    };
  }

  await execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
  return { ok: true, purpose: row.purpose };
}

/** Housekeeping — called from the cron scheduler. */
export async function purgeExpiredOtps() {
  const res = await execute(`DELETE FROM otp_codes WHERE created_at < (NOW() - INTERVAL 2 DAY)`);
  return res.affectedRows;
}
