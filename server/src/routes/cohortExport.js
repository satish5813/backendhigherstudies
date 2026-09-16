import { Router } from 'express';
import { env } from '../config/env.js';
import { query, queryOne } from '../config/db.js';
import { wrap } from '../middleware/common.js';
import { campusAliases, canonicalCampus } from '../services/campus.js';
import { ACTIONS, logActivity } from '../utils/activity.js';
import { tokenOrAdmin } from './cohortImport.js';

/**
 * GET /api/cohorts/export?campus=all|Vijayawada
 *
 * Everything the portal knows about every student on the roster, in one
 * document, for filling the placement cell's own spreadsheets. Roster fields
 * for everyone; account, profile, links, coding stats, resume and application
 * counts for those who have signed in.
 *
 * Guarded like the import: an administrator's session, or the roster service
 * token. No contact details — the sheets this feeds already carry them.
 * Logged, because it is a whole-roster read of student material.
 */
const router = Router();

const json = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
};
const num = (v) => (v == null ? null : Number(v));

async function profileFor(userId) {
  const [user, skills, links, projects, experiences, achievements, coding, resumes, apps] = await Promise.all([
    queryOne(`SELECT headline, location, cgpa, grad_year, branch FROM users WHERE id = ?`, [userId]),
    query(`SELECT name FROM skills WHERE user_id = ? ORDER BY sort_order`, [userId]),
    query(`SELECT platform, username, url FROM social_links WHERE user_id = ?`, [userId]),
    query(`SELECT title FROM projects WHERE user_id = ? ORDER BY featured DESC, sort_order`, [userId]),
    query(`SELECT COUNT(*) AS n FROM experiences WHERE user_id = ?`, [userId]),
    query(`SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?`, [userId]),
    query(`SELECT platform, username, solved_total, contest_rating FROM coding_profiles WHERE user_id = ? AND status = 'ok'`, [userId]),
    query(`SELECT id, title, ats_score, updated_at FROM resumes WHERE user_id = ? ORDER BY ats_score DESC, is_default DESC, updated_at DESC`, [userId]),
    query(`SELECT COUNT(*) AS n FROM job_applications WHERE user_id = ?`, [userId]),
  ]);
  const best = resumes[0];
  return {
    profile: {
      headline: user?.headline ?? null,
      location: user?.location ?? null,
      cgpa: num(user?.cgpa),
      gradYear: user?.grad_year ?? null,
      branch: user?.branch ?? null,
      skills: skills.map((s) => s.name),
      links: links.map((l) => ({ platform: l.platform, username: l.username, url: l.url })),
      projects: projects.length,
      projectTitles: projects.map((p) => p.title),
      experiences: Number(experiences[0]?.n ?? 0),
      achievements: Number(achievements[0]?.n ?? 0),
      coding: coding.map((c) => ({ platform: c.platform, username: c.username, solved: c.solved_total, rating: c.contest_rating })),
    },
    resume: best
      ? { id: Number(best.id), title: best.title, atsScore: num(best.ats_score), updatedAt: best.updated_at, count: resumes.length }
      : null,
    applications: Number(apps[0]?.n ?? 0),
  };
}

router.get('/', tokenOrAdmin, wrap(async (req, res) => {
  const wanted = String(req.query.campus || 'all');
  const all = wanted.toLowerCase() === 'all';
  const campus = all ? null : canonicalCampus(wanted);
  const aliases = all ? [] : campusAliases(campus);

  const rows = await query(
    `SELECT sr.reg_no, sr.name, sr.branch, sr.campus, sr.target_band, sr.readiness_index,
            c.code AS cohort,
            u.id AS user_id, u.name AS account_name, u.slug, u.profile_public, u.onboarded, u.last_login_at
       FROM student_records sr
       JOIN cohorts c ON c.id = sr.cohort_id
       LEFT JOIN users u ON u.id = sr.user_id
      ${all ? '' : `WHERE LOWER(sr.campus) IN (${aliases.map(() => '?').join(', ')})`}
      ORDER BY sr.reg_no`,
    aliases
  );

  const items = [];
  for (const r of rows) {
    const base = {
      regNo: r.reg_no,
      name: r.name,
      branch: r.branch,
      campus: r.campus,
      cohort: r.cohort,
      band: r.target_band,
      readiness: num(r.readiness_index),
      loginEmail: `${String(r.reg_no).toLowerCase()}@${env.access.studentDomain}`,
      account: null,
      profile: null,
      resume: null,
      applications: 0,
    };
    if (r.user_id != null) {
      base.account = {
        id: Number(r.user_id),
        name: r.account_name,
        slug: r.slug,
        onboarded: Boolean(r.onboarded),
        lastLoginAt: r.last_login_at,
        publicUrl: r.profile_public && r.slug ? `${env.appUrl}/u/${r.slug}` : null,
      };
      Object.assign(base, await profileFor(r.user_id));
    }
    items.push(base);
  }

  await logActivity(req, {
    userId: req.user?.id ?? null,
    action: ACTIONS.PROFILE_VIEWED,
    detail: { export: all ? 'all' : campus, rows: items.length, by: req.importedBy },
  });

  res.json({ campus: all ? 'all' : campus, generatedAt: new Date().toISOString(), items });
}));

export default router;
