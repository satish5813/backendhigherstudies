/**
 * Loads the placement cohort payload produced by scripts/extract-cohorts.py
 * into MySQL. Pure Node — the VPS needs no Python or Excel parser.
 *
 *   node server/src/db/import-cohorts.js
 *   node server/src/db/import-cohorts.js --file some/other.json --dry-run
 *
 * Re-runnable: records upsert on (cohort, registration number), so re-importing
 * a corrected spreadsheet updates in place. A record already claimed by a
 * student keeps its user_id.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, pool, query, queryOne } from '../config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = flag('dry-run');
const FILE = path.resolve(option('file', path.join(here, 'data', 'cohorts.json')));

const RECORD_COLUMNS = [
  'name', 'branch', 'campus', 'company', 'ctc',
  'gender', 'date_of_birth', 'mobile', 'placement_email', 'personal_email',
  'ug_cgpa', 'inter_cgpa', 'ssc_cgpa',
  'rank_overall', 'target_band', 'near_next_band', 'readiness_index',
  'dsa_score', 'cp_score', 'crt_score', 'dev_score', 'consistency_score',
  'academic_score', 'crt_avg_pct', 'crt_percentile', 'crt_attendance',
  'strengths', 'gaps', 'plan_next_band', 'data_notes',
];

const CODING_COLUMNS = [
  'username', 'confidence', 'profile_name', 'url', 'solved', 'easy', 'medium',
  'hard', 'rating', 'max_rating', 'stars', 'repos', 'total_stars', 'followers', 'top_repo',
];

const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

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

  const tables = await query(`SHOW TABLES LIKE 'student_records'`);
  if (!tables.length) {
    console.error('Table `student_records` is missing — run node server/src/db/migrate.js first.');
    process.exit(1);
  }

  const totals = { cohorts: 0, inserted: 0, updated: 0, assessments: 0, coding: 0, linked: 0, skipped: 0 };

  for (const cohort of payload.cohorts ?? []) {
    const records = cohort.records ?? [];
    console.log(`${cohort.code} — ${records.length} students`);

    if (DRY) {
      totals.cohorts += 1;
      totals.inserted += records.length;
      continue;
    }

    await execute(
      `INSERT INTO cohorts (code, name, description, source_file, student_count)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
         source_file = VALUES(source_file), student_count = VALUES(student_count),
         imported_at = NOW()`,
      [cohort.code, cohort.name, cohort.description ?? null, cohort.source_file ?? null, records.length]
    );
    const { id: cohortId } = await queryOne(`SELECT id FROM cohorts WHERE code = ?`, [cohort.code]);
    totals.cohorts += 1;

    for (const record of records) {
      if (!record.reg_no || !record.name) { totals.skipped += 1; continue; }

      const existing = await queryOne(
        `SELECT id FROM student_records WHERE cohort_id = ? AND reg_no = ?`,
        [cohortId, record.reg_no]
      );

      const values = RECORD_COLUMNS.map((c) => record[c] ?? null);
      const raw = JSON.stringify({ assessments: record.assessments ?? [], coding: record.coding ?? [] });

      if (existing) {
        await execute(
          `UPDATE student_records SET ${RECORD_COLUMNS.map((c) => `${c} = ?`).join(', ')}, raw = ?
            WHERE id = ?`,
          [...values, raw, existing.id]
        );
        totals.updated += 1;
      } else {
        await execute(
          `INSERT INTO student_records (cohort_id, reg_no, ${RECORD_COLUMNS.join(', ')}, raw)
           VALUES (?, ?, ${RECORD_COLUMNS.map(() => '?').join(', ')}, ?)`,
          [cohortId, record.reg_no, ...values, raw]
        );
        totals.inserted += 1;
      }

      const { id: recordId } = await queryOne(
        `SELECT id FROM student_records WHERE cohort_id = ? AND reg_no = ?`,
        [cohortId, record.reg_no]
      );

      /* ---- assessments: replace wholesale, the sheet is the source of truth */
      await execute(`DELETE FROM student_assessments WHERE student_record_id = ?`, [recordId]);
      for (const a of record.assessments ?? []) {
        if (a.score == null) continue;
        await execute(
          `INSERT INTO student_assessments (student_record_id, assessment_no, score) VALUES (?, ?, ?)`,
          [recordId, a.no, a.score]
        );
        totals.assessments += 1;
      }

      /* ---- coding stats */
      await execute(`DELETE FROM student_coding_stats WHERE student_record_id = ?`, [recordId]);
      for (const c of record.coding ?? []) {
        if (!['leetcode', 'codechef', 'github'].includes(c.platform)) continue;
        const confidence = VALID_CONFIDENCE.has(String(c.confidence || '').toUpperCase())
          ? String(c.confidence).toUpperCase()
          : 'UNKNOWN';
        await execute(
          `INSERT INTO student_coding_stats (student_record_id, platform, ${CODING_COLUMNS.join(', ')})
           VALUES (?, ?, ${CODING_COLUMNS.map(() => '?').join(', ')})`,
          [recordId, c.platform, ...CODING_COLUMNS.map((k) => (k === 'confidence' ? confidence : c[k] ?? null))]
        );
        totals.coding += 1;
      }
    }
  }

  /* ---- attach records to anyone who already has an account -------------- */
  if (!DRY) {
    const linkable = await query(
      `SELECT sr.id, u.id AS user_id
         FROM student_records sr
         JOIN users u ON u.email = sr.placement_email OR u.email = sr.personal_email
        WHERE sr.user_id IS NULL`
    );
    for (const row of linkable) {
      await execute(`UPDATE student_records SET user_id = ?, claimed_at = NOW() WHERE id = ?`, [
        row.user_id, row.id,
      ]);
      totals.linked += 1;
    }
  }

  /* ---- report ----------------------------------------------------------- */
  console.log('\n' + '-'.repeat(60));
  console.log(`  cohorts        ${totals.cohorts}`);
  console.log(`  inserted       ${totals.inserted}`);
  console.log(`  updated        ${totals.updated}`);
  console.log(`  skipped        ${totals.skipped}`);
  console.log(`  assessments    ${totals.assessments}`);
  console.log(`  coding rows    ${totals.coding}`);
  console.log(`  auto-linked    ${totals.linked} to existing accounts`);
  console.log('-'.repeat(60));

  if (!DRY) {
    const summary = await query(
      `SELECT c.code, COUNT(*) AS students,
              SUM(sr.target_band IS NOT NULL) AS banded,
              SUM(sr.placement_email IS NOT NULL OR sr.personal_email IS NOT NULL) AS with_email,
              SUM(sr.user_id IS NOT NULL) AS claimed,
              ROUND(AVG(sr.readiness_index), 1) AS avg_readiness
         FROM cohorts c JOIN student_records sr ON sr.cohort_id = c.id
        GROUP BY c.code ORDER BY c.code`
    );
    console.log('\nin the database now:');
    for (const r of summary) {
      console.log(
        `  ${r.code.padEnd(6)} ${String(r.students).padStart(4)} students | ` +
        `${String(r.banded).padStart(3)} banded | ${String(r.with_email).padStart(3)} with email | ` +
        `${String(r.claimed).padStart(3)} claimed | avg readiness ${r.avg_readiness ?? '—'}`
      );
    }
    console.log('\nStudents claim their record by signing in with a matching email,');
    console.log('or from Settings using their registration number.\n');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nimport failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
