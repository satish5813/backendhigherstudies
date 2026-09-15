import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, writeLimiter, wrap, HttpError } from '../middleware/common.js';
import { SECTIONS, SECTION_NAMES, fromRow, toColumns } from './sections.js';
import { ACTIONS, logActivity } from '../utils/activity.js';
import { uniqueSlug, slugify } from '../utils/slug.js';
import { profileUrl, normaliseHandle, codingStrength } from '../services/codingProfiles.js';
import {
  ACCEPTED_IMAGE, MAX_AVATAR_BYTES, deleteAvatar, saveAvatar,
} from '../services/avatars.js';

const router = Router();
router.use(requireAuth);

// Held in memory only long enough to normalise it; sharp writes the final file.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ACCEPTED_IMAGE[file.mimetype] || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) {
      return cb(null, true);
    }
    cb(new HttpError(422, 'Upload a JPEG, PNG or WebP image.', 'bad_image_type'));
  },
});

/**
 * POST /api/profile/avatar — upload a profile photo.
 * Replaces any existing one, and deletes the old file so the disk does not
 * accumulate every photo a student ever tried.
 */
router.post('/avatar', writeLimiter, avatarUpload.single('photo'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(422, 'Attach an image to upload.', 'no_file');

  const saved = await saveAvatar(req.file.buffer, req.user.id);
  if (!saved.ok) throw new HttpError(422, saved.error, 'bad_image');

  const current = await queryOne(`SELECT avatar_url FROM users WHERE id = ?`, [req.user.id]);
  await execute(`UPDATE users SET avatar_url = ? WHERE id = ?`, [saved.url, req.user.id]);
  if (current?.avatar_url) await deleteAvatar(current.avatar_url);

  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.PROFILE_UPDATED,
    detail: { avatar: 'uploaded', bytes: saved.bytes },
  });
  res.json({ ok: true, avatarUrl: saved.url, bytes: saved.bytes });
}));

/** DELETE /api/profile/avatar — remove the photo. */
router.delete('/avatar', writeLimiter, wrap(async (req, res) => {
  const current = await queryOne(`SELECT avatar_url FROM users WHERE id = ?`, [req.user.id]);
  await execute(`UPDATE users SET avatar_url = NULL WHERE id = ?`, [req.user.id]);
  if (current?.avatar_url) await deleteAvatar(current.avatar_url);
  await logActivity(req, { userId: req.user.id, action: ACTIONS.PROFILE_UPDATED, detail: { avatar: 'removed' } });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ personal */

const personalSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s-]{7,22}$/, 'Enter a valid phone number')
    .max(24)
    .nullish()
    .or(z.literal('').transform(() => null)),
  headline: z.string().trim().max(180).nullish(),
  about: z.string().trim().max(2000).nullish(),
  // Either an external URL the student pasted, or the relative path our own
  // upload endpoint produced (/uploads/avatars/…). Anything else is rejected
  // so nothing arbitrary ends up in an <img src> on a public profile.
  avatar_url: z
    .string()
    .trim()
    .max(400)
    .refine(
      (v) => v === '' || /^https?:\/\//.test(v) || /^\/uploads\/avatars\/[\w.-]+$/.test(v),
      'Enter an image URL, or upload a photo instead.'
    )
    .nullish()
    .or(z.literal('').transform(() => null)),
  campus: z.string().trim().max(80).nullish(),
  branch: z.string().trim().max(120).nullish(),
  reg_no: z.string().trim().max(60).nullish(),
  grad_year: z.coerce.number().int().min(1990).max(2100).nullish(),
  cgpa: z.coerce.number().min(0).max(10).nullish(),
  location: z.string().trim().max(120).nullish(),
  open_to_work: z.coerce.boolean().optional(),
  profile_public: z.coerce.boolean().optional(),
  slug: z
    .string()
    .trim()
    .min(3, 'Handle must be at least 3 characters')
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
});

const PERSONAL_FIELDS = [
  'name', 'phone', 'headline', 'about', 'avatar_url', 'campus', 'branch',
  'reg_no', 'grad_year', 'cgpa', 'location', 'open_to_work', 'profile_public', 'slug',
];

async function loadFullProfile(userId) {
  const user = await queryOne(
    `SELECT id, email, name, slug, phone, headline, about, avatar_url, campus, branch, reg_no,
            grad_year, cgpa, location, open_to_work, profile_public, role, onboarded,
            email_verified, created_at, last_login_at
       FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) throw new HttpError(404, 'Profile not found.', 'not_found');

  const sections = {};
  for (const name of SECTION_NAMES) {
    const spec = SECTIONS[name];
    const rows = await query(`SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY ${spec.order}`, [userId]);
    sections[name] = rows.map((r) => fromRow(name, r));
  }

  const links = await query(`SELECT platform, username, url FROM social_links WHERE user_id = ?`, [userId]);
  const coding = await query(
    `SELECT platform, username, status, solved_total, easy, medium, hard, contest_rating,
            contest_count, global_rank, star_rating, reputation, badges, raw, fetched_at
       FROM coding_profiles WHERE user_id = ?`,
    [userId]
  );

  return {
    user: {
      ...user,
      id: Number(user.id),
      cgpa: user.cgpa == null ? null : Number(user.cgpa),
      open_to_work: Boolean(user.open_to_work),
      profile_public: Boolean(user.profile_public),
      onboarded: Boolean(user.onboarded),
      email_verified: Boolean(user.email_verified),
    },
    ...sections,
    links,
    coding: coding.map((c) => ({
      ...c,
      raw: typeof c.raw === 'string' ? safeParse(c.raw) : c.raw,
      star_rating: c.star_rating == null ? null : Number(c.star_rating),
      profileUrl: profileUrl(c.platform, c.username),
    })),
    codingStrength: codingStrength(coding),
    completeness: completeness({ user, sections, links }),
  };
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/**
 * Drives the "profile strength" ring. Weighted so the sections recruiters
 * actually read (projects, skills) cost the most to leave empty.
 */
function completeness({ user, sections, links }) {
  const items = [
    { key: 'name', label: 'Full name', weight: 6, done: Boolean(user.name) },
    { key: 'headline', label: 'Headline', weight: 6, done: Boolean(user.headline) },
    { key: 'phone', label: 'Phone number', weight: 5, done: Boolean(user.phone) },
    { key: 'location', label: 'Location', weight: 4, done: Boolean(user.location) },
    { key: 'about', label: 'About / summary', weight: 8, done: (user.about || '').length > 60 },
    { key: 'avatar', label: 'Profile photo', weight: 4, done: Boolean(user.avatar_url) },
    { key: 'academics', label: 'Branch, batch & CGPA', weight: 7, done: Boolean(user.branch && user.grad_year && user.cgpa) },
    { key: 'education', label: 'Education history', weight: 10, done: sections.education.length > 0 },
    { key: 'skills', label: 'At least 6 skills', weight: 12, done: sections.skills.length >= 6 },
    { key: 'projects', label: 'At least 2 projects', weight: 16, done: sections.projects.length >= 2 },
    { key: 'experience', label: 'Internship or experience', weight: 10, done: sections.experience.length > 0 },
    { key: 'achievements', label: 'An achievement or certification', weight: 6, done: sections.achievements.length > 0 },
    { key: 'links', label: 'GitHub or LeetCode linked', weight: 6, done: links.some((l) => ['github', 'leetcode'].includes(l.platform) && l.username) },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return {
    percent: Math.round((earned / total) * 100),
    missing: items.filter((i) => !i.done).map(({ key, label, weight }) => ({ key, label, weight })),
    items,
  };
}

/** GET /api/profile — everything the dashboard and resume builder need, in one call. */
router.get('/', wrap(async (req, res) => {
  res.json(await loadFullProfile(req.user.id));
}));

/** PATCH /api/profile — personal details. */
router.patch(
  '/',
  writeLimiter,
  validate(personalSchema),
  wrap(async (req, res) => {
    const updates = {};
    for (const field of PERSONAL_FIELDS) {
      if (field in req.body) updates[field] = req.body[field] ?? null;
    }

    if (updates.slug) {
      const desired = slugify(updates.slug);
      const taken = await queryOne(`SELECT id FROM users WHERE slug = ? AND id <> ?`, [desired, req.user.id]);
      if (taken) throw new HttpError(409, 'That public handle is already taken.', 'slug_taken');
      updates.slug = desired;
    }
    if (typeof updates.open_to_work === 'boolean') updates.open_to_work = updates.open_to_work ? 1 : 0;
    if (typeof updates.profile_public === 'boolean') updates.profile_public = updates.profile_public ? 1 : 0;

    if (!Object.keys(updates).length) throw new HttpError(422, 'Nothing to update.', 'empty_update');

    // first save of a name backfills the public handle
    if (updates.name && !updates.slug) {
      const current = await queryOne(`SELECT slug FROM users WHERE id = ?`, [req.user.id]);
      if (!current?.slug) updates.slug = await uniqueSlug(updates.name, { excludeUserId: req.user.id });
    }

    const cols = Object.keys(updates);
    await execute(
      `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')}, onboarded = 1 WHERE id = ?`,
      [...cols.map((c) => updates[c]), req.user.id]
    );

    await logActivity(req, { userId: req.user.id, action: ACTIONS.PROFILE_UPDATED, detail: { fields: cols } });
    res.json(await loadFullProfile(req.user.id));
  })
);

/* ------------------------------------------------------------- social links */

const linksSchema = z.object({
  links: z
    .array(
      z.object({
        platform: z.enum(['github', 'leetcode', 'codechef', 'hackerrank', 'linkedin', 'portfolio', 'other']),
        username: z.string().trim().max(200).nullish().or(z.literal('').transform(() => null)),
      })
    )
    .max(10),
});

/** PUT /api/profile/links — replaces the whole set; a null username clears that platform. */
router.put(
  '/links',
  writeLimiter,
  validate(linksSchema),
  wrap(async (req, res) => {
    for (const link of req.body.links) {
      const handle = link.username ? normaliseHandle(link.platform, link.username) : null;
      if (!handle) {
        await execute(`DELETE FROM social_links WHERE user_id = ? AND platform = ?`, [req.user.id, link.platform]);
        await execute(`DELETE FROM coding_profiles WHERE user_id = ? AND platform = ?`, [req.user.id, link.platform]);
        continue;
      }
      const url = profileUrl(link.platform, handle) ?? (link.platform === 'portfolio' || link.platform === 'other'
        ? (link.username.startsWith('http') ? link.username : `https://${link.username}`)
        : null);

      await execute(
        `INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username), url = VALUES(url)`,
        [req.user.id, link.platform, handle, url]
      );

      // seed a coding_profiles row so the sync endpoint has something to update
      if (['leetcode', 'github', 'codechef', 'hackerrank'].includes(link.platform)) {
        await execute(
          `INSERT INTO coding_profiles (user_id, platform, username, status) VALUES (?, ?, ?, 'unlinked')
           ON DUPLICATE KEY UPDATE username = VALUES(username)`,
          [req.user.id, link.platform, handle]
        );
      }
    }
    await logActivity(req, {
      userId: req.user.id,
      action: ACTIONS.PROFILE_UPDATED,
      detail: { links: req.body.links.map((l) => l.platform) },
    });
    res.json(await loadFullProfile(req.user.id));
  })
);

/* ----------------------------------------------------- generic section CRUD */

function sectionOr404(name) {
  const spec = SECTIONS[name];
  if (!spec) throw new HttpError(404, `Unknown profile section "${name}".`, 'unknown_section');
  return spec;
}

/** GET /api/profile/:section */
router.get('/:section', wrap(async (req, res) => {
  const spec = sectionOr404(req.params.section);
  const rows = await query(`SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY ${spec.order}`, [req.user.id]);
  res.json({ items: rows.map((r) => fromRow(req.params.section, r)) });
}));

/** POST /api/profile/:section */
router.post('/:section', writeLimiter, wrap(async (req, res) => {
  const name = req.params.section;
  const spec = sectionOr404(name);

  const parsed = spec.schema.safeParse(req.body);
  if (!parsed.success) {
    throw Object.assign(new HttpError(422, parsed.error.issues[0].message, 'validation_failed'), {
      issues: parsed.error.issues,
    });
  }

  const cols = toColumns(name, parsed.data);
  const keys = Object.keys(cols);
  const result = await execute(
    `INSERT INTO ${spec.table} (user_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
    [req.user.id, ...keys.map((k) => cols[k])]
  );

  const row = await queryOne(`SELECT * FROM ${spec.table} WHERE id = ?`, [result.insertId]);
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.SECTION_CREATED,
    detail: { section: name, id: Number(result.insertId) },
  });
  res.status(201).json(fromRow(name, row));
}));

/** PATCH /api/profile/:section/:id */
router.patch('/:section/:id', writeLimiter, wrap(async (req, res) => {
  const name = req.params.section;
  const spec = sectionOr404(name);

  const owned = await queryOne(`SELECT id FROM ${spec.table} WHERE id = ? AND user_id = ?`, [
    req.params.id, req.user.id,
  ]);
  if (!owned) throw new HttpError(404, 'That entry does not exist.', 'not_found');

  const parsed = spec.schema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0].message, 'validation_failed');

  const cols = toColumns(name, parsed.data);
  const keys = Object.keys(cols);
  if (!keys.length) throw new HttpError(422, 'Nothing to update.', 'empty_update');

  await execute(
    `UPDATE ${spec.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
    [...keys.map((k) => cols[k]), req.params.id, req.user.id]
  );

  const row = await queryOne(`SELECT * FROM ${spec.table} WHERE id = ?`, [req.params.id]);
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.SECTION_UPDATED,
    detail: { section: name, id: Number(req.params.id), fields: keys },
  });
  res.json(fromRow(name, row));
}));

/** DELETE /api/profile/:section/:id */
router.delete('/:section/:id', writeLimiter, wrap(async (req, res) => {
  const name = req.params.section;
  const spec = sectionOr404(name);
  const result = await execute(`DELETE FROM ${spec.table} WHERE id = ? AND user_id = ?`, [
    req.params.id, req.user.id,
  ]);
  if (!result.affectedRows) throw new HttpError(404, 'That entry does not exist.', 'not_found');
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.SECTION_DELETED,
    detail: { section: name, id: Number(req.params.id) },
  });
  res.json({ ok: true, id: Number(req.params.id) });
}));

/** PUT /api/profile/:section/reorder — body: { ids: [3,1,2] } */
router.put('/:section/reorder', writeLimiter, wrap(async (req, res) => {
  const name = req.params.section;
  const spec = sectionOr404(name);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) throw new HttpError(422, 'Send an array of ids in the new order.', 'validation_failed');

  for (const [index, id] of ids.entries()) {
    await execute(`UPDATE ${spec.table} SET sort_order = ? WHERE id = ? AND user_id = ?`, [index, id, req.user.id]);
  }
  const rows = await query(`SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY ${spec.order}`, [req.user.id]);
  res.json({ items: rows.map((r) => fromRow(name, r)) });
}));

export { loadFullProfile };
export default router;
