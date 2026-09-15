/**
 * Turns the stored profile into the flat shape the resume renderer and the ATS
 * scorer both consume. Anything the student has not filled in is simply absent
 * — empty sections never reach the document.
 */

const monthYear = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 7 ? `${d}-01` : d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/**
 * The template library.
 *
 * `atsSafe` is a promise to the student, so it is graded honestly:
 *   highest - single column, no colour fills, standard headings
 *   high    - single column with rules or an accent colour
 *   medium  - visual devices a strict parser can stumble on (colour bands,
 *             two columns). `atsPenalty` is subtracted from the parseability
 *             dimension, so choosing one visibly lowers the score rather than
 *             quietly costing the student interviews.
 *
 * `layout` selects the renderer variant in client/src/components/resume/ResumeDocument.jsx.
 */
export const TEMPLATES = [
  {
    id: 'ats-classic',
    name: 'ATS Classic',
    blurb: 'Single column, no graphics, standard headings. The safest possible parse.',
    atsSafe: 'highest',
    atsPenalty: 0,
    layout: 'single',
    accent: '#0f172a',
  },
  {
    id: 'ats-compact',
    name: 'ATS Compact',
    blurb: 'Tightened spacing to fit a dense fresher profile on one page.',
    atsSafe: 'highest',
    atsPenalty: 0,
    layout: 'single',
    accent: '#1e293b',
  },
  {
    id: 'ats-minimal',
    name: 'Minimal',
    blurb: 'No rules, no colour, generous whitespace. Quietly confident and trivially parseable.',
    atsSafe: 'highest',
    atsPenalty: 0,
    layout: 'single',
    accent: '#111827',
  },
  {
    id: 'ats-modern',
    name: 'ATS Modern',
    blurb: 'Subtle rules and a coloured name block — still a clean single column.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#4f46e5',
  },
  {
    id: 'ats-technical',
    name: 'ATS Technical',
    blurb: 'Skills matrix up top, projects before education. Built for SDE roles.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#0ea5e9',
  },
  {
    id: 'ats-academic',
    name: 'ATS Academic',
    blurb: 'Education and publications lead. For higher-study and research applications.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#0d9488',
  },
  {
    id: 'ats-elegant',
    name: 'Elegant Serif',
    blurb: 'Centred serif header with letter-spaced headings. Reads as considered, not decorated.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#1f2937',
  },
  {
    id: 'ats-timeline',
    name: 'Timeline',
    blurb: 'Dates in a left gutter so your history reads at a glance. Single column underneath.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'timeline',
    accent: '#0f766e',
  },
  {
    id: 'ats-executive',
    name: 'Executive',
    blurb: 'Navy rules and a wider name block. Built for internships at larger firms.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#1e3a8a',
  },
  {
    id: 'ats-banner',
    name: 'Banner',
    blurb: 'Full-width coloured header with your name reversed out, then a clean single column.',
    atsSafe: 'medium',
    atsPenalty: 2,
    layout: 'banner',
    accent: '#4338ca',
  },
  {
    id: 'ats-sidebar',
    name: 'Sidebar',
    blurb: 'Two columns: skills and education beside your experience. Striking, but the riskiest parse.',
    atsSafe: 'medium',
    atsPenalty: 4,
    layout: 'sidebar',
    accent: '#0f766e',
  },
  {
    id: 'ats-crimson',
    name: 'Crimson',
    blurb: 'Deep red rules on a tight single column. Formal without being stiff.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#b91c1c',
  },
  {
    id: 'ats-slate',
    name: 'Slate Sidebar',
    blurb: 'The two-column layout in cool slate, with a heavier divider.',
    atsSafe: 'medium',
    atsPenalty: 4,
    layout: 'sidebar',
    accent: '#334155',
  },
  {
    id: 'ats-azure',
    name: 'Azure Banner',
    blurb: 'A deep blue header band over a compact single column.',
    atsSafe: 'medium',
    atsPenalty: 2,
    layout: 'banner',
    accent: '#1d4ed8',
  },
  {
    id: 'ats-amber',
    name: 'Amber Timeline',
    blurb: 'Dated left rail in warm bronze. Good when your history is the story.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'timeline',
    accent: '#92400e',
  },
  {
    id: 'ats-plum',
    name: 'Plum Serif',
    blurb: 'Serif throughout with a plum accent and centred name.',
    atsSafe: 'high',
    atsPenalty: 0,
    layout: 'single',
    accent: '#6d28d9',
  },

  /* ---------------------------------------------------------------------
   * Design-first family. These carry a photo and heavy colour, which is what
   * campus drives and referrals respond to — and exactly what a strict parser
   * struggles with. Graded honestly: `photo: true` adds a further penalty on
   * top of the layout's own, because an image is the single thing most likely
   * to make an ATS drop the block around it. Parseability is worth 10 points in
   * total, so 10 is the largest penalty that can honestly be advertised.
   * ------------------------------------------------------------------- */
  {
    id: 'modern-portrait',
    name: 'Modern Portrait',
    blurb: 'Photo beside a bold colour header, then a clean single column.',
    atsSafe: 'medium',
    atsPenalty: 6,
    layout: 'photo-header',
    photo: true,
    accent: '#4338ca',
  },
  {
    id: 'modern-profile',
    name: 'Profile Card',
    blurb: 'Circular photo, centred name and a tinted contact strip.',
    atsSafe: 'medium',
    atsPenalty: 6,
    layout: 'photo-header',
    photo: true,
    accent: '#0f766e',
  },
  {
    id: 'modern-aside',
    name: 'Portrait Sidebar',
    blurb: 'Photo, contact and skills in a coloured left rail. The most designed option.',
    atsSafe: 'medium',
    atsPenalty: 10,
    layout: 'photo-sidebar',
    photo: true,
    accent: '#1e3a8a',
  },
  {
    id: 'modern-slate-aside',
    name: 'Slate Portrait',
    blurb: 'The portrait sidebar in dark slate. Strong on screen, heavy in print.',
    atsSafe: 'medium',
    atsPenalty: 10,
    layout: 'photo-sidebar',
    photo: true,
    accent: '#334155',
  },
  {
    id: 'modern-coral',
    name: 'Coral Header',
    blurb: 'Warm full-width header with your photo and headline reversed out.',
    atsSafe: 'medium',
    atsPenalty: 6,
    layout: 'photo-header',
    photo: true,
    accent: '#be123c',
  },
];

/** Templates that render a profile photo, so the UI can prompt for one. */
export const PHOTO_TEMPLATES = TEMPLATES.filter((t) => t.photo).map((t) => t.id);

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/**
 * Accent presets offered in the Design panel. Any template can take any accent,
 * which is why there is no "Navy Classic" and "Crimson Classic" cluttering the
 * gallery — colour is a property, not a template.
 *
 * Every value is dark enough to stay legible on white when printed in greyscale.
 */
export const ACCENT_PRESETS = [
  { name: 'Ink', value: '#111827' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Sky', value: '#0369a1' },
  { name: 'Crimson', value: '#b91c1c' },
  { name: 'Plum', value: '#6d28d9' },
  { name: 'Bronze', value: '#92400e' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Accepts only a 6-digit hex, so nothing arbitrary reaches an inline style. */
export function normaliseAccent(value) {
  if (!value) return null;
  const v = String(value).trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

export function buildResumeData(profile, { targetRole } = {}) {
  const u = profile.user;
  const linkOf = (p) => profile.links.find((l) => l.platform === p)?.url || null;

  return {
    basics: {
      fullName: u.name || '',
      // Only the design-first templates draw this; the rest ignore it.
      photo: u.avatar_url || null,
      headline: u.headline || targetRole || '',
      email: u.email,
      phone: u.phone || '',
      location: u.location || '',
      linkedin: linkOf('linkedin'),
      github: linkOf('github'),
      leetcode: linkOf('leetcode'),
      portfolio: linkOf('portfolio'),
    },

    summary: u.about || '',

    education: (profile.education || []).map((e) => ({
      institution: e.institution,
      degree: [e.degree, e.branch].filter(Boolean).join(', '),
      location: e.location || '',
      startYear: e.start_year,
      endYear: e.end_year,
      score: e.score == null ? null : Number(e.score),
      scoreType: e.score_type,
    })),

    skills: (profile.skills || []).map((s) => ({
      name: s.name,
      category: s.category,
      proficiency: s.proficiency,
    })),

    experience: (profile.experience || []).map((x) => ({
      company: x.company,
      role: x.role,
      type: x.type,
      location: x.location || '',
      startDate: x.start_date,
      endDate: x.end_date,
      current: x.is_current,
      period: x.is_current
        ? `${monthYear(x.start_date)} – Present`
        : [monthYear(x.start_date), monthYear(x.end_date)].filter(Boolean).join(' – '),
      description: x.description || '',
      highlights: x.highlights || [],
    })),

    projects: (profile.projects || []).map((p) => ({
      title: p.title,
      role: p.role || '',
      description: p.description || '',
      tech: p.tech || [],
      highlights: p.highlights || [],
      repoUrl: p.repo_url,
      liveUrl: p.live_url,
      startDate: p.start_date,
      endDate: p.end_date,
      period: [monthYear(p.start_date), monthYear(p.end_date)].filter(Boolean).join(' – '),
      featured: p.featured,
    })),

    achievements: (profile.achievements || []).map((a) => ({
      title: a.title,
      issuer: a.issuer || '',
      category: a.category,
      date: a.date,
      dateLabel: monthYear(a.date),
      description: a.description || '',
      url: a.url,
    })),

    coding: (profile.coding || [])
      .filter((c) => c.status === 'ok')
      .map((c) => ({
        platform: c.platform,
        username: c.username,
        solved: c.solved_total,
        rating: c.contest_rating,
        rank: c.global_rank,
        url: c.profileUrl,
      })),

    meta: {
      generatedAt: new Date().toISOString(),
      targetRole: targetRole || null,
      sectionOrder: ['summary', 'education', 'skills', 'experience', 'projects', 'achievements', 'coding'],
    },
  };
}

/** Guards against a section that is present but entirely blank. */
export function pruneEmpty(data) {
  const out = { ...data };
  for (const key of ['education', 'skills', 'experience', 'projects', 'achievements', 'coding']) {
    if (Array.isArray(out[key]) && out[key].length === 0) delete out[key];
  }
  if (!out.summary?.trim()) delete out.summary;
  return out;
}
