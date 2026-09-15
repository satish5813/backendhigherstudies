import { verifyAccessToken } from '../utils/tokens.js';
import { queryOne } from '../config/db.js';

function bearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Hard gate: 401 unless a valid access token maps to an active user. */
export async function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'token_expired' : 'unauthorized',
      message: expired ? 'Your session expired. Refreshing…' : 'Invalid session. Please sign in again.',
    });
  }

  const user = await queryOne(
    `SELECT id, email, name, slug, role, status, onboarded FROM users WHERE id = ?`,
    [payload.sub]
  );
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Account not found.' });
  if (user.status !== 'active')
    return res.status(403).json({ error: 'blocked', message: 'This account has been disabled.' });

  req.user = user;
  next();
}

/** Soft: attaches req.user when a token is present, never fails. */
export async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = await queryOne(`SELECT id, email, name, slug, role, status FROM users WHERE id = ?`, [payload.sub]);
  } catch {
    /* ignore — anonymous request */
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'forbidden', message: 'Admin access required.' });
  next();
}
