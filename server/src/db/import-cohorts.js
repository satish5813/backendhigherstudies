/**
 * Loads the placement cohort payload produced by scripts/extract-cohorts.py
 * into MySQL. Pure Node — the VPS needs no Python or Excel parser.
 *
 *   node server/src/db/import-cohorts.js
 *   node server/src/db/import-cohorts.js --file some/other.json --dry-run
 *
 * On a server the same import runs behind POST /api/cohorts/import, because
 * the roster must never be committed and so is never on the server's disk.
 * This script is the local path; both call services/cohortImport.js.
 *
 * Re-runnable: records upsert on (cohort, registration number), so re-importing
 * a corrected spreadsheet updates in place. A record already claimed by a
 * student keeps its user_id.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { importCohorts } from '../services/cohortImport.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = flag('dry-run');
const FILE = path.resolve(option('file', path.join(here, 'data', 'cohorts.json')));

async function main() {
  console.log(`\nimporting from ${FILE}${DRY ? '  (dry run)' : ''}\n`);

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    console.error(`Could not read the payload: ${err.message}`);
    console.error('Generate it first:  python scripts/extract-cohorts.py');
    process.exit(1);
  }

  const { totals, summary } = await importCohorts(payload, { dryRun: DRY, log: console.log });

  console.log('\n' + '-'.repeat(60));
  console.log(`  cohorts        ${totals.cohorts}`);
  console.log(`  inserted       ${totals.inserted}`);
  console.log(`  updated        ${totals.updated}`);
  console.log(`  skipped        ${totals.skipped}`);
  console.log(`  assessments    ${totals.assessments}`);
  console.log(`  coding rows    ${totals.coding}`);
  console.log(`  auto-linked    ${totals.linked} to existing accounts`);
  console.log('-'.repeat(60));

  if (summary.length) {
    console.log('\nin the database now:');
    for (const r of summary) {
      console.log(
        `  ${r.code.padEnd(6)} ${String(r.students).padStart(4)} students | ` +
        `${String(r.banded).padStart(3)} banded | ${String(r.with_email).padStart(3)} with email | ` +
        `${String(r.claimed).padStart(3)} claimed | avg readiness ${r.avg_readiness ?? '—'}`
      );
    }
    console.log('\nStudents sign in with <registration number>@kluniversity.in and land on');
    console.log('their record; anyone else can claim from Settings by registration number.\n');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nimport failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
