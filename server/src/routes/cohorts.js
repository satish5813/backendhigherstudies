import { Router } from 'express';
import { query, queryOne } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { wrap, HttpError } from '../middleware/common.js';
import { cohortSummary } from '../services/cohorts.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/cohorts — aggregate view for any signed-in student.
 * Counts and averages only; nothing that identifies another student.
 */
router.get('/', wrap(async (_req, res) => {
  res.json({ cohorts: await cohortSummary() });
}));

/**
 * GET /api/cohorts/:code/students — the placement cell's roster.
 * Admin only, and PII stays out of the payload: no mobile numbers, no dates of
 * birth, no personal email addresses.
 */
router.get('/:code/students', requireAdmin, wrap(async (req, res) => {
  const cohort = await queryOne(`SELECT id, code, name FROM cohorts WHERE code = ?`, [req.params.code]);
  if (!cohort) throw new HttpError(404, 'No such cohort.', 'not_found');

  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(200, Math.max(1, Number(req.query.perPage) || 50));
  const where = ['sr.cohort_id = ?'];
  const params = [cohort.id];

  if (req.query.band) { where.push('sr.target_band = ?'); params.push(req.query.band); }
  if (req.query.branch) { where.push('sr.branch = ?'); params.push(req.query.branch); }
  if (req.query.q) {
    where.push('(sr.name LIKE ? OR sr.reg_no LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }

  const clause = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM student_records sr WHERE ${clause}`, params);
  const rows = await query(
    `SELECT sr.reg_no, sr.name, sr.branch, sr.campus, sr.company, sr.ctc,
            sr.target_band, sr.near_next_band, sr.readiness_index, sr.rank_overall,
            sr.dsa_score, sr.cp_score, sr.crt_score, sr.dev_score, sr.consistency_score,
            sr.ug_cgpa, sr.crt_avg_pct, sr.user_id IS NOT NULL AS claimed
       FROM student_records sr
      WHERE ${clause}
      ORDER BY sr.readiness_index IS NULL, sr.readiness_index DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params
  );

  const num = (v) => (v == null ? null : Number(v));
  res.json({
    cohort: { code: cohort.code, name: cohort.name },
    items: rows.map((r) => ({
      ...r,
      ctc: num(r.ctc),
      readiness_index: num(r.readiness_index),
      ug_cgpa: num(r.ug_cgpa),
      crt_avg_pct: num(r.crt_avg_pct),
      claimed: Boolean(r.claimed),
    })),
    total,
    page,
    pages: Math.ceil(total / perPage),
  });
}));

/**
 * GET /api/cohorts/:code/students/:regNo — one student's full profiling report.
 *
 * Admin only. Unlike the roster this *does* include contact details, because a
 * placement officer chasing a student legitimately needs them — so every read
 * is written to the activity log and can be audited later.
 */
router.get('/:code/students/:regNo', requireAdmin, wrap(async (req, res) => {
  const record = await queryOne(
    `SELECT sr.*, c.code AS cohort_code, c.name AS cohort_name
       FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id
      WHERE c.code = ? AND sr.reg_no = ?`,
    [req.params.code, req.params.regNo]
  );
  if (!record) throw new HttpError(404, 'No record for that registration number.', 'not_found');

  const [assessments, coding, position] = await Promise.all([
    query(
      `SELECT assessment_no, score FROM student_assessments
        WHERE student_record_id = ? ORDER BY assessment_no`,
      [record.id]
    ),
    query(
      `SELECT platform, username, confidence, profile_name, url, solved, easy, medium, hard,
              rating, max_rating, stars, repos, total_stars, followers, top_repo
         FROM student_coding_stats WHERE student_record_id = ?`,
      [record.id]
    ),
    record.readiness_index == null
      ? Promise.resolve(null)
      : queryOne(
          `SELECT COUNT(*) + 1 AS rank_in_cohort,
                  (SELECT COUNT(*) FROM student_records
                    WHERE cohort_id = ? AND readiness_index IS NOT NULL) AS cohort_size
             FROM student_records
            WHERE cohort_id = ? AND readiness_index > ?`,
          [record.cohort_id, record.cohort_id, record.readiness_index]
        ),
  ]);

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.PROFILE_VIEWED,
    detail: { adminViewedRecord: record.reg_no, cohort: record.cohort_code },
  });

  const n = (v) => (v == null ? null : Number(v));

  res.json({
    cohort: { code: record.cohort_code, name: record.cohort_name },
    regNo: record.reg_no,
    name: record.name,
    branch: record.branch,
    campus: record.campus,
    company: record.company,
    ctc: n(record.ctc),
    claimed: Boolean(record.user_id),
    claimedAt: record.claimed_at,
    contact: {
      placementEmail: record.placement_email,
      personalEmail: record.personal_email,
      mobile: record.mobile,
      gender: record.gender,
      dateOfBirth: record.date_of_birth,
    },
    band: {
      target: record.target_band,
      nearNext: record.near_next_band,
      readinessIndex: n(record.readiness_index),
      rankOverall: record.rank_overall,
      rankInCohort: position?.rank_in_cohort ?? null,
      cohortSize: position?.cohort_size ?? null,
    },
    scores: {
      dsa: n(record.dsa_score), cp: n(record.cp_score), crt: n(record.crt_score),
      dev: n(record.dev_score), consistency: n(record.consistency_score),
      academic: n(record.academic_score),
    },
    crt: {
      avgPercent: n(record.crt_avg_pct),
      percentile: n(record.crt_percentile),
      attendance: n(record.crt_attendance),
      assessments: assessments.map((a) => ({ no: a.assessment_no, score: n(a.score) })),
    },
    academics: { ug: n(record.ug_cgpa), inter: n(record.inter_cgpa), ssc: n(record.ssc_cgpa) },
    coaching: {
      strengths: record.strengths, gaps: record.gaps,
      plan: record.plan_next_band, notes: record.data_notes,
    },
    coding: coding.map((c) => ({
      ...c,
      solved: n(c.solved), easy: n(c.easy), medium: n(c.medium), hard: n(c.hard),
      rating: n(c.rating), maxRating: n(c.max_rating), stars: n(c.stars),
      repos: n(c.repos), totalStars: n(c.total_stars), followers: n(c.followers),
    })),
  });
}));

/**
 * GET /api/cohorts/:code/analytics — everything the admin dashboard plots.
 * Aggregates only: no student is identifiable except in the explicit top list,
 * which shows names the placement cell already has.
 */
router.get('/:code/analytics', requireAdmin, wrap(async (req, res) => {
  const cohort = await queryOne(`SELECT id, code, name FROM cohorts WHERE code = ?`, [req.params.code]);
  if (!cohort) throw new HttpError(404, 'No such cohort.', 'not_found');
  const id = cohort.id;

  const [totals, bands, branches, campuses, readiness, companies, cgpa, crt, coding, top] = await Promise.all([
    queryOne(
      `SELECT COUNT(*) students,
              SUM(user_id IS NOT NULL) claimed,
              SUM(target_band IS NOT NULL) banded,
              ROUND(AVG(readiness_index), 1) avg_readiness,
              ROUND(AVG(ug_cgpa), 2) avg_cgpa,
              ROUND(AVG(crt_avg_pct), 1) avg_crt,
              ROUND(AVG(ctc), 2) avg_ctc,
              MAX(ctc) max_ctc
         FROM student_records WHERE cohort_id = ?`,
      [id]
    ),
    query(
      `SELECT target_band label, COUNT(*) n, ROUND(AVG(readiness_index),1) avg_readiness
         FROM student_records WHERE cohort_id = ? AND target_band IS NOT NULL
        GROUP BY target_band ORDER BY n DESC`,
      [id]
    ),
    query(
      `SELECT branch label, COUNT(*) n, ROUND(AVG(readiness_index),1) avg_readiness,
              ROUND(AVG(ug_cgpa),2) avg_cgpa
         FROM student_records WHERE cohort_id = ? AND branch IS NOT NULL
        GROUP BY branch ORDER BY n DESC LIMIT 15`,
      [id]
    ),
    query(
      `SELECT campus label, COUNT(*) n FROM student_records
        WHERE cohort_id = ? AND campus IS NOT NULL GROUP BY campus ORDER BY n DESC`,
      [id]
    ),
    // readiness spread in ten-point buckets
    query(
      `SELECT FLOOR(readiness_index / 10) * 10 bucket, COUNT(*) n
         FROM student_records WHERE cohort_id = ? AND readiness_index IS NOT NULL
        GROUP BY bucket ORDER BY bucket`,
      [id]
    ),
    query(
      `SELECT company label, COUNT(*) n, ROUND(AVG(ctc),2) avg_ctc
         FROM student_records WHERE cohort_id = ? AND company IS NOT NULL
        GROUP BY company ORDER BY n DESC LIMIT 12`,
      [id]
    ),
    query(
      `SELECT CASE
                WHEN ug_cgpa >= 9 THEN '9.0+'
                WHEN ug_cgpa >= 8 THEN '8.0-8.9'
                WHEN ug_cgpa >= 7 THEN '7.0-7.9'
                ELSE 'below 7'
              END label, COUNT(*) n
         FROM student_records WHERE cohort_id = ? AND ug_cgpa IS NOT NULL
        GROUP BY label ORDER BY label DESC`,
      [id]
    ),
    queryOne(
      `SELECT ROUND(AVG(crt_avg_pct),1) avg_pct,
              SUM(crt_avg_pct >= 80) above_80,
              SUM(crt_avg_pct < 50) below_50,
              COUNT(crt_avg_pct) measured
         FROM student_records WHERE cohort_id = ?`,
      [id]
    ),
    queryOne(
      `SELECT COUNT(DISTINCT sr.id) with_any,
              SUM(scs.platform = 'leetcode') leetcode,
              SUM(scs.platform = 'github') github,
              SUM(scs.platform = 'codechef') codechef,
              ROUND(AVG(CASE WHEN scs.platform = 'leetcode' THEN scs.solved END)) avg_lc_solved
         FROM student_records sr
         JOIN student_coding_stats scs ON scs.student_record_id = sr.id
        WHERE sr.cohort_id = ?`,
      [id]
    ),
    query(
      `SELECT reg_no, name, branch, target_band, readiness_index, ug_cgpa, company, ctc
         FROM student_records WHERE cohort_id = ? AND readiness_index IS NOT NULL
        ORDER BY readiness_index DESC LIMIT 10`,
      [id]
    ),
  ]);

  const n = (v) => (v == null ? null : Number(v));
  const shape = (rows) => rows.map((r) => ({
    ...r, n: Number(r.n),
    avg_readiness: n(r.avg_readiness), avg_cgpa: n(r.avg_cgpa), avg_ctc: n(r.avg_ctc),
  }));

  res.json({
    cohort: { code: cohort.code, name: cohort.name },
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, n(v)])),
    bands: shape(bands),
    branches: shape(branches),
    campuses: shape(campuses),
    readiness: readiness.map((r) => ({ bucket: Number(r.bucket), n: Number(r.n) })),
    companies: shape(companies),
    cgpa: shape(cgpa),
    crt: Object.fromEntries(Object.entries(crt).map(([k, v]) => [k, n(v)])),
    coding: Object.fromEntries(Object.entries(coding).map(([k, v]) => [k, n(v)])),
    top: top.map((t) => ({
      ...t, readiness_index: n(t.readiness_index), ug_cgpa: n(t.ug_cgpa), ctc: n(t.ctc),
    })),
  });
}));

/** GET /api/cohorts/:code/facets — branch and band values for the roster filters. */
router.get('/:code/facets', requireAdmin, wrap(async (req, res) => {
  const cohort = await queryOne(`SELECT id FROM cohorts WHERE code = ?`, [req.params.code]);
  if (!cohort) throw new HttpError(404, 'No such cohort.', 'not_found');

  const [branches, bands] = await Promise.all([
    query(
      `SELECT branch, COUNT(*) AS n FROM student_records
        WHERE cohort_id = ? AND branch IS NOT NULL GROUP BY branch ORDER BY n DESC`,
      [cohort.id]
    ),
    query(
      `SELECT target_band, COUNT(*) AS n FROM student_records
        WHERE cohort_id = ? AND target_band IS NOT NULL GROUP BY target_band ORDER BY n DESC`,
      [cohort.id]
    ),
  ]);
  res.json({ branches, bands });
}));

export default router;
