/**
 * Application tracking.
 *
 * A student marks a job applied, optionally attaching the confirmation
 * screenshot, and moves it along as the process progresses. The placement cell
 * gets a real count of who applied where — which is the number they have never
 * been able to get out of a spreadsheet.
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { hydrateJob } from '../services/jobAlerts.js';
import { deleteProof, proofLimits, proofPath, saveProof } from '../services/proofs.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['applied', 'screening', 'interviewing', 'offer', 'rejected', 'withdrawn'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: proofLimits().maxBytes, files: 1 },
});

/** Shared shape so the list, the create and the update all return the same thing. */
function hydrate(row) {
  return {
    id: row.id,
    status: row.status,
    appliedAt: row.applied_at,
    note: row.note,
    // The filename is never exposed; the client asks for the endpoint instead.
    hasProof: Boolean(row.proof_file),
    proofUrl: row.proof_file ? `/api/jobs/applications/${row.id}/proof` : null,
    proofBytes: row.proof_bytes,
    job: row.title
      ? hydrateJob({
          id: row.job_id, title: row.title, company: row.company, location: row.location,
          work_mode: row.work_mode, job_type: row.job_type, min_ctc: row.min_ctc,
          max_ctc: row.max_ctc, skills: row.skills, apply_url: row.apply_url,
          posted_at: row.posted_at, description: null,
        })
      : { id: row.job_id },
  };
}

const SELECT = `
  SELECT a.*, j.title, j.company, j.location, j.work_mode, j.job_type,
         j.min_ctc, j.max_ctc, j.skills, j.apply_url, j.posted_at
    FROM job_applications a
    JOIN jobs j ON j.id = a.job_id`;

/** GET /api/jobs/applications — everything this student has applied to. */
router.get('/', wrap(async (req, res) => {
  const rows = await query(`${SELECT} WHERE a.user_id = ? ORDER BY a.applied_at DESC`, [req.user.id]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  res.json({
    items: rows.map(hydrate),
    total: rows.length,
    counts,
    withProof: rows.filter((r) => r.proof_file).length,
  });
}));

const createSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  status: z.enum(STATUSES).default('applied'),
  note: z.string().trim().max(600).nullish(),
});

/**
 * POST /api/jobs/applications — "I applied to this."
 *
 * Idempotent on (user, job): pressing it twice updates the existing row rather
 * than failing on the unique key, because a student who re-opens a job and taps
 * again means "yes, still applied", not "error".
 */
router.post('/', writeLimiter, validate(createSchema), wrap(async (req, res) => {
  const { jobId, status, note } = req.body;

  // Only an approved, live listing can be applied to — a pending row is not
  // something a student was ever shown.
  const job = await queryOne(
    `SELECT id, title, company FROM jobs WHERE id = ? AND active = 1 AND status = 'approved'`,
    [jobId]
  );
  if (!job) throw new HttpError(404, 'That opening is not open for applications.', 'not_found');

  const existing = await queryOne(
    `SELECT id FROM job_applications WHERE user_id = ? AND job_id = ?`, [req.user.id, jobId]
  );

  if (existing) {
    await execute(
      `UPDATE job_applications SET status = ?, note = COALESCE(?, note) WHERE id = ?`,
      [status, note ?? null, existing.id]
    );
  } else {
    await execute(
      `INSERT INTO job_applications (user_id, job_id, status, note) VALUES (?,?,?,?)`,
      [req.user.id, jobId, status, note ?? null]
    );
  }

  const row = await queryOne(`${SELECT} WHERE a.user_id = ? AND a.job_id = ?`, [req.user.id, jobId]);
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.JOB_APPLIED,
    detail: { jobId, company: job.company, title: job.title, status },
  });

  res.status(existing ? 200 : 201).json(hydrate(row));
}));

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  note: z.string().trim().max(600).nullish(),
});

/** PATCH /api/jobs/applications/:id — move it along the funnel. */
router.patch('/:id', writeLimiter, validate(updateSchema), wrap(async (req, res) => {
  const owned = await queryOne(
    `SELECT id FROM job_applications WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]
  );
  if (!owned) throw new HttpError(404, 'No such application.', 'not_found');

  const sets = [];
  const params = [];
  if (req.body.status !== undefined) { sets.push('status = ?'); params.push(req.body.status); }
  if (req.body.note !== undefined) { sets.push('note = ?'); params.push(req.body.note ?? null); }
  if (!sets.length) throw new HttpError(422, 'Nothing to update.', 'empty_update');

  await execute(`UPDATE job_applications SET ${sets.join(', ')} WHERE id = ?`, [...params, owned.id]);
  const row = await queryOne(`${SELECT} WHERE a.id = ?`, [owned.id]);
  res.json(hydrate(row));
}));

/** POST /api/jobs/applications/:id/proof — attach the confirmation screenshot. */
router.post('/:id/proof', writeLimiter, upload.single('screenshot'), wrap(async (req, res) => {
  const app = await queryOne(
    `SELECT id, proof_file FROM job_applications WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!app) throw new HttpError(404, 'No such application.', 'not_found');

  const saved = await saveProof(app.id, req.file);
  if (!saved.ok) throw new HttpError(422, saved.message, 'bad_upload');

  const previous = app.proof_file;
  await execute(
    `UPDATE job_applications SET proof_file = ?, proof_bytes = ?, proof_at = NOW() WHERE id = ?`,
    [saved.filename, saved.bytes, app.id]
  );
  // Replace, don't accumulate — the old screenshot is unreachable now.
  if (previous && previous !== saved.filename) await deleteProof(previous);

  await logActivity(req, {
    userId: req.user.id, action: ACTIONS.JOB_PROOF_UPLOADED, detail: { applicationId: app.id },
  });

  const row = await queryOne(`${SELECT} WHERE a.id = ?`, [app.id]);
  res.json(hydrate(row));
}));

/**
 * GET /api/jobs/applications/:id/proof — the image itself.
 *
 * The owner or an admin, nobody else. This is the only way the bytes leave the
 * server, which is what keeps the screenshots off the public web.
 */
router.get('/:id/proof', wrap(async (req, res) => {
  const row = await queryOne(`SELECT user_id, proof_file FROM job_applications WHERE id = ?`, [req.params.id]);
  if (!row?.proof_file) throw new HttpError(404, 'No screenshot on this application.', 'not_found');

  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    throw new HttpError(403, 'That screenshot is not yours.', 'forbidden');

  const full = proofPath(row.proof_file);
  if (!full) throw new HttpError(404, 'That screenshot is missing from disk.', 'not_found');

  // Private: never let a shared cache or a CDN hold a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(full);
}));

/** DELETE /api/jobs/applications/:id — student withdraws the record entirely. */
router.delete('/:id', writeLimiter, wrap(async (req, res) => {
  const row = await queryOne(
    `SELECT id, proof_file FROM job_applications WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!row) throw new HttpError(404, 'No such application.', 'not_found');

  await execute(`DELETE FROM job_applications WHERE id = ?`, [row.id]);
  if (row.proof_file) await deleteProof(row.proof_file);
  res.json({ ok: true });
}));

export default router;
