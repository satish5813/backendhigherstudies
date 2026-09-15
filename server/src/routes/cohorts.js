import { Router } from 'express';
import { env } from '../config/env.js';
import { query, queryOne } from '../config/db.js';
import { campusAliases, canonicalCampus } from '../services/campus.js';
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
/**
 * GET /api/cohorts/followup?campus=Vijayawada
 *
 * The placement cell's chase list for one campus, in a single call: who has
 * created a profile and who has not, whose best resume scores what, where
 * their public profile is, and how to reach the ones who have not turned up.
 * Contact details are included, so every read is logged exactly like the
 * per-student report.
 */
router.get('/followup', requireAdmin, wrap(async (req, res) => {
  const campus = canonicalCampus(req.query.campus || 'Vijayawada');
  const aliases = campusAliases(campus);

  const rows = await query(
    `SELECT sr.reg_no, sr.name, sr.branch, sr.target_band, sr.readiness_index,
            sr.mobile, sr.placement_email, sr.personal_email, sr.claimed_at,
            c.code AS cohort,
            u.id AS user_id, u.name AS account_name, u.slug, u.profile_public, u.onboarded, u.last_login_at,
            r.id AS resume_id, r.title AS resume_title, r.ats_score, r.updated_at AS resume_updated_at,
            (SELECT COUNT(*) FROM resumes r2 WHERE r2.user_id = u.id) AS resume_count
       FROM student_records sr
       JOIN cohorts c ON c.id = sr.cohort_id
       LEFT JOIN users u ON u.id = sr.user_id
       LEFT JOIN resumes r ON r.id = (
         SELECT r3.id FROM resumes r3 WHERE r3.user_id = u.id
          ORDER BY r3.ats_score DESC, r3.is_default DESC, r3.updated_at DESC LIMIT 1)
      WHERE LOWER(sr.campus) IN (${aliases.map(() => '?').join(', ')})
      ORDER BY (sr.user_id IS NULL), sr.name`,
    aliases
  );

  const num = (v) => (v == null ? null : Number(v));
  const now = Date.now();
  const items = rows.map((r) => {
    const created = r.user_id != null;
    return {
      regNo: r.reg_no,
      name: r.name,
      branch: r.branch,
      cohort: r.cohort,
      band: r.target_band,
      readiness: num(r.readiness_index),
      status: created ? 'created' : 'pending',
      // The address KL issues, which is also the only one the portal accepts.
      loginEmail: `${String(r.reg_no).toLowerCase()}@${env.access.studentDomain}`,
      contact: { mobile: r.mobile, placementEmail: r.placement_email, personalEmail: r.personal_email },
      account: created
        ? {
            id: Number(r.user_id),
            name: r.account_name,
            slug: r.slug,
            profilePublic: Boolean(r.profile_public),
            onboarded: Boolean(r.onboarded),
            lastLoginAt: r.last_login_at,
            claimedAt: r.claimed_at,
            publicUrl: r.profile_public && r.slug ? `${env.appUrl}/u/${r.slug}` : null,
          }
        : null,
      resume: r.resume_id
        ? {
            id: Number(r.resume_id),
            title: r.resume_title,
            atsScore: num(r.ats_score),
            updatedAt: r.resume_updated_at,
            count: Number(r.resume_count || 0),
            // Opens the resume in the main app's admin print view.
            printUrl: `${env.appUrl}/app/students/${r.cohort}/${encodeURIComponent(r.reg_no)}/resume/${r.resume_id}`,
          }
        : null,
    };
  });

  const scored = items.filter((i) => i.resume?.atsScore != null);
  const summary = {
    campus,
    roster: items.length,
    created: items.filter((i) => i.status === 'created').length,
    pending: items.filter((i) => i.status === 'pending').length,
    withResume: items.filter((i) => i.resume).length,
    publicProfiles: items.filter((i) => i.account?.publicUrl).length,
    activeLast7Days: items.filter((i) => i.account?.lastLoginAt && now - new Date(i.account.lastLoginAt).getTime() < 7 * 86400_000).length,
    avgAts: scored.length ? Math.round(scored.reduce((s, i) => s + i.resume.atsScore, 0) / scored.length) : null,
  };

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.PROFILE_VIEWED,
    detail: { followup: campus, rows: items.length },
  });

  res.json({ summary, items, generatedAt: new Date().toISOString() });
}));

/**
 * GET /api/cohorts/resumes/:id — any student's resume, for the admin print
 * view. The PDF is produced in the browser, so the main app renders it with
 * the same templates the student used. Logged, like every admin read of a
 * student's material.
 */
router.get('/resumes/:id', requireAdmin, wrap(async (req, res) => {
  const r = await queryOne(
    `SELECT r.id, r.title, r.template, r.accent, r.target_role, r.data, r.ats_score, r.ats_report, r.updated_at,
            u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.slug AS owner_slug
       FROM resumes r JOIN users u ON u.id = r.user_id
      WHERE r.id = ?`,
    [req.params.id]
  );
  if (!r) throw new HttpError(404, 'Resume not found.', 'not_found');
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.PROFILE_VIEWED,
    detail: { adminViewedResume: Number(r.id), owner: Number(r.owner_id) },
  });

  res.json({
    id: Number(r.id),
    title: r.title,
    template: r.template,
    accent: r.accent,
    targetRole: r.target_role,
    data: parse(r.data),
    atsScore: r.ats_score == null ? null : Number(r.ats_score),
    atsReport: parse(r.ats_report),
    updatedAt: r.updated_at,
    owner: { id: Number(r.owner_id), name: r.owner_name, email: r.owner_email, slug: r.owner_slug },
  });
}));

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

  // Everything above is the imported spreadsheet: CRT scores, bands, the
  // placement cell's own analysis. It is a snapshot from import day and never
  // changes on its own.
  //
  // `live` is the other half — what the student has actually done since they
  // claimed the record. Without it an officer reading this page has no way to
  // tell an engaged student from a dormant one, and would be quoting stale
  // numbers back at someone whose profile moved on months ago.
  const live = record.user_id ? await liveProfileFor(record.user_id) : null;

  // A claimed record whose account name looks nothing like the roster name is
  // worth a second look — usually a shared device or a mistyped registration
  // number at claim time. Compared loosely, because "K. Priya" and "Priya
  // Kumari" are the same person and must not be flagged.
  if (live) live.nameMismatch = !namesOverlap(record.name, live.name);

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
    live,
  });
}));

/**
 * What this student has actually built in their own login.
 *
 * Deliberately a summary, not a dump: counts, titles and the best ATS score,
 * enough for an officer to judge engagement and open the public profile for the
 * detail. It reads the same tables the student edits, so it is current by
 * construction — there is no copy to fall out of date.
 */
/**
 * DELETE /api/cohorts/accounts/:userId — the placement cell removes an account.
 *
 * The student-facing delete is closed, so this is the only route to it. It is
 * irreversible and takes every child row with it, so it demands the account's
 * own email typed back, refuses to touch another admin, and is written to the
 * activity log with the name of the officer who did it.
 *
 * The placement RECORD survives and is simply unclaimed — the cell's roster and
 * readiness analysis are institutional data that should outlive one login.
 */
router.delete('/accounts/:userId', requireAdmin, wrap(async (req, res) => {
  const target = await queryOne(
    `SELECT id, email, name, role FROM users WHERE id = ?`, [req.params.userId]
  );
  if (!target) throw new HttpError(404, 'No such account.', 'not_found');

  if (String(req.body?.confirm ?? '').trim().toLowerCase() !== target.email.toLowerCase())
    throw new HttpError(422, `Type ${target.email} to confirm.`, 'confirm_required');

  if (target.role === 'admin' && target.id !== req.user.id)
    throw new HttpError(403, 'Remove the admin role before deleting a staff account.', 'forbidden');

  // Unclaim first, so the roster row survives the cascade.
  await execute(
    `UPDATE student_records SET user_id = NULL, claimed_at = NULL WHERE user_id = ?`, [target.id]
  );
  await execute(`DELETE FROM users WHERE id = ?`, [target.id]);

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.ACCOUNT_DELETED,
    detail: { deleted: target.email, name: target.name, by: req.user.email },
  });

  res.json({
    ok: true,
    message: `${target.email} deleted. Their placement record is intact and can be claimed again.`,
  });
}));

/**
 * Do two names plausibly belong to the same person?
 *
 * Indian names reorder and abbreviate constantly across records — "Achanta
 * Bhanu Vamsi" / "Bhanu Vamsi A" / "A. B. Vamsi" are one student. So this asks
 * only whether any word of two or more letters is shared, which catches the
 * genuinely-different case without crying wolf over initials and word order.
 */
function namesOverlap(a, b) {
  const words = (s) => new Set(
    String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1)
  );
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return true; // nothing to compare: do not flag
  for (const w of A) if (B.has(w)) return true;
  return false;
}

async function liveProfileFor(userId) {
  const [user, skills, projects, experience, achievements, resumes, coding, applications] =
    await Promise.all([
      queryOne(
        `SELECT id, name, email, slug, headline, about, avatar_url, branch, grad_year, cgpa,
                location, open_to_work, profile_public, onboarded, last_login_at, created_at
           FROM users WHERE id = ?`,
        [userId]
      ),
      query(`SELECT name, category, proficiency FROM skills WHERE user_id = ? ORDER BY sort_order`, [userId]),
      query(`SELECT title, role, tech, featured FROM projects WHERE user_id = ? ORDER BY featured DESC, sort_order`, [userId]),
      query(`SELECT company, role, type, start_date, end_date FROM experiences WHERE user_id = ? ORDER BY sort_order`, [userId]),
      query(`SELECT title, issuer, category, date FROM achievements WHERE user_id = ? ORDER BY sort_order`, [userId]),
      query(`SELECT id, title, target_role, template, ats_score, updated_at FROM resumes WHERE user_id = ? ORDER BY ats_score DESC`, [userId]),
      query(`SELECT platform, username, status, solved_total, contest_rating, fetched_at FROM coding_profiles WHERE user_id = ?`, [userId]),
      query(
        `SELECT a.status, a.applied_at, a.proof_file IS NOT NULL AS has_proof, j.title, j.company
           FROM job_applications a JOIN jobs j ON j.id = a.job_id
          WHERE a.user_id = ? ORDER BY a.applied_at DESC LIMIT 20`,
        [userId]
      ),
    ]);

  if (!user) return null;

  const json = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return []; }
  };

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    slug: user.slug,
    headline: user.headline,
    about: user.about,
    avatarUrl: user.avatar_url,
    branch: user.branch,
    gradYear: user.grad_year,
    cgpa: user.cgpa == null ? null : Number(user.cgpa),
    location: user.location,
    openToWork: Boolean(user.open_to_work),
    profilePublic: Boolean(user.profile_public),
    onboarded: Boolean(user.onboarded),
    lastLoginAt: user.last_login_at,
    joinedAt: user.created_at,

    counts: {
      skills: skills.length,
      projects: projects.length,
      experience: experience.length,
      achievements: achievements.length,
      resumes: resumes.length,
      applications: applications.length,
    },
    skills: skills.map((s) => s.name),
    projects: projects.map((p) => ({ title: p.title, role: p.role, tech: json(p.tech), featured: Boolean(p.featured) })),
    experience: experience.map((e) => ({
      company: e.company, role: e.role, type: e.type, startDate: e.start_date, endDate: e.end_date,
    })),
    achievements: achievements.map((a) => ({ title: a.title, issuer: a.issuer, category: a.category, date: a.date })),
    resumes: resumes.map((r) => ({
      id: r.id, title: r.title, targetRole: r.target_role, template: r.template,
      atsScore: r.ats_score, updatedAt: r.updated_at,
    })),
    bestAtsScore: resumes.length ? Math.max(...resumes.map((r) => r.ats_score ?? 0)) : null,
    coding: coding.map((c) => ({
      platform: c.platform, username: c.username, status: c.status,
      solved: c.solved_total, rating: c.contest_rating, fetchedAt: c.fetched_at,
    })),
    applications: applications.map((a) => ({
      title: a.title, company: a.company, status: a.status,
      appliedAt: a.applied_at, hasProof: Boolean(a.has_proof),
    })),
  };
}

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
