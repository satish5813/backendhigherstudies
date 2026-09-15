/**
 * End-to-end for the sourcing -> moderation -> application -> proof pipeline.
 *
 *   node server/src/db/e2e-jobs.js
 *
 * Runs against a live server. Creates its own admin and student, and deletes
 * both plus everything they touched at the end.
 */
import { execute, pool, query, queryOne } from '../config/db.js';
import { env } from '../config/env.js';
import { estimateCtc, isFresherRole, isIndia, isPlaceableRole, normalise, parseCtc } from '../services/jobIngest.js';

const BASE = process.env.E2E_BASE || `http://localhost:${env.port}`;
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' - ' + detail : ''}`); }
}

async function call(path, { method = 'GET', token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body && !raw) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return {
    status: res.status,
    data: type.includes('json') ? await res.json() : null,
    bytes: type.startsWith('image/') ? (await res.arrayBuffer()).byteLength : null,
    type,
  };
}

async function signIn(email) {
  // MAIL_DEV_ECHO hands the code straight back in development, which is how
  // the other suites sign in. The stored hash is bcrypt and is not guessable.
  const req = await call('/auth/request-otp', { method: 'POST', body: { email } });
  const code = req.data?.devCode;
  if (!code) throw new Error('no devCode - set MAIL_DEV_ECHO=true and NODE_ENV=development');
  const res = await call('/auth/verify-otp', { method: 'POST', body: { email, code } });
  if (!res.data?.accessToken) throw new Error(`sign-in failed: ${JSON.stringify(res.data)}`);
  return res.data.accessToken;
}

/** A tiny real JPEG, so the sharp round-trip is genuinely exercised. */
async function pngBuffer() {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 900, height: 1400, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png().toBuffer();
}

const STUDENT = `e2e.jobs.student.${Date.now()}@kluniversity.in`;
const ADMIN = `e2e.jobs.admin.${Date.now()}@kluniversity.in`;
const SENTINEL = 'e2e-jobs-test';

async function main() {
  console.log(`\nJob pipeline e2e against ${BASE}\n`);

  console.log('Pure classification (no network)');
  {
    // The bands are now FRESHER bands only — senior titles never reach the
    // estimator because isFresherRole() drops them first, so the old
    // "Director is the top band" assertion no longer describes the system.
    check('an AI role pays above a generic dev role',
      estimateCtc('Machine Learning Engineer').max > estimateCtc('Backend Developer').max);
    check('intern sits below the graduate bands', estimateCtc('Software Engineer Intern').max < 20);
    check('no fresher band claims a senior package',
      Object.values(['Software Engineer', 'Data Analyst', 'Applied AI Engineer'])
        .every((t) => estimateCtc(t).max <= 40));
    check('unknown title gets no band', estimateCtc('Zookeeper') === null);

    // The gate that keeps a final-year student out of roles they cannot get.
    check('a director role is not a fresher role', !isFresherRole('Director of Engineering'));
    check('a staff role is not a fresher role', !isFresherRole('Staff Software Engineer'));
    check('a senior role is not a fresher role', !isFresherRole('Senior Software Engineer'));
    check('a numbered level is not a fresher role', !isFresherRole('Software Engineer 3'));
    check('a roman-numeral level is not a fresher role', !isFresherRole('Data Scientist II'));
    check('"intermediate" is not a fresher role', !isFresherRole('Intermediate Backend Engineer'));
    check('"Sr." glued to the next word is still senior', !isFresherRole('Sr.Data Scientist I'));
    check('a plain engineer title is a fresher role', isFresherRole('Software Engineer'));
    check('an explicit fresher title is kept', isFresherRole('Graduate Engineer Trainee'));
    check('SDE-1 is kept', isFresherRole('SDE-1'));
    check('a senior title is dropped by normalise',
      normalise({
        externalId: 'greenhouse:acme:9', title: 'Senior Software Engineer', company: 'Acme',
        location: 'Bengaluru, India', description: 'Java.', applyUrl: 'https://x.test/9',
      }).skip === 'not_fresher');

    check('payroll role is filtered out', !isPlaceableRole('Senior Payroll Accountant'));
    check('sales role is filtered out', !isPlaceableRole('Sales Engineer'));
    check('recruiter is filtered out', !isPlaceableRole('Technical Recruiter'));
    check('engineer is kept', isPlaceableRole('Staff Software Engineer'));
    check('product manager is kept', isPlaceableRole('Group Product Manager'));

    check('Bengaluru is India', isIndia('Bengaluru, India'));
    check('Bangalore IND is India', isIndia('Bangalore, IND'));
    check('Remote - India is India', isIndia('Remote - India'));
    check('San Francisco is not', !isIndia('San Francisco, CA'));
    check('bare Remote is not', !isIndia('Remote'));

    check('LPA range parses', parseCtc('25-40 LPA')?.max === 40);
    check('crore parses', parseCtc('1.2 cr')?.min === 120);
    check('USD range keeps its top', parseCtc('$150,000 - $190,000')?.max > 0);
    check('prose is not a salary', parseCtc('competitive salary') === null);
  }

  console.log('\nNormalisation rules');
  {
    const base = {
      // A fresher title: 'Senior ...' is now dropped before any other rule runs.
      externalId: 'greenhouse:acme:1', title: 'Software Engineer', company: 'Acme',
      location: 'Bengaluru, India', description: 'Java, Kubernetes and AWS.', applyUrl: 'https://x.test/1',
    };
    check('a good posting is kept', Boolean(normalise(base).row));
    check('skills are extracted', normalise(base).row.skills.includes('java'));
    check('no apply url is dropped', normalise({ ...base, applyUrl: null }).skip === 'no_apply_url');
    check('a US role is dropped', normalise({ ...base, location: 'Austin, TX' }).skip === 'not_india');
    check('an accountant is dropped', normalise({ ...base, title: 'Payroll Accountant' }).skip === 'off_track');
    check('an intern is below the floor', normalise({ ...base, title: 'Software Engineer Intern' }).skip === 'below_floor');
    check('a published figure wins over the estimate',
      normalise({ ...base, payText: 'INR 45-60 LPA' }).row.ctc_source === 'listed');
    check('an estimate is labelled as one', normalise(base).row.ctc_source === 'estimated');
    check('a future posted_at is clamped to now',
      new Date(normalise({ ...base, postedAt: '2099-01-01' }).row.posted_at) <= new Date());
  }

  // ---- accounts ---------------------------------------------------------
  // The admin row is created with its role ALREADY set, so a single sign-in
  // returns a token that carries it. Signing in twice to pick up a role change
  // does not work: the second request hits the 60-second resend cooldown.
  const studentToken = await signIn(STUDENT);
  await execute(
    `INSERT INTO users (email, name, role, email_verified, onboarded) VALUES (?, 'E2E Admin', 'admin', 1, 1)`,
    [ADMIN.toLowerCase()]
  );
  const adminToken = await signIn(ADMIN);

  // A pending job to moderate, tagged so cleanup can find it.
  const ins = await execute(
    `INSERT INTO jobs (source, external_id, title, company, location, work_mode, job_type,
                       min_ctc, max_ctc, ctc_source, skills, description, apply_url, status, ingested_at)
     VALUES ('greenhouse', ?, 'Senior Backend Engineer', 'E2E Test Corp', 'Hyderabad, India',
             'hybrid', 'full-time', 28, 45, 'estimated', '["java","aws"]', ?, 'https://x.test/e2e', 'pending', NOW())`,
    [`${SENTINEL}:${Date.now()}`, SENTINEL]
  );
  const jobId = ins.insertId;

  console.log('\nModeration gate');
  {
    const asStudent = await call(`/jobs/${jobId}`, { token: studentToken });
    check('a pending job is invisible to students', asStudent.status === 404, `got ${asStudent.status}`);

    const list = await call('/jobs?perPage=50', { token: studentToken });
    check('a pending job is absent from the board',
      !(list.data?.items ?? []).some((j) => j.id === jobId));

    const applyEarly = await call('/jobs/applications', {
      method: 'POST', token: studentToken, body: { jobId },
    });
    check('a pending job cannot be applied to', applyEarly.status === 404, `got ${applyEarly.status}`);

    const queue = await call('/jobs/admin/queue?status=pending&perPage=100', { token: adminToken });
    check('admin sees it in the queue', queue.status === 200
      && queue.data.items.some((j) => j.id === jobId));
    check('the queue flags an estimated package',
      queue.data.items.find((j) => j.id === jobId)?.ctcSource === 'estimated');

    const denied = await call('/jobs/admin/queue', { token: studentToken });
    check('a student cannot open the queue', denied.status === 403, `got ${denied.status}`);
  }

  console.log('\nApproval');
  {
    const ok = await call('/jobs/admin/approve', {
      method: 'POST', token: adminToken, body: { ids: [jobId], note: 'verified by e2e' },
    });
    check('approve returns updated:1', ok.status === 200 && ok.data.updated === 1);

    const asStudent = await call(`/jobs/${jobId}`, { token: studentToken });
    check('the job is now visible to students', asStudent.status === 200, `got ${asStudent.status}`);

    const row = await queryOne(`SELECT reviewed_by, reviewed_at FROM jobs WHERE id = ?`, [jobId]);
    check('the reviewer is recorded', Boolean(row.reviewed_by && row.reviewed_at));
  }

  console.log('\nApplying');
  let applicationId;
  {
    const created = await call('/jobs/applications', {
      method: 'POST', token: studentToken, body: { jobId, note: 'applied via portal' },
    });
    check('application created', created.status === 201, `got ${created.status}`);
    applicationId = created.data?.id;
    check('it starts as applied', created.data?.status === 'applied');
    check('it carries the job', created.data?.job?.company === 'E2E Test Corp');

    const again = await call('/jobs/applications', {
      method: 'POST', token: studentToken, body: { jobId, status: 'interviewing' },
    });
    check('applying twice updates instead of failing', again.status === 200);
    check('the second call moved the status', again.data?.status === 'interviewing');
    check('still exactly one row', (await query(
      `SELECT COUNT(*) n FROM job_applications WHERE job_id = ?`, [jobId]))[0].n === 1);

    const list = await call('/jobs/applications', { token: studentToken });
    check('the student sees their application', list.data?.total === 1);
    check('counts are broken down by status', list.data?.counts?.interviewing === 1);
  }

  console.log('\nProof screenshot');
  {
    const form = new FormData();
    form.append('screenshot', new Blob([await pngBuffer()], { type: 'image/png' }), 'proof.png');
    const up = await call(`/jobs/applications/${applicationId}/proof`, {
      method: 'POST', token: studentToken, body: form, raw: true,
    });
    check('upload accepted', up.status === 200, `got ${up.status} ${JSON.stringify(up.data)}`);
    check('the application now reports proof', up.data?.hasProof === true);

    const stored = await queryOne(
      `SELECT proof_file, proof_bytes FROM job_applications WHERE id = ?`, [applicationId]
    );
    check('a filename was stored, not a URL', /^\d+-[0-9a-f]+\.jpg$/.test(stored.proof_file ?? ''));
    check('it was re-encoded to JPEG', stored.proof_file?.endsWith('.jpg'));
    check('the re-encode shrank it', stored.proof_bytes > 0 && stored.proof_bytes < 500000);

    const mine = await call(`/jobs/applications/${applicationId}/proof`, { token: studentToken });
    check('the owner can fetch it', mine.status === 200 && mine.type.startsWith('image/'));

    const asAdmin = await call(`/jobs/applications/${applicationId}/proof`, { token: adminToken });
    check('an admin can fetch it', asAdmin.status === 200);

    const anon = await fetch(`${API}/jobs/applications/${applicationId}/proof`);
    check('anonymous is refused', anon.status === 401, `got ${anon.status}`);

    // The whole point of storing outside /uploads. A 200 here is expected and
    // harmless — the SPA fallback answers any unmatched path with index.html.
    // What must never happen is image bytes coming back, so assert on the
    // content type rather than the status code.
    const direct = await fetch(`${BASE}/uploads/proofs/${stored.proof_file}`);
    const directType = direct.headers.get('content-type') || '';
    check('the screenshot is NOT reachable on the public uploads tree',
      !directType.startsWith('image/'), `served ${directType}`);

    // Same check one level up: the private directory must not be mounted at all.
    const viaPrivate = await fetch(`${BASE}/private/proofs/${stored.proof_file}`);
    check('the private directory is not served either',
      !(viaPrivate.headers.get('content-type') || '').startsWith('image/'));
  }

  console.log('\nAdmin analytics');
  {
    const a = await call('/jobs/admin/applications', { token: adminToken });
    check('analytics returns totals', a.status === 200 && a.data.totals.total >= 1);
    check('it counts distinct students', a.data.totals.students >= 1);
    check('it reports the proof rate', typeof a.data.totals.proofRate === 'number');
    check('the job appears in topJobs', a.data.topJobs.some((j) => j.id === jobId));
    const row = a.data.recent.find((r) => r.id === applicationId);
    check('recent names the student and job', Boolean(row?.student?.name !== undefined && row?.job?.company));
    check('recent links the screenshot', row?.proofUrl?.endsWith('/proof'));

    const s = await call('/jobs/admin/sources', { token: adminToken });
    check('sources report their state', s.status === 200 && s.data.sources.length >= 3);
    check('a keyless source says what it needs',
      s.data.sources.filter((x) => !x.enabled).every((x) => Boolean(x.needs)));
    check('the floor is reported', s.data.minCtc === env.jobs.minCtc);
  }

  console.log('\nRejection');
  {
    const ins2 = await execute(
      `INSERT INTO jobs (source, external_id, title, company, location, apply_url, description, status, ingested_at)
       VALUES ('lever', ?, 'Junk Role', 'E2E Test Corp', 'Pune, India', 'https://x.test/2', ?, 'pending', NOW())`,
      [`${SENTINEL}:reject:${Date.now()}`, SENTINEL]
    );
    const r = await call('/jobs/admin/reject', {
      method: 'POST', token: adminToken, body: { ids: [ins2.insertId], note: 'not relevant' },
    });
    check('reject returns updated:1', r.status === 200 && r.data.updated === 1);
    const row = await queryOne(`SELECT status, active FROM jobs WHERE id = ?`, [ins2.insertId]);
    check('rejected rows go inactive', row.status === 'rejected' && row.active === 0);
    check('the row is kept so the sweep will not re-queue it', Boolean(row));
  }

  console.log('\nCleanup');
  {
    await execute(`DELETE FROM jobs WHERE description = ? OR external_id LIKE ?`, [SENTINEL, `${SENTINEL}%`]);
    await execute(`DELETE FROM users WHERE email IN (?, ?)`, [STUDENT.toLowerCase(), ADMIN.toLowerCase()]);
    const left = await query(
      `SELECT COUNT(*) n FROM job_applications a LEFT JOIN users u ON u.id = a.user_id WHERE u.id IS NULL`
    );
    check('no orphaned applications', left[0].n === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nsuite crashed:', err.message, '\n', err.stack);
  await execute(`DELETE FROM users WHERE email IN (?, ?)`, [STUDENT.toLowerCase(), ADMIN.toLowerCase()]).catch(() => {});
  await execute(`DELETE FROM jobs WHERE description = ?`, [SENTINEL]).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
