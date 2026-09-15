import { execute, query, queryOne } from '../config/db.js';
import { canonicalCampus } from './campus.js';

/**
 * Loads a placement cohort payload (the shape scripts/extract-cohorts.py
 * produces) into MySQL.
 *
 * Lifted out of the import script so the same code can run behind an HTTP
 * endpoint. The roster must never be committed — it is 656 students' personal
 * details — so on a server it arrives over HTTPS, not in the repository, and
 * a script that only reads a local file cannot do that.
 *
 * Re-runnable: records upsert on (cohort, registration number), so a corrected
 * spreadsheet updates in place. A record already claimed keeps its user_id.
 */

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

/** Shape check before anything is written. Returns a reason, or null if fine. */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Body must be a JSON object.';
  if (!Array.isArray(payload.cohorts)) return 'Expected { cohorts: [...] }.';
  for (const c of payload.cohorts) {
    if (!c || typeof c.code !== 'string' || !c.code.trim()) return 'Every cohort needs a code.';
    if (!Array.isArray(c.records)) return `Cohort ${c.code}: records must be an array.`;
  }
  return null;
}

/**
 * @param {object} payload   { cohorts: [{ code, name, description?, source_file?, records: [...] }] }
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]   count what would happen, write nothing
 * @param {Function} [opts.log]     per-cohort progress line
 * @returns {Promise<{totals: object, summary: object[]}>}
 */
export async function importCohorts(payload, { dryRun = false, log = () => {} } = {}) {
  const bad = validatePayload(payload);
  if (bad) throw new Error(bad);

  const tables = await query(`SHOW TABLES LIKE 'student_records'`);
  if (!tables.length) throw new Error('Table student_records is missing — the schema has not been applied.');

  const totals = { cohorts: 0, inserted: 0, updated: 0, assessments: 0, coding: 0, linked: 0, skipped: 0 };

  for (const cohort of payload.cohorts) {
    const records = cohort.records;
    log(`${cohort.code} — ${records.length} students`);

    if (dryRun) {
      totals.cohorts += 1;
      for (const r of records) (r.reg_no && r.name) ? totals.inserted++ : totals.skipped++;
      continue;
    }

    await execute(
      `INSERT INTO cohorts (code, name, description, source_file, student_count)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
         source_file = VALUES(source_file), student_count = VALUES(student_count),
         imported_at = NOW()`,
      [cohort.code, cohort.name ?? cohort.code, cohort.description ?? null, cohort.source_file ?? null, records.length]
    );
    const { id: cohortId } = await queryOne(`SELECT id FROM cohorts WHERE code = ?`, [cohort.code]);
    totals.cohorts += 1;

    for (const source of records) {
      if (!source.reg_no || !source.name) { totals.skipped += 1; continue; }
      // Campus spelled one way, whatever the sheet said.
      const record = { ...source, campus: canonicalCampus(source.campus) };

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

      // assessments: replace wholesale, the sheet is the source of truth
      await execute(`DELETE FROM student_assessments WHERE student_record_id = ?`, [recordId]);
      for (const a of record.assessments ?? []) {
        if (a.score == null) continue;
        await execute(
          `INSERT INTO student_assessments (student_record_id, assessment_no, score) VALUES (?, ?, ?)`,
          [recordId, a.no, a.score]
        );
        totals.assessments += 1;
      }

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

  // Attach records to anyone who already has an account — by either email on
  // the record, or by the registration-number address KL issues.
  if (!dryRun) {
    const linkable = await query(
      `SELECT sr.id, u.id AS user_id
         FROM student_records sr
         JOIN users u ON u.email = sr.placement_email
                      OR u.email = sr.personal_email
                      OR u.email = CONCAT(LOWER(sr.reg_no), '@kluniversity.in')
        WHERE sr.user_id IS NULL`
    );
    for (const row of linkable) {
      await execute(`UPDATE student_records SET user_id = ?, claimed_at = NOW() WHERE id = ?`, [row.user_id, row.id]);
      totals.linked += 1;
    }
  }

  const summary = dryRun ? [] : await query(
    `SELECT c.code, COUNT(*) AS students,
            SUM(sr.target_band IS NOT NULL) AS banded,
            SUM(sr.placement_email IS NOT NULL OR sr.personal_email IS NOT NULL) AS with_email,
            SUM(sr.user_id IS NOT NULL) AS claimed,
            ROUND(AVG(sr.readiness_index), 1) AS avg_readiness
       FROM cohorts c JOIN student_records sr ON sr.cohort_id = c.id
      GROUP BY c.code ORDER BY c.code`
  );

  return { totals, summary };
}
