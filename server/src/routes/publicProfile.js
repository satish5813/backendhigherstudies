import { Router } from 'express';
import { query, queryOne } from '../config/db.js';
import { optionalAuth } from '../middleware/auth.js';
import { apiLimiter, wrap, HttpError } from '../middleware/common.js';
import { fromRow, SECTIONS } from './sections.js';
import { codingStrength, profileUrl } from '../services/codingProfiles.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(apiLimiter, optionalAuth);

/**
 * GET /api/u/:slug — the shareable student profile.
 * Contact details are withheld from anonymous viewers; the owner always sees
 * their own page exactly as it is stored.
 */
router.get('/:slug', wrap(async (req, res) => {
  const user = await queryOne(
    `SELECT id, email, name, slug, phone, headline, about, avatar_url, campus, branch,
            grad_year, cgpa, location, open_to_work, profile_public, created_at
       FROM users WHERE slug = ? AND status = 'active'`,
    [req.params.slug]
  );
  if (!user) throw new HttpError(404, 'No student profile at that address.', 'not_found');

  // Boolean(), not a bare &&: an undefined value is dropped from the JSON
  // response entirely, and the client needs an explicit false.
  const isOwner = Boolean(req.user && Number(req.user.id) === Number(user.id));
  if (!user.profile_public && !isOwner)
    throw new HttpError(403, 'This profile is private.', 'private_profile');

  const sections = {};
  for (const [name, spec] of Object.entries(SECTIONS)) {
    const rows = await query(`SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY ${spec.order}`, [user.id]);
    sections[name] = rows.map((r) => fromRow(name, r));
  }

  // An empty profile must not be served to the public.
  //
  // It renders as a "?" avatar with no name and no content, which reads as a
  // broken site rather than an unfinished profile — and it is the page the
  // student would be sending to a recruiter. The owner still sees their own,
  // so they can watch it fill in as they work.
  const hasSomethingToShow = Boolean(
    user.name && (
      user.headline || user.about ||
      sections.skills.length || sections.projects.length ||
      sections.experience.length || sections.education.length
    )
  );
  if (!hasSomethingToShow && !isOwner)
    throw new HttpError(404, 'This student has not published a profile yet.', 'profile_empty');

  const links = await query(`SELECT platform, username, url FROM social_links WHERE user_id = ?`, [user.id]);
  const codingRows = await query(
    `SELECT platform, username, status, solved_total, easy, medium, hard, contest_rating,
            contest_count, global_rank, star_rating, reputation, badges, fetched_at
       FROM coding_profiles WHERE user_id = ? AND status = 'ok'`,
    [user.id]
  );

  if (!isOwner) {
    logActivity(req, {
      userId: user.id,
      action: ACTIONS.PROFILE_VIEWED,
      detail: { slug: user.slug, by: req.user ? Number(req.user.id) : null },
    }).catch(() => {});
  }

  res.json({
    user: {
      name: user.name,
      slug: user.slug,
      headline: user.headline,
      about: user.about,
      avatarUrl: user.avatar_url,
      campus: user.campus,
      branch: user.branch,
      gradYear: user.grad_year,
      cgpa: user.cgpa == null ? null : Number(user.cgpa),
      location: user.location,
      openToWork: Boolean(user.open_to_work),
      memberSince: user.created_at,
      // contact only for the owner
      email: isOwner ? user.email : null,
      phone: isOwner ? user.phone : null,
    },
    isOwner,
    ...sections,
    links: links.map((l) => ({ ...l, url: l.url || profileUrl(l.platform, l.username) })),
    coding: codingRows.map((c) => ({
      ...c,
      star_rating: c.star_rating == null ? null : Number(c.star_rating),
      profileUrl: profileUrl(c.platform, c.username),
    })),
    codingStrength: codingStrength(codingRows),
  });
}));

/**
 * GET /api/u — the student directory. Only public, onboarded profiles.
 */
router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(48, Math.max(1, Number(req.query.perPage) || 24));
  const where = ["status = 'active'", 'profile_public = 1', 'name IS NOT NULL', 'slug IS NOT NULL'];
  const params = [];

  // The directory is the public face of the university, so it carries KL
  // students and nothing else.
  //
  // Test and demo accounts were reaching it — two "E2E Test Student" rows from
  // suite runs were sitting on the public page. Filtering by address rather
  // than deleting keeps the suites free to create accounts without ever
  // exposing one, and covers the seeded demo profile too.
  where.push("email LIKE '%@kluniversity.in'");
  where.push("email NOT LIKE 'e2e%'");
  where.push("email NOT LIKE 'test.%'");
  where.push("email NOT LIKE '%@careerforge.local'");

  // An empty profile is not worth a card — same rule the single profile page
  // applies, so the directory and the profile agree on what "published" means.
  where.push(`(
    headline IS NOT NULL OR about IS NOT NULL
    OR EXISTS (SELECT 1 FROM skills s WHERE s.user_id = users.id)
    OR EXISTS (SELECT 1 FROM projects p WHERE p.user_id = users.id)
  )`);

  if (req.query.q) {
    where.push('(name LIKE ? OR headline LIKE ? OR branch LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  if (req.query.branch) { where.push('branch = ?'); params.push(req.query.branch); }
  if (req.query.gradYear) { where.push('grad_year = ?'); params.push(Number(req.query.gradYear)); }
  if (req.query.campus) { where.push('campus = ?'); params.push(req.query.campus); }

  const clause = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users WHERE ${clause}`, params);
  const rows = await query(
    `SELECT id, name, slug, headline, avatar_url, campus, branch, grad_year, location, open_to_work
       FROM users WHERE ${clause}
      ORDER BY updated_at DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params
  );

  // one round trip for every card's skill chips
  const ids = rows.map((r) => r.id);
  const skillsByUser = new Map();
  if (ids.length) {
    const skillRows = await query(
      `SELECT user_id, name FROM skills WHERE user_id IN (${ids.map(() => '?').join(',')})
        ORDER BY proficiency DESC`,
      ids
    );
    for (const s of skillRows) {
      const list = skillsByUser.get(String(s.user_id)) || [];
      if (list.length < 5) list.push(s.name);
      skillsByUser.set(String(s.user_id), list);
    }
  }

  const [rosterRow] = await query(
    `SELECT COUNT(*) AS onRoster, SUM(user_id IS NOT NULL) AS claimed
       FROM student_records${req.query.campus ? ' WHERE campus = ?' : ''}`,
    req.query.campus ? [req.query.campus] : []
  );
  const roster = {
    onRoster: Number(rosterRow?.onRoster ?? 0),
    claimed: Number(rosterRow?.claimed ?? 0),
    published: total,
  };

  res.json({
    items: rows.map((r) => ({
      name: r.name,
      slug: r.slug,
      headline: r.headline,
      avatarUrl: r.avatar_url,
      campus: r.campus,
      branch: r.branch,
      gradYear: r.grad_year,
      location: r.location,
      openToWork: Boolean(r.open_to_work),
      skills: skillsByUser.get(String(r.id)) || [],
    })),
    total,
    page,
    pages: Math.ceil(total / perPage),
    // Context, so an almost-empty page explains itself instead of looking
    // broken. A placement record is not a profile: the roster holds CRT scores
    // and readiness bands, and none of a student's own writing exists until
    // they sign in and publish. 537 students on the roster with one published
    // profile is an accurate picture, and worth stating plainly.
    roster,
  });
}));

export default router;
