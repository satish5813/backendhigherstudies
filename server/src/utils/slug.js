import crypto from 'node:crypto';
import { queryOne } from '../config/db.js';

const RESERVED = new Set([
  'app', 'api', 'admin', 'login', 'signup', 'auth', 'u', 'me', 'settings',
  'jobs', 'alerts', 'resume', 'resumes', 'profile', 'about', 'privacy', 'terms',
  'static', 'assets', 'public', 'health', 'null', 'undefined',
]);

export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Builds a unique public handle from a name (or email local part).
 * Falls back to a short random suffix rather than looping forever.
 */
export async function uniqueSlug(base, { excludeUserId = null } = {}) {
  let root = slugify(base);
  if (!root || root.length < 3 || RESERVED.has(root)) root = `student-${root || 'profile'}`.slice(0, 40);

  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await queryOne(
      `SELECT id FROM users WHERE slug = ? ${excludeUserId ? 'AND id <> ?' : ''} LIMIT 1`,
      excludeUserId ? [candidate, excludeUserId] : [candidate]
    );
    if (!taken) return candidate;
  }
  return `${root}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 48);
}
