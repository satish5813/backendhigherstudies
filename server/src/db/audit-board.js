/**
 * Re-check every job on the student board against the rules as they stand now.
 *
 *   node server/src/db/audit-board.js            # report
 *   node server/src/db/audit-board.js --fix      # retire the failures
 *
 * The rules have changed several times — a fresher gate, a package floor, a
 * ceiling — and rows approved under the old ones stay approved. That is how a
 * board ends up advertising an "Associate Director" at 60-150 LPA to final-year
 * students alongside fictional seed data.
 *
 * So the board is auditable: re-apply the current rules to what is already
 * published and retire whatever no longer passes. Retired rows become
 * `rejected` rather than deleted, so the nightly sweep never re-queues them.
 */
import { execute, pool, query } from '../config/db.js';
import { env } from '../config/env.js';
import { isFresherRole, isPlaceableRole } from '../services/jobIngest.js';

const FIX = process.argv.includes('--fix');

/** Why this row should not be on a fresher board. Null means it is fine. */
function fault(job) {
  const min = job.min_ctc == null ? null : Number(job.min_ctc);
  const max = job.max_ctc == null ? null : Number(job.max_ctc);

  // Seeded demo rows are fiction. They were useful before real sourcing
  // existed; now they sit among genuine postings and a student cannot tell
  // which is which.
  if (job.source === 'seed') return 'demo seed data';

  if (!isPlaceableRole(job.title)) return 'not a role this campus places into';
  if (!isFresherRole(job.title)) return 'not a fresher role';

  const ceiling = max ?? min;
  if (ceiling == null) return 'no package at all';
  if (ceiling < env.jobs.minCtc) return `pays under ${env.jobs.minCtc} LPA`;
  if (min != null && min > env.jobs.maxCtc) return `starts above ${env.jobs.maxCtc} LPA`;

  return null;
}

async function main() {
  const jobs = await query(
    `SELECT id, source, title, company, min_ctc, max_ctc
       FROM jobs WHERE status = 'approved' AND active = 1
      ORDER BY min_ctc`
  );

  console.log(`\nAuditing ${jobs.length} published job(s) against the current rules`);
  console.log(`fresher only · ${env.jobs.minCtc}-${env.jobs.maxCtc} LPA · India\n`);

  const bad = [];
  const good = [];

  for (const job of jobs) {
    const why = fault(job);
    if (why) bad.push({ job, why });
    else good.push(job);
  }

  for (const { job, why } of bad) {
    console.log(
      `  RETIRE  ${String(job.min_ctc + '-' + job.max_ctc).padEnd(14)}`
      + `${String(job.title).slice(0, 42).padEnd(43)}${String(job.company).padEnd(16)}${why}`
    );
  }
  for (const job of good) {
    console.log(
      `  keep    ${String(job.min_ctc + '-' + job.max_ctc).padEnd(14)}`
      + `${String(job.title).slice(0, 42).padEnd(43)}${job.company}`
    );
  }

  console.log(`\n${good.length} pass, ${bad.length} fail.`);

  if (!bad.length) { await pool.end(); return; }

  if (!FIX) {
    console.log('Re-run with --fix to retire the failures.\n');
    await pool.end();
    return;
  }

  const ids = bad.map((b) => b.job.id);
  const marks = ids.map(() => '?').join(',');
  const res = await execute(
    `UPDATE jobs SET status = 'rejected', active = 0,
            review_note = 'retired by board audit: no longer matches the fresher rules'
      WHERE id IN (${marks})`,
    ids
  );
  console.log(`\nretired ${res.affectedRows} job(s). The board now carries ${good.length}.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
