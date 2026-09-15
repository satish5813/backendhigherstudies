/**
 * The nightly sweep: pull postings, keep the Indian ones paying at or above the
 * floor, and queue them for a placement officer to approve.
 *
 * Nothing here ever reaches a student directly. Every sourced row lands as
 * `status = 'pending'`; only an approval in the admin queue makes it visible.
 * That is the whole point of the design — an automated pipeline you would not
 * let loose on 656 students without a human in the middle.
 */
import { env } from '../config/env.js';
import { execute, query } from '../config/db.js';
import { SOURCES, stripHtml } from './jobSources.js';

/* --------------------------------------------------------------- location */

// Where "in India" is decided. Remote roles count only when the listing says
// the remote is India-based — a US-remote role a student cannot legally take is
// noise in the queue.
const INDIA_CITIES = [
  'bengaluru', 'bangalore', 'hyderabad', 'pune', 'chennai', 'mumbai', 'delhi',
  'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'jaipur', 'kochi',
  'cochin', 'trivandrum', 'thiruvananthapuram', 'coimbatore', 'indore',
  'chandigarh', 'vizag', 'visakhapatnam', 'vijayawada', 'bhubaneswar', 'mysore',
  'mysuru', 'nagpur', 'surat', 'lucknow', 'mohali', 'thane', 'navi mumbai',
];

export function isIndia(location) {
  if (!location) return false;
  const s = String(location).toLowerCase();
  if (/\b(india|bharat)\b/.test(s)) return true;
  if (INDIA_CITIES.some((c) => s.includes(c))) return true;
  // "Remote" with no country is ambiguous; treat it as not-India so the queue
  // stays about roles a KL student can actually take.
  return false;
}

/* ----------------------------------------------------------------- salary */

const CRORE = 100;   // 1 crore = 100 lakh
const USD_LPA = 0.9; // ~1 USD 1k/yr ≈ 0.9 LPA at 90/USD; only used for ranges

/**
 * Read a published package out of free text.
 *
 * Indian listings write salary a dozen ways — "₹25-40 LPA", "25,00,000 -
 * 40,00,000 PA", "INR 30L", "upto 45 lakhs". Returns lakhs per annum, or null
 * when nothing trustworthy is there. Null is a perfectly good answer; the
 * estimator handles it and the admin sees "estimated".
 */
export function parseCtc(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/,/g, '');

  const nums = (re, scale = 1) => {
    const m = s.match(re);
    if (!m) return null;
    const a = Number(m[1]) * scale;
    const b = m[2] != null ? Number(m[2]) * scale : null;
    if (!Number.isFinite(a) || a <= 0) return null;
    return { min: a, max: b && Number.isFinite(b) && b >= a ? b : null };
  };

  // "25-40 LPA", "25 to 40 lpa", "30 lpa"
  const lpa = nums(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(?:lpa|lakhs? ?p\.?a|lakhs? per annum|l\b)/);
  if (lpa) return lpa;

  // "1.2 - 1.5 cr", "2 crore"
  const cr = nums(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(?:cr\b|crores?)/, CRORE);
  if (cr) return cr;

  // Raw rupees: "2500000 - 4000000". Needs a currency marker, otherwise any
  // seven-digit number in a description would read as a salary.
  if (/(?:₹|rs\.?|inr)/.test(s)) {
    const raw = nums(/(\d{6,9})\s*(?:-|–|to)?\s*(\d{6,9})?/);
    if (raw) return { min: raw.min / 1e5, max: raw.max ? raw.max / 1e5 : null };
  }

  // "$120,000 - $160,000" or "USD 120k-160k". The separator has to tolerate a
  // repeated currency symbol — "$150000 - $190000" is the common spelling, and
  // a pattern that stops at the second "$" silently drops the top of the range.
  if (/(?:\$|usd)/.test(s)) {
    const sep = String.raw`\s*(?:-|–|to)\s*(?:\$|usd)?\s*`;
    const k = nums(new RegExp(String.raw`(\d{2,3})\s*k?${sep}(\d{2,3})\s*k`));
    if (k) return { min: k.min * USD_LPA, max: k.max ? k.max * USD_LPA : null };
    const full = nums(new RegExp(String.raw`(\d{6})(?:${sep}(\d{6}))?`));
    if (full) return { min: (full.min / 1000) * USD_LPA, max: full.max ? (full.max / 1000) * USD_LPA : null };
  }

  return null;
}

/**
 * Is this a role a CSE/IT student from this campus would actually be placed
 * into? A board API returns everything the company is hiring for, so a sweep of
 * Databricks brings back payroll accountants and field marketing managers
 * alongside the engineering roles.
 *
 * Without this gate those land in the queue with a confident-looking estimated
 * package attached — a number with nothing behind it, on a role nobody here can
 * apply for. Filtering is much better than making an officer reject 40 of them
 * by hand every morning.
 */
const TECH_ROLE = new RegExp([
  'engineer', 'developer', 'programmer', 'sde\\b', 'swe\\b', 'sdet\\b',
  'architect', 'devops', 'sre\\b', 'site reliability', 'data scien',
  'data analyst', 'data engineer', 'machine learning', '\\bml\\b', '\\bai\\b',
  'research scientist', 'analytics', 'security', 'qa\\b', 'quality assurance',
  'product manager', 'technical program', 'tpm\\b', 'solutions? (?:architect|engineer)',
  'full ?stack', 'front ?end', 'back ?end', 'mobile', 'android', 'ios\\b',
  'cloud', 'platform', 'infrastructure', 'database administrator', '\\bdba\\b',
  'ux engineer', 'designer', 'technical writer',
].join('|'), 'i');

// Matched before TECH_ROLE, because "Sales Engineer" and "Recruiting Manager"
// contain words the gate above would otherwise wave through.
const NON_TECH_ROLE = new RegExp([
  'sales', 'account (?:executive|manager)', 'business development', '\\bbdr\\b', '\\bsdr\\b',
  'marketing', 'brand', 'content writer', 'copywriter', 'social media',
  'recruit', 'talent acquisition', 'human resources', '\\bhr\\b', 'people partner',
  'payroll', 'accountant', 'accounting', 'finance manager', 'controller', 'tax\\b',
  'legal', 'counsel', 'compliance officer', 'procurement', 'facilities',
  'customer success', 'customer support', 'technical support', 'help ?desk',
  'recepti', 'administrative assistant', 'office manager', 'logistics', 'warehouse',
  // Physical security and loss-prevention roles, which the 'security' keyword
  // in TECH_ROLE would otherwise read as infosec.
  'cluster head', 'investigation', 'loss prevention', 'physical security', 'guard',
].join('|'), 'i');

export function isPlaceableRole(title) {
  const t = String(title ?? '');
  if (NON_TECH_ROLE.test(t)) return false;
  return TECH_ROLE.test(t);
}

/**
 * Could a final-year student actually apply to this?
 *
 * This is the filter that matters most and was missing. Without it 82% of the
 * queue was Director, Principal, Staff and Senior roles — and because those
 * carry the biggest packages, they sorted straight to the top and made the
 * board look like it was full of 60-150 LPA openings. A student applying to
 * "Director of Engineering" is rejected before a human reads it, and learns
 * that the portal wastes their time.
 *
 * Seniority is judged on the title alone, which is imperfect but is the only
 * signal every board actually provides. The bias is deliberately toward
 * excluding: a senior job shown to a fresher costs them an application and
 * some confidence, while a fresher job missed costs one row in a queue that
 * refills nightly.
 */
const SENIOR_TITLE = new RegExp([
  'senior', 'sr\\.?\\s*[a-z]', 'staff', 'principal', 'distinguished', 'fellow',
  'lead\\b', 'leader', 'director', '\\bvp\\b', 'vice president', '\\bhead\\b',
  'chief', '\\bcto\\b', 'architect',
  'manager', 'mgr\\b',
  // Mid-level, which is not a first job either.
  'intermediate', 'mid[- ]level', 'experienced',
  // Level markers. "Software Engineer 2" and "Engineer III" both mean the
  // second rung, and boards write them every possible way.
  '(engineer|developer|scientist|analyst|sde|swe)\\s*[-–]?\\s*[2-9]\\b',
  '(engineer|developer|scientist|analyst)\\s+(ii|iii|iv|v)\\b',
  '\\bsde\\s*[-–]?\\s*[2-9]\\b', '\\bswe\\s*[-–]?\\s*[2-9]\\b',
  '\\bl[4-9]\\b', '\\blevel\\s*[3-9]\\b',
  // Experience stated in the title.
  '\\d\\+?\\s*(years|yrs)',
].join('|'), 'i');

/**
 * Titles that say "fresher" outright. Only consulted when no seniority marker
 * is present — an earlier version let these override, and "Sr.Data Scientist I"
 * slipped through on the trailing "I".
 */
const FRESHER_TITLE = new RegExp([
  'fresher', 'graduate', 'new ?grad', 'campus', 'trainee', 'intern\\b',
  'entry[- ]level', 'junior', '\\bjr\\.?\\b', 'associate engineer',
  '\\bsde\\s*[-–]?\\s*1\\b', '\\bswe\\s*[-–]?\\s*1\\b', '\\bl1\\b',
  'apprentice', 'early career',
].join('|'), 'i');

export function isFresherRole(title) {
  const t = String(title ?? '');
  // Seniority wins outright. A title carrying both signals ("Senior Graduate
  // Engineer" does not exist, but "Sr. Data Scientist I" does) is senior.
  if (SENIOR_TITLE.test(t)) return false;
  if (FRESHER_TITLE.test(t)) return true;
  // No marker either way: an untitled "Software Engineer" is the classic
  // campus-hire posting, so it stays.
  return true;
}

/**
 * When no package is published, infer a band from the title.
 *
 * This is a heuristic, and it is labelled as one everywhere it surfaces
 * (`ctc_source = 'estimated'`, and an "estimated" chip in the admin queue and
 * on the student's job card). A student deciding where to spend an afternoon
 * applying deserves to know the difference between a number the employer
 * printed and a number we inferred from a job title.
 *
 * ORDER MATTERS. The list is walked top-down and the first match wins, so the
 * most specific seniority has to come first — otherwise "Staff Software
 * Engineer" matches the generic engineer band and a 90 LPA role is advertised
 * at 18. That exact bug is what the smoke tests below pin down.
 */
const TITLE_BANDS = [
  [/\b(intern|internship|trainee|apprentice|graduate programme)\b/i,     { min: 6,  max: 12 }],

  // Everything below is a FRESHER band, because isFresherRole() has already
  // excluded senior titles by the time this runs. The old table carried
  // Director and Principal rows at 60-150 LPA; those numbers were real for the
  // role but meaningless here, and they dominated the board precisely because
  // they were the largest.
  //
  // These are entry-level Indian ranges. The spread is wide on purpose: the
  // same "Software Engineer" title pays about 5 LPA at a service company and
  // about 30 at a product one, and the title alone cannot tell us which.
  [/\b(machine learning|ml engineer|data scientist|ai engineer|research)\b/i, { min: 10, max: 32 }],
  [/\b(devops|sre|site reliability|platform|infrastructure|security|cloud)\b/i, { min: 8, max: 26 }],
  [/\b(product manager|technical program manager|\btpm\b)\b/i,          { min: 12, max: 30 }],
  [/\b(software|backend|front ?end|full ?stack|mobile|android|ios|data|qa|test)\b.*\b(engineer|developer)\b/i, { min: 6, max: 28 }],
  [/\b(engineer|developer|analyst)\b/i,                                 { min: 5, max: 24 }],
];

export function estimateCtc(title) {
  const t = String(title ?? '');
  for (const [re, band] of TITLE_BANDS) if (re.test(t)) return band;
  return null;
}

/* ------------------------------------------------------------------ skills */

const SKILL_VOCAB = [
  'java', 'python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#', 'kotlin',
  'swift', 'scala', 'ruby', 'php', 'react', 'angular', 'vue', 'next.js', 'node.js', 'express',
  'django', 'flask', 'spring boot', 'spring', '.net', 'rails', 'graphql', 'rest api', 'grpc',
  'mysql', 'postgresql', 'postgres', 'mongodb', 'redis', 'cassandra', 'dynamodb', 'elasticsearch',
  'kafka', 'rabbitmq', 'spark', 'hadoop', 'airflow', 'snowflake', 'dbt', 'databricks',
  'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'jenkins', 'ci/cd', 'linux',
  'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'nlp', 'llm', 'computer vision',
  'system design', 'microservices', 'distributed systems', 'data structures', 'algorithms',
  'git', 'agile', 'unit testing', 'selenium', 'android', 'ios', 'flutter', 'react native',
];

export function extractSkills(text, limit = 14) {
  const s = String(text ?? '').toLowerCase();
  const hits = [];
  for (const skill of SKILL_VOCAB) {
    // Escape the regex metacharacters that live in real skill names (c++, c#,
    // node.js) instead of silently building a broken pattern.
    const safe = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9+#.])${safe}([^a-z0-9+#.]|$)`).test(s)) hits.push(skill);
    if (hits.length >= limit) break;
  }
  return hits;
}

/* -------------------------------------------------------------- normalise */

function workModeOf(location, description) {
  const s = `${location ?? ''} ${String(description ?? '').slice(0, 600)}`.toLowerCase();
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\b(fully remote|remote[- ]first|work from home|wfh)\b/.test(s)) return 'remote';
  if (/\bremote\b/.test(s)) return 'remote';
  return 'onsite';
}

function jobTypeOf(title, description) {
  const s = `${title ?? ''} ${String(description ?? '').slice(0, 400)}`.toLowerCase();
  if (/\b(intern|internship|trainee)\b/.test(s)) return 'internship';
  if (/\b(contract|contractor|freelance|consultant)\b/.test(s)) return 'contract';
  return 'full-time';
}

function toMysqlDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Never trust a source's clock: a listing "posted" next week would sort to
  // the top of every student's feed forever.
  const now = Date.now();
  return new Date(Math.min(d.getTime(), now)).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Raw posting → a row shaped like the `jobs` table, or a rejection reason.
 * Pure and exported so the test suite can exercise the rules without a network.
 */
export function normalise(raw, { minCtc = env.jobs.minCtc } = {}) {
  if (!raw?.title || !raw?.company) return { skip: 'incomplete' };
  if (!raw.applyUrl) return { skip: 'no_apply_url' };
  if (!isIndia(raw.location)) return { skip: 'not_india' };
  if (!isPlaceableRole(raw.title)) return { skip: 'off_track' };
  if (!isFresherRole(raw.title)) return { skip: 'not_fresher' };

  const description = stripHtml(raw.description ?? '').slice(0, 7000);

  // A published figure always beats an inferred one.
  let ctcSource = 'listed';
  let band = raw.ctcMin != null
    ? { min: raw.ctcMin, max: raw.ctcMax ?? null }
    : parseCtc(raw.payText) ?? parseCtc(description.slice(0, 1500));

  if (!band) {
    band = estimateCtc(raw.title);
    ctcSource = band ? 'estimated' : 'unknown';
  }

  // An unknown package cannot clear a floor. Dropping these silently would hide
  // good roles, so they are reported separately rather than merged into
  // below_floor — the admin can widen the sources if the count looks wrong.
  if (!band) return { skip: 'no_salary' };

  // Compare on the TOP of the range: a "20-35 LPA" role clears a 20 floor, and
  // so does an estimated 18-35 band. The officer sees the range and decides.
  const ceiling = band.max ?? band.min;
  if (ceiling < minCtc) return { skip: 'below_floor' };

  return {
    row: {
      source: raw.externalId.split(':')[0],
      external_id: raw.externalId.slice(0, 120),
      title: String(raw.title).trim().slice(0, 200),
      company: String(raw.company).trim().slice(0, 180),
      location: raw.location ? String(raw.location).trim().slice(0, 180) : null,
      work_mode: workModeOf(raw.location, description),
      job_type: jobTypeOf(raw.title, description),
      min_ctc: round2(band.min),
      max_ctc: band.max != null ? round2(band.max) : null,
      ctc_source: ctcSource,
      experience: null,
      skills: JSON.stringify(extractSkills(`${raw.title} ${description}`)),
      description: description || null,
      apply_url: String(raw.applyUrl).slice(0, 500),
      source_url: String(raw.applyUrl).slice(0, 500),
      posted_at: toMysqlDate(raw.postedAt) ?? nowSql(),
    },
  };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/* ----------------------------------------------------------------- the run */

/**
 * Run every enabled source and queue what clears the rules.
 *
 * `INSERT IGNORE` leans on the `uq_job_source_ext` unique key, so re-running
 * the sweep an hour later is free and a job already approved (or already
 * rejected) is never resurrected.
 */
export async function ingestAll({ only = null, dryRun = false } = {}) {
  const chosen = SOURCES.filter((s) => (only ? s.id === only : true));
  const runs = [];

  for (const source of chosen) {
    if (!source.enabled()) {
      runs.push({ source: source.id, status: 'skipped', needs: source.needs, found: 0, inserted: 0 });
      continue;
    }

    const started = Date.now();
    const tally = { found: 0, inserted: 0, duplicates: 0, below_floor: 0, other: 0 };
    let status = 'ok';
    let error = null;

    let raws = [];
    try {
      raws = await source.fetch();
    } catch (err) {
      // A source that lost SOME of its boards still has usable results. Keep
      // them, mark the run `partial`, and record which boards broke — a renamed
      // board token is otherwise indistinguishable from a company that simply
      // has nothing open.
      if (err.name === 'PartialSourceError') {
        raws = err.results;
        status = 'partial';
        error = err.message.slice(0, 500);
      } else {
        status = 'failed';
        error = err.message?.slice(0, 500) ?? 'unknown error';
      }
    }

    try {
      tally.found = raws.length;

      for (const raw of raws) {
        let norm;
        try {
          norm = normalise(raw);
        } catch {
          tally.other++;
          continue;
        }
        if (norm.skip) {
          if (norm.skip === 'below_floor') tally.below_floor++;
          else tally.other++;
          continue;
        }
        if (dryRun) { tally.inserted++; continue; }

        const r = norm.row;
        const result = await execute(
          `INSERT IGNORE INTO jobs
             (source, external_id, title, company, location, work_mode, job_type,
              min_ctc, max_ctc, ctc_source, experience, skills, description,
              apply_url, source_url, posted_at, active, status, ingested_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'pending',NOW())`,
          [r.source, r.external_id, r.title, r.company, r.location, r.work_mode, r.job_type,
           r.min_ctc, r.max_ctc, r.ctc_source, r.experience, r.skills, r.description,
           r.apply_url, r.source_url, r.posted_at]
        );
        if (result.affectedRows) tally.inserted++;
        else tally.duplicates++;
      }
    } catch (err) {
      status = 'failed';
      error = err.message?.slice(0, 500) ?? 'unknown error';
    }

    if (status === 'ok' && tally.found === 0) status = 'partial';
    const ms = Date.now() - started;

    if (!dryRun) {
      await execute(
        `INSERT INTO job_ingest_runs (source, status, found, inserted, duplicates, below_floor, error, ms)
         VALUES (?,?,?,?,?,?,?,?)`,
        [source.id, status, tally.found, tally.inserted, tally.duplicates, tally.below_floor, error, ms]
      );
    }
    runs.push({ source: source.id, status, error, ms, ...tally });
  }

  const [{ pending }] = await query(`SELECT COUNT(*) AS pending FROM jobs WHERE status = 'pending'`);
  return {
    runs,
    inserted: runs.reduce((n, r) => n + (r.inserted || 0), 0),
    pending,
  };
}

/** Expire approved listings nobody closed, so the board stays honest. */
export async function expireStaleJobs({ days = env.jobs.expireDays } = {}) {
  const res = await execute(
    `UPDATE jobs SET active = 0
      WHERE active = 1 AND status = 'approved'
        AND (expires_at IS NOT NULL AND expires_at < NOW()
             OR posted_at < DATE_SUB(NOW(), INTERVAL ? DAY))`,
    [days]
  );
  return res.affectedRows;
}
