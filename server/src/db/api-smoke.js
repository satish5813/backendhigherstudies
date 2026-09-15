/**
 * Hit every public surface of the API and report what answers.
 *
 *   node server/src/db/api-smoke.js
 *   API_BASE=https://placement.yourdomain.in node server/src/db/api-smoke.js
 *
 * Different from e2e.js on purpose. That suite proves behaviour is correct and
 * needs a writable database and a dev-mode OTP echo. This one asks a simpler
 * question — "is this deployment answering, and answering as itself?" — so it
 * can be pointed at production, where writing test accounts would be rude and
 * MAIL_DEV_ECHO is off.
 *
 * It also checks the two settings that are silently dangerous in production:
 * an OTP echoed in the response, and email links still pointing at localhost.
 */
import { env } from '../config/env.js';

const BASE = (process.env.API_BASE || `http://localhost:${env.port}`).replace(/\/$/, '');

let pass = 0;
let fail = 0;
let warn = 0;

const ok = (label, good, detail = '') => {
  if (good) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
  return good;
};
const caution = (label, detail) => { warn++; console.log(`  WARN  ${label}${detail ? ' — ' + detail : ''}`); };

async function call(path, { method = 'GET', body, token } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status,
      ms: Date.now() - t0,
      data: type.includes('json') ? await res.json().catch(() => null) : null,
      type,
    };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, error: err.message };
  }
}

async function main() {
  console.log(`\nAPI smoke — ${BASE}\n`);

  /* ------------------------------------------------------------- reachable */
  console.log('Reachability');
  const health = await call('/api/health');

  // A reachable app reporting itself unhealthy is a different situation from
  // nothing answering, and far more useful to keep testing: the routes that do
  // not touch the database still tell us whether the build, the environment
  // and the auth layer are sound.
  if (!health.data && health.status !== 200) {
    ok(`GET /api/health (${health.ms}ms)`, false, health.error || `got ${health.status}`);
    console.log('\n  Nothing is answering at all. Is the container running, and is API_BASE right?\n');
    process.exit(1);
  }

  ok(`the app answers (${health.ms}ms)`, Boolean(health.data));
  ok('it is running as itself', health.data?.service === 'KL Placement Readiness', health.data?.service);
  // Only a failure when the target looks like a real deployment. Running this
  // against localhost during development is the normal case, not a fault.
  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    ok(`environment: ${health.data?.env} (local run)`, true);
  } else {
    ok('NODE_ENV is production', health.data?.env === 'production', `env=${health.data?.env}`);
  }
  ok('database reachable', health.data?.db === true,
    'db:false — the app cannot reach MySQL. Everything below that needs data will fail.');
  ok('mail is configured', health.data?.mail?.configured === true, 'no SMTP host set');
  if (health.data?.mail?.configured && !health.data?.mail?.verified) {
    caution('SMTP configured but not verified', 'usually a wrong or missing SMTP_PASS — no student receives a code');
  }

  /* --------------------------------------------------------- configuration */
  console.log('\nConfiguration');
  const diag = await call('/api/auth/diagnostics');
  ok('GET /api/auth/diagnostics → 200', diag.status === 200);

  const mail = diag.data?.mail ?? {};
  if (mail.devEcho) {
    caution('MAIL_DEV_ECHO is ON', 'sign-in codes come back in the API response — anyone can log in as any student');
  } else {
    ok('MAIL_DEV_ECHO is off', true);
  }
  ok('SMTP host configured', Boolean(mail.host), 'no SMTP host — no student will receive a code');

  if (/localhost|127\.0\.0\.1/.test(env.appUrl)) {
    caution('APP_URL still points at localhost', `${env.appUrl} — every email link will be unreachable`);
  } else {
    ok(`APP_URL is a real address (${env.appUrl})`, true);
  }

  /* ----------------------------------------------------------- public reads */
  console.log('\nPublic endpoints');
  const dir = await call('/api/u?perPage=3');
  ok('GET /api/u (student directory) → 200', dir.status === 200);
  ok('directory reports the roster', typeof dir.data?.roster?.onRoster === 'number',
    JSON.stringify(dir.data?.roster));

  const missing = await call('/api/u/definitely-not-a-real-slug-99999');
  ok('unknown profile → 404', missing.status === 404, `got ${missing.status}`);

  // The directory is the one public surface that could leak, so check it.
  const leaky = JSON.stringify(dir.data ?? {}).match(/\b[6-9]\d{9}\b|"(mobile|dateOfBirth|gender|cgpa)"/g);
  ok('directory exposes no contact details or marks', !leaky, leaky ? leaky.slice(0, 3).join(', ') : '');

  /* ------------------------------------------------------------ auth guards */
  console.log('\nAuthentication guards');
  for (const [path, label] of [
    ['/api/profile', 'profile'],
    ['/api/resumes', 'resumes'],
    ['/api/jobs', 'jobs'],
    ['/api/me/onboarding', 'onboarding'],
    ['/api/jobs/admin/queue', 'admin job queue'],
    ['/api/cohorts/lpa7/students', 'cohort roster'],
  ]) {
    const r = await call(path);
    ok(`${label} requires a token`, r.status === 401, `got ${r.status}`);
  }

  const badToken = await call('/api/profile', { token: 'garbage.token.value' });
  ok('a forged token is rejected', badToken.status === 401, `got ${badToken.status}`);

  /* ------------------------------------------------------------ rate limits */
  console.log('\nAbuse protection');

  // Test the per-ADDRESS limit, not the per-IP one. The per-IP ceiling is
  // deliberately high — a whole campus sits behind one NAT address, and a
  // tight limit there locks out real students during a placement drive. The
  // limit that actually protects someone is per address: it stops a stranger
  // filling one student's inbox with sign-in codes.
  const probe = `probe.${Date.now()}@kluniversity.in`;
  const first = await call('/api/auth/request-otp', { method: 'POST', body: { email: probe } });
  ok('first OTP request accepted', first.status === 200, `got ${first.status}`);

  const immediate = await call('/api/auth/request-otp', { method: 'POST', body: { email: probe } });
  ok('an immediate resend to the same address is refused', immediate.status === 429, `got ${immediate.status}`);
  ok('the refusal says how long to wait',
    typeof immediate.data?.retryAfter === 'number' && immediate.data.retryAfter > 0,
    JSON.stringify(immediate.data));
  // A cooldown reported in hours means the driver and MySQL disagree on
  // timezone — the bug that makes a 10-minute code look like it expires in
  // five and a half hours.
  ok('the cooldown is seconds, not hours (timezone sanity)',
    immediate.data?.retryAfter <= 300, `retryAfter=${immediate.data?.retryAfter}`);

  const wrongCode = await call('/api/auth/verify-otp', {
    method: 'POST', body: { email: probe, code: '000000' },
  });
  ok('a wrong code is rejected', wrongCode.status === 401, `got ${wrongCode.status}`);
  ok('remaining attempts are reported', typeof wrongCode.data?.attemptsLeft === 'number');

  if (env.otp.maxRequestsPerIp > 50) {
    caution(`OTP_MAX_REQUESTS_PER_IP is ${env.otp.maxRequestsPerIp}`,
      'raised for test runs; 20-40 is saner in production, but keep it above a lecture hall of students on one NAT address');
  }

  /* ------------------------------------------------------------- validation */
  console.log('\nInput validation');
  const badEmail = await call('/api/auth/check-email', { method: 'POST', body: { email: 'not-an-email' } });
  ok('malformed email rejected', badEmail.data?.valid === false, JSON.stringify(badEmail.data));

  const noBody = await call('/api/auth/request-otp', { method: 'POST', body: {} });
  ok('missing field → 4xx not 500', noBody.status >= 400 && noBody.status < 500, `got ${noBody.status}`);

  /* ----------------------------------------------------------------- report */
  console.log(`\n${pass} passed, ${fail} failed, ${warn} warning(s)\n`);
  if (warn) console.log('Warnings are configuration, not code. Fix them before students use this.\n');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nsmoke run crashed:', err.message, '\n');
  process.exit(1);
});
