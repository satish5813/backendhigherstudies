import { useMemo } from 'react';
import ResumeDocument from './ResumeDocument';
import { Badge } from '../ui';
import { IconCheck } from '../ui/Icons';
import { atsLevel } from './templateMeta';

const PAGE_W = 794;
const PAGE_H = 1123;

/**
 * Every template drawn as a real miniature of the actual document.
 *
 * A picker that lists only names and blurbs is useless — you cannot choose a
 * design you have never seen. These are genuine <ResumeDocument> renders at
 * ~22% scale using the student's own content, so what you click is what you get.
 */
export default function TemplateGallery({
  templates,
  value,
  onChange,
  data,
  accent,
  columns = 'sm:grid-cols-2 lg:grid-cols-3',
  thumbWidth = 176,
}) {
  // Real content if the student has any, otherwise enough sample text that the
  // layouts are distinguishable rather than a row of empty pages.
  const preview = useMemo(() => (hasContent(data) ? data : SAMPLE), [data]);
  const scale = thumbWidth / PAGE_W;

  return (
    <div className={`grid gap-4 ${columns}`}>
      {templates.map((t) => {
        const level = atsLevel(t);
        const selected = value === t.id;

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={selected}
            className={`group overflow-hidden rounded-xl border text-left transition ${
              selected
                ? 'border-brand-500 ring-2 ring-brand-500/25'
                : 'border-ink-200 hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lift'
            }`}
          >
            {/* --------------------------------------------------- thumbnail */}
            <div className="relative flex justify-center overflow-hidden bg-ink-100 p-3">
              <div
                className="relative overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-ink-900/10"
                style={{ width: thumbWidth, height: Math.round(PAGE_H * scale) }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    width: PAGE_W,
                    pointerEvents: 'none',
                  }}
                >
                  <ResumeDocument
                    data={preview}
                    template={t.id}
                    accent={accent}
                  />
                </div>
                {/* fade the cut-off bottom so it reads as a crop, not a bug */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
              </div>

              {selected && (
                <span className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white shadow">
                  <IconCheck size={14} />
                </span>
              )}
            </div>

            {/* ------------------------------------------------------- label */}
            <div className="border-t border-ink-100 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold text-ink-900">{t.name}</span>
                <Badge tone={level.tone}>{level.label}</Badge>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{t.blurb}</p>
              {t.atsPenalty > 0 && (
                <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
                  Costs up to {t.atsPenalty} ATS point{t.atsPenalty === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function hasContent(data) {
  if (!data) return false;
  return Boolean(
    data.summary ||
      data.experience?.length ||
      data.projects?.length ||
      data.education?.length ||
      data.skills?.length
  );
}

/** Only used when the student has nothing yet — keeps thumbnails meaningful. */
const SAMPLE = {
  basics: {
    fullName: 'Your Name',
    headline: 'Final-year CSE · Software Engineer',
    email: 'you@college.edu',
    phone: '+91 90000 00000',
    location: 'Hyderabad',
    github: 'https://github.com/you',
    linkedin: 'https://linkedin.com/in/you',
  },
  summary:
    'Final-year Computer Science student focused on backend engineering. Shipped three production applications and solved 400+ problems on LeetCode. Looking for an SDE role where I can own services end to end.',
  education: [
    { institution: 'KL University', degree: 'B.Tech, Computer Science', startYear: 2022, endYear: 2026, score: 8.7, scoreType: 'cgpa' },
    { institution: 'Narayana Junior College', degree: 'MPC', startYear: 2020, endYear: 2022, score: 95.2, scoreType: 'percentage' },
  ],
  skills: [
    { name: 'Java', category: 'language' }, { name: 'Python', category: 'language' },
    { name: 'React', category: 'framework' }, { name: 'Node.js', category: 'framework' },
    { name: 'MySQL', category: 'database' }, { name: 'Redis', category: 'database' },
    { name: 'Docker', category: 'tool' }, { name: 'Git', category: 'tool' },
    { name: 'AWS', category: 'cloud' },
    { name: 'Data Structures', category: 'concept' }, { name: 'Algorithms', category: 'concept' },
    { name: 'REST API', category: 'concept' },
  ],
  experience: [
    {
      company: 'Nexpay Technologies', role: 'Backend Engineering Intern', type: 'internship',
      location: 'Hyderabad', period: 'May 2025 – Jul 2025',
      description: 'Six-week internship on the payments reliability team.',
      highlights: [
        'Cut payment-webhook p95 latency 68% (840ms to 270ms) by batching writes.',
        'Removed duplicate charges across 50,000 monthly events with idempotency keys.',
      ],
    },
  ],
  projects: [
    {
      title: 'CampusHire', tech: ['React', 'Node.js', 'MySQL'], period: 'Jan 2025 – Jun 2025',
      description: 'A placement portal used by 1,200 students to track drives.',
      highlights: [
        'Built an eligibility engine filtering 1,200 records in under 200ms.',
        'Reduced upload failures 34% with a retrying background queue.',
      ],
    },
    {
      title: 'PayFlow', tech: ['Node.js', 'Redis', 'AWS'], period: 'Aug 2024 – Dec 2024',
      description: 'A reliable webhook receiver for payment events.',
      highlights: ['Raised successful delivery to 99.97% with exponential-backoff replay.'],
    },
  ],
  achievements: [
    { title: 'Smart India Hackathon — National Finalist', issuer: 'Govt. of India', dateLabel: 'Mar 2025' },
    { title: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', dateLabel: 'Nov 2024' },
  ],
  coding: [{ platform: 'leetcode', username: 'you', solved: 420, rating: 1780 }],
};

export { SAMPLE as SAMPLE_RESUME };
