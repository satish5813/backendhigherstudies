/**
 * Reads an uploaded resume (PDF / DOCX / TXT) and pulls out what can be
 * extracted *reliably*.
 *
 * Free-form resume parsing is not a solved problem — every student writes
 * headings, dates and bullets differently, and a parser that guesses produces
 * confident nonsense. So this deliberately only returns things with an
 * unambiguous shape: contact details (regex), skills (matched against a known
 * vocabulary, never invented), section headings that are actually present, and
 * the raw text so the ATS scorer can run over the real document.
 *
 * Everything it returns is offered to the student as a suggestion to accept,
 * never written to their profile automatically.
 */
import { createRequire } from 'node:module';
import { ROLE_KEYWORDS } from './atsScore.js';

const require = createRequire(import.meta.url);

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ACCEPTED = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

/* ------------------------------------------------------------- extraction */

export async function extractText(buffer, mimeType, filename = '') {
  const kind = ACCEPTED[mimeType] ?? guessFromName(filename);
  if (!kind) {
    return { ok: false, error: 'Upload a PDF, a Word .docx file, or plain text.' };
  }

  try {
    if (kind === 'txt') return { ok: true, kind, text: buffer.toString('utf8') };

    if (kind === 'pdf') {
      // pdf-parse's index runs a debug harness on import; require the lib directly.
      const pdf = require('pdf-parse/lib/pdf-parse.js');
      const parsed = await pdf(buffer);
      return {
        ok: true, kind,
        text: parsed.text || '',
        pages: parsed.numpages,
        producer: parsed.info?.Producer || parsed.info?.Creator || '',
      };
    }

    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return { ok: true, kind, text: value || '' };
  } catch (err) {
    return { ok: false, error: `Could not read that file: ${err.message}` };
  }
}

function guessFromName(filename) {
  const ext = String(filename).toLowerCase().split('.').pop();
  return { pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'txt' }[ext] ?? null;
}

/* --------------------------------------------------------------- parsing */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){9,12}\d/;
const URL_RE = {
  linkedin: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9._-]+/i,
  github: /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9._-]+/i,
  leetcode: /(?:https?:\/\/)?(?:www\.)?leetcode\.com\/(?:u\/)?[A-Za-z0-9._-]+/i,
};

const SECTION_WORDS = {
  summary: ['summary', 'objective', 'profile', 'about'],
  education: ['education', 'academics', 'academic'],
  skills: ['skills', 'technical skills', 'technologies'],
  experience: ['experience', 'employment', 'internship', 'internships', 'work history'],
  projects: ['projects', 'project work'],
  achievements: ['achievements', 'certifications', 'awards', 'accomplishments'],
};

/** Every skill the app knows about, so nothing is invented from thin air. */
const SKILL_VOCABULARY = [
  ...new Set([
    ...Object.values(ROLE_KEYWORDS).flat(),
    'javascript', 'typescript', 'java', 'python', 'c', 'c++', 'c#', 'go', 'rust', 'kotlin', 'swift', 'php', 'ruby', 'r',
    'react', 'angular', 'vue', 'next.js', 'node.js', 'express', 'django', 'flask', 'spring boot', 'fastapi', '.net',
    'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'oracle', 'firebase', 'dynamodb',
    'docker', 'kubernetes', 'git', 'github', 'gitlab', 'jenkins', 'terraform', 'ansible', 'linux', 'bash', 'nginx',
    'aws', 'azure', 'gcp', 'heroku', 'vercel',
    'html', 'css', 'tailwind', 'bootstrap', 'sass', 'figma',
    'pandas', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'keras', 'opencv', 'matplotlib',
    'power bi', 'tableau', 'excel', 'jira', 'postman', 'selenium', 'cypress', 'junit', 'pytest',
    'data structures', 'algorithms', 'oop', 'rest api', 'graphql', 'microservices', 'system design',
    'machine learning', 'deep learning', 'nlp', 'computer vision', 'unit testing', 'ci/cd', 'agile',
  ]),
];

/**
 * @returns {{
 *   text: string, wordCount: number,
 *   basics: object, skills: string[], sectionsFound: string[], sectionsMissing: string[],
 *   confidence: object
 * }}
 */
export function parseResumeText(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const lower = text.toLowerCase();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  /* -- contact: regex-reliable ------------------------------------------- */
  const email = text.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;

  // Phone: only accept it once stripped to 10-13 digits, so years and IDs
  // scattered through the document do not masquerade as a number.
  let phone = null;
  for (const candidate of text.match(new RegExp(PHONE_RE, 'g')) ?? []) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) { phone = candidate.trim(); break; }
  }

  const links = {};
  for (const [key, re] of Object.entries(URL_RE)) {
    const hit = text.match(re)?.[0];
    if (hit) links[key] = hit.startsWith('http') ? hit : `https://${hit}`;
  }

  /* -- name: the first line that looks like a person, not a heading ------ */
  let fullName = null;
  for (const line of lines.slice(0, 6)) {
    if (line.length > 42 || EMAIL_RE.test(line) || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (Object.values(SECTION_WORDS).flat().some((w) => line.toLowerCase().includes(w))) continue;
    fullName = line.replace(/[^\p{L}\s.'-]/gu, '').trim();
    break;
  }

  /* -- skills: matched against the vocabulary, never invented ------------ */
  const skills = SKILL_VOCABULARY.filter((skill) => {
    const needle = skill.toLowerCase();
    // word-boundary match so "c" does not fire on every word containing it
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(needle)}([^a-z0-9+#.]|$)`, 'i');
    return re.test(lower);
  }).map(titleCaseSkill);

  /* -- which sections the document actually has -------------------------- */
  const sectionsFound = [];
  for (const [section, words] of Object.entries(SECTION_WORDS)) {
    const present = lines.some((line) => {
      const l = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();
      return l.length <= 34 && words.some((w) => l === w || l.startsWith(`${w} `) || l.endsWith(` ${w}`));
    });
    if (present) sectionsFound.push(section);
  }
  const sectionsMissing = Object.keys(SECTION_WORDS).filter((s) => !sectionsFound.includes(s));

  const wordCount = (text.match(/\S+/g) || []).length;

  return {
    text,
    wordCount,
    basics: { fullName, email, phone, ...links },
    skills,
    sectionsFound,
    sectionsMissing,
    confidence: {
      // honest about what is a guess and what is not
      email: email ? 'high' : 'none',
      phone: phone ? 'medium' : 'none',
      fullName: fullName ? 'medium' : 'none',
      skills: skills.length ? 'high' : 'none',
    },
  };
}

/**
 * Turns the parsed upload into the shape the ATS scorer reads, so an uploaded
 * PDF gets the same eight-dimension score as one built here.
 *
 * Bullets are every line that starts like a bullet — that is a genuine
 * structural signal, unlike trying to guess which company each one belongs to.
 */
export function uploadToScorable(parsed) {
  const bulletLines = parsed.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•●▪*·o]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^[-•●▪*·o]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((l) => l.length > 12);

  const summaryLines = parsed.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 60 && !/^[-•●▪*·]/.test(l));

  return {
    basics: {
      fullName: parsed.basics.fullName || '',
      email: parsed.basics.email || '',
      phone: parsed.basics.phone || '',
      // location cannot be extracted reliably; left blank so the scorer
      // correctly reports it as missing rather than inventing one
      location: '',
      linkedin: parsed.basics.linkedin || null,
      github: parsed.basics.github || null,
    },
    summary: summaryLines[0] || '',
    education: parsed.sectionsFound.includes('education') ? [{ institution: 'Detected in document', endYear: null }] : [],
    skills: parsed.skills.map((name) => ({ name, category: 'other' })),
    experience: [],
    // Bullets are attached to a single synthetic project so the impact and
    // bullet-quality dimensions score the real lines from the document.
    projects: bulletLines.length
      ? [{ title: 'Detected in document', highlights: bulletLines.slice(0, 20), tech: [] }]
      : [],
    achievements: [],
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function titleCaseSkill(skill) {
  const special = {
    'rest api': 'REST API', 'ci/cd': 'CI/CD', oop: 'OOP', sql: 'SQL', aws: 'AWS',
    gcp: 'GCP', nlp: 'NLP', html: 'HTML', css: 'CSS', 'c++': 'C++', 'c#': 'C#',
    'node.js': 'Node.js', 'next.js': 'Next.js', 'scikit-learn': 'scikit-learn',
    'power bi': 'Power BI', mysql: 'MySQL', postgresql: 'PostgreSQL', mongodb: 'MongoDB',
    javascript: 'JavaScript', typescript: 'TypeScript', '.net': '.NET', graphql: 'GraphQL',
  };
  if (special[skill]) return special[skill];
  return skill.replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}
