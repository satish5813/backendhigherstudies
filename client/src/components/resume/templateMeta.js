/**
 * How a template's parse-safety is presented. Kept in one place so the resume
 * list and the builder's Design panel can never drift apart and start making
 * different promises about the same template.
 */
export const ATS_LEVELS = {
  highest: {
    label: 'Safest parse',
    tone: 'emerald',
    note: 'Single column, no colour fills, standard headings.',
  },
  high: {
    label: 'ATS safe',
    tone: 'sky',
    note: 'Single column with rules or an accent colour. Parses cleanly.',
  },
  medium: {
    label: 'Design-first',
    tone: 'amber',
    note: 'Looks striking, but costs points on the ATS score. Best when a human screens first.',
  },
};

export const atsLevel = (template) => ATS_LEVELS[template?.atsSafe] ?? ATS_LEVELS.high;
