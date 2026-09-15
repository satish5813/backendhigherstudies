/**
 * Where sourced jobs come from.
 *
 * Each adapter is `{ id, label, needs, enabled(), fetch() }` and returns RAW
 * postings in one shape. Normalising, salary inference, the CTC floor and the
 * India filter all happen once in jobIngest.js — an adapter only has to know
 * how to talk to its own endpoint.
 *
 * Adapters are deliberately ordered cheapest-and-most-reliable first:
 *
 *   greenhouse / lever / ashby   official public job-board JSON. No key, no
 *                                scraping, no terms to violate. These are the
 *                                endpoints the companies' own careers pages
 *                                call, and they are stable for years.
 *   adzuna                       a licensed aggregator with real Indian salary
 *                                data. Free tier; needs an app id + key.
 *   apify                        a scraping marketplace for the portals that
 *                                have no API at all. Needs a paid token.
 *
 * A source with no credentials reports itself disabled rather than failing, so
 * the nightly sweep works out of the box and gets better as keys are added.
 */
import { env } from '../config/env.js';

const UA = 'CareerForge/1.0 (KL University placement portal)';

// Boards fetched at once. Enough to keep the sweep quick, few enough that we
// are not hammering one host from a single university IP.
const CONCURRENCY = 6;

async function getJson(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': UA, ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch many boards at once, a few at a time.
 *
 * These requests are independent, so running them in sequence just multiplies
 * the latency — eighteen Greenhouse boards took about 25 seconds one at a time
 * and about 5 in parallel. The cap keeps us from opening eighteen sockets to
 * the same host at once, which is the sort of thing that gets a university's IP
 * rate-limited.
 *
 * Failures are RETURNED, not swallowed. A board that 404s because the company
 * renamed its token looks exactly like a board with no open roles unless
 * somebody counts them, and the admin dashboard is where that has to show up.
 */
async function mapPool(items, limit, worker) {
  const results = [];
  const failures = [];
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        results.push(...(await worker(item)));
      } catch (err) {
        failures.push(`${item}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return { results, failures };
}

/**
 * Board adapters all share the same shape: walk a list of tokens, map each
 * response into raw postings. `SourceError` carries the per-board failures up
 * so `ingestAll` can record them against the run.
 */
export class PartialSourceError extends Error {
  constructor(results, failures) {
    super(`${failures.length} board(s) failed: ${failures.slice(0, 3).join('; ')}`);
    this.name = 'PartialSourceError';
    this.results = results;
    this.failures = failures;
  }
}

/**
 * Employers that hire in India at or above the package we care about and
 * publish through an open board API.
 *
 * This list is the one thing worth editing as hiring changes — add a board
 * token and its jobs appear in tomorrow's queue. Find the token in the careers
 * page URL: boards.greenhouse.io/<token> or jobs.lever.co/<token>.
 */
export const BOARDS = {
  // Every token below was probed and confirmed to (a) resolve and (b) carry
  // India-based roles. Guessing a company's token from its name mostly does not
  // work — "atlassian", "freshworks" and "swiggy" all 404 — so verify a new one
  // before adding it. `node server/src/db/check-boards.js` does exactly that.
  greenhouse: [
    'databricks', 'zscaler', 'mongodb', 'stripe', 'gitlab', 'rubrik', 'elastic',
    'razorpaysoftwareprivatelimited', 'druva', 'twilio', 'coinbase', 'samsara',
    'airbnb', 'flexport', 'postman', 'sumologic', 'cloudflare',
  ],
  lever: ['meesho', 'hevodata', 'mindtickle', 'zeta', 'cred'],
  ashby: ['openai', 'atlan', 'notion'],
};

/* ------------------------------------------------------------- greenhouse */

const greenhouse = {
  id: 'greenhouse',
  label: 'Greenhouse job boards',
  needs: null,
  enabled: () => true,
  async fetch() {
    // One dead board must not take down the other seventeen, but it must still
    // be counted — see mapPool.
    const { results, failures } = await mapPool(BOARDS.greenhouse, CONCURRENCY, async (token) => {
      const data = await getJson(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
      );
      return (data.jobs ?? []).map((j) => ({
        externalId: `greenhouse:${token}:${j.id}`,
        title: j.title,
        company: prettify(token),
        location: j.location?.name ?? null,
        description: stripHtml(j.content ?? ''),
        applyUrl: j.absolute_url,
        postedAt: j.updated_at ?? j.first_published ?? null,
        // Greenhouse exposes pay ranges only for jurisdictions that force it
        // (US states, mostly). Indian roles come through blank, which is
        // exactly what `estimateCtc` is for.
        payText: payFromMetadata(j.metadata),
      }));
    });
    if (failures.length) throw new PartialSourceError(results, failures);
    return results;
  },
};

/* ------------------------------------------------------------------ lever */

const lever = {
  id: 'lever',
  label: 'Lever job boards',
  needs: null,
  enabled: () => true,
  async fetch() {
    const { results, failures } = await mapPool(BOARDS.lever, CONCURRENCY, async (token) => {
      const data = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      return (data ?? []).map((j) => ({
        externalId: `lever:${token}:${j.id}`,
        title: j.text,
        company: prettify(token),
        location: j.categories?.location ?? null,
        description: stripHtml(j.descriptionPlain ?? j.description ?? ''),
        applyUrl: j.hostedUrl ?? j.applyUrl,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        payText: j.salaryRange
          ? `${j.salaryRange.currency ?? ''} ${j.salaryRange.min ?? ''}-${j.salaryRange.max ?? ''}`
          : null,
      }));
    });
    if (failures.length) throw new PartialSourceError(results, failures);
    return results;
  },
};

/* ------------------------------------------------------------------ ashby */

const ashby = {
  id: 'ashby',
  label: 'Ashby job boards',
  needs: null,
  enabled: () => true,
  async fetch() {
    const { results, failures } = await mapPool(BOARDS.ashby, CONCURRENCY, async (token) => {
      const data = await getJson(
        `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`
      );
      return (data.jobs ?? []).map((j) => ({
        externalId: `ashby:${token}:${j.id}`,
        title: j.title,
        company: data.name || prettify(token),
        location: j.location ?? null,
        description: stripHtml(j.descriptionPlain ?? j.descriptionHtml ?? ''),
        applyUrl: j.jobUrl ?? j.applyUrl,
        postedAt: j.publishedAt ?? null,
        payText: j.compensation?.summary ?? null,
      }));
    });
    if (failures.length) throw new PartialSourceError(results, failures);
    return results;
  },
};

/* ----------------------------------------------------------------- adzuna */

const adzuna = {
  id: 'adzuna',
  label: 'Adzuna India',
  needs: 'ADZUNA_APP_ID and ADZUNA_APP_KEY (free at developer.adzuna.com)',
  enabled: () => Boolean(env.jobs.adzuna.appId && env.jobs.adzuna.appKey),
  async fetch() {
    const { appId, appKey } = env.jobs.adzuna;
    const out = [];
    // Adzuna reports salary in rupees per year, so the floor can be applied at
    // the source instead of guessed afterwards.
    const floor = Math.round(env.jobs.minCtc * 100000);
    for (const what of ['software engineer', 'data engineer', 'devops', 'product manager']) {
      for (let page = 1; page <= 2; page++) {
        try {
          const url = new URL(`https://api.adzuna.com/v1/api/jobs/in/search/${page}`);
          url.searchParams.set('app_id', appId);
          url.searchParams.set('app_key', appKey);
          url.searchParams.set('results_per_page', '50');
          url.searchParams.set('what', what);
          url.searchParams.set('salary_min', String(floor));
          url.searchParams.set('content-type', 'application/json');
          const data = await getJson(url.toString());
          for (const j of data.results ?? []) {
            out.push({
              externalId: `adzuna:${j.id}`,
              title: j.title,
              company: j.company?.display_name ?? 'Unknown',
              location: j.location?.display_name ?? null,
              description: stripHtml(j.description ?? ''),
              applyUrl: j.redirect_url,
              postedAt: j.created ?? null,
              // Already annual rupees — hand over lakhs directly so the
              // estimator does not have to re-derive a published figure.
              ctcMin: j.salary_min ? j.salary_min / 100000 : null,
              ctcMax: j.salary_max ? j.salary_max / 100000 : null,
            });
          }
        } catch { /* next page */ }
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ apify */

const apify = {
  id: 'apify',
  label: 'Apify actor',
  needs: 'APIFY_TOKEN, and APIFY_JOB_ACTOR set to the actor you want to run',
  enabled: () => Boolean(env.jobs.apify.token && env.jobs.apify.actor),
  async fetch() {
    const { token, actor, input } = env.jobs.apify;
    // run-sync-get-dataset-items blocks until the actor finishes and hands back
    // the rows, so there is no polling loop to get wrong.
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}`
      + `/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180000); // actors are slow
    let rows;
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
      rows = await res.json();
    } finally {
      clearTimeout(timer);
    }

    // Actors disagree about field names, so accept the common spellings rather
    // than pinning this to one actor's schema.
    return (Array.isArray(rows) ? rows : []).map((r, i) => ({
      externalId: `apify:${actor}:${r.id ?? r.jobId ?? r.url ?? i}`,
      title: r.title ?? r.positionName ?? r.jobTitle ?? null,
      company: r.company ?? r.companyName ?? r.employer ?? null,
      location: r.location ?? r.jobLocation ?? r.city ?? null,
      description: stripHtml(r.description ?? r.descriptionText ?? r.jobDescription ?? ''),
      applyUrl: r.url ?? r.jobUrl ?? r.link ?? null,
      postedAt: r.postedAt ?? r.publishedAt ?? r.date ?? null,
      payText: r.salary ?? r.salaryText ?? r.compensation ?? null,
    }));
  },
};

export const SOURCES = [greenhouse, lever, ashby, adzuna, apify];

export function sourceStatus() {
  return SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    enabled: s.enabled(),
    needs: s.enabled() ? null : s.needs,
  }));
}

/* ----------------------------------------------------------------- helpers */

/** `sumologic` → `Sumologic`, `leadsquared` → `Leadsquared`. */
function prettify(token) {
  return token.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function payFromMetadata(metadata) {
  if (!Array.isArray(metadata)) return null;
  const hit = metadata.find((m) => /salary|compensation|pay|ctc/i.test(m?.name ?? ''));
  const v = hit?.value;
  if (!v) return null;
  return Array.isArray(v) ? v.join(' ') : String(v);
}

/**
 * Board APIs return HTML in a JSON string. We only need readable text for
 * keyword matching and the admin preview, so entities and tags come out and the
 * block structure becomes newlines.
 */
export function stripHtml(html) {
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
