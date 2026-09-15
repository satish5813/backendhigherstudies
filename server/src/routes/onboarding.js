/**
 * Getting a student from an empty profile to a scoreable resume.
 *
 * The placement cell already holds a record for all 656 students, but almost
 * none of it is profile data — CRT scores and readiness bands say nothing about
 * what a student built or which languages they know. So a student would sign in,
 * see their name and branch prefilled, and face eleven empty sections with no
 * idea which ones actually matter.
 *
 * Three steps, in the order that costs the student least effort:
 *
 *   1. confirm   we already know your name, branch, CGPA and coding handles.
 *                Check them. One screen, mostly reading.
 *   2. resume    upload the resume you already have; we read it and fill in
 *                what we can. Far cheaper than retyping it into a form.
 *   3. complete  here is exactly what is still missing and required, and what
 *                each gap costs you. No open-ended "fill in your profile".
 *
 * Only after that does an ATS score mean anything, which is why the score is
 * gated on step 3 rather than shown against a blank document.
 */
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

/**
 * The fields a student must have before a resume is worth scoring.
 *
 * Deliberately shorter than the dashboard's completeness checklist: that one
 * measures how strong a profile is, this one is the floor below which a resume
 * is not a resume. Making the full checklist compulsory would stall a student
 * who has no internship yet, which is most of third year.
 */
const REQUIRED = [
  { key: 'name', label: 'Your full name', why: 'Every resume is headed with it.' },
  { key: 'phone', label: 'Phone number', why: 'Recruiters call before they email.' },
  { key: 'academics', label: 'Branch, graduation year and CGPA', why: 'The first eligibility filter in every campus drive.' },
  { key: 'education', label: 'At least one education entry', why: 'An ATS looks for a degree block and drops resumes without one.' },
  { key: 'skills', label: 'At least 6 skills', why: 'Keyword matching is a quarter of your ATS score.' },
  { key: 'projects', label: 'At least one project', why: 'With no internship, this is the only evidence you can build.' },
];

function requiredState({ user, counts }) {
  const done = {
    name: Boolean(user.name),
    phone: Boolean(user.phone),
    academics: Boolean(user.branch && user.grad_year && user.cgpa),
    education: counts.education > 0,
    skills: counts.skills >= 6,
    projects: counts.projects >= 1,
  };
  return REQUIRED.map((r) => ({ ...r, done: done[r.key] }));
}

async function sectionCounts(userId) {
  const one = async (table) => {
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]);
    return n;
  };
  const [education, skills, projects, experience, achievements] = await Promise.all(
    ['educations', 'skills', 'projects', 'experiences', 'achievements'].map(one)
  );
  return { education, skills, projects, experience, achievements };
}

/**
 * GET /api/me/onboarding — where this student is, and what to ask next.
 */
router.get('/', wrap(async (req, res) => {
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  const counts = await sectionCounts(req.user.id);

  const record = await queryOne(
    `SELECT sr.id, sr.reg_no, sr.name, sr.branch, sr.campus, sr.mobile,
            sr.ug_cgpa, sr.inter_cgpa, sr.ssc_cgpa, sr.target_band, c.code AS cohort_code, c.name AS cohort_name
       FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id
      WHERE sr.user_id = ?`,
    [req.user.id]
  );

  const handles = record
    ? await query(
        `SELECT platform, username FROM student_coding_stats
          WHERE student_record_id = ? AND username IS NOT NULL AND username <> ''`,
        [record.id]
      )
    : [];

  const required = requiredState({ user, counts });
  const missing = required.filter((r) => !r.done);

  const hasUploadedResume = Boolean(
    await queryOne(`SELECT id FROM resumes WHERE user_id = ? LIMIT 1`, [req.user.id])
  );

  // A record with nothing but a name is not worth a confirmation screen — it
  // would ask the student to verify one field they already know.
  const recordWorthConfirming = Boolean(
    record && (record.branch || record.ug_cgpa != null || record.mobile || handles.length)
  );

  let step;
  if (recordWorthConfirming && !user.record_confirmed_at) step = 'confirm';
  else if (!hasUploadedResume && missing.length) step = 'resume';
  else if (missing.length) step = 'complete';
  else step = 'done';

  res.json({
    step,
    // Null when there is no claimed record, which is the common case for a
    // student who signed up before the cell imported their cohort.
    record: record && {
      regNo: record.reg_no,
      name: record.name,
      branch: record.branch,
      campus: record.campus,
      mobile: record.mobile,
      ugCgpa: record.ug_cgpa == null ? null : Number(record.ug_cgpa),
      interCgpa: record.inter_cgpa == null ? null : Number(record.inter_cgpa),
      sscCgpa: record.ssc_cgpa == null ? null : Number(record.ssc_cgpa),
      targetBand: record.target_band,
      cohort: record.cohort_name,
      handles: handles.map((h) => ({ platform: h.platform, username: h.username })),
      worthConfirming: recordWorthConfirming,
    },
    confirmedAt: user.record_confirmed_at,
    profile: {
      name: user.name, phone: user.phone, branch: user.branch,
      gradYear: user.grad_year, cgpa: user.cgpa == null ? null : Number(user.cgpa),
      location: user.location,
    },
    counts,
    required,
    missingRequired: missing.length,
    hasUploadedResume,
    // The one thing the whole flow is for: an ATS score against an empty
    // profile is a meaningless number that makes students distrust the tool.
    canScore: missing.length === 0,
  });
}));

const confirmSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(24).nullish(),
  branch: z.string().trim().max(120).nullish(),
  gradYear: z.coerce.number().int().min(2000).max(2100).nullish(),
  cgpa: z.coerce.number().min(0).max(10).nullish(),
  location: z.string().trim().max(120).nullish(),
  // Education rows the student accepted from the record's CGPA columns.
  education: z.array(z.object({
    level: z.enum(['ug', 'pg', 'intermediate', 'diploma', 'ssc', 'other']),
    institution: z.string().trim().min(1).max(180),
    degree: z.string().trim().max(120).nullish(),
    branch: z.string().trim().max(120).nullish(),
    score: z.coerce.number().min(0).max(100).nullish(),
    scoreType: z.enum(['cgpa', 'percentage']).default('cgpa'),
  })).max(6).default([]),
  handles: z.array(z.object({
    platform: z.enum(['github', 'leetcode', 'codechef', 'hackerrank', 'linkedin', 'portfolio', 'other']),
    username: z.string().trim().min(1).max(120),
  })).max(8).default([]),
});

const HANDLE_URL = {
  github: (u) => `https://github.com/${u}`,
  leetcode: (u) => `https://leetcode.com/u/${u}/`,
  codechef: (u) => `https://www.codechef.com/users/${u}`,
  hackerrank: (u) => `https://www.hackerrank.com/${u}`,
  linkedin: (u) => `https://www.linkedin.com/in/${u}`,
};

/**
 * POST /api/me/onboarding/confirm — "yes, that is me", with corrections.
 *
 * The student's edits win over the imported record every time. The workbook is
 * a snapshot typed by someone else; the person filling this form is the
 * authority on their own name and phone number.
 */
router.post('/confirm', writeLimiter, validate(confirmSchema), wrap(async (req, res) => {
  const b = req.body;

  await execute(
    `UPDATE users
        SET name = ?, phone = ?, branch = ?, grad_year = ?, cgpa = ?, location = ?,
            record_confirmed_at = NOW()
      WHERE id = ?`,
    [b.name, b.phone ?? null, b.branch ?? null, b.gradYear ?? null, b.cgpa ?? null,
     b.location ?? null, req.user.id]
  );

  // Education and links are only ever ADDED here. A student who already
  // entered their own school should not have it duplicated by a confirmation.
  let addedEducation = 0;
  const [{ n: eduCount }] = await query(`SELECT COUNT(*) AS n FROM educations WHERE user_id = ?`, [req.user.id]);
  if (!eduCount) {
    for (const [i, e] of b.education.entries()) {
      await execute(
        `INSERT INTO educations (user_id, level, institution, degree, branch, score, score_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, e.level, e.institution, e.degree ?? null, e.branch ?? null,
         e.score ?? null, e.scoreType, i]
      );
      addedEducation++;
    }
  }

  let addedLinks = 0;
  for (const h of b.handles) {
    const exists = await queryOne(
      `SELECT id FROM social_links WHERE user_id = ? AND platform = ?`, [req.user.id, h.platform]
    );
    if (exists) continue;
    await execute(
      `INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)`,
      [req.user.id, h.platform, h.username, HANDLE_URL[h.platform]?.(h.username) ?? null]
    );
    addedLinks++;
  }

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.RECORD_CONFIRMED,
    detail: { addedEducation, addedLinks },
  });

  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  const counts = await sectionCounts(req.user.id);
  const required = requiredState({ user, counts });

  res.json({
    ok: true,
    addedEducation,
    addedLinks,
    required,
    missingRequired: required.filter((r) => !r.done).length,
  });
}));

/**
 * POST /api/me/onboarding/skip — the student says the record is not theirs, or
 * they would rather fill it in by hand. Either way, stop asking.
 */
router.post('/skip', writeLimiter, wrap(async (req, res) => {
  await execute(`UPDATE users SET record_confirmed_at = NOW() WHERE id = ?`, [req.user.id]);
  res.json({ ok: true });
}));

export default router;
