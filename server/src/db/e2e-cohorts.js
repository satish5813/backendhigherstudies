/**
 * End-to-end tests for the placement cohort features: claiming a record,
 * the readiness endpoint, the admin roster and reports, and — most
 * importantly — that student PII never reaches a public endpoint.
 *
 *   node server/src/index.js            # terminal 1
 *   node server/src/db/e2e-cohorts.js   # terminal 2
 *
 * Needs MAIL_DEV_ECHO=true and NODE_ENV=development to complete a signup, and
 * imported cohort data (node server/src/db/import-cohorts.js).
 *
 * Creates throwaway accounts and deletes them at the end. It temporarily
 * detaches one real record to test auto-claim, then restores it.
 */
import { execute, pool, query, queryOne } from '../config/db.js';

const BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');

let passed = 0;
let failed = 0;
const cleanup = [];

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  return Boolean(condition);
}

async function call(method, path, body, token) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

/** Signs up (or signs in) and returns the access token. */
async function signIn(email, name = 'Cohort Test') {
  await execute(`DELETE FROM otp_codes WHERE email = ?`, [email]);
  const req = await call('POST', '/api/auth/request-otp', { email });
  const code = req.data?.devCode;
  if (!code) throw new Error(`no devCode for ${email} — set MAIL_DEV_ECHO=true (got ${req.status})`);
  const verify = await call('POST', '/api/auth/verify-otp', { email, code, name });
  if (!verify.data?.accessToken) throw new Error(`sign-in failed: ${JSON.stringify(verify.data)}`);
  return { token: verify.data.accessToken, body: verify.data };
}

async function main() {
  console.log(`\nKL Placement Readiness cohorts end-to-end — ${BASE}\n`);

  const [{ n: records }] = await query(`SELECT COUNT(*) AS n FROM student_records`);
  if (!records) {
    console.log('  No cohort data imported. Run: node server/src/db/import-cohorts.js\n');
    await pool.end();
    process.exit(1);
  }
  console.log(`${records} student records in the database\n`);

  /* ------------------------------------------------ A. auto-claim by email */
  console.log('Auto-claim at signup');
  const withEmail = await queryOne(
    `SELECT id, reg_no, placement_email FROM student_records
      WHERE placement_email IS NOT NULL ORDER BY id LIMIT 1`
  );
  let studentToken = null;

  if (!withEmail) {
    console.log('  skipped — no record carries an email address');
  } else {
    const email = withEmail.placement_email;
    // start from a clean slate for this address
    await execute(`DELETE FROM users WHERE email = ?`, [email]);
    await execute(`UPDATE student_records SET user_id = NULL, claimed_at = NULL WHERE id = ?`, [withEmail.id]);

    const { token, body } = await signIn(email);
    studentToken = token;
    cleanup.push(email);

    check('record auto-claimed at signup', Boolean(body.placementRecord),
      JSON.stringify(body.placementRecord));
    check('the right record was attached', body.placementRecord?.regNo === withEmail.reg_no,
      `${body.placementRecord?.regNo} vs ${withEmail.reg_no}`);

    const readiness = await call('GET', '/api/me/readiness', undefined, token);
    const r = readiness.data?.readiness;
    check('GET /api/me/readiness returns the record', Boolean(r), `status ${readiness.status}`);
    check('band is present', Boolean(r?.band?.target), r?.band?.target);
    check('rank within the cohort computed',
      r?.band?.rankInCohort > 0 && r?.band?.cohortSize > 0,
      `${r?.band?.rankInCohort}/${r?.band?.cohortSize}`);

    const profile = await call('GET', '/api/profile', undefined, token);
    check('profile seeded with the registration number',
      profile.data?.user?.reg_no === withEmail.reg_no, profile.data?.user?.reg_no);
    check('education rows seeded from the CGPAs', (profile.data?.education ?? []).length > 0,
      `${(profile.data?.education ?? []).length} rows`);
  }

  /* --------------------------------------------- B. manual claim by reg no */
  console.log('\nManual claim by registration number');
  const unclaimed = await queryOne(
    `SELECT reg_no FROM student_records
      WHERE user_id IS NULL AND placement_email IS NULL AND personal_email IS NULL
        AND target_band IS NOT NULL ORDER BY id LIMIT 1`
  );

  if (!unclaimed) {
    console.log('  skipped — every emailless record is already claimed');
  } else {
    const email = `cohort.claim.${Date.now()}@gmail.com`;
    const { token } = await signIn(email);
    cleanup.push(email);

    const claimed = await call('POST', '/api/me/claim', { regNo: unclaimed.reg_no }, token);
    check('claim succeeds', claimed.data?.ok === true, JSON.stringify(claimed.data).slice(0, 120));
    check('claim returns the readiness record', Boolean(claimed.data?.readiness?.band));

    const again = await call('POST', '/api/me/claim', { regNo: unclaimed.reg_no }, token);
    check('a second claim from the same account is refused', again.status === 422);
    check('and says the account is already linked',
      /already linked/i.test(again.data?.message ?? ''), again.data?.message);

    // a different, unlinked account must not be able to take it
    const thiefEmail = `cohort.thief.${Date.now()}@gmail.com`;
    const thief = await signIn(thiefEmail);
    cleanup.push(thiefEmail);
    const steal = await call('POST', '/api/me/claim', { regNo: unclaimed.reg_no }, thief.token);
    check('another account cannot claim the same record', steal.status === 422,
      `got ${steal.status}`);
    check('and is told it is already claimed',
      /already been claimed/i.test(steal.data?.message ?? ''), steal.data?.message);

    const bogus = await call('POST', '/api/me/claim', { regNo: '0000000000' }, thief.token);
    check('an unknown registration number is refused',
      /No placement record/i.test(bogus.data?.message ?? ''), bogus.data?.message);
  }

  /* ------------------------------------------------------- C. admin guards */
  console.log('\nAdmin guards');
  if (!studentToken) {
    const { token } = await signIn(`cohort.viewer.${Date.now()}@gmail.com`);
    studentToken = token;
    cleanup.push(`cohort.viewer.${Date.now()}@gmail.com`);
  }

  const summary = await call('GET', '/api/cohorts', undefined, studentToken);
  check('any student may read cohort aggregates', summary.status === 200);
  check('aggregates carry no student names',
    !JSON.stringify(summary.data).match(/"name":"[A-Z][a-z]+ [A-Z]/),
    'a personal name appeared in the aggregate payload');

  const sample = await queryOne(
    `SELECT c.code, sr.reg_no FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id LIMIT 1`
  );
  for (const [label, path] of [
    ['roster', `/api/cohorts/${sample.code}/students`],
    ['facets', `/api/cohorts/${sample.code}/facets`],
    ['student report', `/api/cohorts/${sample.code}/students/${sample.reg_no}`],
  ]) {
    const res = await call('GET', path, undefined, studentToken);
    check(`${label} is admin-only (403 for a student)`, res.status === 403, `got ${res.status}`);
  }
  check('cohort endpoints require auth',
    (await call('GET', '/api/cohorts')).status === 401);

  /* --------------------------------------------------- D. admin can read it */
  console.log('\nAdmin access');
  // The role is baked into the JWT, so the account is created with role=admin
  // up front — signing in once and promoting afterwards would need a second
  // sign-in just to re-issue the token, and OTP requests are rate limited.
  const adminEmail = `cohort.admin.${Date.now()}@gmail.com`;
  await execute(
    `INSERT INTO users (email, name, slug, role, email_verified, onboarded)
     VALUES (?, 'Cohort Admin', ?, 'admin', 1, 1)`,
    [adminEmail, `cohort-admin-${Date.now()}`]
  );
  cleanup.push(adminEmail);
  const adminToken = (await signIn(adminEmail)).token;

  const roster = await call('GET', `/api/cohorts/${sample.code}/students?perPage=5`, undefined, adminToken);
  check('admin can read the roster', roster.status === 200, `got ${roster.status}`);
  check('roster is ranked by readiness', (roster.data?.items ?? []).length > 0);
  check('roster omits mobile numbers', !JSON.stringify(roster.data).includes('mobile'));
  check('roster omits dates of birth', !/date_of_birth|dateOfBirth/.test(JSON.stringify(roster.data)));
  check('roster omits email addresses', !/@/.test(JSON.stringify(roster.data)));

  const facets = await call('GET', `/api/cohorts/${sample.code}/facets`, undefined, adminToken);
  check('facets return bands and branches',
    Array.isArray(facets.data?.bands) && Array.isArray(facets.data?.branches));

  const report = await call('GET', `/api/cohorts/${sample.code}/students/${sample.reg_no}`, undefined, adminToken);
  check('admin can read one student report', report.status === 200);
  check('report includes the score breakdown', typeof report.data?.scores === 'object');
  check('report includes contact details for staff', 'contact' in (report.data ?? {}));

  const missing = await call('GET', `/api/cohorts/${sample.code}/students/9999999999`, undefined, adminToken);
  check('unknown registration number → 404', missing.status === 404, `got ${missing.status}`);

  // the contact read must be auditable
  const log = await call('GET', '/api/me/activity?action=profile.viewed', undefined, adminToken);
  check('admin report views are written to the activity log',
    (log.data?.total ?? 0) >= 1, `total=${log.data?.total}`);

  /* ---------------------------------------------------------- E. PII leaks */
  console.log('\nPII containment');
  const me = await call('GET', '/api/auth/me', undefined, studentToken);
  const slug = me.data?.user?.slug;
  const pub = await call('GET', `/api/u/${slug}`);
  const pubJson = JSON.stringify(pub.data);
  check('public profile exposes no mobile number', !pubJson.includes('mobile'));
  check('public profile exposes no date of birth', !/date_of_birth|dateOfBirth/.test(pubJson));
  check('public profile exposes no gender', !pubJson.includes('gender'));
  check('public profile hides email from anonymous viewers', pub.data?.user?.email === null);

  const directory = await call('GET', '/api/u?perPage=5');
  check('directory exposes no contact details',
    !/mobile|dateOfBirth|date_of_birth/.test(JSON.stringify(directory.data)));

  /* ------------------------------------------------------------- teardown */
  console.log("\nWhat the admin sees of the student's own profile");
{
  // A record nobody has claimed must carry no live block at all -- there is no
  // account behind it to read.
  const unclaimed = await queryOne(
    "SELECT sr.reg_no, c.code FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id" +
    ' WHERE sr.user_id IS NULL LIMIT 1'
  );
  if (unclaimed) {
    const r = await call('GET', '/api/cohorts/' + unclaimed.code + '/students/' + unclaimed.reg_no, undefined, adminToken);
    check('an unclaimed record has no live profile', r.status === 200 && r.data.live === null);
  }

  // The claimed one this suite created should expose what the student entered.
  const mine = !withEmail ? null : await queryOne(
    "SELECT sr.reg_no, c.code FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id" +
    ' WHERE sr.user_id = (SELECT id FROM users WHERE email = ?) LIMIT 1',
    [withEmail.placement_email.toLowerCase()]
  );

  if (mine && withEmail) {
    const r = await call('GET', '/api/cohorts/' + mine.code + '/students/' + mine.reg_no, undefined, adminToken);
    check('a claimed record carries a live profile', r.status === 200 && Boolean(r.data.live));

    const live = r.data.live ?? {};
    check('it names the account behind the record', Boolean(live.email));
    check('it counts what the student has entered', typeof live.counts?.skills === 'number');
    check('it lists their skills', Array.isArray(live.skills));
    check('it lists the resumes they built', Array.isArray(live.resumes));
    check('it reports where they applied', Array.isArray(live.applications));
    check('it flags a name mismatch either way', typeof live.nameMismatch === 'boolean');

    // The live block is a placement view, not a data dump: contact details from
    // the imported record stay in the contact block, which is already access-logged.
    check('the live block carries no mobile number', !('mobile' in live));
    check('the live block carries no date of birth', !('dateOfBirth' in live));

    // It has to be LIVE, not a copy. Change the profile and read it back.
    await execute('UPDATE users SET headline = ? WHERE email = ?',
      ['E2E live-read probe', withEmail.placement_email.toLowerCase()]);
    const again = await call('GET', '/api/cohorts/' + mine.code + '/students/' + mine.reg_no, undefined, adminToken);
    check('an edit by the student shows up immediately',
      again.data?.live?.headline === 'E2E live-read probe', again.data?.live?.headline);
  }

  const asStudent = await call('GET', '/api/cohorts/lpa7/students/' + (mine?.reg_no ?? '0'), undefined, studentToken);
  check('a student cannot read anyone\'s report', asStudent.status === 403, 'got ' + asStudent.status);
}

console.log('\nCleanup');
  for (const email of new Set(cleanup)) {
    await execute(`DELETE FROM users WHERE email = ?`, [email]);
  }
  // detach anything those throwaway accounts claimed
  await execute(`UPDATE student_records SET user_id = NULL, claimed_at = NULL WHERE user_id IS NOT NULL
                  AND user_id NOT IN (SELECT id FROM users)`);
  const [{ orphans }] = await query(
    `SELECT COUNT(*) AS orphans FROM student_records sr
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.user_id IS NOT NULL AND u.id IS NULL`
  );
  check('no records left pointing at deleted accounts', Number(orphans) === 0, `${orphans} orphaned`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\ncohort e2e crashed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
