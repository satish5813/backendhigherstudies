/**
 * Pull everything the portal knows about the roster from a deployment, as
 * one JSON file, for filling the placement cell's spreadsheets.
 *
 *   node server/src/db/pull-portal-data.js --url https://placement.kluniversity.in
 *   node server/src/db/pull-portal-data.js --url https://... --campus Vijayawada --out somewhere.json
 *
 * Then:  python scripts/fill-sheet-from-portal.py --sheet batch.xlsx --export <that json>
 *
 * The token comes from ROSTER_IMPORT_TOKEN or _private-data/coolify.env. The
 * output holds student material and is written OUTSIDE the repository by
 * default (_private-data/portal-export.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = path.resolve(here, '../../../../_private-data');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const URL_ = (option('url', process.env.API_BASE) || '').replace(/\/$/, '');
const CAMPUS = option('campus', 'all');
const OUT = path.resolve(option('out', path.join(PRIVATE, 'portal-export.json')));

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
  if (!URL_) { console.error('\nGive the deployment:  --url https://your.host\n'); process.exit(1); }
  const token = readToken();
  if (!token) { console.error('\nNo ROSTER_IMPORT_TOKEN in the environment or _private-data/coolify.env.\n'); process.exit(1); }

  const t0 = Date.now();
  const res = await fetch(`${URL_}/api/cohorts/export?campus=${encodeURIComponent(CAMPUS)}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) { console.error(`\n${res.status}: ${text.slice(0, 300)}\n`); process.exit(1); }
  const data = JSON.parse(text);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1));

  const withAccount = data.items.filter((i) => i.account).length;
  const withResume = data.items.filter((i) => i.resume).length;
  console.log(`\n${data.items.length} students (${data.campus}) in ${Date.now() - t0} ms`);
  console.log(`  ${withAccount} with an account, ${withResume} with a resume`);
  console.log(`  wrote ${OUT}\n`);
}

main().catch((err) => { console.error('\npull failed:', err.message, '\n'); process.exit(1); });
