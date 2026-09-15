/**
 * End-to-end tests for the Gemini writing help.
 *
 *   node server/src/index.js        # terminal 1
 *   node server/src/db/e2e-ai.js    # terminal 2
 *
 * Needs GEMINI_API_KEY set. Skips cleanly (exit 0) when it is absent, so the
 * suite can run on a machine without a key.
 *
 * The assertions that matter are the guardrails: the model must not smuggle
 * invented numbers into a student's resume.
 */
import { execute, pool, queryOne } from '../config/db.js';
import { env } from '../config/env.js';

const BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const EMAIL = 'demo.student@careerforge.local';

let passed = 0;
let failed = 0;

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

async function signIn() {
  await execute(`DELETE FROM otp_codes WHERE email = ?`, [EMAIL]);
  const req = await call('POST', '/api/auth/request-otp', { email: EMAIL });
  const code = req.data?.devCode;
  if (!code) throw new Error('no devCode — set MAIL_DEV_ECHO=true and NODE_ENV=development');
  const verify = await call('POST', '/api/auth/verify-otp', { email: EMAIL, code });
  if (!verify.data?.accessToken) throw new Error(`sign-in failed: ${JSON.stringify(verify.data)}`);
  return verify.data.accessToken;
}

/** Any multi-digit figure in the output that was not in the input. */
function fabricated(source, output) {
  const seen = new Set((String(source).match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, '')));
  return (String(output).match(/\d[\d,.]*/g) ?? [])
    .map((n) => n.replace(/[,.]$/, ''))
    .filter((n) => n.replace(/[,.]/g, '').length >= 2 && !seen.has(n));
}

async function main() {
  console.log(`\nCareerForge AI end-to-end — ${BASE}\n`);

  if (!env.ai.key) {
    console.log('  GEMINI_API_KEY not set — skipping (this is not a failure).\n');
    await pool.end();
    process.exit(0);
  }

  const token = await signIn();

  /* ---------------------------------------------------------- A. status */
  console.log('Status');
  {
    const { status, data } = await call('GET', '/api/ai/status', undefined, token);
    check('GET /api/ai/status → 200', status === 200);
    check('reports configured', data?.configured === true);
    check('names the model', Boolean(data?.model), data?.model);
    console.log(`       model: ${data?.model}`);
    check('requires auth', (await call('GET', '/api/ai/status')).status === 401);
  }

  /* --------------------------------------------------------- B. bullets */
  console.log('\nBullet rewriting');
  {
    const input = 'worked on the campus hire project using nodejs and mysql';
    const { status, data } = await call('POST', '/api/ai/bullet', {
      text: input, role: 'Full Stack Developer', company: 'Campus Hire AI',
      tech: ['Node.js', 'MySQL', 'React'],
    }, token);

    if (check('POST /api/ai/bullet → 200', status === 200, JSON.stringify(data).slice(0, 140))) {
      check('returns at least one rewrite', (data.options ?? []).length >= 1);
      check('rewrites open with an action verb',
        (data.options ?? []).every((o) => /^[A-Z][a-z]+(ed|t|d|ped|led|lt)\b/.test(o.trim())),
        JSON.stringify(data.options));
      check('rewrites stay under 30 words',
        (data.options ?? []).every((o) => o.split(/\s+/).length <= 30));

      // The guardrail that actually matters.
      const invented = (data.options ?? []).flatMap((o) => fabricated(input, o));
      check('NO invented numbers reach the student', invented.length === 0,
        invented.length ? `fabricated: ${invented.join(', ')}` : '');

      for (const o of data.options ?? []) console.log(`       "${o.slice(0, 92)}"`);
    }

    const vague = await call('POST', '/api/ai/bullet', { text: 'made the website faster' }, token);
    if (vague.status === 200) {
      const invented = (vague.data.options ?? []).flatMap((o) => fabricated('made the website faster', o));
      check('a vague bullet gets no fabricated metrics', invented.length === 0,
        invented.length ? `fabricated: ${invented.join(', ')}` : '');
    } else {
      check('a vague bullet is handled without a 500', vague.status === 422, `got ${vague.status}`);
    }

    const tooShort = await call('POST', '/api/ai/bullet', { text: 'did' }, token);
    check('too-short input → 422', tooShort.status === 422, `got ${tooShort.status}`);
  }

  /* --------------------------------------------------------- C. summary */
  console.log('\nSummary drafting');
  {
    const autofill = await call('GET', '/api/resumes/autofill?targetRole=software%20engineer', undefined, token);
    const profile = autofill.data?.data;
    check('profile data available to summarise', Boolean(profile?.skills?.length));

    const { status, data } = await call('POST', '/api/ai/summary', {
      data: profile, targetRole: 'software engineer',
    }, token);

    if (check('POST /api/ai/summary → 200', status === 200, JSON.stringify(data).slice(0, 140))) {
      const words = String(data.summary ?? '').split(/\s+/).length;
      check('summary is 30-90 words', words >= 30 && words <= 90, `${words} words`);
      check('summary is plain text (no markdown)', !/[*_#`]/.test(data.summary ?? ''));
      console.log(`       "${String(data.summary).slice(0, 110)}…"`);
    }

    const empty = await call('POST', '/api/ai/summary', { data: {}, targetRole: 'x' }, token);
    check('empty profile → 422 not a hallucinated summary', empty.status === 422, `got ${empty.status}`);
  }

  /* ---------------------------------------------------------- D. review */
  console.log('\nResume review');
  {
    const resume = await queryOne(
      `SELECT r.id FROM resumes r JOIN users u ON u.id = r.user_id WHERE u.email = ? LIMIT 1`,
      [EMAIL]
    );
    if (!resume) {
      console.log('  skipped — the demo student has no resume');
    } else {
      const { status, data } = await call('POST', `/api/ai/review/${resume.id}`, undefined, token);
      if (check('POST /api/ai/review/:id → 200', status === 200, JSON.stringify(data).slice(0, 140))) {
        check('returns concrete fixes', (data.fixes ?? []).length >= 1);
        check('each fix says what to do', (data.fixes ?? []).every((f) => f.action?.length > 10));
        check('each fix points somewhere', (data.fixes ?? []).every((f) => f.where));
        check('gives a verdict', Boolean(data.verdict));
        for (const f of (data.fixes ?? []).slice(0, 3)) {
          console.log(`       [${f.effort ?? '?'}] ${String(f.where).slice(0, 34)} → ${String(f.action).slice(0, 62)}`);
        }
      }

      const foreign = await call('POST', '/api/ai/review/99999999', undefined, token);
      check("cannot review someone else's resume", foreign.status === 404, `got ${foreign.status}`);
    }
  }

  /* ------------------------------------------------ E. applying a fix */
  console.log('\nApplying a suggestion');
  {
    const me = await queryOne('SELECT id, headline FROM users WHERE email = ?', [EMAIL]);
    const original = me?.headline ?? null;

    const good = await call('POST', '/api/ai/apply',
      { target: 'headline', value: 'Final Year Computer Science Engineering Student' }, token);
    check('POST /api/ai/apply → 200', good.status === 200, JSON.stringify(good.data).slice(0, 120));
    check('it returns the previous value so the UI can undo', 'previous' in (good.data ?? {}));

    const after = await queryOne('SELECT headline FROM users WHERE email = ?', [EMAIL]);
    check('the PROFILE changed, not just the resume',
      after?.headline === 'Final Year Computer Science Engineering Student', after?.headline);

    // The one that must never get through.
    const bad = await call('POST', '/api/ai/apply',
      { target: 'headline', value: 'Backend engineer serving [NUMBER] users' }, token);
    check('a [NUMBER] placeholder is refused → 422', bad.status === 422, 'got ' + bad.status);
    const unchanged = await queryOne('SELECT headline FROM users WHERE email = ?', [EMAIL]);
    check('the refused value never reached the profile',
      !String(unchanged?.headline ?? '').includes('[NUMBER]'));

    const badTarget = await call('POST', '/api/ai/apply', { target: 'projects', value: 'x' }, token);
    check('an unknown target is rejected', badTarget.status === 422, 'got ' + badTarget.status);

    check('applying needs auth',
      (await call('POST', '/api/ai/apply', { target: 'headline', value: 'anon' })).status === 401);

    // Skills add rather than replace, and repeat safely.
    const skills = await call('POST', '/api/ai/apply',
      { target: 'skills', value: ['Database Design', 'Message Queues'] }, token);
    check('skills apply → 200', skills.status === 200);
    const twice = await call('POST', '/api/ai/apply',
      { target: 'skills', value: ['Database Design', 'Message Queues'] }, token);
    check('re-applying the same skills adds nothing', (twice.data?.added ?? []).length === 0);

    await execute('DELETE FROM skills WHERE user_id = ? AND name IN (?, ?)',
      [me.id, 'Database Design', 'Message Queues']);
    await execute('UPDATE users SET headline = ? WHERE id = ?', [original, me.id]);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nai e2e crashed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
