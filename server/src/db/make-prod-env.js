/**
 * Write a finished production .env, ready to paste into Coolify in one go.
 *
 *   node server/src/db/make-prod-env.js --domain placement.kluniversity.in
 *
 * Coolify's Environment Variables tab has a bulk editor that accepts a whole
 * .env at once. The tedious part of deployment is filling twenty-odd values by
 * hand and getting one wrong in a way that only shows up when a student cannot
 * sign in — so this produces the entire block, secrets generated, and the two
 * dangerous defaults already correct.
 *
 * Secrets are read from _private-data/production-secrets.txt if it exists, and
 * generated (and saved there) if it does not, so re-running is stable — a fresh
 * JWT secret every run would sign every student out.
 *
 * The output file is written OUTSIDE the repository. It contains live
 * credentials and must never be committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = path.resolve(here, '../../../../_private-data');
const SECRETS = path.join(PRIVATE, 'production-secrets.txt');
const OUT = path.join(PRIVATE, 'coolify.env');

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const DOMAIN = opt('domain');
const SMTP_USER = opt('smtp-user', 'drsatishthatavarti@kluniversity.in');

if (!DOMAIN) {
  console.error(`
Give the domain the app will be served from:

  node server/src/db/make-prod-env.js --domain placement.kluniversity.in

If you have no domain yet, use the IP for now and change APP_URL later:

  node server/src/db/make-prod-env.js --domain 187.127.135.148
`);
  process.exit(1);
}

fs.mkdirSync(PRIVATE, { recursive: true });

/** Read existing secrets so a re-run does not invalidate every session. */
function loadSecrets() {
  const out = {};
  if (fs.existsSync(SECRETS)) {
    for (const line of fs.readFileSync(SECRETS, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  }
  const gen = (n) => crypto.randomBytes(n).toString('base64url');
  let created = false;
  for (const [key, bytes] of [
    ['JWT_SECRET', 48], ['JWT_REFRESH_SECRET', 48],
    ['DB_PASSWORD', 24], ['DB_ROOT_PASSWORD', 24],
  ]) {
    if (!out[key]) { out[key] = gen(bytes); created = true; }
  }
  if (created) {
    fs.writeFileSync(
      SECRETS,
      `# Generated ${new Date().toISOString()}\n# Keep OUT of git. These are live credentials.\n\n`
      + Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    );
  }
  return out;
}

const s = loadSecrets();
const scheme = /^\d+\.\d+\.\d+\.\d+$/.test(DOMAIN) ? 'http' : 'https';
const appUrl = `${scheme}://${DOMAIN}`;

const env = `# KL Placement Readiness — production environment
# Generated ${new Date().toISOString()} for ${appUrl}
#
# Paste this whole block into Coolify:
#   your application -> Environment Variables -> Developer view / bulk edit
#
# Two values below are the ones that break things silently. They are already
# correct here; do not "tidy" them.

NODE_ENV=production
PORT=4000
APP_NAME=KL Placement Readiness
# Every email link is built from this. Wrong, and students get dead links.
APP_URL=${appUrl}

# --- database -------------------------------------------------------------
# DB_HOST is the SERVICE NAME Coolify gave the MySQL container, not an IP and
# never the public address. Change it if you named the service differently.
DB_HOST=careerforge-db
DB_PORT=3306
DB_NAME=careerforge
DB_USER=careerforge
DB_PASSWORD=${s.DB_PASSWORD}

# --- sessions -------------------------------------------------------------
# Changing either of these signs every student out. Generated once and reused.
JWT_SECRET=${s.JWT_SECRET}
JWT_REFRESH_SECRET=${s.JWT_REFRESH_SECRET}
ACCESS_TOKEN_TTL=30m
REFRESH_TOKEN_TTL_DAYS=30

# --- sign-in codes --------------------------------------------------------
# MUST be false. True returns the sign-in code in the API response, which lets
# anyone log in as any student. It is correct locally and a complete
# authentication bypass in production.
MAIL_DEV_ECHO=false
OTP_LENGTH=6
OTP_TTL_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_VERIFY_ATTEMPTS=5
OTP_MAX_PER_EMAIL_PER_HOUR=5
# Kept high on purpose: a campus sits behind one NAT address, and a tight
# per-IP limit locks out real students during a drive.
OTP_MAX_REQUESTS_PER_IP=120
OTP_MAX_VERIFIES_PER_IP=240

# --- email ----------------------------------------------------------------
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=${SMTP_USER}
# PASTE YOUR MAILBOX PASSWORD HERE. Left blank deliberately: it is not mine to
# store, and no student receives a sign-in code until it is set.
SMTP_PASS=
MAIL_FROM_NAME=KL Placement Readiness
MAIL_FROM_ADDRESS=${SMTP_USER}
VALIDATE_EMAIL_MX=true

# --- AI -------------------------------------------------------------------
# PASTE YOUR GEMINI KEY HERE. Without it the resume assistant and job
# enrichment decline politely and everything else works.
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash

# --- job sourcing ---------------------------------------------------------
JOB_MIN_CTC=20
JOB_MAX_CTC=80
JOB_ALERT_MIN_ATS=45
JOB_EXPIRE_DAYS=45
JOB_AUTO_INGEST=true
JOB_INGEST_HOUR=3
JOB_PROOF_MAX_MB=8

# Optional extra job sources; each stays off until its credentials exist.
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
APIFY_TOKEN=
APIFY_JOB_ACTOR=

# --- directory ------------------------------------------------------------
DIRECTORY_LIST_ROSTER=true

# --- misc -----------------------------------------------------------------
TZ=Asia/Kolkata
`;

fs.writeFileSync(OUT, env);

const blanks = [...env.matchAll(/^([A-Z_]+)=$/gm)].map((m) => m[1]).filter((k) => !k.startsWith('ADZUNA') && !k.startsWith('APIFY'));

console.log(`\nWrote ${OUT}\n`);
console.log(`  ${env.split('\n').filter((l) => /^[A-Z]/.test(l)).length} variables, secrets already filled in.`);
console.log(`  APP_URL  ${appUrl}`);
console.log(`  DB_HOST  careerforge-db  (rename if your Coolify service differs)\n`);
console.log('Fill in these two by hand before deploying:');
for (const k of blanks) console.log(`  ${k}`);
console.log(`
Then: Coolify -> your application -> Environment Variables -> bulk/developer
view -> paste the whole file -> Save -> Deploy.

This file holds live credentials. It is outside the repository and gitignored;
keep it that way.
`);
