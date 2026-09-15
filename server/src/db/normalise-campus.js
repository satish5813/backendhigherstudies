/**
 * Unify the campus codes across the imported workbooks.
 *
 *   node server/src/db/normalise-campus.js          # report
 *   node server/src/db/normalise-campus.js --write  # apply
 *
 * LPA7 was typed with VZA/HYD and LPA8 with VJA/Hyd. They are the same two
 * campuses, so anything that groups or filters by campus currently splits
 * Vijayawada in half and shows Hyderabad twice. This maps every spelling onto
 * one canonical name and carries it through to any claimed user profile.
 *
 * Safe to re-run: rows already canonical are left alone.
 */
import { execute, query, pool } from '../config/db.js';

/** Every spelling seen in the source files, mapped to the name we display. */
const CANONICAL = {
  vza: 'Vijayawada',
  vja: 'Vijayawada',
  vijayawada: 'Vijayawada',
  hyd: 'Hyderabad',
  hyderabad: 'Hyderabad',
  bza: 'Vijayawada',     // older Bezawada code, in case an import carries it
};

const WRITE = process.argv.includes('--write');

const canonical = (raw) => CANONICAL[String(raw ?? '').trim().toLowerCase()] ?? null;

async function main() {
  const before = await query(
    `SELECT campus, COUNT(*) n FROM student_records GROUP BY campus ORDER BY n DESC`
  );

  console.log('Campus values in student_records:');
  const plan = [];
  let unknown = 0;

  for (const { campus, n } of before) {
    const to = canonical(campus);
    if (!to) {
      unknown += n;
      console.log(`  ${String(campus).padEnd(14)} ${String(n).padStart(4)}  -> UNRECOGNISED, left as is`);
    } else if (to === campus) {
      console.log(`  ${String(campus).padEnd(14)} ${String(n).padStart(4)}  already canonical`);
    } else {
      plan.push([campus, to, n]);
      console.log(`  ${String(campus).padEnd(14)} ${String(n).padStart(4)}  -> ${to}`);
    }
  }

  if (!plan.length) {
    console.log('\nNothing to change.');
    await pool.end();
    return;
  }

  if (!WRITE) {
    console.log(`\n${plan.reduce((s, [, , n]) => s + n, 0)} rows would change. Re-run with --write to apply.`);
    await pool.end();
    return;
  }

  let records = 0;
  let users = 0;
  for (const [from, to] of plan) {
    const r = await execute(`UPDATE student_records SET campus = ? WHERE campus = ?`, [to, from]);
    records += r.affectedRows;

    // A student who already claimed carries the old code on their profile.
    const u = await execute(`UPDATE users SET campus = ? WHERE campus = ?`, [to, from]);
    users += u.affectedRows;
  }

  // Users may also hold a free-typed spelling that never came from a workbook.
  for (const [spelling, to] of Object.entries(CANONICAL)) {
    const u = await execute(
      `UPDATE users SET campus = ? WHERE LOWER(TRIM(campus)) = ? AND campus <> ?`,
      [to, spelling, to]
    );
    users += u.affectedRows;
  }

  const after = await query(
    `SELECT campus, COUNT(*) n FROM student_records GROUP BY campus ORDER BY n DESC`
  );
  console.log(`\nUpdated ${records} records and ${users} user profiles.`);
  console.log('Now:');
  for (const { campus, n } of after) console.log(`  ${String(campus).padEnd(14)} ${n}`);
  if (unknown) console.log(`\n${unknown} row(s) had a campus this script does not know — add it to CANONICAL.`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
