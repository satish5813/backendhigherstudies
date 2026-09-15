/**
 * One generic CRUD surface for every repeatable profile section
 * (education, skills, projects, experience, achievements).
 *
 * Each section declares its table, its zod schema and which columns hold JSON.
 * Adding a new section means adding one entry here — no new routes.
 */
import { z } from 'zod';

const yearField = z.coerce.number().int().min(1950).max(2100).nullish();
const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM or YYYY-MM-DD')
  .transform((v) => (v.length === 7 ? `${v}-01` : v))
  .nullish()
  .or(z.literal('').transform(() => null));

const strList = z.array(z.string().trim().min(1).max(120)).max(40).default([]);

export const SECTIONS = {
  education: {
    table: 'educations',
    json: [],
    order: 'end_year DESC, sort_order ASC, id DESC',
    schema: z.object({
      level: z.enum(['ug', 'pg', 'intermediate', 'diploma', 'ssc', 'other']).default('ug'),
      institution: z.string().trim().min(2, 'Institution name is required').max(180),
      degree: z.string().trim().max(120).nullish(),
      branch: z.string().trim().max(120).nullish(),
      start_year: yearField,
      end_year: yearField,
      score: z.coerce.number().min(0).max(100).nullish(),
      score_type: z.enum(['cgpa', 'percentage']).default('cgpa'),
      location: z.string().trim().max(120).nullish(),
      sort_order: z.coerce.number().int().default(0),
    }),
  },

  skills: {
    table: 'skills',
    json: [],
    order: 'category ASC, proficiency DESC, sort_order ASC',
    schema: z.object({
      name: z.string().trim().min(1, 'Skill name is required').max(80),
      category: z
        .enum(['language', 'framework', 'database', 'tool', 'cloud', 'concept', 'soft', 'other'])
        .default('other'),
      proficiency: z.coerce.number().int().min(1).max(5).default(3),
      sort_order: z.coerce.number().int().default(0),
    }),
  },

  projects: {
    table: 'projects',
    json: ['tech', 'highlights'],
    order: 'featured DESC, sort_order ASC, id DESC',
    schema: z.object({
      title: z.string().trim().min(2, 'Project title is required').max(180),
      role: z.string().trim().max(120).nullish(),
      description: z.string().trim().max(2000).nullish(),
      tech: strList,
      highlights: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
      repo_url: z.string().trim().url('Enter a valid repository URL').max(400).nullish().or(z.literal('').transform(() => null)),
      live_url: z.string().trim().url('Enter a valid live URL').max(400).nullish().or(z.literal('').transform(() => null)),
      start_date: dateField,
      end_date: dateField,
      featured: z.coerce.boolean().default(false),
      sort_order: z.coerce.number().int().default(0),
    }),
  },

  experience: {
    table: 'experiences',
    json: ['highlights'],
    order: 'is_current DESC, start_date DESC, sort_order ASC',
    schema: z.object({
      company: z.string().trim().min(2, 'Company name is required').max(180),
      role: z.string().trim().min(2, 'Role is required').max(150),
      type: z.enum(['internship', 'full-time', 'part-time', 'freelance', 'training']).default('internship'),
      location: z.string().trim().max(120).nullish(),
      start_date: dateField,
      end_date: dateField,
      is_current: z.coerce.boolean().default(false),
      description: z.string().trim().max(2000).nullish(),
      highlights: z.array(z.string().trim().min(1).max(400)).max(10).default([]),
      sort_order: z.coerce.number().int().default(0),
    }),
  },

  achievements: {
    table: 'achievements',
    json: [],
    order: 'date DESC, sort_order ASC, id DESC',
    schema: z.object({
      title: z.string().trim().min(2, 'Title is required').max(200),
      issuer: z.string().trim().max(180).nullish(),
      category: z
        .enum(['award', 'certification', 'publication', 'hackathon', 'extracurricular', 'other'])
        .default('award'),
      date: dateField,
      description: z.string().trim().max(1200).nullish(),
      url: z.string().trim().url('Enter a valid URL').max(400).nullish().or(z.literal('').transform(() => null)),
      sort_order: z.coerce.number().int().default(0),
    }),
  },
};

export const SECTION_NAMES = Object.keys(SECTIONS);

/** MySQL rejects `undefined`; normalise everything to null and stringify JSON columns. */
export function toColumns(section, data) {
  const spec = SECTIONS[section];
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (spec.json.includes(key)) out[key] = JSON.stringify(value ?? []);
    else if (typeof value === 'boolean') out[key] = value ? 1 : 0;
    else out[key] = value === '' ? null : value ?? null;
  }
  return out;
}

/** mysql2 hands JSON columns back already parsed on MySQL 8 but as strings on some MariaDB builds. */
export function fromRow(section, row) {
  const spec = SECTIONS[section];
  const out = { ...row };
  for (const key of spec.json) {
    if (typeof out[key] === 'string') {
      try { out[key] = JSON.parse(out[key]); } catch { out[key] = []; }
    }
    if (out[key] == null) out[key] = [];
  }
  if ('is_current' in out) out.is_current = Boolean(out.is_current);
  if ('featured' in out) out.featured = Boolean(out.featured);
  out.id = Number(out.id);
  return out;
}
