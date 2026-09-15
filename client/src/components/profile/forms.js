/**
 * Field definitions for every repeatable profile section. The generic
 * <SectionForm> renders from these, so adding a field is a one-line change
 * here plus the matching column in the server's zod schema.
 *
 * type: text | textarea | number | select | month | url | switch | tags | bullets
 */

export const SECTION_FORMS = {
  education: {
    singular: 'education entry',
    title: 'Education',
    blurb: 'Degree, school and marks. Recruiters filter on graduation year and CGPA.',
    empty: 'Add your degree, then your intermediate and SSC records.',
    defaults: { level: 'ug', score_type: 'cgpa' },
    fields: [
      { name: 'level', label: 'Level', type: 'select', width: 'half', options: [
        ['ug', 'Undergraduate (B.Tech / B.E / B.Sc)'],
        ['pg', 'Postgraduate (M.Tech / MCA / M.Sc)'],
        ['intermediate', 'Intermediate / 12th'],
        ['diploma', 'Diploma'],
        ['ssc', 'SSC / 10th'],
        ['other', 'Other'],
      ] },
      { name: 'institution', label: 'Institution', type: 'text', required: true, placeholder: 'KL University' },
      { name: 'degree', label: 'Degree', type: 'text', width: 'half', placeholder: 'B.Tech' },
      { name: 'branch', label: 'Branch / stream', type: 'text', width: 'half', placeholder: 'Computer Science & Engineering' },
      { name: 'start_year', label: 'Start year', type: 'number', width: 'half', placeholder: '2022' },
      { name: 'end_year', label: 'End year', type: 'number', width: 'half', placeholder: '2026', hint: 'Expected year is fine' },
      { name: 'score', label: 'Score', type: 'number', width: 'half', step: '0.01', placeholder: '8.74' },
      { name: 'score_type', label: 'Score type', type: 'select', width: 'half', options: [['cgpa', 'CGPA (out of 10)'], ['percentage', 'Percentage']] },
      { name: 'location', label: 'Location', type: 'text', placeholder: 'Vijayawada' },
    ],
  },

  skills: {
    singular: 'skill',
    title: 'Skills',
    blurb: 'The keywords an ATS matches against. Group them properly — 15 to 20 you can defend.',
    empty: 'Add the languages, frameworks, databases and tools you actually use.',
    defaults: { category: 'language', proficiency: 3 },
    fields: [
      { name: 'name', label: 'Skill', type: 'text', required: true, placeholder: 'React' },
      { name: 'category', label: 'Category', type: 'select', width: 'half', options: [
        ['language', 'Language'], ['framework', 'Framework / library'], ['database', 'Database'],
        ['tool', 'Tool'], ['cloud', 'Cloud / DevOps'], ['concept', 'Concept'],
        ['soft', 'Soft skill'], ['other', 'Other'],
      ] },
      { name: 'proficiency', label: 'Proficiency', type: 'select', width: 'half', options: [
        [1, 'Beginner'], [2, 'Basic'], [3, 'Intermediate'], [4, 'Advanced'], [5, 'Expert'],
      ] },
    ],
  },

  projects: {
    singular: 'project',
    title: 'Projects',
    blurb: 'The heaviest section on a fresher resume. Two strong projects beat five thin ones.',
    empty: 'Add a project with what you built, the stack, and what measurably changed.',
    defaults: { tech: [], highlights: [], featured: false },
    fields: [
      { name: 'title', label: 'Project title', type: 'text', required: true, placeholder: 'CampusHire — Placement Management Platform' },
      { name: 'role', label: 'Your role', type: 'text', width: 'half', placeholder: 'Full Stack Developer' },
      { name: 'featured', label: 'Feature this project', type: 'switch', width: 'half', hint: 'Pinned to the top of your profile' },
      { name: 'description', label: 'One-line description', type: 'textarea', rows: 2,
        placeholder: 'A placement portal used by 1,200+ students to track drives and receive eligibility-filtered alerts.' },
      { name: 'tech', label: 'Tech stack', type: 'tags', placeholder: 'React, Node.js, MySQL — press Enter after each' },
      { name: 'highlights', label: 'Impact bullets', type: 'bullets',
        hint: 'Start with an action verb and include a number. These carry most of your ATS score.' },
      { name: 'start_date', label: 'Started', type: 'month', width: 'half' },
      { name: 'end_date', label: 'Finished', type: 'month', width: 'half' },
      { name: 'repo_url', label: 'Repository URL', type: 'url', width: 'half', placeholder: 'https://github.com/you/project' },
      { name: 'live_url', label: 'Live demo URL', type: 'url', width: 'half', placeholder: 'https://project.vercel.app' },
    ],
  },

  experience: {
    singular: 'experience',
    title: 'Experience & internships',
    blurb: 'Internships, part-time roles, freelance work and training programmes.',
    empty: 'No internships yet? A significant training programme or freelance project counts.',
    defaults: { type: 'internship', highlights: [], is_current: false },
    fields: [
      { name: 'company', label: 'Company', type: 'text', required: true, placeholder: 'Nexpay Technologies' },
      { name: 'role', label: 'Role', type: 'text', required: true, placeholder: 'Backend Engineering Intern' },
      { name: 'type', label: 'Type', type: 'select', width: 'half', options: [
        ['internship', 'Internship'], ['full-time', 'Full-time'], ['part-time', 'Part-time'],
        ['freelance', 'Freelance'], ['training', 'Training programme'],
      ] },
      { name: 'location', label: 'Location', type: 'text', width: 'half', placeholder: 'Hyderabad (Remote)' },
      { name: 'start_date', label: 'From', type: 'month', width: 'half' },
      { name: 'end_date', label: 'To', type: 'month', width: 'half', hideIf: 'is_current' },
      { name: 'is_current', label: 'I currently work here', type: 'switch' },
      { name: 'description', label: 'What the role was', type: 'textarea', rows: 2,
        placeholder: 'Six-week internship on the payments reliability team.' },
      { name: 'highlights', label: 'Impact bullets', type: 'bullets',
        hint: 'What you shipped and what changed because of it.' },
    ],
  },

  achievements: {
    singular: 'achievement',
    title: 'Achievements & certifications',
    blurb: 'Awards, hackathons, certifications, publications and leadership roles.',
    empty: 'Add certifications, hackathon results, ranks or any award you have earned.',
    defaults: { category: 'award' },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Smart India Hackathon — National Finalist' },
      { name: 'issuer', label: 'Issued by', type: 'text', width: 'half', placeholder: 'Govt. of India' },
      { name: 'category', label: 'Category', type: 'select', width: 'half', options: [
        ['award', 'Award'], ['certification', 'Certification'], ['hackathon', 'Hackathon'],
        ['publication', 'Publication'], ['extracurricular', 'Extracurricular'], ['other', 'Other'],
      ] },
      { name: 'date', label: 'Date', type: 'month', width: 'half' },
      { name: 'url', label: 'Verification URL', type: 'url', width: 'half', placeholder: 'https://credential.link' },
      { name: 'description', label: 'Detail', type: 'textarea', rows: 2, placeholder: 'Top 6 of 412 teams in the smart-mobility track.' },
    ],
  },
};

export const PLATFORMS = [
  { key: 'github', label: 'GitHub', placeholder: 'username or profile URL', help: 'Pulls your public repo count and top repositories.' },
  { key: 'leetcode', label: 'LeetCode', placeholder: 'username or leetcode.com/u/…', help: 'Pulls solved counts, contest rating and badges.' },
  { key: 'codechef', label: 'CodeChef', placeholder: 'username', help: 'Pulls your rating and stars.' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'in/your-handle', help: 'Shown on your resume header.' },
  { key: 'portfolio', label: 'Portfolio', placeholder: 'https://yoursite.com', help: 'Your personal website, if you have one.' },
];
