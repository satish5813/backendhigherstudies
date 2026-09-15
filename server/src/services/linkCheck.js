/**
 * Does the apply link still work?
 *
 * A sourced posting can be filled and taken down between the 3am sweep and the
 * morning review. Approving it then sends 656 students to a 404, which costs
 * the placement cell more credibility than a thin queue ever would — so every
 * pending row's link is checked and the result shown next to it.
 *
 * The check is deliberately forgiving about what counts as working. Careers
 * sites do a lot of things that are not failures:
 *
 *   - redirect to a canonical URL, or to a regional domain
 *   - answer HEAD with 405 while GET works perfectly
 *   - return 403 to anything without a browser-shaped user agent
 *
 * Only a 404/410, or a redirect that lands on a generic "all jobs" page, means
 * the posting is genuinely gone. Anything we cannot judge is reported as
 * `blocked` rather than `dead`, because telling an officer to reject a live job
 * is worse than telling them to look themselves.
 */
import { execute, query } from '../config/db.js';

// Careers sites are picky; a bare fetch UA gets 403 from several of them.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/124.0 Safari/537.36 KLPlacementReadiness/1.0 (+placement portal link check)';

const TIMEOUT = 12000;
const CONCURRENCY = 8;

/**
 * A redirect landing on one of these means "this specific posting is gone, here
 * is the job list instead" — which is a dead link for our purposes even though
 * it answers 200.
 */
const GENERIC_LANDING = [
  /\/jobs\/?$/i, /\/careers\/?$/i, /\/open-positions\/?$/i,
  /\/search\/?$/i, /job-not-found/i, /no-longer-available/i, /expired/i,
];

export async function checkUrl(url) {
  if (!url) return { status: 'dead', code: null, finalUrl: null, reason: 'no link' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    // GET, not HEAD: too many boards answer HEAD with 405 or 403. `redirect:
    // follow` is the default and is what we want — we care where it lands.
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });

    const code = res.status;
    const finalUrl = res.url || url;

    if (code === 404 || code === 410)
      return { status: 'dead', code, finalUrl, reason: 'posting removed' };

    if (code >= 200 && code < 300) {
      // Landed somewhere, but is it still the posting?
      const movedAway = finalUrl !== url;
      if (movedAway && GENERIC_LANDING.some((re) => re.test(new URL(finalUrl).pathname + new URL(finalUrl).search)))
        return { status: 'dead', code, finalUrl, reason: 'redirected to the generic jobs page' };

      return {
        status: movedAway ? 'redirect' : 'live',
        code,
        finalUrl,
        reason: movedAway ? 'redirected, still a posting' : 'ok',
      };
    }

    // 401/403/429 and 5xx tell us about the server, not the posting.
    return { status: 'blocked', code, finalUrl, reason: `server answered ${code}` };
  } catch (err) {
    // A timeout or DNS failure is not evidence the job is gone.
    return {
      status: 'blocked',
      code: null,
      finalUrl: null,
      reason: err.name === 'AbortError' ? 'timed out' : err.message.slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `worker` over `items`, `limit` at a time. */
async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

/**
 * Check a batch of jobs and write the results back.
 *
 * @param {object}  opts
 * @param {string}  opts.status    which queue to check (default 'pending')
 * @param {number}  opts.limit     how many rows
 * @param {boolean} opts.recheck   include rows already checked recently
 */
export async function checkPendingLinks({ status = 'pending', limit = 200, recheck = false } = {}) {
  const rows = await query(
    `SELECT id, apply_url FROM jobs
      WHERE status = ? AND apply_url IS NOT NULL AND apply_url <> ''
        ${recheck ? '' : "AND (link_checked_at IS NULL OR link_checked_at < DATE_SUB(NOW(), INTERVAL 3 DAY))"}
      ORDER BY ingested_at DESC
      LIMIT ${Math.max(1, Math.min(1000, Number(limit) || 200))}`,
    [status]
  );

  const tally = { checked: 0, live: 0, redirect: 0, dead: 0, blocked: 0 };

  await pool(rows, CONCURRENCY, async (row) => {
    const r = await checkUrl(row.apply_url);
    await execute(
      `UPDATE jobs SET link_status = ?, link_code = ?, link_checked_at = NOW(), link_final_url = ?
        WHERE id = ?`,
      [r.status, r.code, r.finalUrl?.slice(0, 500) ?? null, row.id]
    );
    tally.checked++;
    tally[r.status]++;
  });

  return { ...tally, scanned: rows.length };
}
