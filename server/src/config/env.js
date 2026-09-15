import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve .env relative to the server directory, not process.cwd().
//
// Bare `dotenv/config` looks in the cwd, which only works if you happen to
// launch from server/. PM2 runs with cwd=/var/www/careerforge and the helper
// scripts run from the repo root — both would silently fall back to defaults
// and, in production, refuse to boot over a missing JWT secret.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

for (const candidate of [
  path.join(serverRoot, '.env'),        // server/.env — the normal location
  path.join(serverRoot, '..', '.env'),  // repo-root .env, if someone prefers it
  path.resolve(process.cwd(), '.env'),  // whatever the caller's cwd is
]) {
  if (fs.existsSync(candidate)) {
    // First file wins; dotenv never overwrites variables already in the
    // environment, so real env vars still take precedence over the file.
    dotenv.config({ path: candidate });
    break;
  }
}

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};
const int = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Parse an env var that carries JSON. A typo in APIFY_JOB_INPUT should not
 * stop the server booting, so a bad value falls back to the default.
 */
function safeJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { console.warn(`[env] ignoring unparseable JSON: ${String(value).slice(0, 40)}`); return fallback; }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 4000),
  appName: process.env.APP_NAME || 'KL Placement Readiness',
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  apiUrl: (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, ''),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'careerforge',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-only-refresh-secret-change-me',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '30m',
    refreshDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  },

  otp: {
    length: int(process.env.OTP_LENGTH, 6),
    ttlMinutes: int(process.env.OTP_TTL_MINUTES, 10),
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    maxVerifyAttempts: int(process.env.OTP_MAX_VERIFY_ATTEMPTS, 5),
    maxPerEmailPerHour: int(process.env.OTP_MAX_PER_EMAIL_PER_HOUR, 5),
    // Per IP, per 15 minutes. The secure default stays 10; raise it only in a
    // local dev environment where the test suites sign up several accounts in
    // quick succession from one address.
    maxRequestsPerIp: int(process.env.OTP_MAX_REQUESTS_PER_IP, 10),
    maxVerifiesPerIp: int(process.env.OTP_MAX_VERIFIES_PER_IP, 30),
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.MAIL_FROM_NAME || process.env.APP_NAME || 'KL Placement Readiness',
    fromAddress: process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || 'no-reply@localhost',
    devEcho: bool(process.env.MAIL_DEV_ECHO, true),
  },

  emailPolicy: {
    validateMx: bool(process.env.VALIDATE_EMAIL_MX, true),
    allowedDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
  },

  directory: {
    // List enrolled students who have not published a profile yet, with name,
    // branch, campus and registration number only. The institution decides;
    // set false to show published profiles alone.
    listRoster: bool(process.env.DIRECTORY_LIST_ROSTER, true),
  },

  jobs: {
    // The package floor for the nightly sweep, in lakhs per annum. A posting
    // clears it on the TOP of its range, so "18-30 LPA" survives a floor of 20
    // and the officer sees the range before approving.
    minCtc: Number(process.env.JOB_MIN_CTC) || 20,
    // Upper bound, in lakhs. A fresher board has a ceiling as well as a floor:
    // an estimate above this is almost always a senior role whose title got
    // past the seniority gate, and the number is the tell.
    maxCtc: Number(process.env.JOB_MAX_CTC) || 80,
    // Approved listings go quiet after this many days rather than sitting on
    // the board forever.
    expireDays: int(process.env.JOB_EXPIRE_DAYS, 45),
    // Hour (local time) the sweep runs. Kept away from the 08:00 alert digest
    // so a slow scrape cannot delay student mail.
    ingestHour: int(process.env.JOB_INGEST_HOUR, 3),
    autoIngest: bool(process.env.JOB_AUTO_INGEST, true),
    // Largest application-proof screenshot accepted, in megabytes.
    proofMaxMb: Number(process.env.JOB_PROOF_MAX_MB) || 8,
    // Lowest ATS score that still gets a daily digest. Below this the student
    // is told to fix the resume instead, because applying with it would just
    // feed the scanner a rejection.
    alertMinAts: int(process.env.JOB_ALERT_MIN_ATS, 45),

    // Optional sources. Each stays switched off until its credentials exist,
    // so the sweep works with no configuration at all and improves as keys
    // are added.
    adzuna: {
      appId: process.env.ADZUNA_APP_ID || '',
      appKey: process.env.ADZUNA_APP_KEY || '',
    },
    apify: {
      token: process.env.APIFY_TOKEN || '',
      actor: process.env.APIFY_JOB_ACTOR || '',
      input: safeJson(process.env.APIFY_JOB_INPUT, {}),
    },
  },
  ai: {
    // Bring-your-own key. With none set, every AI endpoint politely declines
    // and the rest of the app is unaffected.
    key: process.env.GEMINI_API_KEY || '',
    // 2.5-flash is closed to new API keys; 3.6-flash is the current default.
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },

  rateLimits: {
    // The resume builder autosaves ~1.2s after each keystroke pause, so a
    // student editing steadily can legitimately produce dozens of writes a
    // minute. These are set to stop scripted abuse, not real typing.
    apiPerMinute: int(process.env.RATE_LIMIT_API_PER_MIN, 300),
    writesPerMinute: int(process.env.RATE_LIMIT_WRITES_PER_MIN, 240),
  },

  jobAlertCron: process.env.JOB_ALERT_CRON || '0 8 * * *',
  timezone: process.env.TZ || 'Asia/Kolkata',
};

/** Fail fast in production if a secret was left at its dev default. */
export function assertProductionConfig() {
  if (!env.isProd) return;
  const problems = [];
  if (env.jwt.secret.startsWith('dev-only') || env.jwt.secret.length < 32)
    problems.push('JWT_SECRET is missing or too short');
  if (env.jwt.refreshSecret.startsWith('dev-only') || env.jwt.refreshSecret.length < 32)
    problems.push('JWT_REFRESH_SECRET is missing or too short');
  if (env.jwt.secret === env.jwt.refreshSecret)
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
  if (!env.mail.host) problems.push('SMTP_HOST is required to send OTP mail');
  if (!env.db.password) problems.push('DB_PASSWORD is empty');
  if (problems.length) {
    console.error('\nRefusing to start in production:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
    process.exit(1);
  }
}
