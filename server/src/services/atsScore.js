/**
 * ATS scoring engine.
 *
 * Real applicant-tracking systems do two things: parse the document into
 * fields, then rank it against the requisition's keywords. This scorer models
 * both — parseability/structure on one side, keyword and evidence coverage on
 * the other — and returns per-dimension tips so a student knows what to fix.
 */

const ACTION_VERBS = [
  'built', 'designed', 'developed', 'implemented', 'led', 'launched', 'automated', 'optimized',
  'reduced', 'increased', 'improved', 'migrated', 'architected', 'created', 'delivered', 'deployed',
  'engineered', 'integrated', 'scaled', 'refactored', 'analyzed', 'modelled', 'modeled', 'trained',
  'shipped', 'owned', 'mentored', 'coordinated', 'streamlined', 'debugged', 'tested', 'published',
  'achieved', 'won', 'ranked', 'solved', 'benchmarked', 'containerized', 'orchestrated',
];

const WEAK_OPENERS = [
  'responsible for', 'worked on', 'helped with', 'involved in', 'participated in',
  'was part of', 'assisted in', 'tasked with', 'duties included',
];

// Characters that routinely break naive ATS parsers: decorative bullet glyphs,
// arrows, emoji, and private-use codepoints (what an icon font leaves behind in
// extracted text). En and em dashes are deliberately NOT listed here - every
// mainstream parser handles them, and flagging them would push students toward
// worse typography for no gain.
const RISKY_CHARS =
  /[\u2022\u25CF\u25AA\u25B8\u27A2\u2794]|[\u{1F300}-\u{1FAFF}]|[\u2190-\u21FF]|[\u{E000}-\u{F8FF}]/u;

// Kept in step with TEMPLATES in resumeBuilder.js. Templates not listed here
// are plain single-column and cost nothing.
const BANNER_TIP =
  'This template puts your name on a coloured fill. Some parsers skip filled blocks — switch to ATS Classic if the employer screens automatically.';
const TWO_COLUMN_TIP =
  'This template is two columns, the most common cause of a scrambled parse. Use it when a human reviews first; pick a single-column template for portal applications.';
const PHOTO_TIP =
  'This template carries a photo and a colour header. Photos are the single thing most likely to make a parser drop the block around them, and most Indian IT portals do not want one. Keep it for campus drives and referrals; use a single-column template for online applications.';
const PHOTO_SIDEBAR_TIP =
  'Two columns plus a photo is the riskiest combination for automated screening — expect a scrambled parse. Beautiful for a human, poor for a portal. Keep a single-column version of this resume for anything you upload to a careers site.';
const TEMPLATE_RISK = {
  'ats-azure':  { penalty: 2, tip: BANNER_TIP },
  'ats-banner': { penalty: 2, tip: BANNER_TIP },
  'ats-slate':   { penalty: 4, tip: TWO_COLUMN_TIP },
  'ats-sidebar': { penalty: 4, tip: TWO_COLUMN_TIP },
  'modern-portrait':    { penalty: 6,  tip: PHOTO_TIP },
  'modern-profile':     { penalty: 6,  tip: PHOTO_TIP },
  'modern-coral':       { penalty: 6,  tip: PHOTO_TIP },
  'modern-aside':       { penalty: 10, tip: PHOTO_SIDEBAR_TIP },
  'modern-slate-aside': { penalty: 10, tip: PHOTO_SIDEBAR_TIP },
};

/** Baseline keyword sets per target role. Extended by any pasted job description. */
export const ROLE_KEYWORDS = {
  'software engineer': ['data structures', 'algorithms', 'java', 'python', 'c++', 'git', 'rest api', 'sql', 'oop', 'debugging', 'system design', 'unit testing', 'agile'],
  'full stack developer': ['react', 'node.js', 'javascript', 'typescript', 'rest api', 'mongodb', 'sql', 'html', 'css', 'git', 'redux', 'express', 'authentication', 'deployment'],
  'frontend developer': ['react', 'javascript', 'typescript', 'html', 'css', 'responsive design', 'accessibility', 'redux', 'webpack', 'testing', 'ui', 'figma', 'performance'],
  'backend developer': ['node.js', 'java', 'python', 'rest api', 'sql', 'microservices', 'docker', 'redis', 'authentication', 'caching', 'database design', 'testing', 'aws'],
  'data analyst': ['sql', 'excel', 'power bi', 'tableau', 'python', 'pandas', 'data cleaning', 'visualization', 'statistics', 'dashboard', 'a/b testing', 'reporting'],
  'data scientist': ['python', 'pandas', 'numpy', 'scikit-learn', 'machine learning', 'statistics', 'sql', 'feature engineering', 'model evaluation', 'nlp', 'deep learning', 'visualization'],
  'machine learning engineer': ['python', 'pytorch', 'tensorflow', 'machine learning', 'deep learning', 'mlops', 'model deployment', 'feature engineering', 'docker', 'aws', 'nlp', 'computer vision'],
  'devops engineer': ['docker', 'kubernetes', 'ci/cd', 'jenkins', 'terraform', 'aws', 'linux', 'monitoring', 'bash', 'ansible', 'git', 'nginx'],
  'cloud engineer': ['aws', 'azure', 'gcp', 'terraform', 'kubernetes', 'docker', 'networking', 'iam', 'linux', 'ci/cd', 'cost optimization'],
  'qa engineer': ['selenium', 'test automation', 'junit', 'api testing', 'postman', 'regression testing', 'jira', 'test cases', 'ci/cd', 'cypress'],
  'android developer': ['kotlin', 'java', 'android studio', 'jetpack compose', 'rest api', 'room', 'mvvm', 'firebase', 'gradle', 'material design'],
  'business analyst': ['requirements gathering', 'sql', 'excel', 'stakeholder management', 'process mapping', 'documentation', 'jira', 'power bi', 'user stories'],
};

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'that', 'this', 'from', 'have', 'has', 'your', 'work', 'team', 'role', 'about', 'good', 'strong', 'ability', 'years', 'must', 'plus', 'etc', 'job', 'we', 'a', 'an', 'to', 'in', 'of', 'on', 'or', 'as', 'be', 'is', 'at', 'by']);

const norm = (s) => String(s ?? '').toLowerCase();

function flattenResume(data = {}) {
  const parts = [];
  const push = (v) => { if (v) parts.push(String(v)); };

  push(data.summary);
  push(data.basics?.headline);
  for (const e of data.education || []) push([e.institution, e.degree, e.branch].filter(Boolean).join(' '));
  for (const s of data.skills || []) push(typeof s === 'string' ? s : s.name);
  for (const p of data.projects || []) {
    push(p.title); push(p.role); push(p.description);
    push((p.tech || []).join(' '));
    push((p.highlights || []).join(' '));
  }
  for (const x of data.experience || []) {
    push(x.company); push(x.role); push(x.description);
    push((x.highlights || []).join(' '));
  }
  for (const a of data.achievements || []) { push(a.title); push(a.issuer); push(a.description); }
  return parts.join('\n');
}

function allBullets(data = {}) {
  const out = [];
  for (const p of data.projects || []) out.push(...(p.highlights || []).filter(Boolean));
  for (const x of data.experience || []) out.push(...(x.highlights || []).filter(Boolean));
  return out;
}

function extractJdKeywords(jd, limit = 24) {
  const text = norm(jd);
  if (!text.trim()) return [];
  const phrases = new Set();

  // multi-word tech phrases worth matching verbatim
  for (const phrase of ['rest api', 'data structures', 'machine learning', 'deep learning', 'unit testing', 'ci/cd', 'system design', 'object oriented', 'version control', 'problem solving', 'cloud computing', 'test automation', 'data analysis']) {
    if (text.includes(phrase)) phrases.add(phrase);
  }

  const freq = new Map();
  for (const raw of text.match(/[a-z][a-z0-9+#.\-]{2,}/g) || []) {
    const w = raw.replace(/[.\-]+$/, '');
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return [...phrases, ...top].slice(0, limit);
}

function pct(value, max) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

/**
 * @param {object} resumeData  the resume `data` JSON
 * @param {object} opts        { targetRole, jobDescription }
 */
export function scoreResume(resumeData = {}, opts = {}) {
  const data = resumeData || {};
  const basics = data.basics || {};
  const text = flattenResume(data);
  const lower = norm(text);
  const bullets = allBullets(data);
  const words = (text.match(/\S+/g) || []).length;

  const breakdown = [];

  // ---------------------------------------------------------------- contact
  {
    const max = 10;
    const tips = [];
    let got = 0;
    if (basics.fullName?.trim()) got += 2.5; else tips.push('Add your full name — the parser keys the whole record off it.');
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(basics.email || '')) got += 2.5; else tips.push('Add a valid email address.');
    if (String(basics.phone || '').replace(/\D/g, '').length >= 10) got += 2; else tips.push('Add a 10-digit phone number.');
    if (basics.location?.trim()) got += 1.5; else tips.push('Add your city — many filters screen on location.');
    if (basics.linkedin || basics.github || basics.portfolio) got += 1.5;
    else tips.push('Add at least one profile link (LinkedIn, GitHub or portfolio).');
    breakdown.push({ key: 'contact', label: 'Contact details', score: pct(got, max), max, tips });
  }

  // --------------------------------------------------------------- sections
  {
    const max = 15;
    const tips = [];
    let got = 0;
    const hasSummary = (data.summary || '').trim().length >= 40;
    const hasEdu = (data.education || []).length > 0;
    const hasSkills = (data.skills || []).length >= 3;
    const hasWork = (data.projects || []).length > 0 || (data.experience || []).length > 0;

    if (hasSummary) got += 3; else tips.push('Write a 2–3 line professional summary naming your target role.');
    if (hasEdu) got += 3; else tips.push('Add your education — degree, institution, graduation year and CGPA.');
    if (hasSkills) got += 4; else tips.push('List at least 5–8 skills in a dedicated Skills section.');
    if (hasWork) got += 5; else tips.push('Add at least two projects or one internship — this is the heaviest section for a fresher.');
    breakdown.push({ key: 'sections', label: 'Required sections', score: pct(got, max), max, tips });
  }

  // --------------------------------------------------------------- keywords
  const roleKey = norm(opts.targetRole).trim();
  const baseKeywords = ROLE_KEYWORDS[roleKey] || ROLE_KEYWORDS[Object.keys(ROLE_KEYWORDS).find((k) => roleKey && (k.includes(roleKey) || roleKey.includes(k))) || ''] || [];
  const jdKeywords = extractJdKeywords(opts.jobDescription);
  const keywords = [...new Set([...baseKeywords, ...jdKeywords])];

  const matched = [];
  const missing = [];
  for (const kw of keywords) {
    if (lower.includes(norm(kw))) matched.push(kw);
    else missing.push(kw);
  }
  {
    const max = 25;
    const tips = [];
    let got;
    if (!keywords.length) {
      got = 15; // neutral: nothing to match against
      tips.push('Pick a target role (or paste the job description) to get a real keyword match score.');
    } else {
      const ratio = matched.length / keywords.length;
      got = ratio * max;
      if (ratio < 0.4) tips.push(`Only ${matched.length}/${keywords.length} role keywords appear. Work the missing ones into your skills and project bullets.`);
      else if (ratio < 0.7) tips.push(`${matched.length}/${keywords.length} keywords matched — add a few more of the missing terms where they are genuinely true of you.`);
      if (missing.length) tips.push(`Highest-value gaps: ${missing.slice(0, 6).join(', ')}.`);
    }
    breakdown.push({ key: 'keywords', label: 'Role keyword match', score: pct(got, max), max, tips });
  }

  // ------------------------------------------------------------ quantified
  {
    const max = 15;
    const tips = [];
    const quantified = bullets.filter((b) => /\d+\s*(%|percent|x\b|k\b|ms\b|s\b|users?|students?|requests?|hours?|records?|lines?|times)|\b\d{2,}\b/i.test(b));
    let got;
    if (!bullets.length) {
      got = 0;
      tips.push('Write 2–4 bullet points under each project describing what you did and what changed.');
    } else {
      const ratio = quantified.length / bullets.length;
      got = ratio * max;
      if (ratio < 0.3) tips.push(`Only ${quantified.length} of ${bullets.length} bullets contain a number. Quantify results — "cut API latency 420ms → 90ms", "handled 1,200 records/run".`);
      else if (ratio < 0.6) tips.push('Good start — aim for at least half your bullets to carry a measurable outcome.');
    }
    breakdown.push({ key: 'impact', label: 'Quantified impact', score: pct(got, max), max, tips });
  }

  // ---------------------------------------------------------- bullet quality
  {
    const max = 10;
    const tips = [];
    let got = 0;
    if (!bullets.length) {
      tips.push('No bullet points found — ATS ranking leans on verb-led achievement lines.');
    } else {
      const strong = bullets.filter((b) => ACTION_VERBS.some((v) => norm(b).trimStart().startsWith(v)));
      const weak = bullets.filter((b) => WEAK_OPENERS.some((w) => norm(b).includes(w)));
      got = (strong.length / bullets.length) * max;
      if (weak.length) {
        got -= Math.min(3, weak.length);
        const offender = WEAK_OPENERS.find((w) => weak.some((b) => norm(b).includes(w))) ?? 'responsible for';
        tips.push(`Replace passive openers ("${offender}") with an action verb.`);
      }
      if (strong.length / bullets.length < 0.6)
        tips.push('Start each bullet with a past-tense action verb: Built, Automated, Reduced, Designed, Led.');
      const longOnes = bullets.filter((b) => b.split(/\s+/).length > 32);
      if (longOnes.length) tips.push(`${longOnes.length} bullet${longOnes.length === 1 ? ' is' : 's are'} over 32 words — trim to one idea each.`);
    }
    breakdown.push({ key: 'bullets', label: 'Bullet quality', score: pct(got, max), max, tips });
  }

  // ------------------------------------------------------------ parseability
  {
    const max = 10;
    const tips = [];
    let got = max;

    // A design-first template is a real parsing risk, so it costs real points.
    // Otherwise the "ATS safe" badge would be decoration.
    const template = TEMPLATE_RISK[opts.template];
    if (template?.penalty) {
      got -= template.penalty;
      tips.push(template.tip);
    }

    if (RISKY_CHARS.test(text)) {
      got -= 3;
      tips.push('Remove emoji, arrows and decorative bullets — many parsers drop the line that contains them.');
    }
    const datedItems = [...(data.experience || []), ...(data.projects || [])];
    const undated = datedItems.filter((i) => !i.startDate && !i.start_date);
    if (datedItems.length && undated.length / datedItems.length > 0.5) {
      got -= 3;
      tips.push('Add month/year dates to projects and experience — recruiters filter on recency.');
    }
    if ((data.education || []).some((e) => !e.endYear && !e.end_year)) {
      got -= 2;
      tips.push('Add your graduation year to every education entry.');
    }
    if (!tips.length) tips.push('Structure looks clean and machine-readable.');
    breakdown.push({ key: 'parse', label: 'Parseability', score: pct(got, max), max, tips });
  }

  // ------------------------------------------------------------------ length
  {
    const max = 10;
    const tips = [];
    let got;
    if (words < 180) {
      got = (words / 180) * max;
      tips.push(`Only ~${words} words of content. A fresher resume should land around 350–600 words on one page.`);
    } else if (words <= 650) {
      got = max;
      tips.push('Length is in the sweet spot for a one-page fresher resume.');
    } else if (words <= 900) {
      got = max - 3;
      tips.push(`~${words} words is running long — cut to one page by dropping the weakest project.`);
    } else {
      got = max - 6;
      tips.push(`~${words} words spills well past one page. Keep only your strongest 3–4 items.`);
    }
    breakdown.push({ key: 'length', label: 'Length & density', score: pct(got, max), max, tips });
  }

  // ------------------------------------------------------------ skill breadth
  {
    const max = 5;
    const tips = [];
    const count = (data.skills || []).length;
    let got = Math.min(count / 10, 1) * max;
    if (count < 6) tips.push(`Only ${count} skill${count === 1 ? '' : 's'} listed — add languages, frameworks, databases and tools separately.`);
    else if (count > 28) { got = max - 2; tips.push('Too many skills dilutes the match. Keep the 15–20 you would defend in an interview.'); }
    else tips.push('Skill coverage looks solid.');
    breakdown.push({ key: 'skills', label: 'Skill coverage', score: pct(got, max), max, tips });
  }

  const score = Math.max(0, Math.min(100, Math.round(breakdown.reduce((sum, b) => sum + b.score, 0))));

  return {
    score,
    band: band(score),
    wordCount: words,
    bulletCount: bullets.length,
    matchedKeywords: matched,
    missingKeywords: missing.slice(0, 20),
    keywordUniverse: keywords.length,
    breakdown,
    topFixes: breakdown
      .filter((b) => b.score < b.max)
      .sort((a, b) => (b.max - b.score) - (a.max - a.score))
      .slice(0, 4)
      .flatMap((b) => b.tips.slice(0, 1)),
    scoredAt: new Date().toISOString(),
  };
}

function band(score) {
  if (score >= 85) return { label: 'Excellent', tone: 'emerald', note: 'This will clear most automated screens.' };
  if (score >= 70) return { label: 'Good', tone: 'sky', note: 'Solid — close the remaining gaps for a top-tier pass rate.' };
  if (score >= 50) return { label: 'Needs work', tone: 'amber', note: 'Likely to be filtered out by strict keyword screens.' };
  return { label: 'At risk', tone: 'rose', note: 'Most ATS filters would drop this. Work through the fixes below.' };
}
