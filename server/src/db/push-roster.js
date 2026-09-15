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
 * Sent in chunks of --chunk records (default 100). A whole cohort in one
 * request is several thousand queries, and a reverse proxy in front of the
 * app gives up on a request before that finishes — a 504 with the import
 * half done. The server upserts, so chunks are safe and re-runs are safe.
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
const CHUNK = Math.max(1, Number(option('chunk', 100)) || 100);

function readToken() {
  if (process.env.ROSTER_IMPORT_TOKEN) return process.env.ROSTER_IMPORT_TOKEN.trim();
  const envFile = path.join(PRIVATE, 'coolify.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^ROSTER_IMPORT_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

async function send(token, payload) {
  const res = await fetch(`${URL_}/api/cohorts/import${DRY ? '?dryRun=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const why = `${res.status} ${data.error || ''} — ${data.message || data.raw || ''}`.trim();
    if (res.status === 401) throw new Error(`${why}\n  The token did not match. Is ROSTER_IMPORT_TOKEN set on the deployment, and was it redeployed after?`);
    throw new Error(why);
  }
  return data;
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
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error(`\nCould not read the roster at ${FILE}: ${err.message}\n`);
    process.exit(1);
  }
  const cohorts = payload.cohorts ?? [];
  const totalRecords = cohorts.reduce((n, c) => n + (c.records?.length ?? 0), 0);
  console.log(`\n${DRY ? 'dry run against' : 'pushing roster to'} ${URL_}  (${totalRecords} students, chunks of ${CHUNK})\n`);

  const totals = { cohorts: 0, inserted: 0, updated: 0, skipped: 0, linked: 0 };
  let summary = [];
  const t0 = Date.now();
  for (const cohort of cohorts) {
    const { records = [], ...meta } = cohort;
    totals.cohorts += 1;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const t1 = Date.now();
      const r = await send(token, { cohorts: [{ ...meta, records: chunk }] });
      const t = r.totals || {};
      totals.inserted += t.inserted || 0;
      totals.updated += t.updated || 0;
      totals.skipped += t.skipped || 0;
      totals.linked += t.linked || 0;
      summary = r.summary || summary;
      console.log(`  ${String(meta.code).padEnd(6)} ${String(i + chunk.length).padStart(4)}/${records.length}  ${Date.now() - t1} ms`);
    }
  }

  console.log(`\n  ${Date.now() - t0} ms total`);
  console.log(`  cohorts     ${totals.cohorts}`);
  console.log(`  inserted    ${totals.inserted}`);
  console.log(`  updated     ${totals.updated}`);
  console.log(`  skipped     ${totals.skipped}`);
  console.log(`  linked      ${totals.linked} to existing accounts`);
  if (summary.length) {
    console.log('\n  on the server now:');
    for (const r of summary) {
      console.log(`    ${String(r.code).padEnd(6)} ${String(r.students).padStart(4)} students | ${String(r.claimed).padStart(3)} claimed`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('\npush failed:', err.message, '\n');
  process.exit(1);
});
