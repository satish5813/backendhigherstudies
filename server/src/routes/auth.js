import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { execute, queryOne } from '../config/db.js';
import { validate, otpRequestLimiter, otpVerifyLimiter, wrap } from '../middleware/common.js';
import { requireAuth } from '../middleware/auth.js';
import { validateEmail } from '../utils/emailValidator.js';
import { checkSendQuota, createAndSendOtp, verifyOtp } from '../services/otp.js';
import { mailerStatus, sendMail } from '../services/mailer.js';
import { welcomeEmail } from '../templates/emails.js';
import { uniqueSlug } from '../utils/slug.js';
import { autoClaimByEmail } from '../services/cohorts.js';
import { ACTIONS, clientIp, logActivity, userAgent } from '../utils/activity.js';
import {
  REFRESH_COOKIE,
  SESSION_HINT_COOKIE,
  sessionHintOptions,
  consumeRefreshToken,
  issueRefreshToken,
  refreshCookieOptions,
  revokeRefreshToken,
  signAccessToken,
} from '../utils/tokens.js';

const router = Router();

const emailSchema = z.object({ email: z.string().trim().min(3).max(190) });
const verifySchema = z.object({
  email: z.string().trim().min(3).max(190),
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the numeric code from your email.'),
  name: z.string().trim().max(120).optional(),
});

function publicUser(u) {
  return {
    id: Number(u.id),
    email: u.email,
    name: u.name,
    slug: u.slug,
    role: u.role,
    onboarded: Boolean(u.onboarded),
    avatarUrl: u.avatar_url ?? null,
  };
}

/**
 * Live diagnostics for the OTP pipeline — "is mail actually going out?".
 * GET /api/auth/diagnostics
 */
router.get(
  '/diagnostics',
  wrap(async (_req, res) => {
    const mail = mailerStatus();
    res.json({
      mail: {
        ...mail,
        host: env.mail.host || null,
        port: env.mail.port,
        secure: env.mail.secure,
        from: env.mail.fromAddress,
      },
      otpPolicy: {
        length: env.otp.length,
        ttlMinutes: env.otp.ttlMinutes,
        resendCooldownSeconds: env.otp.resendCooldownSeconds,
        maxVerifyAttempts: env.otp.maxVerifyAttempts,
        maxPerEmailPerHour: env.otp.maxPerEmailPerHour,
      },
      emailPolicy: {
        mxCheck: env.emailPolicy.validateMx,
        allowedDomains: env.emailPolicy.allowedDomains,
      },
      ready: mail.configured && mail.verified !== false,
    });
  })
);

/**
 * Inline email validation for the sign-in form — runs as the student types
 * (debounced client-side) so a typo is caught before a code is ever sent.
 * POST /api/auth/check-email
 */
router.post(
  '/check-email',
  validate(emailSchema),
  wrap(async (req, res) => {
    const check = await validateEmail(req.body.email);
    if (!check.ok) return res.json({ valid: false, message: check.reason, suggestion: check.suggestion ?? null });

    const existing = await queryOne(`SELECT id, name FROM users WHERE email = ?`, [check.email]);
    res.json({
      valid: true,
      email: check.email,
      exists: Boolean(existing),
      name: existing?.name ?? null,
      message: existing ? 'Welcome back — we will email you a sign-in code.' : 'New here? We will email you a code to confirm this address.',
    });
  })
);

/**
 * POST /api/auth/request-otp
 * Same response shape whether or not the account exists (no user enumeration).
 */
router.post(
  '/request-otp',
  otpRequestLimiter,
  validate(emailSchema),
  wrap(async (req, res) => {
    const check = await validateEmail(req.body.email);
    if (!check.ok) {
      return res.status(422).json({
        error: 'invalid_email',
        message: check.reason,
        suggestion: check.suggestion ?? null,
      });
    }
    const email = check.email;

    const quota = await checkSendQuota(email);
    if (!quota.ok) {
      await logActivity(req, { email, action: ACTIONS.OTP_FAILED, detail: { reason: quota.code } });
      return res.status(429).json({ error: quota.code, message: quota.message, retryAfter: quota.retryAfter });
    }

    const user = await queryOne(`SELECT id, name, status FROM users WHERE email = ?`, [email]);
    if (user && user.status !== 'active') {
      return res.status(403).json({ error: 'blocked', message: 'This account has been disabled. Contact your placement cell.' });
    }
    const isNewUser = !user;

    const result = await createAndSendOtp({
      email,
      purpose: isNewUser ? 'signup' : 'login',
      ip: clientIp(req),
      userAgent: userAgent(req),
      isNewUser,
    });

    await logActivity(req, {
      userId: user?.id ?? null,
      email,
      action: ACTIONS.OTP_REQUESTED,
      detail: { isNewUser, delivered: result.sent },
    });

    if (!result.sent && !result.devCode) {
      return res.status(502).json({
        error: 'mail_failed',
        message: 'We could not send the code right now. Please try again in a minute.',
        detail: env.isProd ? undefined : result.error,
      });
    }

    res.json({
      sent: true,
      isNewUser,
      email,
      expiresAt: result.expiresAt,
      resendAfter: env.otp.resendCooldownSeconds,
      message: `We sent a ${env.otp.length}-digit code to ${email}. It expires in ${env.otp.ttlMinutes} minutes.`,
      // present only when MAIL_DEV_ECHO=true and NODE_ENV!=production
      devCode: result.devCode,
    });
  })
);

/**
 * POST /api/auth/verify-otp
 * Verifying a code for an unknown address *is* the signup — there is no password.
 */
router.post(
  '/verify-otp',
  otpVerifyLimiter,
  validate(verifySchema),
  wrap(async (req, res) => {
    const check = await validateEmail(req.body.email);
    if (!check.ok) return res.status(422).json({ error: 'invalid_email', message: check.reason });
    const email = check.email;

    const result = await verifyOtp({ email, code: req.body.code });
    if (!result.ok) {
      await logActivity(req, { email, action: ACTIONS.OTP_FAILED, detail: { reason: result.message } });
      return res.status(401).json({ error: 'invalid_code', message: result.message, attemptsLeft: result.attemptsLeft });
    }

    let user = await queryOne(`SELECT * FROM users WHERE email = ?`, [email]);
    let created = false;
    let claim = { claimed: false };

    if (!user) {
      const name = req.body.name?.trim() || null;
      const slug = await uniqueSlug(name || email.split('@')[0]);
      const ins = await execute(
        `INSERT INTO users (email, name, slug, email_verified, last_login_at)
         VALUES (?, ?, ?, 1, NOW())`,
        [email, name, slug]
      );
      // Everyone gets a daily alert row so the toggle has something to flip.
      await execute(`INSERT INTO job_alerts (user_id, active, frequency) VALUES (?, 1, 'daily')`, [ins.insertId]);
      user = await queryOne(`SELECT * FROM users WHERE id = ?`, [ins.insertId]);
      created = true;

      const { subject, html } = welcomeEmail({ name });
      sendMail({ to: email, subject, html }).catch(() => {});

      // If the placement cell already has a record for this address, attach it
      // and seed the profile so the student is not retyping known data.
      try {
        claim = await autoClaimByEmail(user.id, email);
        if (claim.claimed) {
          user = await queryOne(`SELECT * FROM users WHERE id = ?`, [user.id]);
        }
      } catch (err) {
        console.error('[cohort] auto-claim failed:', err.message);
      }
    } else {
      await execute(`UPDATE users SET email_verified = 1, last_login_at = NOW() WHERE id = ?`, [user.id]);
    }

    const accessToken = signAccessToken(user);
    const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(expiresAt));
    res.cookie(SESSION_HINT_COOKIE, "1", sessionHintOptions(expiresAt));

    await logActivity(req, {
      userId: user.id,
      email,
      action: created ? ACTIONS.SIGNUP : ACTIONS.LOGIN,
      detail: { method: 'email-otp' },
    });

    res.json({
      accessToken,
      refreshToken, // also returned for non-cookie clients (mobile/Postman)
      user: publicUser(user),
      isNewUser: created,
      placementRecord: claim.claimed
        ? { cohort: claim.cohort, regNo: claim.regNo, filled: claim.filled }
        : null,
      next: user.onboarded ? '/app' : '/app/profile?onboarding=1',
    });
  })
);

/** POST /api/auth/refresh — cookie first, body fallback. */
router.post(
  '/refresh',
  wrap(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    const session = await consumeRefreshToken(token);
    if (!session) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
      return res.status(401).json({ error: 'invalid_refresh', message: 'Your session expired. Please sign in again.' });
    }

    const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [session.user_id]);
    if (!user) return res.status(401).json({ error: 'invalid_refresh', message: 'Account not found.' });

    // rotate: the presented token dies, a fresh one takes its place
    await revokeRefreshToken(token);
    const { token: nextToken, expiresAt } = await issueRefreshToken(user.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.cookie(REFRESH_COOKIE, nextToken, refreshCookieOptions(expiresAt));
    res.cookie(SESSION_HINT_COOKIE, "1", sessionHintOptions(expiresAt));

    res.json({ accessToken: signAccessToken(user), refreshToken: nextToken, user: publicUser(user) });
  })
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    await revokeRefreshToken(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
    if (req.body?.userId) await logActivity(req, { userId: req.body.userId, action: ACTIONS.LOGOUT });
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    res.json({ user: publicUser(user) });
  })
);

export default router;
