/**
 * Gemini-backed writing help for resumes.
 *
 * The hard rule everywhere in this file: **the model may rewrite what a student
 * wrote, never invent what they did.** A resume is a claim a human has to defend
 * in an interview, and a fabricated metric is worse than a weak bullet — it gets
 * found out. So every prompt forbids inventing facts, and `stripInvented()`
 * checks the output for numbers that were not in the input and rejects them.
 *
 * Where a bullet genuinely needs a number the model asks for one with a
 * [NUMBER] placeholder rather than guessing.
 */
import { env } from '../config/env.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30_000;

export function aiStatus() {
  return {
    configured: Boolean(env.ai.key),
    model: env.ai.model,
    provider: 'google-gemini',
  };
}

/* ------------------------------------------------------------- transport */

/**
 * Gemini 3 charges its internal "thinking" against maxOutputTokens — a long
 * prompt can burn the whole budget reasoning and return truncated JSON. So the
 * ceilings here are deliberately generous and thinking is capped, rather than
 * tuned down to look economical.
 */
async function generate(prompt, { temperature = 0.4, maxTokens = 4096, json = false, thinking = 'low' } = {}) {
  if (!env.ai.key) {
    return { ok: false, error: 'AI is not configured. Add GEMINI_API_KEY to server/.env and restart.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API}/${env.ai.model}:generateContent?key=${env.ai.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          thinkingConfig: { thinkingLevel: thinking },
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
        safetySettings: [
          'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
        ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const reason = data?.error?.message || `Gemini returned ${res.status}`;
      if (res.status === 429) return { ok: false, error: 'Gemini rate limit reached. Wait a minute and try again.' };
      if (res.status === 400 && /API key/i.test(reason)) {
        return { ok: false, error: 'That Gemini API key was rejected. Check GEMINI_API_KEY in server/.env.' };
      }
      return { ok: false, error: reason };
    }

    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      return { ok: false, error: 'Gemini declined to answer that. Try rephrasing.' };
    }

    // Thought parts carry no answer text; joining them in would corrupt the JSON.
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim();

    if (!text) {
      const why = candidate?.finishReason === 'MAX_TOKENS'
        ? 'Gemini ran out of output budget before answering. Try a shorter input.'
        : 'Gemini returned an empty response.';
      return { ok: false, error: why };
    }

    if (json) {
      try {
        // Models occasionally wrap JSON in a markdown fence despite the mime type.
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        return { ok: true, data: JSON.parse(cleaned) };
      } catch {
        console.error('[ai] malformed JSON from Gemini:', text.slice(0, 300));
        return {
          ok: false,
          error: candidate?.finishReason === 'MAX_TOKENS'
            ? 'Gemini ran out of output budget mid-answer. Try a shorter input.'
            : 'Gemini returned malformed JSON. Try again.',
        };
      }
    }
    return { ok: true, text };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'Gemini timed out. Try again.' };
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- guardrails */

const RULES = `
HARD RULES — these override anything else:
- Never invent facts. Do not add companies, technologies, dates, or achievements
  the input does not contain.
- Never invent numbers. If a line would be stronger with a metric the student has
  not supplied, write the literal token [NUMBER] where it belongs and keep the
  rest of the sentence honest.
- Keep every claim something the student could defend in an interview.
- Indian English. No em dashes. No emoji. No markdown formatting.
- Plain text only, because this goes into an ATS-parsed document.
`.trim();

/** Numbers the model produced that were nowhere in the source are fabrications. */
function inventedNumbers(source, output) {
  const seen = new Set((String(source).match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, '')));
  const produced = (String(output).match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, ''));
  // Single digits and years are usually structural (a count of items, "2025"),
  // so only flag substantial figures the source never mentioned.
  return produced.filter((n) => n.replace(/[,.]/g, '').length >= 2 && !seen.has(n));
}

/* ----------------------------------------------------------------- tasks */

/**
 * Rewrites one achievement bullet. Returns two options so the student chooses
 * rather than accepting whatever came out first.
 */
export async function improveBullet({ text, role, company, tech }) {
  const input = String(text || '').trim();
  if (input.length < 8) return { ok: false, error: 'Write a few words first, then I can sharpen them.' };

  const prompt = `${RULES}

You are helping an Indian final-year engineering student sharpen one bullet point
on their resume.

CONTEXT
Role: ${role || 'not given'}
Company or project: ${company || 'not given'}
Technologies: ${(tech || []).join(', ') || 'not given'}

THEIR BULLET
${input}

TASK
Rewrite it twice. Each rewrite must:
- open with a past tense action verb (Built, Reduced, Automated, Designed, Led, Shipped)
- say what changed, not just what they touched
- stay under 28 words
- keep every number that is already there, exactly as written
- use [NUMBER] only where a metric is clearly missing

Return JSON: {"options":["first rewrite","second rewrite"],"note":"one short sentence on what you changed, or what number would make this much stronger"}`;

  const result = await generate(prompt, { temperature: 0.6, json: true, maxTokens: 4096 });
  if (!result.ok) return result;

  const options = (result.data?.options ?? [])
    .filter((o) => typeof o === 'string' && o.trim())
    .map((o) => o.trim().replace(/^[-•*]\s*/, ''));

  if (!options.length) return { ok: false, error: 'Gemini did not return a usable rewrite.' };

  // Reject any rewrite that smuggled in a number the student never gave us.
  const clean = [];
  let rejected = 0;
  for (const option of options) {
    if (inventedNumbers(input, option).length) { rejected += 1; continue; }
    clean.push(option);
  }

  if (!clean.length) {
    return {
      ok: false,
      error: 'The suggestions invented figures that are not in your bullet, so I discarded them. Add the real number and try again.',
    };
  }

  return {
    ok: true,
    options: clean,
    note: result.data?.note ?? null,
    rejected,
  };
}

/** Drafts a professional summary strictly from profile facts. */
export async function writeSummary({ profile, targetRole }) {
  const facts = summariseProfile(profile);
  if (!facts.trim()) {
    return { ok: false, error: 'Add some education, skills or projects first — there is nothing to summarise yet.' };
  }

  const prompt = `${RULES}

Write a professional summary for the top of an Indian final-year engineering
student's resume.

TARGET ROLE: ${targetRole || 'software engineering role'}

EVERYTHING KNOWN ABOUT THEM (use only this):
${facts}

TASK
Write 2 to 3 sentences, 45 to 65 words total. Name the target role. Lead with the
strongest evidence that is actually listed above. Do not use the phrase "results
driven" or "passionate". Do not invent anything not listed.

Return JSON: {"summary":"the text","used":["which facts above you leaned on"]}`;

  const result = await generate(prompt, { temperature: 0.5, json: true, maxTokens: 4096 });
  if (!result.ok) return result;

  const summary = String(result.data?.summary ?? '').trim();
  if (!summary) return { ok: false, error: 'Gemini did not return a summary.' };

  const invented = inventedNumbers(facts, summary);
  if (invented.length) {
    return {
      ok: false,
      error: `The draft contained figures not in your profile (${invented.join(', ')}), so I discarded it. Try again.`,
    };
  }

  return { ok: true, summary, used: result.data?.used ?? [] };
}

/**
 * Reviews the whole resume against a target role or a pasted posting, and
 * returns concrete, addressable fixes — not generic advice.
 */
export async function reviewResume({ data, targetRole, jobDescription, atsReport }) {
  const facts = summariseProfile(data);
  if (!facts.trim()) return { ok: false, error: 'This resume is empty — fill in your profile first.' };

  const gaps = atsReport?.missingKeywords?.length
    ? `\nKEYWORDS THE SCORER FOUND MISSING: ${atsReport.missingKeywords.join(', ')}`
    : '';

  const prompt = `${RULES}

You are a placement officer reviewing an Indian final-year engineering student's
resume before they apply.

TARGET ROLE: ${targetRole || 'not specified'}
${jobDescription ? `\nTHE ACTUAL JOB POSTING:\n${String(jobDescription).slice(0, 4000)}\n` : ''}
CURRENT ATS SCORE: ${atsReport?.score ?? 'unknown'} out of 100${gaps}

THE RESUME
${facts}

TASK
Give at most 5 fixes, ordered by how much they would improve the student's
chances. Each fix must point at something specific in the resume above and say
exactly what to change. No generic advice like "add more keywords" or "quantify
your impact" on its own.

For missing keywords, only suggest ones this student could plausibly claim given
what is already listed. Say so if a keyword would be dishonest for them.

Return JSON:
{"fixes":[{"where":"which section or line","problem":"what is wrong","action":"exactly what to do","effort":"quick|medium|substantial"}],
 "strongest":"the single best thing about this resume",
 "verdict":"one sentence on readiness for this role"}`;

  const result = await generate(prompt, { temperature: 0.4, json: true, maxTokens: 8192, thinking: 'high' });
  if (!result.ok) return result;

  const fixes = (result.data?.fixes ?? []).filter((f) => f?.action);
  return {
    ok: true,
    fixes,
    strongest: result.data?.strongest ?? null,
    verdict: result.data?.verdict ?? null,
  };
}

/* ------------------------------------------------------------- helpers */

/** Flattens the resume/profile into the only facts the model may use. */
function summariseProfile(data = {}) {
  const parts = [];
  const b = data.basics ?? {};
  if (b.headline) parts.push(`Headline: ${b.headline}`);
  if (data.summary) parts.push(`Current summary: ${data.summary}`);

  for (const e of data.education ?? []) {
    parts.push(`Education: ${[e.degree, e.institution, e.endYear, e.score != null ? `${e.score} ${e.scoreType ?? ''}`.trim() : null].filter(Boolean).join(', ')}`);
  }

  const skills = (data.skills ?? []).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  if (skills.length) parts.push(`Skills: ${skills.join(', ')}`);

  for (const x of data.experience ?? []) {
    parts.push(`Experience: ${x.role} at ${x.company}${x.period ? ` (${x.period})` : ''}`);
    for (const h of x.highlights ?? []) parts.push(`  - ${h}`);
  }

  for (const p of data.projects ?? []) {
    parts.push(`Project: ${p.title}${p.tech?.length ? ` using ${p.tech.join(', ')}` : ''}`);
    if (p.description) parts.push(`  ${p.description}`);
    for (const h of p.highlights ?? []) parts.push(`  - ${h}`);
  }

  for (const a of data.achievements ?? []) {
    parts.push(`Achievement: ${[a.title, a.issuer].filter(Boolean).join(' — ')}`);
  }

  for (const c of data.coding ?? []) {
    parts.push(`Coding: ${c.platform}${c.solved ? `, ${c.solved} solved` : ''}${c.rating ? `, rating ${c.rating}` : ''}`);
  }

  return parts.join('\n');
}
