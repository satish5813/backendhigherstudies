/**
 * How ready is this student for THIS opening?
 *
 * A single ATS score is not enough to answer that. A resume scoring 82 against
 * "backend developer" can still be a poor match for a machine-learning role, so
 * the fit is recomputed against the job's own title and description rather than
 * reusing whatever the resume happened to be scored on.
 *
 * The output gates the apply button. Not to stop anyone — a student who wants
 * to apply anyway may — but because the most useful moment to say "your resume
 * is missing three of the five things this posting asks for" is the moment
 * before they send it, not after the rejection.
 */
import { Router } from 'express';
import { query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap, HttpError } from '../middleware/common.js';
import { scoreResume } from '../services/atsScore.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

const parse = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

/**
 * Where the line sits.
 *
 * `ready` is not "you will get the job" — it is "a scanner will not drop this
 * before a human sees it", which is the only thing an ATS score can honestly
 * claim. Below `weak` the resume is the problem, not the student.
 */
const READY = 70;
const WEAK = 50;

/** GET /api/jobs/:id/fit — the student's readiness for one opening. */
router.get('/:id/fit', wrap(async (req, res) => {
  const job = await queryOne(
    `SELECT id, title, company, description, skills, min_ctc, max_ctc
       FROM jobs WHERE id = ? AND active = 1 AND status = 'approved'`,
    [req.params.id]
  );
  if (!job) throw new HttpError(404, 'That opening is not open for applications.', 'not_found');

  const resumes = await query(
    `SELECT id, title, template, data, ats_score FROM resumes WHERE user_id = ? ORDER BY ats_score DESC`,
    [req.user.id]
  );

  if (!resumes.length) {
    return res.json({
      jobId: job.id,
      verdict: 'no_resume',
      score: null,
      ready: false,
      message: 'Build a resume first — there is nothing to match against this opening yet.',
      missingKeywords: [],
      matchedKeywords: [],
      resume: null,
      threshold: READY,
    });
  }

  // Score every resume against THIS posting and keep the best. A student who
  // tailored one for backend and one for data should be told which to send.
  let best = null;
  for (const r of resumes) {
    const report = scoreResume(parse(r.data, {}), {
      targetRole: job.title,
      jobDescription: [job.title, job.description].filter(Boolean).join('\n'),
      template: r.template,
    });
    if (!best || report.score > best.report.score) best = { resume: r, report };
  }

  const { report, resume } = best;
  const verdict = report.score >= READY ? 'ready' : report.score >= WEAK ? 'close' : 'weak';

  // Only gaps the student could honestly claim are worth naming. The scorer
  // already limits these to the job's own keyword universe.
  const missing = report.missingKeywords.slice(0, 6);

  res.json({
    jobId: job.id,
    verdict,
    score: report.score,
    ready: verdict === 'ready',
    threshold: READY,
    resume: { id: resume.id, title: resume.title, usedAtsScore: resume.ats_score },
    matchedKeywords: report.matchedKeywords.slice(0, 12),
    missingKeywords: missing,
    // The single highest-value thing to change, taken from the scorer's own
    // ranked fix list rather than invented here.
    topFix: report.topFixes?.[0] ?? null,
    message:
      verdict === 'ready'
        ? `Your "${resume.title}" resume scores ${report.score} against this posting. Send that one.`
        : verdict === 'close'
          ? `Your best resume scores ${report.score} here, under the ${READY} that clears most scanners. `
            + (missing.length ? `It never mentions ${missing.slice(0, 3).join(', ')}.` : '')
          : `Your best resume scores ${report.score} against this posting. Applying now mostly wastes the application — fix it first.`,
    // Alerts use the same floor, so the two never disagree about readiness.
    alertFloor: env.jobs.alertMinAts,
  });
}));

export default router;
