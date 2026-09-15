/**
 * Send the placement roster to a running deployment over HTTPS.
 *
 *   node server/src/db/push-roster.js --url https://placement.kluniversity.in
 *   node server/src/db/push-roster.js --url https://... --file path/to/cohorts.json --dry-run
 *
 * The roster is 656 students' personal details and is never committed, so it
 * cannot reach a server through the repository. This posts it to
 * POST /api/cohorts/import instead. The token comes from ROSTER_IMPORT_TOKEN
 * in the environment, or is read from _private-data/coolify.env, so it is
 * never typed on a command line where a shell history would keep it.
 *
 * Re-runnable: the server upserts on (cohort, registration number).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = path.resolve(here, '../../../../_private-data');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const URL_ = (option('url', process.env.API_BASE) || '').replace(/\/$/, '');
const FILE = path.resolve(option('file', path.join(PRIVATE, 'cohorts.json')));
const DRY = flag('dry-run');

function readToken() {
  if (process.env.ROSTER_IMPORT_TOKEN) return process.env.ROSTER_IMPORT_TOKEN.trim();
  const envFile = path.join(PRIVATE, 'coolify.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^ROSTER_IMPORT_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

async function main() {
  if (!URL_) {
    console.error('\nGive the deployment:  node server/src/db/push-roster.js --url https://your.host\n');
    process.exit(1);
  }
  const token = readToken();
  if (!token) {
    console.error('\nNo ROSTER_IMPORT_TOKEN in the environment or in _private-data/coolify.env.\n');
    process.exit(1);
  }
  let body;
  try {
    body = fs.readFileSync(FILE, 'utf8');
    JSON.parse(body); // fail here, not on the server
  } catch (err) {
    console.error(`\nCould not read the roster at ${FILE}: ${err.message}\n`);
    process.exit(1);
  }

  console.log(`\n${DRY ? 'dry run against' : 'pushing roster to'} ${URL_}  (${(body.length / 1024).toFixed(0)} kB)\n`);
  const t0 = Date.now();
  const res = await fetch(`${URL_}/api/cohorts/import${DRY ? '?dryRun=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }

  if (!res.ok) {
    console.error(`  ${res.status} ${data.error || ''} — ${data.message || data.raw || ''}`);
    if (res.status === 401) console.error('  The token did not match. Is ROSTER_IMPORT_TOKEN set on the deployment, and was it redeployed after?');
    process.exit(1);
  }

  const t = data.totals;
  console.log(`  ${Date.now() - t0} ms`);
  console.log(`  cohorts     ${t.cohorts}`);
  console.log(`  inserted    ${t.inserted}`);
  console.log(`  updated     ${t.updated}`);
  console.log(`  skipped     ${t.skipped}`);
  console.log(`  linked      ${t.linked} to existing accounts`);
  if (data.summary?.length) {
    console.log('\n  on the server now:');
    for (const r of data.summary) {
      console.log(`    ${String(r.code).padEnd(6)} ${String(r.students).padStart(4)} students | ${String(r.claimed).padStart(3)} claimed`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('\npush failed:', err.message, '\n');
  process.exit(1);
});
