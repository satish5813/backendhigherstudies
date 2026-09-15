/**
 * Pull technology icons from svgl.app into client/public/icons/.
 *
 *   node server/src/db/fetch-skill-icons.js
 *   node server/src/db/fetch-skill-icons.js --check    # report, write nothing
 *
 * Fetched once and committed, NOT hot-linked at runtime. Three reasons:
 * a page that renders thirty skill chips would otherwise make thirty
 * cross-origin requests on every load; the board goes blank if svgl is down or
 * rate-limits us; and a self-hosted file cannot change under us without a
 * commit. The trade is that this needs re-running when a logo is restyled,
 * which is roughly never.
 *
 * These are third-party trademarks. Using a company's logo to label its own
 * technology is nominative use and is what every developer tool does; the marks
 * remain the property of their owners. svgl publishes them for this purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../client/public/icons');
const INDEX = 'https://api.svgl.app';

const CHECK_ONLY = process.argv.includes('--check');

/**
 * The skills worth an icon: the ones our vocabulary actually matches and a
 * student is likely to list. Key is the slug we render by, value is the title
 * to look up in svgl (or an array of acceptable titles).
 */
const WANTED = {
  // languages
  java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  go: 'Go', rust: 'Rust', kotlin: 'Kotlin', swift: 'Swift', php: 'PHP', ruby: 'Ruby',
  c: 'C', cpp: ['C++', 'Cpp'], csharp: ['C#', 'CSharp'],
  // frontend
  react: 'React', angular: 'Angular', vue: ['Vue.js', 'Vue'], svelte: 'Svelte',
  nextjs: ['Next.js', 'Nextjs'], tailwindcss: ['Tailwind CSS', 'TailwindCSS'],
  html5: 'HTML5', css: 'CSS', bootstrap: 'Bootstrap',
  // backend
  nodejs: ['Node.js', 'NodeJS'], express: ['Express', 'Express.js'], django: 'Django',
  flask: 'Flask', spring: ['Spring', 'Spring Boot'], dotnet: ['.NET', 'dotNET'],
  graphql: 'GraphQL', laravel: 'Laravel',
  // data
  mysql: 'MySQL', postgresql: ['PostgreSQL', 'Postgres'], mongodb: 'MongoDB',
  redis: 'Redis', sqlite: 'SQLite', elasticsearch: ['Elasticsearch', 'Elastic'],
  kafka: ['Apache Kafka', 'Kafka'], spark: ['Apache Spark', 'Spark'], snowflake: 'Snowflake',
  // cloud + tooling
  aws: ['Amazon Web Services', 'AWS'], azure: ['Microsoft Azure', 'Azure'],
  gcp: ['Google Cloud', 'Google Cloud Platform'], docker: 'Docker', kubernetes: 'Kubernetes',
  terraform: 'Terraform', jenkins: 'Jenkins', git: 'Git', github: 'GitHub', gitlab: 'GitLab',
  linux: 'Linux', firebase: 'Firebase', vercel: 'Vercel', postman: 'Postman',
  figma: 'Figma', jira: 'Jira',
  // ml
  pytorch: 'PyTorch', tensorflow: 'TensorFlow', openai: 'OpenAI',
  // mobile
  flutter: 'Flutter', android: 'Android',
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const res = await fetch(INDEX, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`svgl index returned HTTP ${res.status}`);
  const all = await res.json();

  const byTitle = new Map();
  for (const l of all) {
    const k = norm(l.title);
    if (!byTitle.has(k)) byTitle.set(k, l);
  }

  if (!CHECK_ONLY) fs.mkdirSync(OUT, { recursive: true });

  const found = [];
  const absent = [];

  for (const [slug, titles] of Object.entries(WANTED)) {
    const candidates = Array.isArray(titles) ? titles : [titles];
    const hit = candidates.map((t) => byTitle.get(norm(t))).find(Boolean);
    if (!hit) { absent.push(slug); continue; }
    found.push([slug, hit]);
  }

  console.log(`svgl index: ${all.length} logos · wanted ${Object.keys(WANTED).length} · matched ${found.length}\n`);

  if (CHECK_ONLY) {
    for (const [slug, hit] of found) console.log(`  ok    ${slug.padEnd(14)} ${hit.title}`);
    if (absent.length) console.log(`\n  no match: ${absent.join(', ')}`);
    return;
  }

  let written = 0;
  let failed = 0;

  for (const [slug, hit] of found) {
    // `route` is a string for single-theme logos and { light, dark } for logos
    // that ship a pair. The product is a light surface, so take light.
    const url = typeof hit.route === 'string' ? hit.route : hit.route?.light;
    if (!url) { failed++; continue; }

    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const svg = await r.text();

      // Sanity-check it really is an SVG before writing it into public/. Many
      // of these open with an <?xml?> prolog (and some with a comment or
      // DOCTYPE), so look for the tag anywhere near the start rather than
      // demanding it at position zero — and make sure we did not just get the
      // site's HTML shell back.
      if (/^\s*<(!doctype\s+html|html)[\s>]/i.test(svg)) throw new Error('got the HTML shell, not a file');
      if (!/<svg[\s>]/i.test(svg.slice(0, 600))) throw new Error('not an SVG');

      fs.writeFileSync(path.join(OUT, `${slug}.svg`), svg, 'utf8');
      written++;
    } catch (err) {
      console.log(`  FAIL  ${slug.padEnd(14)} ${err.message}`);
      failed++;
    }
  }

  // A manifest so the client knows which slugs exist without probing for 404s.
  const slugs = found
    .map(([slug]) => slug)
    .filter((slug) => fs.existsSync(path.join(OUT, `${slug}.svg`)))
    .sort();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(slugs), 'utf8');

  console.log(`\nwrote ${written} icons to client/public/icons (${failed} failed)`);
  if (absent.length) console.log(`not in svgl: ${absent.join(', ')}`);
  console.log('manifest: client/public/icons/index.json');
}

main().catch((err) => {
  console.error('\nfailed:', err.message);
  process.exit(1);
});
