/**
 * Placement cohort records (LPA7 / LPA8).
 *
 * A student_record is institutional data with no account attached. It becomes
 * useful when a student *claims* it — automatically if they sign in with an
 * email that matches, or manually with their registration number. Claiming
 * seeds their profile so they are not retyping what the placement cell already
 * has: branch, campus, CGPAs and their known coding handles.
 */
import { execute, query, queryOne } from '../config/db.js';

const CODING_PLATFORMS = ['leetcode', 'codechef', 'github'];

const profileUrlFor = (platform, username) => {
  if (!username) return null;
  return {
    leetcode: `https://leetcode.com/u/${username}/`,
    codechef: `https://www.codechef.com/users/${username}`,
    github: `https://github.com/${username}`,
  }[platform] ?? null;
};

/** The record attached to a user, with its children. Never leaves the API raw. */
export async function readinessFor(userId) {
  const record = await queryOne(
    `SELECT sr.*, c.code AS cohort_code, c.name AS cohort_name
       FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id
      WHERE sr.user_id = ? ORDER BY sr.updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!record) return null;

  const assessments = await query(
    `SELECT assessment_no, score FROM student_assessments
      WHERE student_record_id = ? ORDER BY assessment_no`,
    [record.id]
  );
  const coding = await query(
    `SELECT platform, username, confidence, solved, easy, medium, hard,
            rating, max_rating, stars, repos, total_stars, followers, top_repo, url
       FROM student_coding_stats WHERE student_record_id = ?`,
    [record.id]
  );

  // Where this student sits inside their own cohort.
  const position = record.readiness_index == null ? null : await queryOne(
    `SELECT COUNT(*) + 1 AS rank_in_cohort,
            (SELECT COUNT(*) FROM student_records WHERE cohort_id = ? AND readiness_index IS NOT NULL) AS cohort_size
       FROM student_records
      WHERE cohort_id = ? AND readiness_index > ?`,
    [record.cohort_id, record.cohort_id, record.readiness_index]
  );

  const number = (v) => (v == null ? null : Number(v));

  return {
    cohort: { code: record.cohort_code, name: record.cohort_name },
    regNo: record.reg_no,
    name: record.name,
    branch: record.branch,
    campus: record.campus,
    company: record.company,
    ctc: number(record.ctc),
    band: {
      target: record.target_band,
      nearNext: record.near_next_band,
      readinessIndex: number(record.readiness_index),
      rankOverall: record.rank_overall,
      rankInCohort: position?.rank_in_cohort ?? null,
      cohortSize: position?.cohort_size ?? null,
    },
    scores: {
      dsa: number(record.dsa_score),
      cp: number(record.cp_score),
      crt: number(record.crt_score),
      dev: number(record.dev_score),
      consistency: number(record.consistency_score),
      academic: number(record.academic_score),
    },
    crt: {
      avgPercent: number(record.crt_avg_pct),
      percentile: number(record.crt_percentile),
      attendance: number(record.crt_attendance),
      assessments: assessments.map((a) => ({ no: a.assessment_no, score: number(a.score) })),
    },
    academics: {
      ug: number(record.ug_cgpa),
      inter: number(record.inter_cgpa),
      ssc: number(record.ssc_cgpa),
    },
    coaching: {
      strengths: record.strengths,
      gaps: record.gaps,
      plan: record.plan_next_band,
      notes: record.data_notes,
    },
    coding: coding.map((c) => ({
      ...c,
      solved: number(c.solved), rating: number(c.rating), maxRating: number(c.max_rating),
      stars: number(c.stars), repos: number(c.repos), totalStars: number(c.total_stars),
      url: c.url || profileUrlFor(c.platform, c.username),
    })),
    claimedAt: record.claimed_at,
  };
}

/**
 * Seeds a freshly claimed profile from the placement record — only filling
 * blanks, so a student who has already edited something keeps their version.
 */
async function seedProfileFrom(record, userId) {
  const filled = [];
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return filled;

  const updates = {};
  if (!user.name && record.name) updates.name = titleCase(record.name);
  if (!user.branch && record.branch) updates.branch = record.branch;
  if (!user.campus && record.campus) updates.campus = record.campus;
  if (!user.reg_no && record.reg_no) updates.reg_no = record.reg_no;
  if (user.cgpa == null && record.ug_cgpa != null) updates.cgpa = record.ug_cgpa;
  if (!user.phone && record.mobile) updates.phone = record.mobile;

  if (Object.keys(updates).length) {
    const cols = Object.keys(updates);
    await execute(
      `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => updates[c]), userId]
    );
    filled.push(...cols);
  }

  // education rows from the three CGPAs
  const [{ n: eduCount }] = await query(`SELECT COUNT(*) AS n FROM educations WHERE user_id = ?`, [userId]);
  if (!eduCount) {
    const rows = [
      record.ug_cgpa != null && ['ug', 'KL University', 'B.Tech', record.branch, record.ug_cgpa, 'cgpa'],
      record.inter_cgpa != null && ['intermediate', 'Intermediate / Diploma', null, null, record.inter_cgpa, record.inter_cgpa > 10 ? 'percentage' : 'cgpa'],
      record.ssc_cgpa != null && ['ssc', 'SSC', null, null, record.ssc_cgpa, record.ssc_cgpa > 10 ? 'percentage' : 'cgpa'],
    ].filter(Boolean);

    for (const [i, [level, institution, degree, branch, score, scoreType]] of rows.entries()) {
      await execute(
        `INSERT INTO educations (user_id, level, institution, degree, branch, score, score_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, level, institution, degree, branch, score, scoreType, i]
      );
    }
    if (rows.length) filled.push(`${rows.length} education entries`);
  }

  // known coding handles -> social links, so a sync can pull live stats
  const stats = await query(
    `SELECT platform, username FROM student_coding_stats
      WHERE student_record_id = ? AND username IS NOT NULL AND username <> ''`,
    [record.id]
  );
  let links = 0;
  for (const s of stats) {
    if (!CODING_PLATFORMS.includes(s.platform)) continue;
    const existing = await queryOne(
      `SELECT id FROM social_links WHERE user_id = ? AND platform = ?`, [userId, s.platform]
    );
    if (existing) continue;
    await execute(
      `INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)`,
      [userId, s.platform, s.username, profileUrlFor(s.platform, s.username)]
    );
    await execute(
      `INSERT INTO coding_profiles (user_id, platform, username, status) VALUES (?, ?, ?, 'unlinked')
       ON DUPLICATE KEY UPDATE username = VALUES(username)`,
      [userId, s.platform, s.username]
    );
    links += 1;
  }
  if (links) filled.push(`${links} coding handles`);

  return filled;
}

/**
 * Links every unclaimed record matching this email. Called right after signup.
 * @returns {Promise<{claimed: boolean, cohort?: string, filled?: string[]}>}
 */
export async function autoClaimByEmail(userId, email) {
  if (!email) return { claimed: false };

  const record = await queryOne(
    `SELECT sr.*, c.code AS cohort_code FROM student_records sr
       JOIN cohorts c ON c.id = sr.cohort_id
      WHERE sr.user_id IS NULL AND (sr.placement_email = ? OR sr.personal_email = ?)
      LIMIT 1`,
    [email, email]
  );
  if (!record) return { claimed: false };

  await execute(`UPDATE student_records SET user_id = ?, claimed_at = NOW() WHERE id = ?`, [userId, record.id]);
  const filled = await seedProfileFrom(record, userId);
  return { claimed: true, cohort: record.cohort_code, regNo: record.reg_no, filled };
}

/**
 * Manual claim by registration number, for the ~85% of records with no email.
 * @returns {Promise<{ok: boolean, message: string, cohort?: string, filled?: string[]}>}
 */
export async function claimByRegNo(userId, rawRegNo) {
  const regNo = String(rawRegNo || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (!regNo) return { ok: false, message: 'Enter your registration number.' };

  const already = await queryOne(`SELECT reg_no FROM student_records WHERE user_id = ?`, [userId]);
  if (already) {
    return { ok: false, message: `Your account is already linked to registration number ${already.reg_no}.` };
  }

  const record = await queryOne(
    `SELECT sr.*, c.code AS cohort_code FROM student_records sr
       JOIN cohorts c ON c.id = sr.cohort_id
      WHERE sr.reg_no = ? LIMIT 1`,
    [regNo]
  );
  if (!record) {
    return { ok: false, message: `No placement record found for ${regNo}. Check the number, or ask your placement cell.` };
  }
  if (record.user_id) {
    return { ok: false, message: 'That record has already been claimed by another account. Contact your placement cell.' };
  }

  await execute(`UPDATE student_records SET user_id = ?, claimed_at = NOW() WHERE id = ?`, [userId, record.id]);
  const filled = await seedProfileFrom(record, userId);

  return {
    ok: true,
    cohort: record.cohort_code,
    regNo: record.reg_no,
    filled,
    message: filled.length
      ? `Linked to ${record.reg_no}. We filled in ${filled.join(', ')}.`
      : `Linked to ${record.reg_no}.`,
  };
}

/** Aggregate cohort view for the placement cell. No PII. */
export async function cohortSummary() {
  return query(
    `SELECT c.code, c.name, c.description, c.imported_at,
            COUNT(sr.id) AS students,
            SUM(sr.user_id IS NOT NULL) AS claimed,
            ROUND(AVG(sr.readiness_index), 1) AS avg_readiness,
            ROUND(AVG(sr.ug_cgpa), 2) AS avg_ug_cgpa,
            SUM(sr.target_band = '50 LPA+') AS band_50_plus,
            SUM(sr.target_band = '20-40 LPA') AS band_20_40,
            SUM(sr.target_band = '10-20 LPA') AS band_10_20
       FROM cohorts c LEFT JOIN student_records sr ON sr.cohort_id = c.id
      GROUP BY c.id ORDER BY c.code`
  );
}

function titleCase(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .trim();
}
