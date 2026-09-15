import { execute, query, queryOne } from '../config/db.js';
import { sendMail } from './mailer.js';
import { jobAlertEmail } from '../templates/emails.js';
import { env } from '../config/env.js';

const parse = (v, fallback = []) => {
  if (v == null) return fallback;
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : fallback; } catch { return fallback; }
};

export const hydrateJob = (j) => ({
  ...j,
  id: Number(j.id),
  skills: parse(j.skills),
  // What the model read out of the description: the core CS subjects this
  // posting actually tests, and the experience the body text asks for. These
  // matter more to a campus student than the technology list — DSA and OS are
  // what they revise, React is what they pick up.
  coreSubjects: parse(j.ai_core_subjects),
  yearsRequired: j.ai_years_required == null ? null : Number(j.ai_years_required),
  aiSummary: j.ai_summary ?? null,
  min_ctc: j.min_ctc == null ? null : Number(j.min_ctc),
  max_ctc: j.max_ctc == null ? null : Number(j.max_ctc),
  active: Boolean(j.active),
});

export const hydrateAlert = (a) =>
  a && {
    ...a,
    id: Number(a.id),
    active: Boolean(a.active),
    roles: parse(a.roles),
    skills: parse(a.skills),
    locations: parse(a.locations),
    work_modes: parse(a.work_modes),
    job_types: parse(a.job_types),
    min_ctc: a.min_ctc == null ? null : Number(a.min_ctc),
  };

/**
 * Relevance 0-100. A job with no stated preference to match against still
 * scores on recency, so a brand new alert is not an empty inbox.
 */
export function matchScore(job, alert, profileSkills = []) {
  const j = hydrateJob(job);
  const wanted = new Set([
    ...(alert.skills || []).map((s) => s.toLowerCase()),
    ...profileSkills.map((s) => s.toLowerCase()),
  ]);
  const jobSkills = j.skills.map((s) => s.toLowerCase());

  let score = 0;

  // skills overlap — the heaviest signal
  if (wanted.size && jobSkills.length) {
    const hits = jobSkills.filter((s) => wanted.has(s)).length;
    score += Math.min(hits / Math.min(jobSkills.length, 5), 1) * 45;
  } else {
    score += 15;
  }

  // role title
  const roles = (alert.roles || []).map((r) => r.toLowerCase());
  if (roles.length) {
    const title = j.title.toLowerCase();
    if (roles.some((r) => title.includes(r) || r.includes(title))) score += 25;
    else if (roles.some((r) => r.split(/\s+/).some((w) => w.length > 3 && title.includes(w)))) score += 12;
  } else {
    score += 12;
  }

  // location / work mode
  const locs = (alert.locations || []).map((l) => l.toLowerCase());
  const jobLoc = (j.location || '').toLowerCase();
  if (!locs.length || j.work_mode === 'remote' || locs.some((l) => jobLoc.includes(l))) score += 15;

  const modes = alert.work_modes || [];
  if (!modes.length || modes.includes(j.work_mode)) score += 5;

  const types = alert.job_types || [];
  if (!types.length || types.includes(j.job_type)) score += 5;

  // freshness
  const ageDays = (Date.now() - new Date(j.posted_at).getTime()) / 86400_000;
  score += Math.max(0, 5 - ageDays);

  return Math.round(Math.min(100, score));
}

/**
 * Jobs posted since the last digest that clear the alert's filters.
 * @returns {Promise<Array>} hydrated jobs, each with a `match` field
 */
export async function findMatches(alert, { limit = 8, since = null } = {}) {
  const params = [];
  const where = ['active = 1', "status = 'approved'", '(expires_at IS NULL OR expires_at > NOW())'];

  if (since) { where.push('posted_at > ?'); params.push(since); }
  if (alert.min_ctc != null) { where.push('(min_ctc IS NULL OR min_ctc >= ?)'); params.push(alert.min_ctc); }
  if ((alert.job_types || []).length) {
    where.push(`job_type IN (${alert.job_types.map(() => '?').join(',')})`);
    params.push(...alert.job_types);
  }
  if ((alert.work_modes || []).length) {
    where.push(`work_mode IN (${alert.work_modes.map(() => '?').join(',')})`);
    params.push(...alert.work_modes);
  }

  const rows = await query(
    `SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY posted_at DESC LIMIT 200`,
    params
  );

  const profileSkills = (
    await query(`SELECT name FROM skills WHERE user_id = ?`, [alert.user_id])
  ).map((s) => s.name);

  return rows
    .map((j) => ({ ...hydrateJob(j), match: matchScore(j, alert, profileSkills) }))
    .filter((j) => j.match >= 35)
    .sort((a, b) => b.match - a.match)
    .slice(0, limit);
}

/**
 * Builds and sends one student's digest.
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', count: number, reason?: string}>}
 */
export async function sendDigestFor(userId, { force = false } = {}) {
  const alert = hydrateAlert(await queryOne(`SELECT * FROM job_alerts WHERE user_id = ?`, [userId]));
  if (!alert) return { status: 'skipped', count: 0, reason: 'no alert configured' };
  if (!force && (!alert.active || alert.frequency === 'off'))
    return { status: 'skipped', count: 0, reason: 'alerts are off' };

  const user = await queryOne(`SELECT id, email, name, status FROM users WHERE id = ?`, [userId]);
  if (!user || user.status !== 'active') return { status: 'skipped', count: 0, reason: 'inactive account' };

  // Alerts are gated on the student's best ATS score.
  //
  // Mailing a 40 LPA opening to somebody whose resume scores 31 does them no
  // favours: they apply, get filtered out by the scanner before a human reads
  // it, and learn nothing. Below the floor the digest is replaced by a single
  // nudge to fix the resume, which is the thing actually blocking them.
  const best = await queryOne(
    `SELECT MAX(ats_score) AS score FROM resumes WHERE user_id = ?`, [userId]
  );
  const atsScore = best?.score ?? null;

  if (!force && (atsScore == null || atsScore < env.jobs.alertMinAts)) {
    await execute(
      `INSERT INTO alert_deliveries (user_id, job_ids, job_count, status, error) VALUES (?, ?, 0, 'skipped', ?)`,
      [userId, JSON.stringify([]), atsScore == null ? 'no resume yet' : `ATS ${atsScore} below ${env.jobs.alertMinAts}`]
    );
    return {
      status: 'skipped',
      count: 0,
      atsScore,
      reason: atsScore == null
        ? 'no resume to match against yet'
        : `resume scores ${atsScore}, below the ${env.jobs.alertMinAts} needed for alerts`,
    };
  }

  const since = force ? null : alert.last_sent_at || new Date(Date.now() - 7 * 86400_000);
  const jobs = await findMatches(alert, { limit: 8, since });

  if (!jobs.length) {
    await execute(
      `INSERT INTO alert_deliveries (user_id, job_ids, job_count, status, error) VALUES (?, ?, 0, 'skipped', ?)`,
      [userId, JSON.stringify([]), 'no new matches']
    );
    return { status: 'skipped', count: 0, reason: 'no new matches' };
  }

  const { subject, html } = jobAlertEmail({ name: user.name, jobs });
  const result = await sendMail({ to: user.email, subject, html });

  await execute(
    `INSERT INTO alert_deliveries (user_id, job_ids, job_count, status, error) VALUES (?, ?, ?, ?, ?)`,
    [userId, JSON.stringify(jobs.map((j) => j.id)), jobs.length, result.sent ? 'sent' : 'failed', result.error ?? null]
  );

  if (result.sent) await execute(`UPDATE job_alerts SET last_sent_at = NOW() WHERE user_id = ?`, [userId]);

  return { status: result.sent ? 'sent' : 'failed', count: jobs.length, reason: result.error };
}

/** Runs the whole daily sweep. Called by the cron scheduler. */
export async function runDailyDigest() {
  const hour = new Date().getHours();
  const due = await query(
    `SELECT user_id FROM job_alerts
      WHERE active = 1 AND frequency <> 'off'
        AND send_hour = ?
        AND (last_sent_at IS NULL
             OR (frequency = 'daily'  AND last_sent_at < (NOW() - INTERVAL 20 HOUR))
             OR (frequency = 'weekly' AND last_sent_at < (NOW() - INTERVAL 6 DAY)))`,
    [hour]
  );

  const summary = { due: due.length, sent: 0, skipped: 0, failed: 0 };
  for (const { user_id } of due) {
    try {
      const r = await sendDigestFor(user_id);
      summary[r.status] = (summary[r.status] || 0) + 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`[alerts] user ${user_id} failed:`, err.message);
    }
  }
  return summary;
}
