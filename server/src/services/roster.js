import { env } from '../config/env.js';
import { queryOne } from '../config/db.js';

/**
 * Who may create an account.
 *
 * KL issues every student one address, <registration number>@kluniversity.in,
 * and the placement cell has already told us every registration number it is
 * responsible for. So the roster is the sign-up list: an address whose local
 * part is a registration number we hold may create an account, and it lands
 * already linked to its record. Anything else is refused before a code is
 * ever sent.
 *
 * Two doors stay open. Anyone who already has an account keeps it (a blocked
 * one is refused later, with the right message). And ADMIN_EMAILS may sign in
 * regardless of the roster and become administrators on first sign-in — the
 * only way to have a first administrator without a shell on the server.
 *
 * ROSTER_ONLY_SIGNUP=false switches the gate off, which is the development
 * default so the test suites can create arbitrary accounts.
 */

const norm = (s) => String(s || '').trim().toLowerCase();

export function isAdminEmail(email) {
  return env.access.adminEmails.includes(norm(email));
}

/**
 * The registration number an address encodes, or null.
 * "2300032652@kluniversity.in" -> "2300032652"; a name-based address -> null.
 */
export function regNoFromEmail(email) {
  const [local, domain] = norm(email).split('@');
  if (!local || domain !== env.access.studentDomain) return null;
  if (!/^[a-z0-9]{4,40}$/.test(local)) return null;
  return local.toUpperCase();
}

/**
 * @returns {Promise<{allowed: true, why: 'admin'|'existing'|'open'|'roster', regNo?: string}
 *                 | {allowed: false, message: string}>}
 */
export async function rosterAccess(email) {
  const addr = norm(email);

  if (isAdminEmail(addr)) return { allowed: true, why: 'admin' };

  const existing = await queryOne(`SELECT id FROM users WHERE email = ?`, [addr]);
  if (existing) return { allowed: true, why: 'existing' };

  if (!env.access.rosterOnly) return { allowed: true, why: 'open' };

  const regNo = regNoFromEmail(addr);
  if (regNo) {
    const record = await queryOne(
      `SELECT id FROM student_records WHERE UPPER(reg_no) = ? LIMIT 1`,
      [regNo]
    );
    if (record) return { allowed: true, why: 'roster', regNo };
  }

  return {
    allowed: false,
    message:
      `This portal is for KL University students on the placement roster. ` +
      `Sign in with your registration-number address, for example 2300032652@${env.access.studentDomain}. ` +
      `If yours is refused, ask the placement cell to add you.`,
  };
}
