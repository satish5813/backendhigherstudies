/**
 * End-to-end API test. Boots nothing — it talks HTTP to a server you already
 * have running, exercising the real database.
 *
 *   # terminal 1
 *   node server/src/index.js
 *   # terminal 2
 *   node server/src/db/e2e.js            (defaults to http://localhost:4000)
 *   API_BASE=https://yourdomain.com node server/src/db/e2e.js
 *
 * Requires MAIL_DEV_ECHO=true and NODE_ENV!=production so the OTP comes back
 * in the request-otp response; otherwise it cannot complete the login leg.
 */
import { execute, queryOne } from '../config/db.js';

const BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const TEST_EMAIL = process.env.E2E_EMAIL || `e2e-${Date.now()}@gmail.com`;

let passed = 0;
let failed = 0;
let access = null;
const cookies = new Map();

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  return Boolean(condition);
}

async function call(method, path, body, { auth = true, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && access) headers.Authorization = `Bearer ${access}`;
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  for (const setCookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = setCookie.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return raw ? { res, data } : { status: res.status, data };
}

async function main() {
  console.log(`\nKL Placement Readiness end-to-end — ${BASE}\n`);

  /* ------------------------------------------------------------- health */
  console.log('Health');
  {
    const { status, data } = await call('GET', '/api/health', undefined, { auth: false });
    if (!check('GET /api/health → 200', status === 200, `got ${status}`)) {
      console.log('\n  Server unreachable. Start it first, then re-run.\n');
      process.exit(1);
    }
    check('database reachable', data.db === true, JSON.stringify(data));
    check('mail status reported', 'mail' in data);
  }

  /* -------------------------------------------------------- diagnostics */
  console.log('\nOTP pipeline diagnostics');
  {
    const { status, data } = await call('GET', '/api/auth/diagnostics', undefined, { auth: false });
    check('GET /api/auth/diagnostics → 200', status === 200);
    check('OTP policy exposed', data?.otpPolicy?.length > 0, JSON.stringify(data?.otpPolicy));
    console.log(`       smtp=${data?.mail?.host || 'none'} verified=${data?.mail?.verified} devEcho=${data?.mail?.devEcho}`);
  }

  /* ------------------------------------------------ email validation */
  console.log('\nEmail validation');
  {
    const bad = await call('POST', '/api/auth/check-email', { email: 'not-an-email' }, { auth: false });
    check('malformed address rejected', bad.data?.valid === false, bad.data?.message);

    const typo = await call('POST', '/api/auth/check-email', { email: 'someone@gmial.com' }, { auth: false });
    check('typo suggests a correction', typo.data?.suggestion === 'someone@gmail.com', typo.data?.suggestion);

    const disposable = await call('POST', '/api/auth/check-email', { email: 'x@mailinator.com' }, { auth: false });
    check('disposable domain rejected', disposable.data?.valid === false);

    const good = await call('POST', '/api/auth/check-email', { email: TEST_EMAIL }, { auth: false });
    check('valid address accepted', good.data?.valid === true, good.data?.message);
    check('reports the account does not exist yet', good.data?.exists === false);
  }

  /* -------------------------------------------------------------- OTP */
  console.log('\nSignup by OTP');
  let devCode;
  {
    const { status, data } = await call('POST', '/api/auth/request-otp', { email: TEST_EMAIL }, { auth: false });
    if (!check('POST /api/auth/request-otp → 200', status === 200, JSON.stringify(data))) {
      console.log('\n  Cannot continue without a code.\n');
      process.exit(1);
    }
    check('flagged as a new user', data.isNewUser === true);
    check('expiry returned', Boolean(data.expiresAt));

    // Regression guard: if the driver and MySQL disagree on timezone, every
    // NOW()-based comparison skews by the UTC offset. A 10-minute TTL that
    // reads as 5.5 hours is the symptom.
    const ttlMinutes = (new Date(data.expiresAt) - Date.now()) / 60000;
    check('OTP expiry is minutes away, not hours (timezone sanity)',
      ttlMinutes > 0 && ttlMinutes <= 30, `${ttlMinutes.toFixed(1)} minutes`);

    devCode = data.devCode;
    if (!devCode) {
      console.log('\n  devCode absent — set MAIL_DEV_ECHO=true and NODE_ENV=development to run the login leg.\n');
      console.log(`\n${passed} passed, ${failed} failed\n`);
      process.exit(failed ? 1 : 0);
    }

    const resend = await call('POST', '/api/auth/request-otp', { email: TEST_EMAIL }, { auth: false });
    check('resend inside the cooldown → 429', resend.status === 429, `got ${resend.status}`);
    check('cooldown is seconds, not hours (timezone sanity)',
      resend.data?.retryAfter > 0 && resend.data.retryAfter <= 300,
      `retryAfter=${resend.data?.retryAfter}`);

    const wrong = await call('POST', '/api/auth/verify-otp', { email: TEST_EMAIL, code: '000000' }, { auth: false });
    check('wrong code → 401', wrong.status === 401, `got ${wrong.status}`);
    check('remaining attempts reported', typeof wrong.data?.attemptsLeft === 'number', String(wrong.data?.attemptsLeft));
  }

  {
    const { status, data } = await call(
      'POST', '/api/auth/verify-otp',
      { email: TEST_EMAIL, code: devCode, name: 'E2E Test Student' },
      { auth: false }
    );
    if (!check('correct code → 200', status === 200, JSON.stringify(data))) process.exit(1);
    check('access token issued', Boolean(data.accessToken));
    check('account created', data.isNewUser === true);
    check('public handle assigned', Boolean(data.user?.slug), data.user?.slug);
    access = data.accessToken;
  }

  /* ------------------------------------------------------------- auth */
  console.log('\nSession');
  {
    check('GET /api/auth/me → 200', (await call('GET', '/api/auth/me')).status === 200);

    const saved = access;
    access = 'garbage.token.value';
    check('bad token → 401', (await call('GET', '/api/auth/me')).status === 401);
    access = saved;

    const refresh = await call('POST', '/api/auth/refresh', {}, { auth: false });
    check('refresh rotates the token', refresh.status === 200 && Boolean(refresh.data?.accessToken));
    if (refresh.data?.accessToken) access = refresh.data.accessToken;
  }

  /* ---------------------------------------------------------- profile */
  console.log('\nProfile');
  {
    const { status, data } = await call('GET', '/api/profile');
    check('GET /api/profile → 200', status === 200);
    check('completeness computed', typeof data?.completeness?.percent === 'number', String(data?.completeness?.percent));
    check('all sections present', ['education', 'skills', 'projects', 'experience', 'achievements'].every((k) => Array.isArray(data[k])));

    const patched = await call('PATCH', '/api/profile', {
      name: 'E2E Test Student',
      headline: 'Final-year CSE · Backend Developer',
      about: 'Final-year Computer Science student focused on backend engineering, distributed systems and building reliable services that scale under load.',
      phone: '+91 98765 43210',
      location: 'Hyderabad',
      branch: 'Computer Science & Engineering',
      grad_year: 2026,
      cgpa: 8.5,
    });
    check('PATCH /api/profile → 200', patched.status === 200, JSON.stringify(patched.data).slice(0, 160));
    check('completeness rose after saving', patched.data?.completeness?.percent > data?.completeness?.percent,
      `${data?.completeness?.percent} → ${patched.data?.completeness?.percent}`);

    const badPhone = await call('PATCH', '/api/profile', { phone: 'abc' });
    check('invalid phone → 422', badPhone.status === 422, `got ${badPhone.status}`);
  }

  /* --------------------------------------------------------- sections */
  console.log('\nProfile sections');
  const created = {};
  {
    const edu = await call('POST', '/api/profile/education', {
      level: 'ug', institution: 'KL University', degree: 'B.Tech',
      branch: 'Computer Science & Engineering', start_year: 2022, end_year: 2026,
      score: 8.5, score_type: 'cgpa',
    });
    check('POST education → 201', edu.status === 201, JSON.stringify(edu.data).slice(0, 140));
    created.education = edu.data?.id;

    for (const [name, category] of [['Java', 'language'], ['React', 'framework'], ['MySQL', 'database'],
                                     ['Docker', 'tool'], ['Data Structures', 'concept'], ['REST API', 'concept'],
                                     ['Algorithms', 'concept'], ['Git', 'tool']]) {
      await call('POST', '/api/profile/skills', { name, category, proficiency: 4 });
    }
    const skills = await call('GET', '/api/profile/skills');
    check('8 skills stored', skills.data?.items?.length === 8, String(skills.data?.items?.length));

    const dupe = await call('POST', '/api/profile/skills', { name: 'Java', category: 'language' });
    check('duplicate skill → 409', dupe.status === 409, `got ${dupe.status}`);

    const proj = await call('POST', '/api/profile/projects', {
      title: 'CampusHire — Placement Portal',
      role: 'Full Stack Developer',
      description: 'A placement portal used by 1,200 students.',
      tech: ['React', 'Java', 'MySQL'],
      highlights: [
        'Built an eligibility engine filtering 1,200 records in under 200ms.',
        'Reduced upload failures 34% by moving parsing to a retrying queue.',
      ],
      start_date: '2025-01',
      end_date: '2025-06',
      featured: true,
    });
    check('POST project → 201', proj.status === 201, JSON.stringify(proj.data).slice(0, 140));
    check('JSON columns round-trip', Array.isArray(proj.data?.tech) && proj.data.tech.length === 3);
    check('bullets round-trip', proj.data?.highlights?.length === 2);
    created.projects = proj.data?.id;

    const exp = await call('POST', '/api/profile/experience', {
      company: 'Nexpay', role: 'Backend Intern', type: 'internship',
      start_date: '2025-05', end_date: '2025-07',
      highlights: ['Cut webhook p95 latency 68% (840ms to 270ms) by batching writes.'],
    });
    check('POST experience → 201', exp.status === 201);

    const ach = await call('POST', '/api/profile/achievements', {
      title: 'Smart India Hackathon Finalist', issuer: 'Govt. of India', category: 'hackathon', date: '2025-03',
    });
    check('POST achievement → 201', ach.status === 201);

    const bad = await call('POST', '/api/profile/projects', { title: 'x' });
    check('too-short title → 422', bad.status === 422, `got ${bad.status}`);

    const unknown = await call('POST', '/api/profile/nonsense', { a: 1 });
    check('unknown section → 404', unknown.status === 404, `got ${unknown.status}`);

    const patched = await call('PATCH', `/api/profile/projects/${created.projects}`, { title: 'CampusHire v2' });
    check('PATCH project → 200', patched.status === 200 && patched.data?.title === 'CampusHire v2');

    const foreign = await call('PATCH', '/api/profile/projects/99999999', { title: 'nope' });
    check('editing someone else\'s row → 404', foreign.status === 404, `got ${foreign.status}`);
  }

  /* ------------------------------------------------------------ links */
  console.log('\nLinks & coding sync');
  {
    const links = await call('PUT', '/api/profile/links', {
      links: [
        { platform: 'github', username: 'https://github.com/torvalds' },
        { platform: 'leetcode', username: 'leetcode' },
        { platform: 'linkedin', username: 'test-student' },
      ],
    });
    check('PUT links → 200', links.status === 200);
    check('URL normalised to a handle',
      links.data?.links?.find((l) => l.platform === 'github')?.username === 'torvalds',
      links.data?.links?.find((l) => l.platform === 'github')?.username);

    const sync = await call('POST', '/api/coding/sync?force=1');
    check('POST /api/coding/sync → 200', sync.status === 200, JSON.stringify(sync.data).slice(0, 140));
    const gh = sync.data?.items?.find((i) => i.platform === 'github');
    check('github synced', gh?.status === 'ok', gh?.status);
    check('coding strength computed', typeof sync.data?.strength === 'number', String(sync.data?.strength));

    const bogus = await call('PUT', '/api/profile/links', { links: [{ platform: 'leetcode', username: 'zzz-not-real-99182736' }] });
    check('bogus handle accepted for storage', bogus.status === 200);
    const resync = await call('POST', '/api/coding/sync/leetcode?force=1');
    const lc = resync.data?.items?.find((i) => i.platform === 'leetcode');
    check('bogus handle reported not_found', lc?.status === 'not_found', lc?.status);
  }

  /* ---------------------------------------------------------- resumes */
  console.log('\nResume builder & ATS scoring');
  let resumeId;
  {
    const templates = await call('GET', '/api/resumes/templates');
    const list = templates.data?.templates ?? [];
    check('GET templates → 21', list.length === 21, `got ${list.length}`);
    check('accent presets returned', (templates.data?.accents ?? []).length >= 6);
    check('role keyword library exposed', templates.data?.roles?.length > 5);
    check('every template declares a safety level',
      list.every((t) => ['highest', 'high', 'medium'].includes(t.atsSafe)));
    check('every template declares a layout',
      list.every((t) => ['single', 'banner', 'sidebar', 'timeline', 'photo-header', 'photo-sidebar'].includes(t.layout)));
    check('design-first templates carry a penalty',
      list.filter((t) => t.atsSafe === 'medium').every((t) => t.atsPenalty > 0));

    const autofill = await call('GET', '/api/resumes/autofill?targetRole=software%20engineer');
    check('autofill pulls the profile', autofill.data?.data?.projects?.length >= 1);

    const created = await call('POST', '/api/resumes', {
      title: 'SDE Resume', template: 'ats-classic', targetRole: 'software engineer', autofill: true,
    });
    check('POST /api/resumes → 201', created.status === 201, JSON.stringify(created.data).slice(0, 140));
    check('ATS score computed', typeof created.data?.ats_score === 'number', String(created.data?.ats_score));
    check('breakdown returned', created.data?.ats_report?.breakdown?.length === 8);
    check('first resume is default', created.data?.is_default === true);
    resumeId = created.data?.id;
    console.log(`       score=${created.data?.ats_score} band=${created.data?.ats_report?.band?.label}`);

    const scored = await call('POST', '/api/resumes/score', {
      data: { basics: { fullName: 'X' } }, targetRole: 'software engineer',
    });
    check('ad-hoc scoring works', typeof scored.data?.score === 'number', String(scored.data?.score));
    check('thin resume scores low', scored.data?.score < 40, String(scored.data?.score));

    const withJd = await call('PATCH', `/api/resumes/${resumeId}`, {
      jobDescription: 'Looking for a backend engineer with Kubernetes, Kafka and GraphQL experience.',
    });
    check('PATCH rescoring with a JD', withJd.status === 200);
    check('JD widened the keyword universe',
      withJd.data?.ats_report?.keywordUniverse > created.data?.ats_report?.keywordUniverse,
      `${created.data?.ats_report?.keywordUniverse} → ${withJd.data?.ats_report?.keywordUniverse}`);

    const badTemplate = await call('PATCH', `/api/resumes/${resumeId}`, { template: 'not-a-template' });
    check('unknown template → 422', badTemplate.status === 422, `got ${badTemplate.status}`);

    // The "Design-first" badge has to mean something, so the sidebar template
    // must actually cost parseability points versus a single-column one.
    const onClassic = await call('PATCH', `/api/resumes/${resumeId}`, { template: 'ats-classic' });
    const onSidebar = await call('PATCH', `/api/resumes/${resumeId}`, { template: 'ats-sidebar' });
    const parseOf = (r) => r.data?.ats_report?.breakdown?.find((b) => b.key === 'parse')?.score;
    check('two-column template lowers parseability',
      parseOf(onSidebar) < parseOf(onClassic),
      `classic=${parseOf(onClassic)} sidebar=${parseOf(onSidebar)}`);
    check('and lowers the overall score',
      onSidebar.data?.ats_score < onClassic.data?.ats_score,
      `classic=${onClassic.data?.ats_score} sidebar=${onSidebar.data?.ats_score}`);
    for (const id of ['ats-minimal', 'ats-elegant', 'ats-timeline', 'ats-executive', 'ats-banner', 'ats-sidebar']) {
      const r = await call('PATCH', `/api/resumes/${resumeId}`, { template: id });
      check(`template ${id} accepted and scored`,
        r.status === 200 && typeof r.data?.ats_score === 'number', `${r.status} / ${r.data?.ats_score}`);
    }
    await call('PATCH', `/api/resumes/${resumeId}`, { template: 'ats-classic' });

    const accented = await call('PATCH', `/api/resumes/${resumeId}`, { accent: '#b91c1c' });
    check('accent is stored', accented.data?.accent === '#b91c1c', String(accented.data?.accent));
    check('accent does not change the ATS score',
      accented.data?.ats_score === onClassic.data?.ats_score,
      `${onClassic.data?.ats_score} -> ${accented.data?.ats_score}`);
    const junk = await call('PATCH', `/api/resumes/${resumeId}`, { accent: 'javascript:alert(1)' });
    check('a non-hex accent is rejected', junk.status === 422, `got ${junk.status}`);
    const cleared = await call('PATCH', `/api/resumes/${resumeId}`, { accent: null });
    check('accent can be cleared', cleared.data?.accent === null, String(cleared.data?.accent));

    check('refresh from profile → 200', (await call('POST', `/api/resumes/${resumeId}/refresh`)).status === 200);
    check('export logged', (await call('POST', `/api/resumes/${resumeId}/export`, { format: 'pdf' })).status === 200);
  }

  /* ------------------------------------------------------- jobs/alerts */
  console.log('\nJobs & alerts');
  {
    const jobs = await call('GET', '/api/jobs?perPage=5');
    check('GET /api/jobs → 200', jobs.status === 200);
    check('jobs seeded', jobs.data?.total > 0, `${jobs.data?.total} jobs — run the seed if 0`);

    const rec = await call('GET', '/api/jobs/recommended');
    check('recommendations ranked', Array.isArray(rec.data?.items));
    if (rec.data?.items?.length) {
      check('match score attached', typeof rec.data.items[0].match === 'number', String(rec.data.items[0].match));
      const desc = rec.data.items.every((j, i, a) => i === 0 || a[i - 1].match >= j.match);
      check('sorted by match descending', desc);
    }

    const alert = await call('GET', '/api/jobs/alerts/me');
    check('GET alert → 200', alert.status === 200);
    check('alert row auto-created', Boolean(alert.data?.alert?.id));

    const saved = await call('PUT', '/api/jobs/alerts/me', {
      active: true, roles: ['Software Engineer'], skills: ['Java', 'React'],
      locations: ['Hyderabad'], job_types: ['full-time'], min_ctc: 6, frequency: 'daily', send_hour: 8,
    });
    check('PUT alert → 200', saved.status === 200, JSON.stringify(saved.data).slice(0, 140));
    check('JSON arrays round-trip', saved.data?.alert?.roles?.[0] === 'Software Engineer');
    check('preview computed', Array.isArray(saved.data?.preview));

    const badFreq = await call('PUT', '/api/jobs/alerts/me', { frequency: 'hourly' });
    check('invalid frequency → 422', badFreq.status === 422, `got ${badFreq.status}`);

    const posting = await call('POST', '/api/jobs', { title: 'Test', company: 'Test' });
    check('non-admin cannot post a job → 403', posting.status === 403, `got ${posting.status}`);
  }

  /* ---------------------------------------------------- activity & me */
  console.log('\nActivity log');
  {
    const activity = await call('GET', '/api/me/activity');
    check('GET /api/me/activity → 200', activity.status === 200);
    check('actions were logged', activity.data?.total > 5, `${activity.data?.total} entries`);
    check('entries carry a readable label', Boolean(activity.data?.items?.[0]?.label));

    const actions = new Set(activity.data.items.map((i) => i.action));
    check('profile edits logged', actions.has('profile.updated') || actions.has('section.created'));

    // Filter rather than scanning page 1 — by now the log is long enough that
    // the signup entry has been pushed onto a later page.
    const signups = await call('GET', '/api/me/activity?action=auth.signup');
    check('signup logged', signups.data?.total >= 1, `total=${signups.data?.total}`);
    check('activity can be filtered by action',
      (signups.data?.items ?? []).every((i) => i.action === 'auth.signup'));

    const stats = await call('GET', '/api/me/stats');
    check('GET /api/me/stats → 200', stats.status === 200);
    check('project counted', stats.data?.counts?.projects >= 1, String(stats.data?.counts?.projects));
    check('best ATS score reported', stats.data?.counts?.best_ats > 0, String(stats.data?.counts?.best_ats));

    const sessions = await call('GET', '/api/me/sessions');
    check('sessions listed', sessions.data?.items?.length >= 1);
  }

  /* ----------------------------------------------------- public page */
  console.log('\nPublic profile');
  {
    const me = await call('GET', '/api/auth/me');
    const slug = me.data?.user?.slug;

    const pub = await call('GET', `/api/u/${slug}`, undefined, { auth: false });
    check('GET /api/u/:slug → 200', pub.status === 200, `slug=${slug}`);
    check('contact hidden from anonymous viewers', pub.data?.user?.email === null && pub.data?.user?.phone === null);
    check('projects exposed', pub.data?.projects?.length >= 1);
    check('isOwner false when anonymous', pub.data?.isOwner === false);

    const owner = await call('GET', `/api/u/${slug}`);
    check('owner sees their own contact details', Boolean(owner.data?.user?.email));

    check('unknown slug → 404', (await call('GET', '/api/u/definitely-not-a-real-slug-12345', undefined, { auth: false })).status === 404);

    const dir = await call('GET', '/api/u?perPage=5', undefined, { auth: false });
    check('directory → 200', dir.status === 200);
    check('directory includes this student', dir.data?.items?.some((s) => s.slug === slug));

    await call('PATCH', '/api/profile', { profile_public: false });
    check('private profile → 403 for anonymous',
      (await call('GET', `/api/u/${slug}`, undefined, { auth: false })).status === 403);
    await call('PATCH', '/api/profile', { profile_public: true });
  }

  /* ------------------------------------------------------- teardown */
  console.log('\nCleanup');
  {
    const me = await call('GET', '/api/auth/me');

    // Self-deletion is closed: a profile carries the placement cell's readiness
    // analysis and the student's logged applications, so one frustrated click
    // must not destroy institutional data. The cell deletes accounts instead.
    const refused = await call('DELETE', '/api/me', { confirm: me.data.user.email });
    check('a student cannot delete their own account → 403', refused.status === 403, `got ${refused.status}`);
    check('the refusal says who can', /placement cell/i.test(refused.data?.message ?? ''));
    check('the account still works', (await call('GET', '/api/auth/me')).status === 200);

    // Tidy up directly, since the route no longer offers it.
    await execute(`DELETE FROM users WHERE email = ?`, [TEST_EMAIL.toLowerCase()]);
    check('the test account was removed for cleanup',
      !(await queryOne(`SELECT id FROM users WHERE email = ?`, [TEST_EMAIL.toLowerCase()])));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\ne2e crashed:', err);
  process.exit(1);
});
