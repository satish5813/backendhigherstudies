import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { validate, wrap, HttpError } from '../middleware/common.js';
import { aiStatus, improveBullet, reviewResume, writeSummary } from '../services/ai.js';
import { queryOne } from '../config/db.js';
import { clientIp, ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

/**
 * Gemini's free tier is generous but finite, and 656 students share one key.
 * Per user rather than per IP, since a whole campus can share an IP.
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ai:${req.user?.id ?? clientIp(req)}`,
  handler: (_req, res) =>
    res.status(429).json({
      error: 'rate_limited',
      message: 'You are using AI help very quickly. Wait a minute — the daily quota is shared across the whole college.',
    }),
});

router.get('/status', (_req, res) => res.json(aiStatus()));

const bulletSchema = z.object({
  text: z.string().trim().min(8, 'Write a few words first.').max(600),
  role: z.string().trim().max(150).nullish(),
  company: z.string().trim().max(180).nullish(),
  tech: z.array(z.string().trim().max(60)).max(20).default([]),
});

/** POST /api/ai/bullet — sharpen one achievement line the student wrote. */
router.post('/bullet', aiLimiter, validate(bulletSchema), wrap(async (req, res) => {
  const result = await improveBullet(req.body);
  if (!result.ok) throw new HttpError(422, result.error, 'ai_failed');

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.AI_USED,
    detail: { task: 'bullet', rejected: result.rejected ?? 0 },
  });
  res.json(result);
}));

const summarySchema = z.object({
  data: z.record(z.any()),
  targetRole: z.string().trim().max(150).nullish(),
});

/** POST /api/ai/summary — draft a professional summary from profile facts. */
router.post('/summary', aiLimiter, validate(summarySchema), wrap(async (req, res) => {
  const result = await writeSummary({ profile: req.body.data, targetRole: req.body.targetRole });
  if (!result.ok) throw new HttpError(422, result.error, 'ai_failed');

  await logActivity(req, { userId: req.user.id, action: ACTIONS.AI_USED, detail: { task: 'summary' } });
  res.json(result);
}));

/** POST /api/ai/review/:resumeId — specific, addressable fixes for one resume. */
router.post('/review/:resumeId', aiLimiter, wrap(async (req, res) => {
  const row = await queryOne(
    `SELECT data, ats_report, target_role, job_description FROM resumes WHERE id = ? AND user_id = ?`,
    [req.params.resumeId, req.user.id]
  );
  if (!row) throw new HttpError(404, 'Resume not found.', 'not_found');

  const parse = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return fallback; }
  };

  const result = await reviewResume({
    data: parse(row.data, {}),
    atsReport: parse(row.ats_report, null),
    targetRole: row.target_role,
    jobDescription: row.job_description,
  });
  if (!result.ok) throw new HttpError(422, result.error, 'ai_failed');

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.AI_USED,
    detail: { task: 'review', resumeId: Number(req.params.resumeId), fixes: result.fixes.length },
  });
  res.json(result);
}));

export default router;
