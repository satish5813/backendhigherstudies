/**
 * Seeds a demo student and a starter job board so the app is usable the moment
 * it boots. Re-runnable: jobs upsert on (source, external_id), the demo user on
 * its email.
 *
 *   npm --workspace server run seed
 */
import { execute, query, queryOne, pool } from '../config/db.js';
import { uniqueSlug } from '../utils/slug.js';

const JOBS = [
  { id: 'seed-1', title: 'Software Engineer (Fresher)', company: 'Zoho', location: 'Chennai', work_mode: 'onsite', job_type: 'full-time', min_ctc: 6.5, max_ctc: 9, experience: '0-1 years', skills: ['Java', 'Data Structures', 'Algorithms', 'SQL', 'OOP'], description: 'Build and maintain product features across the Zoho suite. Strong fundamentals in data structures and algorithms expected.', apply_url: 'https://careers.zohocorp.com' },
  { id: 'seed-2', title: 'Associate Software Developer', company: 'Infosys', location: 'Hyderabad', work_mode: 'hybrid', job_type: 'full-time', min_ctc: 4.5, max_ctc: 6.5, experience: '0-2 years', skills: ['Java', 'Spring Boot', 'SQL', 'REST API', 'Git'], description: 'Work with delivery teams on enterprise applications. Training provided on Spring Boot and microservices.', apply_url: 'https://www.infosys.com/careers' },
  { id: 'seed-3', title: 'Frontend Engineer', company: 'Swiggy', location: 'Bengaluru', work_mode: 'hybrid', job_type: 'full-time', min_ctc: 12, max_ctc: 18, experience: '0-2 years', skills: ['React', 'JavaScript', 'TypeScript', 'CSS', 'Redux', 'Performance'], description: 'Own customer-facing surfaces of the Swiggy web app. You will ship React features that millions use daily.', apply_url: 'https://careers.swiggy.com' },
  { id: 'seed-4', title: 'Data Analyst', company: 'Deloitte', location: 'Hyderabad', work_mode: 'onsite', job_type: 'full-time', min_ctc: 6, max_ctc: 8.5, experience: '0-2 years', skills: ['SQL', 'Excel', 'Power BI', 'Python', 'Statistics', 'Visualization'], description: 'Turn client data into decisions. Build dashboards, run analyses and present findings to stakeholders.', apply_url: 'https://www2.deloitte.com/careers' },
  { id: 'seed-5', title: 'Backend Engineer Intern', company: 'Razorpay', location: 'Bengaluru', work_mode: 'remote', job_type: 'internship', min_ctc: 6, max_ctc: null, experience: 'Student', skills: ['Node.js', 'REST API', 'MySQL', 'Redis', 'Docker'], description: '6-month internship on the payments platform. High conversion to full-time for strong performers.', apply_url: 'https://razorpay.com/jobs' },
  { id: 'seed-6', title: 'Machine Learning Engineer', company: 'Fractal Analytics', location: 'Bengaluru', work_mode: 'hybrid', job_type: 'full-time', min_ctc: 10, max_ctc: 16, experience: '0-2 years', skills: ['Python', 'PyTorch', 'Machine Learning', 'NLP', 'Docker', 'AWS'], description: 'Build and deploy ML models for Fortune 500 clients across retail and healthcare.', apply_url: 'https://fractal.ai/careers' },
  { id: 'seed-7', title: 'Full Stack Developer', company: 'Freshworks', location: 'Chennai', work_mode: 'hybrid', job_type: 'full-time', min_ctc: 9, max_ctc: 14, experience: '0-3 years', skills: ['React', 'Node.js', 'MongoDB', 'TypeScript', 'REST API', 'AWS'], description: 'End-to-end ownership of features in the Freshworks CRM stack.', apply_url: 'https://www.freshworks.com/company/careers' },
  { id: 'seed-8', title: 'DevOps Engineer', company: 'Tata Consultancy Services', location: 'Pune', work_mode: 'onsite', job_type: 'full-time', min_ctc: 5.5, max_ctc: 8, experience: '0-2 years', skills: ['Docker', 'Kubernetes', 'CI/CD', 'Jenkins', 'Linux', 'AWS'], description: 'Automate build and deploy pipelines for banking clients.', apply_url: 'https://www.tcs.com/careers' },
  { id: 'seed-9', title: 'SDE-1', company: 'Amazon', location: 'Hyderabad', work_mode: 'onsite', job_type: 'full-time', min_ctc: 22, max_ctc: 32, experience: '0-2 years', skills: ['Data Structures', 'Algorithms', 'Java', 'System Design', 'AWS', 'Problem Solving'], description: 'Design, build and scale services used by millions. Strong DS/algo and system design fundamentals required.', apply_url: 'https://www.amazon.jobs' },
  { id: 'seed-10', title: 'QA Automation Engineer', company: 'Accenture', location: 'Bengaluru', work_mode: 'hybrid', job_type: 'full-time', min_ctc: 4.5, max_ctc: 7, experience: '0-2 years', skills: ['Selenium', 'Java', 'Test Automation', 'API Testing', 'Jira'], description: 'Own regression suites and CI test pipelines for enterprise clients.', apply_url: 'https://www.accenture.com/in-en/careers' },
  { id: 'seed-11', title: 'Android Developer', company: 'PhonePe', location: 'Bengaluru', work_mode: 'onsite', job_type: 'full-time', min_ctc: 16, max_ctc: 24, experience: '0-3 years', skills: ['Kotlin', 'Android Studio', 'Jetpack Compose', 'REST API', 'MVVM'], description: 'Build payment experiences for 500M+ users on Android.', apply_url: 'https://www.phonepe.com/careers' },
  { id: 'seed-12', title: 'Cloud Support Associate', company: 'Amazon Web Services', location: 'Remote (India)', work_mode: 'remote', job_type: 'full-time', min_ctc: 8, max_ctc: 12, experience: '0-2 years', skills: ['AWS', 'Linux', 'Networking', 'Troubleshooting', 'Python'], description: 'Help AWS customers debug and optimise their cloud workloads.', apply_url: 'https://www.amazon.jobs' },
];

async function seedJobs() {
  let n = 0;
  for (const j of JOBS) {
    await execute(
      `INSERT INTO jobs (source, external_id, title, company, location, work_mode, job_type,
                         min_ctc, max_ctc, experience, skills, description, apply_url, posted_at)
       VALUES ('seed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL FLOOR(RAND()*6) DAY)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), company = VALUES(company), location = VALUES(location),
         min_ctc = VALUES(min_ctc), max_ctc = VALUES(max_ctc), skills = VALUES(skills),
         description = VALUES(description), apply_url = VALUES(apply_url), active = 1`,
      [j.id, j.title, j.company, j.location, j.work_mode, j.job_type, j.min_ctc, j.max_ctc,
       j.experience, JSON.stringify(j.skills), j.description, j.apply_url]
    );
    n++;
  }
  return n;
}

async function seedDemoStudent() {
  const email = 'demo.student@careerforge.local';
  let user = await queryOne(`SELECT * FROM users WHERE email = ?`, [email]);
  if (user) return { created: false, user };

  const slug = await uniqueSlug('Aarav Sharma');
  const res = await execute(
    `INSERT INTO users (email, name, slug, phone, headline, about, campus, branch, reg_no,
                        grad_year, cgpa, location, email_verified, onboarded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [email, 'Aarav Sharma', slug, '+91 98765 43210',
     'Final-year CSE student · Full Stack Developer · 450+ DSA problems solved',
     'Final-year Computer Science student focused on backend engineering and distributed systems. I have shipped three production web applications, solved 450+ problems on LeetCode, and interned at a fintech startup where I cut payment-webhook latency by 68%. Looking for an SDE role where I can own services end to end.',
     'Vijayawada', 'Computer Science & Engineering', '21BCE1234', 2026, 8.74, 'Hyderabad, India']
  );
  const userId = res.insertId;

  await execute(`INSERT INTO job_alerts (user_id, active, roles, skills, locations, job_types, min_ctc, frequency)
                 VALUES (?, 1, ?, ?, ?, ?, ?, 'daily')`,
    [userId, JSON.stringify(['Software Engineer', 'Full Stack Developer']),
     JSON.stringify(['React', 'Node.js', 'Java', 'SQL']),
     JSON.stringify(['Hyderabad', 'Bengaluru']), JSON.stringify(['full-time']), 6]);

  for (const [platform, username] of [['github', 'aaravsharma'], ['leetcode', 'aarav_codes'], ['linkedin', 'aarav-sharma']]) {
    await execute(`INSERT INTO social_links (user_id, platform, username, url) VALUES (?, ?, ?, ?)`,
      [userId, platform, username, platform === 'linkedin' ? `https://www.linkedin.com/in/${username}`
        : platform === 'github' ? `https://github.com/${username}` : `https://leetcode.com/u/${username}/`]);
  }

  const educations = [
    ['ug', 'KL University', 'B.Tech', 'Computer Science & Engineering', 2022, 2026, 8.74, 'cgpa', 'Vijayawada'],
    ['intermediate', 'Narayana Junior College', 'MPC', null, 2020, 2022, 96.4, 'percentage', 'Hyderabad'],
    ['ssc', 'Delhi Public School', 'SSC', null, 2019, 2020, 95.0, 'percentage', 'Hyderabad'],
  ];
  for (const [i, e] of educations.entries()) {
    await execute(
      `INSERT INTO educations (user_id, level, institution, degree, branch, start_year, end_year, score, score_type, location, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, ...e, i]
    );
  }

  const skills = [
    ['Java', 'language', 5], ['Python', 'language', 4], ['JavaScript', 'language', 5],
    ['TypeScript', 'language', 4], ['React', 'framework', 5], ['Node.js', 'framework', 5],
    ['Express', 'framework', 4], ['Spring Boot', 'framework', 3], ['MySQL', 'database', 4],
    ['MongoDB', 'database', 4], ['Redis', 'database', 3], ['Docker', 'tool', 3],
    ['Git', 'tool', 5], ['AWS', 'cloud', 3], ['Data Structures', 'concept', 5],
    ['Algorithms', 'concept', 5], ['System Design', 'concept', 3], ['REST API', 'concept', 5],
  ];
  for (const [i, [name, category, proficiency]] of skills.entries()) {
    await execute(
      `INSERT INTO skills (user_id, name, category, proficiency, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [userId, name, category, proficiency, i]
    );
  }

  const projects = [
    {
      title: 'CampusHire — Placement Management Platform', role: 'Full Stack Developer',
      description: 'A placement portal used by 1,200+ students to track drives, upload resumes and receive eligibility-filtered notifications.',
      tech: ['React', 'Node.js', 'MySQL', 'Redis', 'Docker'],
      highlights: [
        'Built an eligibility engine that filters 1,200 student records against drive criteria in under 200ms.',
        'Cut resume-upload failures 34% by moving parsing to a background queue with retry semantics.',
        'Designed the notification pipeline that delivers 4,000+ emails per drive with 99.2% delivery.',
      ],
      repo_url: 'https://github.com/aaravsharma/campushire', start_date: '2025-01-01', end_date: '2025-06-01', featured: 1,
    },
    {
      title: 'PayFlow — Payment Webhook Gateway', role: 'Backend Developer',
      description: 'A reliable webhook receiver that de-duplicates, verifies and replays payment events for downstream services.',
      tech: ['Node.js', 'Express', 'Redis', 'MySQL', 'AWS'],
      highlights: [
        'Reduced webhook processing latency from 840ms to 270ms by batching database writes.',
        'Implemented idempotency keys that eliminated 100% of duplicate-charge incidents across 50k events.',
        'Added exponential-backoff replay covering 12 failure modes, raising successful delivery to 99.97%.',
      ],
      repo_url: 'https://github.com/aaravsharma/payflow', start_date: '2024-08-01', end_date: '2024-12-01', featured: 1,
    },
    {
      title: 'LeetTrack — DSA Progress Analytics', role: 'Solo Developer',
      description: 'Pulls LeetCode submission history and visualises topic-wise weakness against a target company profile.',
      tech: ['React', 'Python', 'FastAPI', 'PostgreSQL'],
      highlights: [
        'Charted 450 solved problems across 18 topics to surface the 4 weakest areas per user.',
        'Grew to 320 active users from a single college community post within 6 weeks.',
      ],
      repo_url: 'https://github.com/aaravsharma/leettrack', start_date: '2024-03-01', end_date: '2024-06-01', featured: 0,
    },
  ];
  for (const [i, p] of projects.entries()) {
    await execute(
      `INSERT INTO projects (user_id, title, role, description, tech, highlights, repo_url, start_date, end_date, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, p.title, p.role, p.description, JSON.stringify(p.tech), JSON.stringify(p.highlights),
       p.repo_url, p.start_date, p.end_date, p.featured, i]
    );
  }

  await execute(
    `INSERT INTO experiences (user_id, company, role, type, location, start_date, end_date, is_current, description, highlights, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
    [userId, 'Nexpay Technologies', 'Backend Engineering Intern', 'internship', 'Hyderabad (Remote)',
     '2025-05-01', '2025-07-01',
     'Six-week internship on the payments reliability team.',
     JSON.stringify([
       'Cut payment-webhook p95 latency 68% (840ms to 270ms) by replacing per-event writes with batched inserts.',
       'Shipped an idempotency layer that removed duplicate charges across 50,000 monthly events.',
       'Wrote 40 integration tests, lifting service coverage from 41% to 78%.',
     ])]
  );

  const achievements = [
    ['Smart India Hackathon — National Finalist', 'Govt. of India', 'hackathon', '2025-03-15', 'Top 6 of 412 teams in the smart-mobility track.'],
    ['LeetCode Knight (Top 5%)', 'LeetCode', 'award', '2025-01-10', 'Contest rating 1,842 across 34 rated contests.'],
    ['AWS Certified Cloud Practitioner', 'Amazon Web Services', 'certification', '2024-11-02', null],
    ['Meta Front-End Developer Professional Certificate', 'Coursera', 'certification', '2024-06-20', null],
  ];
  for (const [i, a] of achievements.entries()) {
    await execute(
      `INSERT INTO achievements (user_id, title, issuer, category, date, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, ...a, i]
    );
  }

  user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  return { created: true, user };
}

async function main() {
  const jobs = await seedJobs();
  console.log(`  jobs         ${jobs} upserted`);

  const { created, user } = await seedDemoStudent();
  console.log(`  demo student ${created ? 'created' : 'already present'} — ${user.email} (/u/${user.slug})`);

  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM users`);
  console.log(`\nseed complete — ${n} user(s), ${jobs} job(s)\n`);
  console.log(`Browse the demo student's public page at  /u/${user.slug}`);
  console.log('');
  console.log('Note: careerforge.local has no MX record, so signing IN as the demo');
  console.log('student needs VALIDATE_EMAIL_MX=false. For a normal test, just sign up');
  console.log('with your own address — with MAIL_DEV_ECHO=true the code is printed here.\n');
  await pool.end();
}

main().catch(async (err) => {
  console.error('seed failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
