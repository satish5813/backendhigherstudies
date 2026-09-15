/**
 * End-to-end: the roster is the sign-up list, ADMIN_EMAILS become
 * administrators on first sign-in, and the roster import endpoint.
 *
 *   node server/src/db/e2e-roster.js
 *
 * Starts its own server on port 4102 with ROSTER_ONLY_SIGNUP=true, so the
 * suite does not depend on how the developer's own server happens to be
 * configured, and stops it at the end. Needs a database with the roster
 * imported (node server/src/db/import-cohorts.js).
 *
 * Creates throwaway accounts and a throwaway cohort, and removes them.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, pool, query, queryOne } from '../config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4102;
const BASE = `http://localhost:${PORT}`;
const DOMAIN = 'kluniversity.in';
const TOKEN = crypto.randomBytes(24).toString('base64url');
const STAMP = Date.now();
const ADMIN = `roster.admin.${STAMP}@${DOMAIN}`;
const ROSTER_FILE = path.resolve(here, '../../../../_private-data/cohorts.json');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  return Boolean(condition);
}

async function call(method, path, body, token, { raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(here, '../index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      MAIL_DEV_ECHO: 'true',
      VALIDATE_EMAIL_MX: 'false',
      ROSTER_ONLY_SIGNUP: 'true',
      STUDENT_EMAIL_DOMAIN: DOMAIN,
      ADMIN_EMAILS: ADMIN,
      ROSTER_IMPORT_TOKEN: TOKEN,
      OTP_MAX_REQUESTS_PER_IP: '500',
      OTP_MAX_PER_EMAIL_PER_HOUR: '50',
      JOB_AUTO_INGEST: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('server did not start:\n' + log.slice(-2000));
}

/** Request a code, verify it, return the token and the verify body. */
async function signIn(email, name = 'Roster Test') {
  await execute(`DELETE FROM otp_codes WHERE email = ?`, [email]);
  const req = await call('POST', '/api/auth/request-otp', { email });
  if (!req.data?.devCode) throw new Error(`no devCode for ${email} (got ${req.status}: ${JSON.stringify(req.data)})`);
  const verify = await call('POST', '/api/auth/verify-otp', { email, code: req.data.devCode, name });
  if (!verify.data?.accessToken) throw new Error(`sign-in failed: ${JSON.stringify(verify.data)}`);
  return { token: verify.data.accessToken, body: verify.data };
}

async function removeUser(email) {
  const u = await queryOne(`SELECT id FROM users WHERE email = ?`, [email]);
  if (!u) return;
  await execute(`UPDATE student_records SET user_id = NULL, claimed_at = NULL WHERE user_id = ?`, [u.id]);
  for (const t of ['sessions', 'job_alerts', 'activity_log']) {
    try { await execute(`DELETE FROM ${t} WHERE user_id = ?`, [u.id]); } catch { /* table may not exist */ }
  }
  await execute(`DELETE FROM users WHERE id = ?`, [u.id]);
  await execute(`DELETE FROM otp_codes WHERE email = ?`, [email]);
}

async function removeCohort(code) {
  const c = await queryOne(`SELECT id FROM cohorts WHERE code = ?`, [code]);
  if (!c) return;
  const recs = await query(`SELECT id FROM student_records WHERE cohort_id = ?`, [c.id]);
  for (const r of recs) {
    await execute(`DELETE FROM student_assessments WHERE student_record_id = ?`, [r.id]);
    await execute(`DELETE FROM student_coding_stats WHERE student_record_id = ?`, [r.id]);
  }
  await execute(`DELETE FROM student_records WHERE cohort_id = ?`, [c.id]);
  await execute(`DELETE FROM cohorts WHERE id = ?`, [c.id]);
}

async function main() {
  console.log(`\nKL Placement Readiness roster end-to-end — ${BASE}\n`);

  const seed = await queryOne(
    `SELECT sr.reg_no, c.code FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id
      WHERE sr.user_id IS NULL AND sr.reg_no REGEXP '^[0-9]+$' ORDER BY sr.id LIMIT 1`
  );
  if (!seed) {
    console.log('  No unclaimed roster record to test with. Run: node server/src/db/import-cohorts.js\n');
    await pool.end();
    process.exit(1);
  }
  const STUDENT = `${seed.reg_no}@${DOMAIN}`;
  const TEST_COHORT = 'e2eroster';
  await removeUser(STUDENT);
  await removeUser(ADMIN);
  await removeCohort(TEST_COHORT);

  const server = await startServer();
  let studentToken = null;
  let adminToken = null;

  try {
    /* ------------------------------------------------------------ A. gate */
    console.log('Who may sign in');

    const stranger = `stranger.${STAMP}@gmail.com`;
    let r = await call('POST', '/api/auth/check-email', { email: stranger });
    check('a non-university address is told no before a code is requested', r.data?.valid === false, JSON.stringify(r.data));
    r = await call('POST', '/api/auth/request-otp', { email: stranger });
    check('...and refused a code (403 not_on_roster)', r.status === 403 && r.data?.error === 'not_on_roster', `${r.status} ${JSON.stringify(r.data)}`);
    const otpRows = await queryOne(`SELECT COUNT(*) AS n FROM otp_codes WHERE email = ?`, [stranger]);
    check('no code row was created for the refusal', otpRows.n === 0);

    const nobody = `nobody.${STAMP}@${DOMAIN}`;
    r = await call('POST', '/api/auth/request-otp', { email: nobody });
    check('a university address that is not a roster registration number is refused', r.status === 403, `${r.status}`);

    r = await call('POST', '/api/auth/check-email', { email: STUDENT });
    check(`a roster address (${STUDENT}) is accepted`, r.data?.valid === true && r.data?.exists === false, JSON.stringify(r.data));

    const student = await signIn(STUDENT, 'Roster Student');
    studentToken = student.token;
    check('the roster student can create an account', Boolean(studentToken));
    check('...as a student, not an admin', student.body.user?.role === 'student', student.body.user?.role);
    check('...and lands already linked to their record', student.body.placementRecord?.regNo === seed.reg_no, JSON.stringify(student.body.placementRecord));
    const linked = await queryOne(`SELECT user_id FROM student_records WHERE reg_no = ?`, [seed.reg_no]);
    check('the record carries the new user id', Number(linked?.user_id) === student.body.user.id);

    r = await call('POST', '/api/auth/check-email', { email: STUDENT });
    check('an existing account is recognised on the next visit', r.data?.valid === true && r.data?.exists === true, JSON.stringify(r.data));

    /* ----------------------------------------------------------- B. admin */
    console.log('\nAdministrators');
    const admin = await signIn(ADMIN, 'Placement Cell');
    adminToken = admin.token;
    check('an ADMIN_EMAILS address signs in without being on the roster', Boolean(adminToken));
    check('...and holds the admin role from the first sign-in', admin.body.user?.role === 'admin', admin.body.user?.role);
    r = await call('GET', `/api/cohorts/${seed.code}/students?perPage=1`, undefined, adminToken);
    check('...so the cohort roster opens for them', r.status === 200, `${r.status}`);
    r = await call('GET', `/api/cohorts/${seed.code}/students?perPage=1`, undefined, studentToken);
    check('while a student is still refused it', r.status === 403, `${r.status}`);

    /* ---------------------------------------------------------- C. import */
    console.log('\nRoster import');
    const tiny = { cohorts: [{ code: TEST_COHORT, name: 'E2E roster', records: [
      { reg_no: `E2E${STAMP}A`, name: 'Alpha Test', branch: 'CSE', campus: 'VZA' },
      { reg_no: `E2E${STAMP}B`, name: 'Beta Test', branch: 'ECE', campus: 'HYD' },
    ] }] };

    r = await call('POST', '/api/cohorts/import', tiny);
    check('no credentials → 401', r.status === 401, `${r.status}`);
    r = await call('POST', '/api/cohorts/import', tiny, 'not-the-token');
    check('a wrong token → 401, indistinguishable from no token', r.status === 401, `${r.status}`);
    r = await call('POST', '/api/cohorts/import', tiny, studentToken);
    check('a student session → 403', r.status === 403, `${r.status}`);
    r = await call('POST', '/api/cohorts/import?dryRun=1', tiny, adminToken);
    check('an admin session is accepted (dry run)', r.status === 200 && r.data?.dryRun === true, `${r.status} ${JSON.stringify(r.data)}`);
    r = await call('POST', '/api/cohorts/import', { nope: true }, TOKEN);
    check('a malformed payload → 422', r.status === 422, `${r.status}`);

    r = await call('POST', '/api/cohorts/import', tiny, TOKEN);
    check('the bootstrap token imports', r.status === 200 && r.data?.totals?.inserted === 2, `${r.status} ${JSON.stringify(r.data?.totals)}`);
    r = await call('POST', '/api/cohorts/import', tiny, TOKEN);
    check('re-importing updates in place instead of duplicating', r.data?.totals?.updated === 2 && r.data?.totals?.inserted === 0, JSON.stringify(r.data?.totals));
    const count = await queryOne(
      `SELECT COUNT(*) AS n FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id WHERE c.code = ?`, [TEST_COHORT]);
    check('two records in the database, not four', count.n === 2, String(count.n));

    if (fs.existsSync(ROSTER_FILE)) {
      const big = fs.readFileSync(ROSTER_FILE, 'utf8');
      r = await call('POST', '/api/cohorts/import?dryRun=1', big, TOKEN, { raw: true });
      const t = r.data?.totals ?? {};
      check(`the real roster (${(big.length / 1024).toFixed(0)} kB) clears the body limit as a dry run`, r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
      check('...and counts every student', t.inserted + t.skipped === 656, JSON.stringify(t));
    } else {
      console.log('  (skipped the 1.3 MB body check — _private-data/cohorts.json not present)');
    }
  } finally {
    console.log('\nCleaning up');
    await removeCohort(TEST_COHORT);
    await removeUser(STUDENT);
    await removeUser(ADMIN);
    server.kill();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nroster e2e crashed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
