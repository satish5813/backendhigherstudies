import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { findMatches, hydrateAlert, hydrateJob, matchScore, sendDigestFor } from '../services/jobAlerts.js';
import { ACTIONS, logActivity } from '../utils/activity.js';
import applicationRoutes from './applications.js';
import jobAdminRoutes from './jobAdmin.js';

const router = Router();
router.use(requireAuth);

// Mounted BEFORE the `/:id` route below. Express matches in declaration order,
// so a later mount would let `/:id` swallow /applications and /admin and try to
// look them up as job ids.
router.use('/applications', applicationRoutes);
router.use('/admin', jobAdminRoutes);

/* ----------------------------------------------------------------- browsing */

/** GET /api/jobs?q=&location=&mode=&type=&minCtc=&page= */
router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(50, Math.max(1, Number(req.query.perPage) || 20));
  const where = ['active = 1', "status = 'approved'", '(expires_at IS NULL OR expires_at > NOW())'];
  const params = [];

  if (req.query.q) {
    where.push('(title LIKE ? OR company LIKE ? OR description LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  if (req.query.location) { where.push('location LIKE ?'); params.push(`%${req.query.location}%`); }
  if (req.query.mode) { where.push('work_mode = ?'); params.push(req.query.mode); }
  if (req.query.type) { where.push('job_type = ?'); params.push(req.query.type); }
  if (req.query.minCtc) { where.push('min_ctc >= ?'); params.push(Number(req.query.minCtc)); }

  const clause = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM jobs WHERE ${clause}`, params);
  const rows = await query(
    `SELECT * FROM jobs WHERE ${clause} ORDER BY posted_at DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params
  );

  res.json({ items: rows.map(hydrateJob), total, page, perPage, pages: Math.ceil(total / perPage) });
}));

/** GET /api/jobs/recommended — ranked against the student's own alert + skills. */
router.get('/recommended', wrap(async (req, res) => {
  const alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [req.user.id]))
    ?? { user_id: req.user.id, roles: [], skills: [], locations: [], work_modes: [], job_types: [], min_ctc: null };
  const items = await findMatches(alert, { limit: Number(req.query.limit) || 12 });
  res.json({ items });
}));

/** GET /api/jobs/:id */
router.get('/:id', wrap(async (req, res) => {
  const row = await queryOne(`SELECT * FROM jobs WHERE id = ? AND active = 1 AND status = 'approved'`, [req.params.id]);
  if (!row) throw new HttpError(404, 'That opening is no longer listed.', 'not_found');

  const alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [req.user.id]));
  const skills = (await query(`SELECT name FROM skills WHERE user_id = ?`, [req.user.id])).map((s) => s.name);
  const job = hydrateJob(row);

  res.json({
    ...job,
    match: alert ? matchScore(row, alert, skills) : null,
    matchedSkills: job.skills.filter((s) => skills.some((mine) => mine.toLowerCase() === s.toLowerCase())),
    missingSkills: job.skills.filter((s) => !skills.some((mine) => mine.toLowerCase() === s.toLowerCase())),
  });
}));

/* ------------------------------------------------------------------- alerts */

const alertSchema = z.object({
  active: z.coerce.boolean().optional(),
  roles: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  locations: z.array(z.string().trim().min(1).max(80)).max(15).optional(),
  work_modes: z.array(z.enum(['onsite', 'remote', 'hybrid'])).max(3).optional(),
  job_types: z.array(z.enum(['full-time', 'internship', 'contract'])).max(3).optional(),
  min_ctc: z.coerce.number().min(0).max(200).nullish(),
  frequency: z.enum(['daily', 'weekly', 'off']).optional(),
  send_hour: z.coerce.number().int().min(0).max(23).optional(),
});

/** GET /api/jobs/alerts/me */
router.get('/alerts/me', wrap(async (req, res) => {
  let alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [req.user.id]));
  if (!alert) {
    await execute(`INSERT INTO job_alerts (user_id) VALUES (?)`, [req.user.id]);
    alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [req.user.id]));
  }
  const history = await query(
    `SELECT id, job_count, status, error, sent_at FROM alert_deliveries
      WHERE user_id = ? ORDER BY sent_at DESC LIMIT 15`,
    [req.user.id]
  );
  const preview = await findMatches(alert, { limit: 5 });
  res.json({ alert, history, preview });
}));

/** PUT /api/jobs/alerts/me */
router.put('/alerts/me', writeLimiter, validate(alertSchema), wrap(async (req, res) => {
  const existing = await queryOne(`SELECT id FROM job_alerts WHERE user_id = ?`, [req.user.id]);
  if (!existing) await execute(`INSERT INTO job_alerts (user_id) VALUES (?)`, [req.user.id]);

  const jsonFields = ['roles', 'skills', 'locations', 'work_modes', 'job_types'];
  const updates = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (jsonFields.includes(key)) updates[key] = JSON.stringify(value);
    else if (typeof value === 'boolean') updates[key] = value ? 1 : 0;
    else updates[key] = value ?? null;
  }
  if (!Object.keys(updates).length) throw new HttpError(422, 'Nothing to update.', 'empty_update');

  const cols = Object.keys(updates);
  await execute(
    `UPDATE job_alerts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE user_id = ?`,
    [...cols.map((c) => updates[c]), req.user.id]
  );

  const alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [req.user.id]));
  await logActivity(req, { userId: req.user.id, action: ACTIONS.ALERT_UPDATED, detail: { fields: cols } });
  res.json({ alert, preview: await findMatches(alert, { limit: 5 }) });
}));

/**
 * POST /api/jobs/alerts/me/test
 * Sends the digest right now so a student can confirm mail actually arrives.
 */
router.post('/alerts/me/test', writeLimiter, wrap(async (req, res) => {
  const result = await sendDigestFor(req.user.id, { force: true });
  await logActivity(req, { userId: req.user.id, action: ACTIONS.ALERT_SENT, detail: { ...result, manual: true } });

  if (result.status === 'failed')
    return res.status(502).json({ error: 'mail_failed', message: `Could not send: ${result.reason}` });
  if (result.status === 'skipped')
    return res.json({ ok: true, sent: false, message: `Nothing to send — ${result.reason}.` });

  res.json({ ok: true, sent: true, count: result.count, message: `Sent ${result.count} matches to ${req.user.email}.` });
}));

/* -------------------------------------------------------------------- admin */

const jobSchema = z.object({
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(180),
  location: z.string().trim().max(180).nullish(),
  work_mode: z.enum(['onsite', 'remote', 'hybrid']).default('onsite'),
  job_type: z.enum(['full-time', 'internship', 'contract']).default('full-time'),
  min_ctc: z.coerce.number().min(0).max(200).nullish(),
  max_ctc: z.coerce.number().min(0).max(200).nullish(),
  experience: z.string().trim().max(60).nullish(),
  skills: z.array(z.string().trim().min(1).max(60)).max(25).default([]),
  description: z.string().trim().max(8000).nullish(),
  apply_url: z.string().trim().url().max(500).nullish(),
  expires_at: z.string().trim().nullish(),
});

/** POST /api/jobs — placement cell posts an opening. */
router.post('/', requireAdmin, validate(jobSchema), wrap(async (req, res) => {
  const b = req.body;
  const result = await execute(
    `INSERT INTO jobs (source, title, company, location, work_mode, job_type, min_ctc, max_ctc,
                       experience, skills, description, apply_url, expires_at)
     VALUES ('internal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.title, b.company, b.location ?? null, b.work_mode, b.job_type, b.min_ctc ?? null, b.max_ctc ?? null,
     b.experience ?? null, JSON.stringify(b.skills), b.description ?? null, b.apply_url ?? null, b.expires_at ?? null]
  );
  const row = await queryOne(`SELECT * FROM jobs WHERE id = ?`, [result.insertId]);
  res.status(201).json(hydrateJob(row));
}));

/** DELETE /api/jobs/:id — soft close. */
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  await execute(`UPDATE jobs SET active = 0 WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
}));

export default router;
