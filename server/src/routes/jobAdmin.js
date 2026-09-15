/**
 * The moderation queue.
 *
 * Everything the nightly sweep finds lands here as `pending` and goes no
 * further until a placement officer approves it. Approving sets `status =
 * 'approved'`, which is the single condition that makes a job visible to
 * students, matchable by the alert engine, and applicable to.
 */
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { hydrateJob } from '../services/jobAlerts.js';
import { expireStaleJobs, ingestAll } from '../services/jobIngest.js';
import { sourceStatus } from '../services/jobSources.js';
import { checkPendingLinks, checkUrl } from '../services/linkCheck.js';
import { env } from '../config/env.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/* ------------------------------------------------------------ the queue */

/** GET /api/jobs/admin/queue?status=pending&q=&source=&page= */
router.get('/queue', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 25));

  const where = ['status = ?'];
  const params = [status];
  if (req.query.q) {
    where.push('(title LIKE ? OR company LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.source) { where.push('source = ?'); params.push(req.query.source); }
  if (req.query.minCtc) { where.push('max_ctc >= ?'); params.push(Number(req.query.minCtc)); }

  const clause = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM jobs WHERE ${clause}`, params);
  const rows = await query(
    `SELECT * FROM jobs WHERE ${clause}
      ORDER BY ingested_at DESC, posted_at DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params
  );

  const counts = await query(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`);

  res.json({
    items: rows.map((r) => ({
      ...hydrateJob(r),
      status: r.status,
      ctcSource: r.ctc_source,
      // hydrateJob keeps the raw snake_case column; the queue reads camelCase
      // like every other field here, so expose it under both.
      applyUrl: r.apply_url,
      sourceUrl: r.source_url,
      link: {
        status: r.link_status,
        code: r.link_code,
        checkedAt: r.link_checked_at,
        // Where it actually ends up, so an officer can see a posting that has
        // been moved rather than removed.
        finalUrl: r.link_final_url,
      },
      ingestedAt: r.ingested_at,
      reviewNote: r.review_note,
      // The description is long; the queue only needs enough to judge it.
      excerpt: r.description ? String(r.description).slice(0, 400) : null,
    })),
    total, page, perPage, pages: Math.ceil(total / perPage),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
}));

/** GET /api/jobs/admin/sources — which feeds are live, and what each needs. */
router.get('/sources', wrap(async (_req, res) => {
  const runs = await query(
    `SELECT source, status, found, inserted, duplicates, below_floor, error, ms, started_at
       FROM job_ingest_runs ORDER BY started_at DESC LIMIT 25`
  );
  res.json({
    sources: sourceStatus(),
    minCtc: env.jobs.minCtc,
    autoIngest: env.jobs.autoIngest,
    ingestHour: env.jobs.ingestHour,
    runs,
  });
}));

/* ------------------------------------------------------------- decisions */

const decisionSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  note: z.string().trim().max(500).nullish(),
  // Publish even where the link check says the posting is gone.
  force: z.coerce.boolean().optional(),
});

/**
 * POST /api/jobs/admin/approve — publish these to the student board.
 *
 * Bulk by design: an officer clearing a morning's queue should not click
 * through 200 confirmations.
 */
router.post('/approve', writeLimiter, validate(decisionSchema), wrap(async (req, res) => {
  const { ids, note } = req.body;
  const marks = ids.map(() => '?').join(',');

  // Anything selected but never link-checked is verified now, so "approve all"
  // cannot quietly publish a posting that was taken down overnight.
  const unchecked = await query(
    `SELECT id, apply_url FROM jobs
      WHERE id IN (${marks}) AND link_status = 'unchecked' AND apply_url IS NOT NULL`,
    ids
  );
  for (const row of unchecked) {
    const r = await checkUrl(row.apply_url);
    await execute(
      `UPDATE jobs SET link_status = ?, link_code = ?, link_checked_at = NOW(), link_final_url = ? WHERE id = ?`,
      [r.status, r.code, r.finalUrl?.slice(0, 500) ?? null, row.id]
    );
  }

  // Dead links are held back rather than published. `force` lets an officer who
  // has looked at one themselves override it — the check is a safety net, not
  // an authority.
  const dead = await query(
    `SELECT id, company, title FROM jobs WHERE id IN (${marks}) AND link_status = 'dead'`, ids
  );
  const skip = req.body.force ? [] : dead.map((d) => d.id);
  const toApprove = ids.filter((id) => !skip.includes(id));

  if (!toApprove.length) {
    return res.status(409).json({
      error: 'dead_links',
      message: `Every selected opening has a dead apply link. Reject them, or approve again with force to publish anyway.`,
      dead,
    });
  }

  const approveMarks = toApprove.map(() => '?').join(',');
  const result = await execute(
    `UPDATE jobs SET status = 'approved', active = 1, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
      WHERE id IN (${approveMarks}) AND status <> 'approved'`,
    [req.user.id, note ?? null, ...toApprove]
  );

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.JOB_APPROVED,
    detail: { count: result.affectedRows, heldBack: skip.length, ids: toApprove.slice(0, 20) },
  });

  res.json({
    ok: true,
    updated: result.affectedRows,
    // Named, not just counted, so the officer can go and look at them.
    heldBack: dead.filter((d) => skip.includes(d.id)),
    verified: unchecked.length,
  });
}));

/**
 * POST /api/jobs/admin/verify-links — check the apply links in a queue.
 *
 * Runs on demand so an officer can clear the "unchecked" state before reviewing
 * rather than discovering dead links one at a time.
 */
router.post('/verify-links', writeLimiter, wrap(async (req, res) => {
  const result = await checkPendingLinks({
    status: ['pending', 'approved'].includes(req.query.status) ? req.query.status : 'pending',
    limit: Number(req.query.limit) || 200,
    recheck: req.query.recheck === '1',
  });
  await logActivity(req, { userId: req.user.id, action: ACTIONS.JOB_LINKS_CHECKED, detail: result });
  res.json(result);
}));

/** POST /api/jobs/admin/reject — keep the row so the sweep never re-queues it. */
router.post('/reject', writeLimiter, validate(decisionSchema), wrap(async (req, res) => {
  const { ids, note } = req.body;
  const marks = ids.map(() => '?').join(',');
  const result = await execute(
    `UPDATE jobs SET status = 'rejected', active = 0, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
      WHERE id IN (${marks})`,
    [req.user.id, note ?? null, ...ids]
  );
  await logActivity(req, { userId: req.user.id, action: ACTIONS.JOB_REJECTED, detail: { count: result.affectedRows, ids: ids.slice(0, 20) } });
  res.json({ ok: true, updated: result.affectedRows });
}));

const editSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  company: z.string().trim().min(1).max(180).optional(),
  location: z.string().trim().max(180).nullish(),
  work_mode: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  job_type: z.enum(['full-time', 'internship', 'contract']).optional(),
  min_ctc: z.coerce.number().min(0).max(300).nullish(),
  max_ctc: z.coerce.number().min(0).max(300).nullish(),
  ctc_source: z.enum(['listed', 'estimated', 'unknown']).optional(),
  expires_at: z.string().trim().nullish(),
});

/**
 * PATCH /api/jobs/admin/:id — correct a sourced row before approving it.
 *
 * The package estimate is a guess from a job title; an officer who knows the
 * real band should be able to fix it and mark it `listed` rather than reject an
 * otherwise good opening.
 */
router.patch('/:id', writeLimiter, validate(editSchema), wrap(async (req, res) => {
  const job = await queryOne(`SELECT id FROM jobs WHERE id = ?`, [req.params.id]);
  if (!job) throw new HttpError(404, 'No such job.', 'not_found');

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(value ?? null);
  }
  if (!sets.length) throw new HttpError(422, 'Nothing to update.', 'empty_update');

  await execute(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, [...params, job.id]);
  res.json(hydrateJob(await queryOne(`SELECT * FROM jobs WHERE id = ?`, [job.id])));
}));

/* -------------------------------------------------------------- ingestion */

/** POST /api/jobs/admin/ingest — run the sweep now instead of waiting for 3am. */
router.post('/ingest', writeLimiter, wrap(async (req, res) => {
  const only = typeof req.query.source === 'string' ? req.query.source : null;
  const dryRun = req.query.dryRun === '1';
  const result = await ingestAll({ only, dryRun });
  await logActivity(req, { userId: req.user.id, action: ACTIONS.JOB_INGESTED, detail: { manual: true, ...result } });
  res.json(result);
}));

/** POST /api/jobs/admin/expire — close listings nobody took down. */
router.post('/expire', writeLimiter, wrap(async (_req, res) => {
  res.json({ ok: true, closed: await expireStaleJobs() });
}));

/* -------------------------------------------------------------- analytics */

/**
 * GET /api/jobs/admin/applications — who applied where.
 *
 * This is the number the placement cell could never get out of a spreadsheet:
 * per-job counts, per-student counts, and how many attached proof.
 */
router.get('/applications', wrap(async (req, res) => {
  const [totals] = await query(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT user_id) AS students,
            COUNT(DISTINCT job_id)  AS jobs,
            SUM(proof_file IS NOT NULL) AS with_proof
       FROM job_applications`
  );

  const byStatus = await query(
    `SELECT status, COUNT(*) AS n FROM job_applications GROUP BY status`
  );

  const topJobs = await query(
    `SELECT j.id, j.title, j.company, j.min_ctc, j.max_ctc,
            COUNT(a.id) AS applicants,
            SUM(a.proof_file IS NOT NULL) AS with_proof
       FROM job_applications a JOIN jobs j ON j.id = a.job_id
      GROUP BY j.id ORDER BY applicants DESC LIMIT 15`
  );

  const recent = await query(
    `SELECT a.id, a.status, a.applied_at, a.proof_file IS NOT NULL AS has_proof,
            u.id AS user_id, u.name, u.branch, u.grad_year,
            j.title, j.company
       FROM job_applications a
       JOIN users u ON u.id = a.user_id
       JOIN jobs  j ON j.id = a.job_id
      ORDER BY a.applied_at DESC LIMIT ?`,
    [Math.min(100, Number(req.query.limit) || 40)]
  );

  res.json({
    totals: {
      ...totals,
      with_proof: Number(totals.with_proof ?? 0),
      proofRate: totals.total ? Math.round((Number(totals.with_proof ?? 0) / totals.total) * 100) : 0,
    },
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    topJobs,
    recent: recent.map((r) => ({
      id: r.id, status: r.status, appliedAt: r.applied_at,
      hasProof: Boolean(r.has_proof),
      proofUrl: r.has_proof ? `/api/jobs/applications/${r.id}/proof` : null,
      student: { id: r.user_id, name: r.name, branch: r.branch, gradYear: r.grad_year },
      job: { title: r.title, company: r.company },
    })),
  });
}));

export default router;
