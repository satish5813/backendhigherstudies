import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../store/auth';
import {
  IconArrowRight, IconBell, IconBriefcase, IconCheck, IconCode, IconDoc,
  IconGithub, IconLayers, IconLeetCode, IconShield, IconSparkles, IconTarget, IconUser,
} from '../components/ui/Icons';

const FEATURES = [
  {
    icon: IconDoc,
    title: 'ATS-ready resume builder',
    body: 'Twenty-one templates, each scored for parser safety. Your profile flows straight into the document — no retyping, no broken layouts, no columns that scramble in a parser.',
  },
  {
    icon: IconTarget,
    title: 'Real ATS scoring',
    body: 'Score against a target role or a pasted job description. Eight weighted dimensions, keyword gaps named individually, and a fix list ordered by what costs you the most.',
  },
  {
    icon: IconCode,
    title: 'Live coding profile',
    body: 'Link LeetCode, GitHub or CodeChef and your solved counts, contest rating and top repositories sync automatically onto your profile and resume.',
  },
  {
    icon: IconLayers,
    title: 'Every section you need',
    body: 'Personal details, education, skills, projects, internships and achievements — each one structured, reorderable and reusable across every resume you make.',
  },
  {
    icon: IconBell,
    title: 'Daily job alerts',
    body: 'Pick your roles, skills, locations and minimum CTC. A ranked digest lands in your inbox every morning — matched against your actual skill set.',
  },
  {
    icon: IconShield,
    title: 'Passwordless sign-in',
    body: 'One code to your email, rate-limited and expiring. Nothing to forget, nothing to leak — plus a full activity log of every action on your account.',
  },
];

const STEPS = [
  { n: '01', title: 'Verify your email', body: 'Enter your address, type the 6-digit code we send. That is the whole signup — no password to invent.' },
  { n: '02', title: 'Fill your profile once', body: 'Personal details, education, skills, projects, internships, achievements. Link your GitHub and LeetCode handles.' },
  { n: '03', title: 'Generate & score', body: 'Pick a template, pick a target role. The resume autofills and scores instantly against ATS criteria.' },
  { n: '04', title: 'Apply and get alerts', body: 'Export a print-perfect PDF, share your public profile link, and let daily matched openings come to you.' },
];

const ATS_DEMO = [
  { label: 'Contact details', score: 10, max: 10 },
  { label: 'Required sections', score: 15, max: 15 },
  { label: 'Role keyword match', score: 19, max: 25 },
  { label: 'Quantified impact', score: 11, max: 15 },
  { label: 'Bullet quality', score: 8, max: 10 },
  { label: 'Parseability', score: 10, max: 10 },
];

export default function Landing() {
  const { isAuthed } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // count the hero score up once on mount
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / 1400, 1);
      setScore(Math.round(87 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="min-h-full bg-white">
      {/* ------------------------------------------------------------- nav */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? 'border-b border-ink-200/80 bg-white/85 backdrop-blur-xl' : 'border-b border-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* the bar is transparent over the dark hero until the page scrolls */}
          <Logo />
          <nav className="hidden items-center gap-8 md:flex">
            {[['Features', '#features'], ['How it works', '#how'], ['ATS score', '#ats'], ['Students', '/students']].map(
              ([label, href]) => {
                const cls = 'text-sm font-semibold text-ink-600 transition hover:text-ink-900';
                return href.startsWith('#') ? (
                  <a key={href} href={href} className={cls}>{label}</a>
                ) : (
                  <Link key={href} to={href} className={cls}>{label}</Link>
                );
              }
            )}
          </nav>
          <div className="flex items-center gap-2">
            {isAuthed ? (
              <Link to="/app" className="btn-primary">Open dashboard <IconArrowRight size={16} /></Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="btn hidden text-ink-600 hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link to="/login" className="btn-primary">Get started free</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden bg-white pt-16">
        {/* A whisper of crimson at the top corners instead of a full flood —
            enough to feel branded, light enough to read all day. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60rem_28rem_at_15%_-10%,rgba(164,28,36,.10),transparent_70%),radial-gradient(48rem_24rem_at_88%_0%,rgba(164,28,36,.07),transparent_65%)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='64' height='64' viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 .5H64M.5 0V64' stroke='%23f2f2f4' stroke-width='1'/%3E%3C/svg%3E\")",
          }}
        />

        <div className="relative mx-auto grid max-w-7xl gap-14 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-10 lg:px-8 lg:pb-32 lg:pt-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-700">
              <IconSparkles size={14} className="text-brand-600" />
              Koneru Lakshmaiah Education Foundation · Placement Cell
            </span>

            <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink-900 sm:text-6xl lg:text-[4.2rem]">
              Ready before
              <span className="block text-brand-600">
                the drive opens.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-500">
              Fill your details in once. KL Placement Readiness turns them into an ATS-scored resume,
              a recruiter-ready profile with your live LeetCode and GitHub stats, and a daily feed of
              openings the placement cell has approved for you.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to="/login" className="btn-primary h-12 px-7 text-[15px] shadow-crisp">
                Build my resume — free <IconArrowRight size={17} />
              </Link>
              <Link
                to="/students"
                className="btn h-12 border border-ink-200 bg-white px-7 text-[15px] font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
              >
                Browse student profiles
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm text-ink-500">
              {['No password to remember', 'Free for students', 'Export to PDF instantly'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <IconCheck size={15} className="text-emerald-600" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* floating resume + score card */}
          <div className="relative animate-fade-up [animation-delay:150ms]">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-brand-500/30 to-brand-700/20 blur-3xl" />

            <div className="relative rounded-2xl bg-white p-6 shadow-lift sm:p-7">
              <div className="border-b border-ink-200 pb-4">
                <p className="text-xl font-bold tracking-tight text-ink-900">Aarav Sharma</p>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  Hyderabad · aarav@example.com · +91 98765 43210
                </p>
                <p className="mt-0.5 text-[13px] text-brand-600">github.com/aaravsharma · leetcode.com/u/aarav_codes</p>
              </div>

              <div className="mt-4 space-y-3.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.14em] text-ink-400">Experience</p>
                  <p className="mt-1.5 text-[13px] font-bold text-ink-900">Backend Engineering Intern · Nexpay</p>
                  <ul className="mt-1 space-y-1 pl-4 text-[12.5px] leading-snug text-ink-600">
                    <li className="list-disc">Cut webhook p95 latency <b className="text-ink-900">68%</b> (840ms → 270ms)</li>
                    <li className="list-disc">Removed duplicate charges across <b className="text-ink-900">50,000</b> monthly events</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.14em] text-ink-400">Skills</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
                    Java · React · Node.js · MySQL · Redis · Docker · AWS · Data Structures
                  </p>
                </div>
              </div>

              {/* score overlay */}
              <div className="absolute -bottom-5 -left-5 flex items-center gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 shadow-lift sm:-left-8">
                <div className="relative grid h-14 w-14 place-items-center">
                  <svg className="-rotate-90" width="56" height="56">
                    <circle cx="28" cy="28" r="24" fill="none" stroke="#e2e8f0" strokeWidth="6" />
                    <circle
                      cx="28" cy="28" r="24" fill="none" stroke="#059669" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 24}
                      strokeDashoffset={2 * Math.PI * 24 - (score / 100) * 2 * Math.PI * 24}
                    />
                  </svg>
                  <span className="absolute text-sm font-extrabold text-ink-900">{score}</span>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">ATS score</p>
                  <p className="text-xs text-ink-500">Clears most screens</p>
                </div>
              </div>

              <div className="absolute -right-4 -top-4 hidden animate-float rounded-xl border border-ink-100 bg-white px-3.5 py-2.5 shadow-lift sm:block">
                <div className="flex items-center gap-2">
                  <IconLeetCode size={16} className="text-amber-500" />
                  <div>
                    <p className="text-xs font-bold text-ink-900">452 solved</p>
                    <p className="text-[10px] text-ink-500">Rating 1,842</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* stats bar */}
        <div className="relative border-y border-ink-200 bg-ink-50/70">
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-ink-200 px-4 sm:px-6 lg:grid-cols-4 lg:px-8">
            {[
              ['8', 'ATS dimensions scored'],
              ['21', 'Resume templates'],
              ['656', 'Students on the roster'],
              ['Daily', 'Approved job digests'],
            ].map(([big, small], i) => (
              <div key={small} className={`px-5 py-6 ${i < 2 ? 'border-b border-ink-200 lg:border-b-0' : ''}`}>
                <p className="font-display text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">{big}</p>
                <p className="mt-1 text-[13px] text-ink-500">{small}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-title text-brand-600">Everything in one place</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-900 sm:text-[2.6rem] sm:leading-tight">
            Stop maintaining five different resumes
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-500">
            One structured profile feeds every document, every share link and every job match.
            Change a project once and it updates everywhere.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-ink-200/80 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                <Icon size={21} />
              </div>
              <h3 className="mt-4 text-[17px] font-bold tracking-tight text-ink-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- ATS */}
      <section id="ats" className="border-y border-ink-200 bg-ink-50">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-28">
          <div>
            <p className="section-title text-brand-600">The scoring engine</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-900 sm:text-[2.4rem] sm:leading-tight">
              Know why you were filtered out
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-500">
              Most resumes never reach a human. We model what the machine checks — parseable
              structure on one side, keyword and evidence coverage on the other — and tells you exactly
              which line to rewrite.
            </p>

            <ul className="mt-7 space-y-3.5">
              {[
                'Keyword gaps named individually, not a vague "add more keywords"',
                'Flags bullets with no measurable outcome and shows you the pattern to use',
                'Catches the formatting that breaks parsers: emoji, missing dates, decorative bullets',
                'Rescored live on every edit, against the exact job description you paste in',
              ].map((t) => (
                <li key={t} className="flex gap-3 text-[15px] leading-relaxed text-ink-700">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    <IconCheck size={12} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card sm:p-8">
            <div className="flex items-center justify-between border-b border-ink-100 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-ink-400">Target role</p>
                <p className="mt-1 text-[15px] font-bold text-ink-900">Software Engineer</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-black tracking-tight text-emerald-600">73</p>
                <p className="text-xs font-semibold text-ink-400">out of 100</p>
              </div>
            </div>

            <div className="mt-5 space-y-3.5">
              {ATS_DEMO.map(({ label, score: s, max }) => {
                const pctv = (s / max) * 100;
                const tone = pctv >= 90 ? 'bg-emerald-500' : pctv >= 65 ? 'bg-brand-500' : 'bg-amber-500';
                return (
                  <div key={label}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[13px] font-semibold text-ink-700">{label}</span>
                      <span className="font-mono text-xs text-ink-400">{s}/{max}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div className={`h-full rounded-full ${tone} transition-all duration-700`} style={{ width: `${pctv}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Top fix</p>
              <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
                Only 4 of 11 bullets contain a number. Quantify results — “cut API latency 420ms → 90ms”,
                “handled 1,200 records per run”.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- how */}
      <section id="how" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-title text-brand-600">Four steps</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-900 sm:text-[2.6rem]">
            Profile to offer-ready in an evening
          </h2>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} className="relative rounded-2xl border border-ink-200/80 bg-white p-6">
              <span className="font-mono text-3xl font-black text-brand-100">{n}</span>
              <h3 className="mt-2 text-[17px] font-bold tracking-tight text-ink-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- profile CTA */}
      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div className="order-2 lg:order-1">
            <div className="rounded-2xl border border-ink-200 bg-gradient-to-b from-ink-50 to-white p-6 shadow-card">
              <div className="flex items-start gap-4">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-xl font-black text-white">
                  AS
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold tracking-tight text-ink-900">Aarav Sharma</p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    Final-year CSE · Full Stack Developer · 450+ DSA problems
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {['React', 'Node.js', 'Java', 'MySQL', 'Docker'].map((s) => (
                      <span key={s} className="chip bg-brand-50 text-brand-700 ring-1 ring-brand-100">{s}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-ink-200 pt-5">
                {[['452', 'LeetCode solved'], ['1,842', 'Contest rating'], ['18', 'Public repos']].map(([a, b]) => (
                  <div key={b} className="text-center">
                    <p className="text-lg font-extrabold tracking-tight text-ink-900">{a}</p>
                    <p className="text-[11px] font-medium text-ink-400">{b}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5">
                <IconGithub size={15} className="text-white/60" />
                <span className="font-mono text-xs text-white/80">careerforge.app/u/aarav-sharma</span>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="section-title text-brand-600">One link, whole story</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-900 sm:text-[2.4rem] sm:leading-tight">
              A public profile worth sending
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-500">
              Every student gets a clean, fast profile page at their own handle — projects, skills,
              internships, achievements and live coding stats, laid out to be read in thirty seconds.
              Drop it in an email, a LinkedIn bio, or the one line a recruiter gives you.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/login" className="btn-primary h-11 px-6">Claim my handle <IconArrowRight size={16} /></Link>
              <Link to="/students" className="btn-secondary h-11 px-6">See live examples</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section className="relative overflow-hidden bg-ink-950 py-20 lg:py-28">
        <div className="absolute inset-0 bg-mesh opacity-80" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-5xl sm:leading-[1.1]">
            The resume is the easy part.
            <span className="block text-white/55">Let us handle it.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/65">
            Sign in with your email, get a code, and have an ATS-scored resume in the next ten minutes.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/login" className="btn-primary h-12 px-8 text-[15px] shadow-glow">
              Get started — it's free <IconArrowRight size={17} />
            </Link>
          </div>
          <p className="mt-5 text-sm text-white/40">No credit card. No password. Just your college email.</p>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-4 py-9 sm:flex-row sm:px-6 lg:px-8">
          <Logo />
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-ink-500">
            <a href="#features" className="transition hover:text-ink-900">Features</a>
            <a href="#ats" className="transition hover:text-ink-900">ATS score</a>
            <Link to="/students" className="transition hover:text-ink-900">Students</Link>
            <Link to="/login" className="font-semibold text-brand-600 transition hover:text-brand-700">Sign in</Link>
          </div>
          <p className="text-xs text-ink-400">© {new Date().getFullYear()} Koneru Lakshmaiah Education Foundation</p>
        </div>
      </footer>
    </div>
  );
}
