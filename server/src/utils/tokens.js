import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { execute, queryOne } from '../config/db.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    env.jwt.secret,
    { expiresIn: env.jwt.accessTtl }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Issues an opaque refresh token and stores only its hash. */
export async function issueRefreshToken(userId, { ip, userAgent }) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.jwt.refreshDays * 86400_000);
  await execute(
    `INSERT INTO sessions (user_id, refresh_token_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, sha256(token), ip, userAgent, expiresAt]
  );
  return { token, expiresAt };
}

export async function consumeRefreshToken(token) {
  if (!token) return null;
  const row = await queryOne(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ?`,
    [sha256(token)]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  if (row.status !== 'active') return null;
  return row;
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await execute(
    `UPDATE sessions SET revoked_at = NOW() WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
    [sha256(token)]
  );
}

export async function revokeAllUserSessions(userId) {
  await execute(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
}

export const REFRESH_COOKIE = 'cf_refresh';

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'strict' : 'lax',
    path: '/api/auth',
    expires: expiresAt,
  };
}
