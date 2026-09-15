/**
 * Creates (or refreshes) a fully-populated student account so you can test the
 * whole student experience without filling a profile in by hand.
 *
 *   node server/src/db/make-test-student.js
 *   node server/src/db/make-test-student.js --email someone@kluniversity.in
 *   node server/src/db/make-test-student.js --reset      # wipe and rebuild it
 *
 * Everything is realistic but obviously fictional. Safe to re-run.
 */
import { execute, pool, query, queryOne } from '../config/db.js';
import { env } from '../config/env.js';
import { uniqueSlug } from '../utils/slug.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const RESET = args.includes('--reset');
const EMAIL = opt('email', 'test.student@kluniversity.in').toLowerCase();

async function main() {
  console.log(`\nTest student: ${EMAIL}\n`);

  if (RESET) {
    await execute(`DELETE FROM users WHERE email = ?`, [EMAIL]);
    console.log('  existing account removed');
  }

  let user = await queryOne(`SELECT * FROM users WHERE email = ?`, [EMAIL]);

  if (!user) {
    const slug = await uniqueSlug('Priya Nair Test');
    const res = await execute(
      `INSERT INTO users (email, name, slug, phone, headline, about, campus, branch, reg_no,
                          grad_year, cgpa, location, email_verified, onboarded, open_to_work, profile_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`,
      [
        EMAIL, 'Priya Nair', slug, '+91 90000 12345',
        'Final-year CSE · Backend Developer · 380 DSA problems solved',
        'Final-year Computer Science student at KL University focused on backend engineering. '
        + 'I have shipped two production web applications, interned on a payments team where I cut '
        + 'webhook latency by more than half, and solved 380 problems on LeetCode. Looking for an '
        + 'SDE role where I can own services end to end.',
        'Vijayawada', 'Computer Science & Engineering', 'TEST0000001', 2026, 8.92, 'Hyderabad, India',
      ]
    );
    user = await queryOne(`SELECT * FROM users WHERE id = ?`, [res.insertId]);
    await execute(
      `INSERT INTO job_alerts (user_id, active, roles, skills, locations, job_types, min_ctc, frequency)
       VALUES (?, 1, ?, ?, ?, ?, ?, 'daily')`,
      [user.id,
       JSON.stringify(['Software Engineer', 'Backend Developer']),
       JSON.stringify(['Java', 'Node.js', 'SQL', 'React']),
       JSON.stringify(['Hyderabad', 'Bengaluru']),
       JSON.stringify(['full-time']), 6]
    );
    console.log('  account created');
  } else {
    console.log('  account already exists — refreshing its content');
  }

  const id = user.id;

  // Child rows are replaced wholesale so re-running is idempotent.
  for (const table of ['educations', 'skills', 'projects', 'experiences', 'achievements', 'social_links', 'coding_profiles']) {
    await execute(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
  }

  for (const [i, e] of [
    ['ug', 'KL University', 'B.Tech', 'Computer Science & Engineering', 2022, 2026, 8.92, 'cgpa', 'Vijayawada'],
    ['intermediate', 'Sri Chaitanya Junior College', 'MPC', null, 2020, 2022, 94.8, 'percentage', 'Hyderabad'],
    ['ssc', 'Bhashyam High School', 'SSC', null, 2019, 2020, 96.0, 'percentage', 'Hyderabad'],
  ].entries()) {
    await execute(
      `INSERT INTO educations (user_id, level, institution, degree, branch, start_year, end_year, score, score_type, location, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ...e, i]
    );
  }

  for (const [i, [name, category, prof]] of [
    ['Java', 'language', 5], ['Python', 'language', 4], ['JavaScript', 'language', 4],
    ['Node.js', 'framework', 5], ['Express', 'framework', 4], ['React', 'framework', 4],
    ['Spring Boot', 'framework', 3],
    ['MySQL', 'database', 4], ['MongoDB', 'database', 3], ['Redis', 'database', 3],
    ['Docker', 'tool', 3], ['Git', 'tool', 5], ['Postman', 'tool', 4],
    ['AWS', 'cloud', 3],
    ['Data Structures', 'concept', 5], ['Algorithms', 'concept', 5],
    ['REST API', 'concept', 5], ['OOP', 'concept', 4],
    ['System Design', 'concept', 3], ['Unit Testing', 'concept', 3],
  ].entries()) {
    await execute(
      `INSERT INTO skills (user_id, name, category, proficiency, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [id, name, category, prof, i]
    );
  }

  const projects = [
    {
      title: 'MediQueue — OPD Appointment Platform', role: 'Backend Developer',
      description: 'An appointment system used by a 40-doctor clinic to replace walk-in queues.',
      tech: ['Node.js', 'Express', 'MySQL', 'Redis'],
      highlights: [
        'Built a slot-allocation engine handling 3,000 bookings a day with no double-booking.',
        'Cut average patient wait from 48 minutes to 11 by batching slot reminders.',
        'Added Redis caching that reduced database reads 62% during morning peak.',
      ],
      repo: 'https://github.com/priyanair/mediqueue', start: '2025-01-01', end: '2025-06-01', featured: 1,
    },
    {
      title: 'SplitEasy — Shared Expense Tracker', role: 'Full Stack Developer',
      description: 'A group expense splitter with settlement suggestions, built for hostel students.',
      tech: ['React', 'Node.js', 'MongoDB'],
      highlights: [
        'Implemented a debt-simplification algorithm cutting settlement transactions 44%.',
        'Grew to 260 active users across 3 hostels within 5 weeks of launch.',
      ],
      repo: 'https://github.com/priyanair/spliteasy', start: '2024-08-01', end: '2024-11-01', featured: 1,
    },
    {
      title: 'DSA Tracker CLI', role: 'Solo Developer',
      description: 'A command-line tool that logs LeetCode progress and flags weak topics.',
      tech: ['Python', 'SQLite'],
      highlights: ['Charted 380 solved problems across 14 topics to surface the 3 weakest areas.'],
      repo: 'https://github.com/priyanair/dsa-tracker', start: '2024-03-01', end: '2024-05-01', featured: 0,
    },
  ];
  for (const [i, p] of projects.entries()) {
    await execute(
      `INSERT INTO projects (user_id, title, role, description, tech, highlights, repo_url, start_date, end_date, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.title, p.role, p.description, JSON.stringify(p.tech), JSON.stringify(p.highlights),
       p.repo, p.start, p.end, p.featured, i]
    );
  }

  await execute(
    `INSERT INTO experiences (user_id, company, role, type, location, start_date, end_date, is_current, description, highlights, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
    [id, 'Finvolve Technologies', 'Backend Engineering Intern', 'internship', 'Hyderabad (Hybrid)',
     '2025-05-01', '2025-07-01',
     'Eight-week internship on the payments reliability team.',
     JSON.stringify([
       'Reduced webhook processing latency from 910ms to 340ms by batching database writes.',
       'Built a retry pipeline that recovered 99.4% of failed payment callbacks.',
       'Wrote 32 integration tests, lifting service coverage from 38% to 71%.',
     ])]
  );

  for (const [i, a] of [
    ['Smart India Hackathon — Grand Finalist', 'Govt. of India', 'hackathon', '2025-03-20', 'Top 8 of 380 teams in the healthcare track.'],
    ['LeetCode Knight', 'LeetCode', 'award', '2025-01-15', 'Contest rating 1,806 across 27 rated contests.'],
    ['AWS Certified Cloud Practitioner', 'Amazon Web Services', 'certification', '2024-10-12', null],
    ['NPTEL DBMS — Elite + Silver', 'IIT Kharagpur', 'certification', '2024-04-30', 'Scored 87%.'],
  ].entries()) {
    await execute(
      `INSERT INTO achievements (user_id, title, issuer, category, date, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, ...a, i]
    );
  }

  for (const [platform, username, url] of [
    ['github', 'priyanair', 'https://github.com/priyanair'],
    ['leetcode', 'priya_codes', 'https://leetcode.com/u/priya_codes/'],
    ['linkedin', 'priya-nair-dev', 'https://www.linkedin.com/in/priya-nair-dev'],
  ]) {
    await execute(
      `INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)`,
      [id, platform, username, url]
    );
  }

  // Plausible cached stats so the dashboard is not empty before a live sync.
  await execute(
    `INSERT INTO coding_profiles (user_id, platform, username, status, solved_total, easy, medium, hard,
                                  contest_rating, contest_count, global_rank, fetched_at)
     VALUES (?, 'leetcode', 'priya_codes', 'ok', 380, 168, 182, 30, 1806, 27, 48210, NOW())`,
    [id]
  );
  await execute(
    `INSERT INTO coding_profiles (user_id, platform, username, status, solved_total, reputation, fetched_at)
     VALUES (?, 'github', 'priyanair', 'ok', 14, 23, NOW())`,
    [id]
  );

  const [{ n: skills }] = await query(`SELECT COUNT(*) n FROM skills WHERE user_id = ?`, [id]);
  const fresh = await queryOne(`SELECT slug FROM users WHERE id = ?`, [id]);

  console.log(`  ${skills} skills, ${projects.length} projects, 1 internship, 4 achievements, 3 links`);
  console.log('\n' + '─'.repeat(64));
  console.log('  SIGN IN AS THIS STUDENT');
  console.log('─'.repeat(64));
  console.log(`  email      ${EMAIL}`);
  console.log(`  password   none — a 6-digit code is emailed instead`);
  if (env.mail.devEcho && !env.isProd) {
    console.log(`  the code   shown on screen and printed in the server log`);
  } else {
    console.log(`  the code   delivered by email to ${EMAIL}`);
  }
  console.log(`  profile    ${env.appUrl}/u/${fresh.slug}`);
  console.log('─'.repeat(64) + '\n');

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nfailed:', err.message, '\n');
  await pool.end().catch(() => {});
  process.exit(1);
});
