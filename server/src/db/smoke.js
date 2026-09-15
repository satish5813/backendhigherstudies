/**
 * Dependency-free checks of the pure logic: ATS scoring, email validation,
 * resume shaping and the LeetCode fetcher. Runs without a database.
 *
 *   node server/src/db/smoke.js
 */
import { scoreResume } from '../services/atsScore.js';
import { validateEmail } from '../utils/emailValidator.js';
import { ACCENT_PRESETS, buildResumeData, normaliseAccent, pruneEmpty, TEMPLATE_IDS, TEMPLATES } from '../services/resumeBuilder.js';
import { fetchLeetCode, normaliseHandle, codingStrength } from '../services/codingProfiles.js';
import { matchScore } from '../services/jobAlerts.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

const STRONG_RESUME = {
  basics: {
    fullName: 'Aarav Sharma', email: 'aarav@example.com', phone: '+91 98765 43210',
    location: 'Hyderabad', github: 'https://github.com/aarav', linkedin: 'https://linkedin.com/in/aarav',
  },
  summary: 'Final-year Computer Science student focused on backend engineering and distributed systems. Shipped three production applications and solved 450+ problems on LeetCode. Looking for an SDE role owning services end to end.',
  education: [{ institution: 'KL University', degree: 'B.Tech, CSE', endYear: 2026, score: 8.74, scoreType: 'cgpa' }],
  skills: [
    { name: 'Java', category: 'language' }, { name: 'Python', category: 'language' },
    { name: 'SQL', category: 'database' }, { name: 'Git', category: 'tool' },
    { name: 'REST API', category: 'concept' }, { name: 'Data Structures', category: 'concept' },
    { name: 'Algorithms', category: 'concept' }, { name: 'System Design', category: 'concept' },
    { name: 'OOP', category: 'concept' }, { name: 'Unit Testing', category: 'concept' },
  ],
  experience: [{
    company: 'Nexpay', role: 'Backend Intern', startDate: '2025-05-01', period: 'May 2025 – Jul 2025',
    highlights: [
      'Cut payment-webhook p95 latency 68% (840ms to 270ms) by batching database writes.',
      'Implemented idempotency keys that removed 100% of duplicate charges across 50000 events.',
      'Wrote 40 integration tests, lifting service coverage from 41% to 78%.',
    ],
  }],
  projects: [{
    title: 'CampusHire', tech: ['React', 'Java', 'SQL'], startDate: '2025-01-01',
    highlights: [
      'Built an eligibility engine filtering 1200 student records in under 200ms.',
      'Reduced resume-upload failures 34% by moving parsing to a retrying background queue.',
    ],
  }],
  achievements: [{ title: 'Smart India Hackathon Finalist', issuer: 'Govt. of India' }],
};

const WEAK_RESUME = {
  basics: { fullName: 'Test User' },
  summary: '',
  skills: [{ name: 'HTML', category: 'language' }],
  projects: [{ title: 'Project', highlights: ['Responsible for working on the frontend part of the website'] }],
};

console.log('\nATS scoring');
{
  const strong = scoreResume(STRONG_RESUME, { targetRole: 'software engineer' });
  const weak = scoreResume(WEAK_RESUME, { targetRole: 'software engineer' });

  check('strong resume scores >= 70', strong.score >= 70, `got ${strong.score}`);
  check('weak resume scores < 45', weak.score < 45, `got ${weak.score}`);
  check('strong beats weak', strong.score > weak.score, `${strong.score} vs ${weak.score}`);
  check('score is bounded 0-100', strong.score <= 100 && weak.score >= 0);
  check('breakdown weights total 100', strong.breakdown.reduce((s, b) => s + b.max, 0) === 100);
  check('matched keywords found', strong.matchedKeywords.length > 0, `${strong.matchedKeywords.length} matched`);
  check('weak resume gets fix list', weak.topFixes.length > 0);
  check('band label present', Boolean(strong.band?.label), strong.band?.label);
  check('empty resume does not throw', scoreResume({}).score >= 0);
  check('JD keywords widen the universe',
    scoreResume(STRONG_RESUME, { targetRole: 'software engineer', jobDescription: 'We need Kubernetes and GraphQL experience with Kafka streaming pipelines.' }).keywordUniverse
      > strong.keywordUniverse);
  console.log(`       strong=${strong.score} (${strong.band.label})  weak=${weak.score} (${weak.band.label})`);
}

console.log('\nEmail validation');
{
  const cases = [
    ['aarav@gmail.com', true], ['first.last+tag@klu.ac.in', true],
    ['no-at-sign', false], ['a@b', false], ['double..dot@gmail.com', false],
    ['has space@gmail.com', false], ['user@mailinator.com', false],
    ['user@gmial.com', false], ['', false],
  ];
  for (const [input, expected] of cases) {
    // MX lookups are skipped here; shape/disposable/typo rules run regardless.
    const res = await validateEmail(input);
    check(`${input || '(empty)'} → ${expected ? 'valid' : 'rejected'}`,
      expected ? res.ok || res.reason?.includes('not accepting mail') : !res.ok,
      res.reason);
  }
  const typo = await validateEmail('user@gmial.com');
  check('typo offers a suggestion', typo.suggestion === 'user@gmail.com', typo.suggestion);
}

console.log('\nResume builder');
{
  const profile = {
    user: { name: 'A', email: 'a@b.com', about: 'x', headline: 'h', phone: null, location: null },
    links: [{ platform: 'github', url: 'https://github.com/a' }],
    education: [], skills: [], projects: [], experience: [], achievements: [], coding: [],
  };
  const data = buildResumeData(profile);
  check('builds without throwing', Boolean(data.basics));
  check('github link carried through', data.basics.github === 'https://github.com/a');
  const pruned = pruneEmpty(data);
  check('empty sections pruned', !('projects' in pruned) && !('skills' in pruned));
  check('twenty-one templates registered', TEMPLATE_IDS.length === 21, TEMPLATE_IDS.join(','));
  check('template ids are unique', new Set(TEMPLATE_IDS).size === TEMPLATE_IDS.length);
  check('penalties only on design-first templates',
    TEMPLATES.every((t) => (t.atsPenalty > 0) === (t.atsSafe === 'medium')));
  check('single-column templates still dominate the library',
    TEMPLATES.filter((t) => t.layout === 'single').length >= 10);
  check('accent presets are valid 6-digit hex',
    ACCENT_PRESETS.length >= 6 && ACCENT_PRESETS.every((a) => /^#[0-9a-f]{6}$/.test(a.value)));
  check('accent normaliser rejects anything but hex',
    normaliseAccent('#4f46e5') === '#4f46e5' &&
    normaliseAccent('red') === null &&
    normaliseAccent('javascript:alert(1)') === null &&
    normaliseAccent('#fff') === null);
}

console.log('\nTemplate ATS penalties');
{
  const base = scoreResume(STRONG_RESUME, { targetRole: 'software engineer', template: 'ats-classic' });
  const baseParse = base.breakdown.find((b) => b.key === 'parse').score;

  // The advertised figure is a *maximum*: parseability is worth 10 points and
  // cannot go below zero, so a resume that has already lost points there (for
  // emoji, missing dates) cannot lose them a second time.
  for (const t of TEMPLATES.filter((x) => x.atsPenalty > 0)) {
    const scored = scoreResume(STRONG_RESUME, { targetRole: 'software engineer', template: t.id });
    const drop = base.score - scored.score;
    const expected = Math.min(t.atsPenalty, baseParse);
    check(`${t.id} costs up to the ${t.atsPenalty} points it advertises`,
      drop === expected, `dropped ${drop}, expected ${expected} (parseability started at ${baseParse})`);
  }
  check('no template can drive parseability below zero',
    TEMPLATES.filter((x) => x.atsPenalty > 0).every((t) =>
      scoreResume(STRONG_RESUME, { targetRole: 'software engineer', template: t.id })
        .breakdown.find((b) => b.key === 'parse').score >= 0));
  const minimal = scoreResume(STRONG_RESUME, { targetRole: 'software engineer', template: 'ats-minimal' });
  check('a safest-parse template costs nothing', minimal.score === base.score, `${base.score} vs ${minimal.score}`);
}


console.log('\nRisky-glyph detection');
{
  // Only the parseability dimension moves, so compare it directly rather than
  // the total, which also swings on keyword coverage.
  const parse = (text) => scoreResume(
    { ...STRONG_RESUME, summary: text },
    { targetRole: 'software engineer', template: 'ats-classic' }
  ).breakdown.find((b) => b.key === 'parse');

  const clean = parse('Backend engineer who shipped three production services.').score;

  // Typography a human would actually use. Every mainstream parser reads these,
  // so flagging them would only push students toward uglier resumes.
  for (const [label, text] of [
    ['em dash', 'MediQueue \u2014 an OPD platform serving 3,000 bookings a day.'],
    ['en dash', 'Interned May 2025 \u2013 Jul 2025 on the payments team.'],
    ['middot', 'Final-year CSE \u00B7 Backend Developer \u00B7 380 problems solved.'],
    ['ampersand', 'Built reporting & alerting for a payments team.'],
  ]) {
    const got = parse(text);
    check(label + ' is not penalised', got.score === clean,
      'parseability fell to ' + got.score + ' from ' + clean);
  }

  // Characters that genuinely scramble an extracted-text parse.
  for (const [label, text] of [
    ['bullet glyph', '\u2022 Built a slot-allocation engine handling 3,000 bookings.'],
    ['black circle', '\u25CF Led a team of four across two releases.'],
    ['arrow', 'Cut webhook latency 910ms \u2192 340ms by batching writes.'],
    ['emoji', 'Shipped it to production \u{1F680} in under six weeks.'],
    ['icon-font glyph', 'Contact \uE0A1 priya@kluniversity.in for details.'],
  ]) {
    const got = parse(text);
    check(label + ' is penalised', got.score < clean, 'parseability stayed at ' + got.score);
    check(label + ' explains itself', got.tips.some((t) => /emoji|arrow|bullet/i.test(t)));
  }
}

console.log('\nHandle normalisation');
{
  check('leetcode URL → handle', normaliseHandle('leetcode', 'https://leetcode.com/u/aarav_codes/') === 'aarav_codes');
  check('github URL → handle', normaliseHandle('github', 'github.com/aaravsharma') === 'aaravsharma');
  check('bare handle unchanged', normaliseHandle('leetcode', 'aarav_codes') === 'aarav_codes');
  check('empty → empty', normaliseHandle('github', '') === '');
  check('no linked platforms → null strength', codingStrength([]) === null);
  check('linked platform → numeric strength',
    typeof codingStrength([{ platform: 'leetcode', status: 'ok', solved_total: 400, medium: 200, hard: 50, contest_rating: 1800 }]) === 'number');
}

console.log('\nJob matching');
{
  const alert = { roles: ['Software Engineer'], skills: ['Java', 'SQL'], locations: ['Hyderabad'], work_modes: [], job_types: [] };
  const good = { id: 1, title: 'Software Engineer', company: 'X', location: 'Hyderabad', work_mode: 'onsite', job_type: 'full-time', skills: JSON.stringify(['Java', 'SQL', 'Git']), posted_at: new Date() };
  const poor = { id: 2, title: 'Graphic Designer', company: 'Y', location: 'Delhi', work_mode: 'onsite', job_type: 'full-time', skills: JSON.stringify(['Photoshop', 'Figma']), posted_at: new Date() };
  const a = matchScore(good, alert);
  const b = matchScore(poor, alert);
  check('relevant job scores higher', a > b, `${a} vs ${b}`);
  check('scores bounded', a <= 100 && b >= 0);
}

console.log('\nLeetCode live fetch (network)');
{
  try {
    const res = await fetchLeetCode('leetcode');
    check('returns a known status', ['ok', 'not_found', 'error'].includes(res.status), res.status);
    if (res.status === 'ok') console.log(`       solved=${res.solved_total} rank=${res.global_rank}`);

    const missing = await fetchLeetCode('zzz-definitely-not-a-real-user-9182736');
    check('unknown handle → not_found or error', ['not_found', 'error'].includes(missing.status), missing.status);
    check('empty handle → unlinked', (await fetchLeetCode('')).status === 'unlinked');
  } catch (err) {
    console.log(`  skip network checks — ${err.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
