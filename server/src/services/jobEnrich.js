/**
 * Read a sourced posting properly, using the model.
 *
 * Everything upstream of this is regex: a seniority gate on the title, an
 * employer-tier table for the package, a keyword list for skills. That gets a
 * usable queue out of 5,500 postings for free, and it is wrong in ways regex
 * cannot fix — "Forward Deployed Engineer" is not obviously a fresher role, and
 * no keyword list can tell whether a description actually expects operating
 * systems and DBMS or just says "computer science degree".
 *
 * So the model reads the description once, for the things that need reading:
 *
 *   - is this genuinely open to a final-year student with no experience
 *   - which CORE subjects it tests, which is what a campus student revises
 *   - the years of experience the text actually asks for
 *
 * It runs on the moderation queue only, never on anything a student sees
 * directly, and every field it returns is advisory: the officer still approves.
 * Cost control matters — 5,500 postings a night through an LLM would be absurd,
 * so this runs on the handful that already passed every cheap filter.
 */
import { env } from '../config/env.js';
import { execute, query } from '../config/db.js';
import { generateJson } from './ai.js';

/**
 * The subjects a KL student actually revises for placement, and which
 * high-package interviews actually test. Free-text skills ("Kubernetes",
 * "React") already live in `skills`; this is the academic spine underneath,
 * and it is what a student should study rather than list.
 */
export const CORE_SUBJECTS = [
  'DSA',            // data structures and algorithms
  'Advanced DS',    // tries, segment trees, graphs beyond the basics
  'System Design',
  'OS',             // operating systems
  'DBMS',
  'Computer Networks',
  'OOP',
  'Compilers',
  'Distributed Systems',
  'Machine Learning',
];

const PROMPT = (job) => `
You are screening job postings for a university placement cell. The students
are final-year B.Tech Computer Science students in India with no full-time
experience.

POSTING
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? 'not stated'}
Description:
${String(job.description ?? '').slice(0, 5000)}

Answer ONLY from the posting. Do not infer from the company's reputation.

1. fresherEligible — true only if a student with no full-time experience could
   apply. False if it asks for prior industry experience, names a senior level,
   or assumes ownership of an existing system.
2. yearsRequired — the minimum years of experience the text asks for. 0 if it
   asks for none or says new-grad. null if the text never says.
3. coreSubjects — which of these the posting actually tests or names. Pick only
   what the text supports; an empty list is correct when it says nothing:
   ${CORE_SUBJECTS.join(', ')}
4. topSkills — up to 8 concrete technologies named in the posting.
5. oneLine — one plain sentence a student would understand, saying what they
   would actually do. No marketing language.
6. confidence — "high" if the posting is detailed, "low" if it is a stub.

Return JSON:
{"fresherEligible":true|false,"yearsRequired":0,"coreSubjects":["DSA"],
 "topSkills":["Go"],"oneLine":"...","confidence":"high"}`.trim();

const VALID = new Set(CORE_SUBJECTS.map((s) => s.toLowerCase()));

/** Keep only what the model was allowed to return. */
function clean(data) {
  if (!data || typeof data !== 'object') return null;

  const subjects = (Array.isArray(data.coreSubjects) ? data.coreSubjects : [])
    .map((s) => String(s).trim())
    .filter((s) => VALID.has(s.toLowerCase()))
    .slice(0, 6);

  const years = Number.isFinite(Number(data.yearsRequired)) ? Number(data.yearsRequired) : null;

  return {
    fresherEligible: data.fresherEligible === true,
    yearsRequired: years !== null && years >= 0 && years <= 20 ? years : null,
    coreSubjects: subjects,
    topSkills: (Array.isArray(data.topSkills) ? data.topSkills : [])
      .map((s) => String(s).trim()).filter(Boolean).slice(0, 8),
    oneLine: typeof data.oneLine === 'string' ? data.oneLine.trim().slice(0, 240) : null,
    confidence: ['high', 'medium', 'low'].includes(data.confidence) ? data.confidence : 'low',
  };
}

/** Enrich one job. Returns the cleaned fields, or null if the model declined. */
export async function enrichJob(job) {
  const result = await generateJson(PROMPT(job), { temperature: 0.2, maxTokens: 2048 });
  if (!result.ok) return { ok: false, error: result.error };

  const data = clean(result.data);
  if (!data) return { ok: false, error: 'model returned nothing usable' };
  return { ok: true, data };
}

/**
 * Enrich a batch of pending jobs and write the results back.
 *
 * Sequential with a pause, not parallel: this shares one Gemini key with 656
 * students using the resume assistant, and a burst here would rate-limit them.
 */
export async function enrichPending({ limit = 30, status = 'pending' } = {}) {
  if (!env.ai.key) return { ok: false, error: 'AI is not configured.' };

  const jobs = await query(
    `SELECT id, title, company, location, description
       FROM jobs
      WHERE status = ? AND ai_checked_at IS NULL
      ORDER BY ingested_at DESC
      LIMIT ${Math.max(1, Math.min(200, Number(limit) || 30))}`,
    [status]
  );

  const tally = { scanned: jobs.length, enriched: 0, flagged: 0, failed: 0 };

  for (const job of jobs) {
    const r = await enrichJob(job);
    if (!r.ok) { tally.failed++; continue; }

    const d = r.data;
    // The model disagreeing with the title gate is the whole point — record it
    // and let the officer see both, rather than silently overriding either.
    if (!d.fresherEligible) tally.flagged++;

    await execute(
      `UPDATE jobs
          SET ai_fresher_ok = ?, ai_years_required = ?, ai_core_subjects = ?,
              ai_summary = ?, ai_confidence = ?, ai_checked_at = NOW()
        WHERE id = ?`,
      [d.fresherEligible ? 1 : 0, d.yearsRequired, JSON.stringify(d.coreSubjects),
       d.oneLine, d.confidence, job.id]
    );
    tally.enriched++;

    await new Promise((r2) => setTimeout(r2, 1200));
  }

  return { ok: true, ...tally };
}
