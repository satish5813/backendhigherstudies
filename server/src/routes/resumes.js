import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { loadFullProfile } from './profile.js';
import { ACCENT_PRESETS, buildResumeData, normaliseAccent, pruneEmpty, TEMPLATES, TEMPLATE_IDS } from '../services/resumeBuilder.js';
import { scoreResume, ROLE_KEYWORDS } from '../services/atsScore.js';
import {
  ACCEPTED, MAX_UPLOAD_BYTES, extractText, parseResumeText, uploadToScorable,
} from '../services/resumeImport.js';
import { normaliseHandle, profileUrl } from '../services/codingProfiles.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

// Uploads stay in memory: the text is extracted, scored and discarded. Keeping
// students' resumes on disk would be a data-retention liability for no gain.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ACCEPTED[file.mimetype] || ['pdf', 'docx', 'txt', 'md'].includes(ext)) return cb(null, true);
    cb(new HttpError(422, 'Upload a PDF, a Word .docx file, or plain text.', 'bad_file_type'));
  },
});

const parseJson = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const hydrate = (row) => ({
  ...row,
  id: Number(row.id),
  data: parseJson(row.data, {}),
  ats_report: parseJson(row.ats_report, null),
  is_default: Boolean(row.is_default),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(150).default('My Resume'),
  template: z.enum(TEMPLATE_IDS).default('ats-classic'),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/,
    'Accent must be a 6-digit hex colour such as #4f46e5').nullish(),
  targetRole: z.string().trim().max(150).nullish(),
  jobDescription: z.string().trim().max(20000).nullish(),
  autofill: z.coerce.boolean().default(true),
  data: z.record(z.any()).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  template: z.enum(TEMPLATE_IDS).optional(),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/,
    'Accent must be a 6-digit hex colour such as #4f46e5').nullish(),
  targetRole: z.string().trim().max(150).nullish(),
  jobDescription: z.string().trim().max(20000).nullish(),
  data: z.record(z.any()).optional(),
  isDefault: z.coerce.boolean().optional(),
});

/** GET /api/resumes/templates — template gallery + the role keyword library. */
router.get('/templates', (_req, res) => {
  res.json({ templates: TEMPLATES, accents: ACCENT_PRESETS, roles: Object.keys(ROLE_KEYWORDS).sort() });
});

/**
 * POST /api/resumes/analyse — upload an existing resume and score it.
 *
 * Nothing is written to the profile. The response is a set of *suggestions*
 * the student accepts explicitly, because free-form resume parsing guesses,
 * and a guess written silently into someone's profile is worse than no parse.
 */
router.post(
  '/analyse',
  writeLimiter,
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Attach a resume file to analyse.', 'no_file');

    const extracted = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!extracted.ok) throw new HttpError(422, extracted.error, 'unreadable_file');

    if ((extracted.text || '').trim().length < 80) {
      // Overwhelmingly this is a file made with Windows' "Microsoft Print to
      // PDF", which rasterises the page. Naming it saves the student a long
      // guessing game — and warns them their real applications are affected.
      const producer = extracted.producer || '';
      const rasterised = /print to pdf|image|scan/i.test(producer);
      throw new HttpError(
        422,
        rasterised || !producer
          ? [
              'That PDF contains no text at all — only a picture of the page.',
              'It was almost certainly saved with "Microsoft Print to PDF", which rasterises everything.',
              'Re-export it with your browser’s "Save as PDF", or Word’s File › Save As › PDF.',
              'Worth knowing: an ATS reads the current file as a blank page too.',
            ].join(' ')
          : `Almost no text came out of that file (produced by ${producer}). Export a text-based PDF and try again.`,
        'no_text'
      );
    }

    const parsed = parseResumeText(extracted.text);
    const report = scoreResume(uploadToScorable(parsed), {
      targetRole: req.body?.targetRole,
      jobDescription: req.body?.jobDescription,
    });

    await logActivity(req, {
      userId: req.user.id,
      action: ACTIONS.RESUME_UPLOADED,
      detail: {
        filename: req.file.originalname,
        kind: extracted.kind,
        bytes: req.file.size,
        words: parsed.wordCount,
        score: report.score,
      },
    });

    res.json({
      file: { name: req.file.originalname, kind: extracted.kind, bytes: req.file.size, pages: extracted.pages ?? null },
      wordCount: parsed.wordCount,
      suggestions: {
        basics: parsed.basics,
        skills: parsed.skills,
        confidence: parsed.confidence,
      },
      sectionsFound: parsed.sectionsFound,
      sectionsMissing: parsed.sectionsMissing,
      ats: report,
    });
  })
);

/**
 * POST /api/resumes/analyse/apply — write accepted suggestions to the profile.
 * Only fills blanks; an existing value is never overwritten by a guess.
 */
router.post(
  '/analyse/apply',
  writeLimiter,
  wrap(async (req, res) => {
    const { basics = {}, skills = [] } = req.body || {};
    const applied = [];

    const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    const updates = {};
    if (basics.fullName && !user.name) updates.name = String(basics.fullName).slice(0, 120);
    if (basics.phone && !user.phone) updates.phone = String(basics.phone).slice(0, 24);

    if (Object.keys(updates).length) {
      const cols = Object.keys(updates);
      await execute(
        `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => updates[c]), req.user.id]
      );
      applied.push(...cols);
    }

    for (const [platform, key] of [['linkedin', 'linkedin'], ['github', 'github'], ['leetcode', 'leetcode']]) {
      const url = basics[key];
      if (!url) continue;
      const existing = await queryOne(
        `SELECT id FROM social_links WHERE user_id = ? AND platform = ?`, [req.user.id, platform]
      );
      if (existing) continue;
      const username = normaliseHandle(platform, url);
      if (!username) continue;
      await execute(
        `INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)`,
        [req.user.id, platform, username, profileUrl(platform, username)]
      );
      applied.push(platform);
    }

    let addedSkills = 0;
    for (const name of Array.isArray(skills) ? skills.slice(0, 40) : []) {
      const clean = String(name).trim().slice(0, 80);
      if (!clean) continue;
      const result = await execute(
        `INSERT IGNORE INTO skills (user_id, name, category, proficiency) VALUES (?, ?, 'other', 3)`,
        [req.user.id, clean]
      );
      if (result.affectedRows) addedSkills += 1;
    }
    if (addedSkills) applied.push(`${addedSkills} skills`);

    await logActivity(req, {
      userId: req.user.id,
      action: ACTIONS.PROFILE_UPDATED,
      detail: { fromUpload: applied },
    });

    res.json({
      ok: true,
      applied,
      message: applied.length
        ? `Added ${applied.join(', ')} to your profile.`
        : 'Nothing new to add — your profile already has these details.',
    });
  })
);

/** GET /api/resumes/autofill — the profile rendered as resume data, without saving. */
router.get('/autofill', wrap(async (req, res) => {
  const profile = await loadFullProfile(req.user.id);
  const data = buildResumeData(profile, { targetRole: req.query.targetRole });
  res.json({ data, completeness: profile.completeness });
}));

/** GET /api/resumes */
router.get('/', wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, title, template, accent, target_role, ats_score, is_default, created_at, updated_at
       FROM resumes WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows.map((r) => ({ ...r, id: Number(r.id), is_default: Boolean(r.is_default) })) });
}));

/** POST /api/resumes — autofills from the profile unless explicit data is supplied. */
router.post('/', writeLimiter, validate(createSchema), wrap(async (req, res) => {
  const { title, template, targetRole, jobDescription, autofill } = req.body;
  const accent = normaliseAccent(req.body.accent);

  let data = req.body.data;
  if (!data && autofill) {
    const profile = await loadFullProfile(req.user.id);
    data = pruneEmpty(buildResumeData(profile, { targetRole }));
  }
  data = data || { basics: { email: req.user.email } };

  const report = scoreResume(data, { targetRole, jobDescription, template });

  const existing = await query(`SELECT id FROM resumes WHERE user_id = ?`, [req.user.id]);
  const isFirst = existing.length === 0;

  const result = await execute(
    `INSERT INTO resumes (user_id, title, template, accent, target_role, job_description, data, ats_score, ats_report, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, title, template, accent, targetRole ?? null, jobDescription ?? null,
     JSON.stringify(data), report.score, JSON.stringify(report), isFirst ? 1 : 0]
  );

  const row = await queryOne(`SELECT * FROM resumes WHERE id = ?`, [result.insertId]);
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.RESUME_CREATED,
    detail: { id: Number(result.insertId), template, targetRole, score: report.score },
  });
  res.status(201).json(hydrate(row));
}));

/** POST /api/resumes/score — score arbitrary data without persisting (live preview). */
router.post('/score', wrap(async (req, res) => {
  const { data, targetRole, jobDescription, template } = req.body || {};
  if (!data || typeof data !== 'object')
    throw new HttpError(422, 'Send the resume `data` object to score.', 'validation_failed');
  res.json(scoreResume(data, { targetRole, jobDescription, template }));
}));

/** GET /api/resumes/:id */
router.get('/:id', wrap(async (req, res) => {
  const row = await queryOne(`SELECT * FROM resumes WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) throw new HttpError(404, 'Resume not found.', 'not_found');
  res.json(hydrate(row));
}));

/** PATCH /api/resumes/:id — rescoring happens on every content change. */
router.patch('/:id', writeLimiter, validate(updateSchema), wrap(async (req, res) => {
  const row = await queryOne(`SELECT * FROM resumes WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) throw new HttpError(404, 'Resume not found.', 'not_found');

  const next = {
    title: req.body.title ?? row.title,
    template: req.body.template ?? row.template,
    accent: 'accent' in req.body ? normaliseAccent(req.body.accent) : row.accent,
    target_role: 'targetRole' in req.body ? req.body.targetRole : row.target_role,
    job_description: 'jobDescription' in req.body ? req.body.jobDescription : row.job_description,
    data: req.body.data ?? parseJson(row.data, {}),
  };

  const report = scoreResume(next.data, {
    targetRole: next.target_role,
    jobDescription: next.job_description,
    template: next.template,
  });

  await execute(
    `UPDATE resumes SET title = ?, template = ?, accent = ?, target_role = ?, job_description = ?,
            data = ?, ats_score = ?, ats_report = ?
      WHERE id = ? AND user_id = ?`,
    [next.title, next.template, next.accent, next.target_role, next.job_description,
     JSON.stringify(next.data), report.score, JSON.stringify(report), req.params.id, req.user.id]
  );

  if (req.body.isDefault) {
    await execute(`UPDATE resumes SET is_default = 0 WHERE user_id = ?`, [req.user.id]);
    await execute(`UPDATE resumes SET is_default = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  }

  const updated = await queryOne(`SELECT * FROM resumes WHERE id = ?`, [req.params.id]);
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.RESUME_UPDATED,
    detail: { id: Number(req.params.id), score: report.score },
  });
  res.json(hydrate(updated));
}));

/** POST /api/resumes/:id/refresh — pull the latest profile data back into the resume. */
router.post('/:id/refresh', writeLimiter, wrap(async (req, res) => {
  const row = await queryOne(`SELECT * FROM resumes WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) throw new HttpError(404, 'Resume not found.', 'not_found');

  const profile = await loadFullProfile(req.user.id);
  const data = pruneEmpty(buildResumeData(profile, { targetRole: row.target_role }));
  const report = scoreResume(data, {
    targetRole: row.target_role,
    jobDescription: row.job_description,
    template: row.template,
  });

  await execute(
    `UPDATE resumes SET data = ?, ats_score = ?, ats_report = ? WHERE id = ? AND user_id = ?`,
    [JSON.stringify(data), report.score, JSON.stringify(report), req.params.id, req.user.id]
  );
  const updated = await queryOne(`SELECT * FROM resumes WHERE id = ?`, [req.params.id]);
  res.json(hydrate(updated));
}));

/** POST /api/resumes/:id/export — the PDF is produced in the browser; this records it. */
router.post('/:id/export', wrap(async (req, res) => {
  const row = await queryOne(`SELECT id, title FROM resumes WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) throw new HttpError(404, 'Resume not found.', 'not_found');
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.RESUME_EXPORTED,
    detail: { id: Number(row.id), format: req.body?.format || 'pdf' },
  });
  res.json({ ok: true });
}));

/** DELETE /api/resumes/:id */
router.delete('/:id', writeLimiter, wrap(async (req, res) => {
  const result = await execute(`DELETE FROM resumes WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!result.affectedRows) throw new HttpError(404, 'Resume not found.', 'not_found');
  await logActivity(req, { userId: req.user.id, action: ACTIONS.RESUME_DELETED, detail: { id: Number(req.params.id) } });
  res.json({ ok: true });
}));

export default router;
