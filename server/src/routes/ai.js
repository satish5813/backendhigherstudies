import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { validate, wrap, writeLimiter, HttpError } from '../middleware/common.js';
import { aiStatus, improveBullet, reviewResume, sanitiseApply, writeSummary } from '../services/ai.js';
import { execute, query, queryOne } from '../config/db.js';
import { loadFullProfile } from './profile.js';
import { buildResumeData, pruneEmpty } from '../services/resumeBuilder.js';
import { scoreResume } from '../services/atsScore.js';
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

/**
 * POST /api/ai/apply — accept one AI suggestion.
 *
 * This writes to the PROFILE, not to the one resume the review ran against.
 * The profile is the source of truth every resume autofills from, so applying a
 * fix only to the resume would leave the student's next resume, their public
 * profile and their job matching carrying the same weak headline the AI just
 * told them to replace.
 *
 * Nothing is applied automatically. The student presses a button per fix, and
 * the response says exactly what changed so the UI can show it.
 */
const applySchema = z.object({
  target: z.enum(['headline', 'summary', 'skills']),
  value: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
  // Optional: the resume the student is looking at. Given one, the change is
  // pulled straight back into it and the ATS score is recomputed, so the
  // response can say what the fix was actually worth.
  resumeId: z.coerce.number().int().positive().nullish(),
});

/**
 * Re-pull the profile into one resume and re-score it.
 *
 * Without this the student applies a fix, the number on screen does not move,
 * and the feature looks broken — even when it worked. Returning before/after
 * lets the UI say "78 → 80", or say plainly that a rewrite changed no keywords,
 * which is the honest answer for most headline edits.
 */
async function rescoreResume(userId, resumeId) {
  const row = await queryOne(`SELECT * FROM resumes WHERE id = ? AND user_id = ?`, [resumeId, userId]);
  if (!row) return null;

  const before = row.ats_score;
  const profile = await loadFullProfile(userId);
  const data = pruneEmpty(buildResumeData(profile, { targetRole: row.target_role }));
  const report = scoreResume(data, {
    targetRole: row.target_role,
    jobDescription: row.job_description,
    template: row.template,
  });

  await execute(
    `UPDATE resumes SET data = ?, ats_score = ?, ats_report = ? WHERE id = ?`,
    [JSON.stringify(data), report.score, JSON.stringify(report), resumeId]
  );

  return {
    before,
    after: report.score,
    delta: report.score - before,
    // What the student most wants to know: did this close a keyword gap?
    closed: (() => {
      const prev = safeJson(row.ats_report)?.missingKeywords ?? [];
      const now = new Set(report.missingKeywords ?? []);
      return prev.filter((k) => !now.has(k));
    })(),
  };
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

router.post('/apply', writeLimiter, validate(applySchema), wrap(async (req, res) => {
  // Re-run the same guard the review used. The client could post anything, and
  // "[NUMBER]" reaching a real profile is the failure that matters here.
  const clean = sanitiseApply(req.body);
  if (!clean)
    throw new HttpError(422, 'That suggestion still needs your own numbers — fill it in yourself.', 'needs_you');

  if (clean.target === 'skills') {
    // Add, never replace. The AI sees one resume; the student's profile may
    // hold skills this resume deliberately left out.
    const existing = await query(`SELECT name FROM skills WHERE user_id = ?`, [req.user.id]);
    const have = new Set(existing.map((s) => s.name.toLowerCase()));
    const fresh = clean.value.filter((s) => !have.has(s.toLowerCase()));

    if (!fresh.length)
      return res.json({ ok: true, target: 'skills', added: [], ats: null, message: 'You already have all of those.' });

    const [{ next }] = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM skills WHERE user_id = ?`, [req.user.id]
    );
    for (const [i, name] of fresh.entries()) {
      await execute(
        `INSERT INTO skills (user_id, name, category, proficiency, sort_order) VALUES (?, ?, 'other', 3, ?)`,
        [req.user.id, name, next + i]
      );
    }

    const ats = req.body.resumeId ? await rescoreResume(req.user.id, req.body.resumeId) : null;
    await logActivity(req, {
      userId: req.user.id, action: ACTIONS.AI_APPLIED, detail: { target: 'skills', added: fresh, delta: ats?.delta },
    });
    return res.json({
      ok: true,
      target: 'skills',
      added: fresh,
      ats,
      message: `Added ${fresh.length} skill${fresh.length === 1 ? '' : 's'} to your profile.`,
    });
  }

  const column = clean.target === 'headline' ? 'headline' : 'about';
  const before = await queryOne(`SELECT ${column} AS v FROM users WHERE id = ?`, [req.user.id]);
  await execute(`UPDATE users SET ${column} = ? WHERE id = ?`, [clean.value, req.user.id]);

  const ats = req.body.resumeId ? await rescoreResume(req.user.id, req.body.resumeId) : null;
  await logActivity(req, {
    userId: req.user.id, action: ACTIONS.AI_APPLIED, detail: { target: clean.target, delta: ats?.delta },
  });
  res.json({
    ok: true,
    target: clean.target,
    // Returned so the UI can offer an undo without a second round trip.
    previous: before?.v ?? null,
    value: clean.value,
    ats,
    message: clean.target === 'headline' ? 'Headline updated.' : 'Summary updated.',
  });
}));

export default router;
