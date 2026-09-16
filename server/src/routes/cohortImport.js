import crypto from 'node:crypto';
import express, { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { wrap } from '../middleware/common.js';
import { importCohorts, validatePayload } from '../services/cohortImport.js';

/**
 * POST /api/cohorts/import
 *
 * Loads the placement roster. Accepts either an administrator's session or,
 * for the first load on a fresh server where no administrator exists yet,
 * the ROSTER_IMPORT_TOKEN from the environment. The token path is a bootstrap
 * door: clear the variable once the roster is in and the door is gone.
 *
 * Mounted ahead of the main cohorts router, which requires a session on
 * every route.
 */
const router = Router();

function tokenMatches(req) {
  const expected = env.access.importToken;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7).trim());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function tokenOrAdmin(req, res, next) {
  if (tokenMatches(req)) {
    req.importedBy = 'import-token';
    return next();
  }
  // Not the token: fall through to the ordinary admin-session check. A wrong
  // token therefore reads as a plain 401, which tells a stranger nothing.
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    requireAdmin(req, res, (err2) => {
      if (err2) return next(err2);
      req.importedBy = req.user.email;
      next();
    });
  });
}

router.post(
  '/',
  // The roster is ~1.3 MB of JSON; the app-wide body limit is 1 MB.
  express.json({ limit: '16mb' }),
  tokenOrAdmin,
  wrap(async (req, res) => {
    const bad = validatePayload(req.body);
    if (bad) return res.status(422).json({ error: 'bad_payload', message: bad });

    const dryRun = ['1', 'true'].includes(String(req.query.dryRun || ''));
    const lines = [];
    const { totals, summary } = await importCohorts(req.body, { dryRun, log: (l) => lines.push(l) });

    console.log(`[roster] ${dryRun ? 'dry run' : 'import'} by ${req.importedBy}: ` +
      `${totals.cohorts} cohorts, ${totals.inserted} inserted, ${totals.updated} updated, ${totals.linked} linked`);

    res.json({ ok: true, dryRun, totals, summary, cohorts: lines });
  })
);

export default router;
