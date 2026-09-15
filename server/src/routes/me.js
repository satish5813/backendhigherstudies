import { Router } from 'express';
import { execute, query, queryOne } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/common.js';
import { ACTIONS, logActivity } from '../utils/activity.js';
import { revokeAllUserSessions } from '../utils/tokens.js';
import { claimByRegNo, readinessFor } from '../services/cohorts.js';

const router = Router();
router.use(requireAuth);

const LABELS = {
  [ACTIONS.OTP_REQUESTED]: 'Verification code requested',
  [ACTIONS.OTP_VERIFIED]: 'Email verified',
  [ACTIONS.OTP_FAILED]: 'Verification failed',
  [ACTIONS.SIGNUP]: 'Account created',
  [ACTIONS.LOGIN]: 'Signed in',
  [ACTIONS.LOGOUT]: 'Signed out',
  [ACTIONS.PROFILE_UPDATED]: 'Profile updated',
  [ACTIONS.SECTION_CREATED]: 'Entry added',
  [ACTIONS.SECTION_UPDATED]: 'Entry updated',
  [ACTIONS.SECTION_DELETED]: 'Entry removed',
  [ACTIONS.CODING_SYNCED]: 'Coding stats synced',
  [ACTIONS.RESUME_CREATED]: 'Resume created',
  [ACTIONS.RESUME_UPDATED]: 'Resume updated',
  [ACTIONS.RESUME_DELETED]: 'Resume deleted',
  [ACTIONS.RESUME_EXPORTED]: 'Resume downloaded',
  [ACTIONS.RESUME_UPLOADED]: 'Resume uploaded for analysis',
  [ACTIONS.AI_USED]: 'AI writing help used',
  [ACTIONS.ALERT_UPDATED]: 'Job alerts updated',
  [ACTIONS.ALERT_SENT]: 'Job alert email sent',
  [ACTIONS.PROFILE_VIEWED]: 'Public profile viewed',
};

/** GET /api/me/activity — the student's own profiling log. */
router.get('/activity', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 30));
  const params = [req.user.id];
  let clause = 'user_id = ?';
  if (req.query.action) { clause += ' AND action = ?'; params.push(req.query.action); }

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM activity_logs WHERE ${clause}`, params);
  const rows = await query(
    `SELECT id, action, detail, ip, user_agent, created_at FROM activity_logs
      WHERE ${clause} ORDER BY id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params
  );

  res.json({
    items: rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      label: LABELS[r.action] || r.action,
      detail: typeof r.detail === 'string' ? safe(r.detail) : r.detail,
      ip: r.ip,
      device: shortUa(r.user_agent),
      created_at: r.created_at,
    })),
    total,
    page,
    pages: Math.ceil(total / perPage),
  });
}));

/** GET /api/me/stats — the numbers on the dashboard header. */
router.get('/stats', wrap(async (req, res) => {
  const id = req.user.id;
  const [counts] = await query(
    `SELECT
       (SELECT COUNT(*) FROM projects     WHERE user_id = ?) AS projects,
       (SELECT COUNT(*) FROM skills       WHERE user_id = ?) AS skills,
       (SELECT COUNT(*) FROM experiences  WHERE user_id = ?) AS experiences,
       (SELECT COUNT(*) FROM achievements WHERE user_id = ?) AS achievements,
       (SELECT COUNT(*) FROM educations   WHERE user_id = ?) AS educations,
       (SELECT COUNT(*) FROM resumes      WHERE user_id = ?) AS resumes,
       (SELECT MAX(ats_score) FROM resumes WHERE user_id = ?) AS best_ats,
       (SELECT COUNT(*) FROM alert_deliveries WHERE user_id = ? AND status = 'sent') AS alerts_sent`,
    [id, id, id, id, id, id, id, id]
  );

  const recent = await query(
    `SELECT action, created_at FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 5`,
    [id]
  );

  res.json({
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v == null ? 0 : Number(v)])),
    recent: recent.map((r) => ({ action: r.action, label: LABELS[r.action] || r.action, at: r.created_at })),
  });
}));

/**
 * GET /api/me/readiness — this student's placement-cell record, if claimed.
 * Returns null rather than 404 so the dashboard can render a prompt instead.
 */
router.get('/readiness', wrap(async (req, res) => {
  res.json({ readiness: await readinessFor(req.user.id) });
}));

/** POST /api/me/claim — link a placement record by registration number. */
router.post('/claim', wrap(async (req, res) => {
  const result = await claimByRegNo(req.user.id, req.body?.regNo);
  if (!result.ok) return res.status(422).json({ error: 'claim_failed', message: result.message });
  await logActivity(req, {
    userId: req.user.id,
    action: ACTIONS.PROFILE_UPDATED,
    detail: { claimedRecord: result.regNo, cohort: result.cohort },
  });
  res.json({ ...result, readiness: await readinessFor(req.user.id) });
}));

/** GET /api/me/sessions — signed-in devices. */
router.get('/sessions', wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, ip, user_agent, created_at, expires_at, revoked_at FROM sessions
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id),
      ip: r.ip,
      device: shortUa(r.user_agent),
      created_at: r.created_at,
      expires_at: r.expires_at,
      active: !r.revoked_at && new Date(r.expires_at) > new Date(),
    })),
  });
}));

/** POST /api/me/sessions/revoke-all — sign out everywhere. */
router.post('/sessions/revoke-all', wrap(async (req, res) => {
  await revokeAllUserSessions(req.user.id);
  res.json({ ok: true, message: 'Signed out of every device. Sign in again to continue.' });
}));

/** DELETE /api/me — hard delete; every child row cascades. */
router.delete('/', wrap(async (req, res) => {
  const confirm = String(req.body?.confirm || '').trim().toLowerCase();
  const user = await queryOne(`SELECT email FROM users WHERE id = ?`, [req.user.id]);
  if (confirm !== user.email.toLowerCase())
    return res.status(422).json({ error: 'confirm_required', message: 'Type your email address to confirm deletion.' });

  await execute(`DELETE FROM users WHERE id = ?`, [req.user.id]);
  res.json({ ok: true, message: 'Your account and all its data have been deleted.' });
}));

const safe = (s) => { try { return JSON.parse(s); } catch { return null; } };

function shortUa(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const browser = /Edg\//.test(s) ? 'Edge'
    : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(s) ? 'Windows'
    : /Android/.test(s) ? 'Android'
    : /iPhone|iPad/.test(s) ? 'iOS'
    : /Mac OS X/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' · ');
}

export default router;
