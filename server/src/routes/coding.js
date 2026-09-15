import { Router } from 'express';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap, writeLimiter, HttpError } from '../middleware/common.js';
import { FETCHERS, profileUrl, normaliseHandle, codingStrength } from '../services/codingProfiles.js';
import { ACTIONS, logActivity } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

const SYNC_COOLDOWN_MS = 10 * 60 * 1000; // be a good citizen to LeetCode

const shape = (row) => ({
  ...row,
  star_rating: row.star_rating == null ? null : Number(row.star_rating),
  raw: typeof row.raw === 'string' ? safe(row.raw) : row.raw,
  profileUrl: profileUrl(row.platform, row.username),
});
const safe = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** GET /api/coding — cached stats for every linked platform. */
router.get('/', wrap(async (req, res) => {
  const rows = await query(`SELECT * FROM coding_profiles WHERE user_id = ?`, [req.user.id]);
  res.json({ items: rows.map(shape), strength: codingStrength(rows) });
}));

/**
 * POST /api/coding/sync         — refresh every linked platform
 * POST /api/coding/sync/:platform — refresh one
 *
 * `force=1` skips the cooldown. Unlinked or unknown handles come back with a
 * status the UI renders as an empty state rather than a zeroed-out chart.
 */
router.post(['/sync', '/sync/:platform'], writeLimiter, wrap(async (req, res) => {
  const only = req.params.platform;
  if (only && !FETCHERS[only]) throw new HttpError(422, `Cannot sync "${only}".`, 'unknown_platform');
  const force = req.query.force === '1' || req.body?.force === true;

  const links = await query(
    `SELECT platform, username FROM social_links
      WHERE user_id = ? AND username IS NOT NULL AND username <> ''
        ${only ? 'AND platform = ?' : "AND platform IN ('leetcode','github','codechef')"}`,
    only ? [req.user.id, only] : [req.user.id]
  );

  if (!links.length) {
    return res.json({
      items: [],
      strength: null,
      synced: 0,
      message: only
        ? `You have not linked a ${only} handle yet.`
        : 'Link a LeetCode, GitHub or CodeChef handle first — then we can pull your stats.',
    });
  }

  const results = [];
  for (const link of links) {
    const existing = await queryOne(
      `SELECT fetched_at, status FROM coding_profiles WHERE user_id = ? AND platform = ?`,
      [req.user.id, link.platform]
    );
    const fresh =
      existing?.fetched_at &&
      existing.status === 'ok' &&
      Date.now() - new Date(existing.fetched_at).getTime() < SYNC_COOLDOWN_MS;

    if (fresh && !force) {
      results.push({ platform: link.platform, skipped: true, reason: 'recently synced' });
      continue;
    }

    const fetcher = FETCHERS[link.platform];
    const data = await fetcher(link.username);
    const handle = data.username || normaliseHandle(link.platform, link.username);

    await execute(
      `INSERT INTO coding_profiles
         (user_id, platform, username, status, solved_total, easy, medium, hard,
          contest_rating, contest_count, global_rank, star_rating, reputation, badges, raw, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         username = VALUES(username), status = VALUES(status), solved_total = VALUES(solved_total),
         easy = VALUES(easy), medium = VALUES(medium), hard = VALUES(hard),
         contest_rating = VALUES(contest_rating), contest_count = VALUES(contest_count),
         global_rank = VALUES(global_rank), star_rating = VALUES(star_rating),
         reputation = VALUES(reputation), badges = VALUES(badges), raw = VALUES(raw),
         fetched_at = VALUES(fetched_at)`,
      [
        req.user.id, link.platform, handle, data.status,
        data.solved_total ?? null, data.easy ?? null, data.medium ?? null, data.hard ?? null,
        data.contest_rating ?? null, data.contest_count ?? null, data.global_rank ?? null,
        data.star_rating ?? null, data.reputation ?? null, data.badges ?? null,
        data.raw ? JSON.stringify(data.raw) : null,
      ]
    );
    results.push({ platform: link.platform, status: data.status, error: data.error });
  }

  const rows = await query(`SELECT * FROM coding_profiles WHERE user_id = ?`, [req.user.id]);
  await logActivity(req, { userId: req.user.id, action: ACTIONS.CODING_SYNCED, detail: { results } });

  res.json({
    items: rows.map(shape),
    strength: codingStrength(rows),
    synced: results.filter((r) => !r.skipped).length,
    results,
  });
}));

export default router;
