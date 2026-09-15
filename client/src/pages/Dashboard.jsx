import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { codingApi, jobsApi, meApi, profileApi, resumeApi } from '../lib/api';
import ReadinessCard from '../components/ReadinessCard';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, PageLoader, ScoreRing, Spinner } from '../components/ui';
import {
  IconArrowRight, IconAward, IconBell, IconBriefcase, IconCode, IconDoc,
  IconExternal, IconLayers, IconRefresh, IconSparkles, IconTarget, IconUser,
} from '../components/ui/Icons';

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState({ loading: true });
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try {
      const [profile, stats, resumes, jobs, coding, readiness] = await Promise.all([
        profileApi.get(),
        meApi.stats(),
        resumeApi.list(),
        jobsApi.recommended(4).catch(() => ({ items: [] })),
        codingApi.get().catch(() => ({ items: [], strength: null })),
        meApi.readiness().catch(() => ({ readiness: null })),
      ]);
      setState({
        loading: false, profile, stats, resumes: resumes.items,
        jobs: jobs.items, coding, readiness: readiness.readiness,
      });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const syncCoding = async () => {
    setSyncing(true);
    try {
      const res = await codingApi.sync(null, true);
      setState((s) => ({ ...s, coding: res }));
      toast.success(res.synced ? `Synced ${res.synced} platform${res.synced === 1 ? '' : 's'}.` : res.message || 'Nothing to sync.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (state.loading) return <PageLoader label="Loading your dashboard…" />;
  if (state.error) {
    return (
      <EmptyState
        icon={IconAlertFallback}
        title="Could not load your dashboard"
        message={state.error}
        action={<button className="btn-primary" onClick={load}>Try again</button>}
      />
    );
  }

  const { profile, stats, resumes, jobs, coding, readiness } = state;
  const completeness = profile.completeness;
  const bestResume = resumes.reduce((a, b) => ((b.ats_score ?? 0) > (a?.ats_score ?? -1) ? b : a), null);
  const firstName = (user?.name || profile.user.name || '').split(' ')[0];
  const leetcode = coding.items?.find((c) => c.platform === 'leetcode' && c.status === 'ok');
  const github = coding.items?.find((c) => c.platform === 'github' && c.status === 'ok');

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-3xl bg-ink-950 p-6 sm:p-8">
        <div className="absolute inset-0 bg-mesh opacity-80" />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-lg">
            <p className="text-sm font-semibold text-white/50">
              {greeting()}{firstName ? `, ${firstName}` : ''}
            </p>
            <h1 className="mt-1.5 text-2xl font-black tracking-tight text-white sm:text-3xl">
              {completeness.percent >= 90
                ? 'Your profile is recruiter ready.'
                : completeness.percent >= 55
                ? 'You are most of the way there.'
                : 'Let’s finish your profile.'}
            </h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-white/60">
              {completeness.missing.length
                ? `${completeness.missing.length} thing${completeness.missing.length === 1 ? '' : 's'} left — starting with ${completeness.missing[0].label.toLowerCase()}.`
                : 'Everything is filled in. Generate a resume for each role you target.'}
            </p>

            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link to="/app/profile" className="btn-primary h-10">
                {completeness.percent >= 90 ? 'Edit profile' : 'Complete profile'} <IconArrowRight size={15} />
              </Link>
              <Link to="/app/resumes" className="btn h-10 border border-white/20 bg-white/5 text-white hover:bg-white/10">
                <IconDoc size={15} /> {resumes.length ? 'My resumes' : 'Build a resume'}
              </Link>
              {profile.user.slug && (
                <a
                  href={`/u/${profile.user.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn h-10 border border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  <IconExternal size={15} /> Public profile
                </a>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-6 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <ScoreRing
              value={completeness.percent}
              size={104}
              stroke={9}
              sublabel="complete"
              tone={completeness.percent >= 80 ? 'emerald' : completeness.percent >= 50 ? 'sky' : 'amber'}
            />
            <div className="min-w-[9rem]">
              <p className="text-xs font-bold uppercase tracking-wider text-white/40">Profile strength</p>
              <ul className="mt-2 space-y-1.5">
                {completeness.missing.slice(0, 3).map((m) => (
                  <li key={m.key} className="flex items-center gap-2 text-[13px] text-white/70">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    {m.label}
                  </li>
                ))}
                {!completeness.missing.length && (
                  <li className="text-[13px] text-emerald-300">Nothing missing 🎉</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={IconTarget}
          label="Best ATS score"
          value={bestResume?.ats_score ?? '—'}
          sub={bestResume ? bestResume.title : 'No resume yet'}
          to="/app/resumes"
          tone={
            bestResume?.ats_score >= 85 ? 'emerald' : bestResume?.ats_score >= 70 ? 'sky' :
            bestResume?.ats_score >= 50 ? 'amber' : bestResume ? 'rose' : 'slate'
          }
        />
        <StatCard icon={IconLayers} label="Projects" value={stats.counts.projects} sub={`${stats.counts.skills} skills listed`} to="/app/profile" />
        <StatCard
          icon={IconCode}
          label="LeetCode solved"
          value={leetcode?.solved_total ?? '—'}
          sub={leetcode?.contest_rating ? `Rating ${leetcode.contest_rating}` : 'Link your handle'}
          to="/app/profile"
        />
        <StatCard icon={IconBell} label="Alerts sent" value={stats.counts.alerts_sent} sub="Daily job digest" to="/app/alerts" />
      </section>

      {/* --------------------------------------------- placement readiness */}
      <ReadinessCard
        readiness={readiness}
        onClaimed={(next) => setState((s) => ({ ...s, readiness: next }))}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------- checklist */}
        <section className="card p-5 lg:col-span-2">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold tracking-tight text-ink-900">Finish your profile</h2>
              <p className="text-sm text-ink-500">Each item adds to your profile strength.</p>
            </div>
            <Link to="/app/profile" className="btn-secondary h-9 text-xs">Open editor</Link>
          </header>

          <ul className="divide-y divide-ink-100">
            {completeness.items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-100 text-ink-400'
                  }`}
                >
                  {item.done ? '✓' : ''}
                </span>
                <span className={`flex-1 text-sm ${item.done ? 'text-ink-400 line-through' : 'font-medium text-ink-800'}`}>
                  {item.label}
                </span>
                <span className="font-mono text-[11px] text-ink-400">+{item.weight}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------- coding */}
        <section className="card p-5">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-ink-900">Coding profile</h2>
              <p className="text-sm text-ink-500">Live from LeetCode & GitHub.</p>
            </div>
            <button onClick={syncCoding} disabled={syncing} className="btn-ghost h-8 rounded-lg px-2" title="Sync now">
              {syncing ? <Spinner size={15} /> : <IconRefresh size={15} />}
            </button>
          </header>

          {coding.strength != null ? (
            <>
              <div className="flex items-center gap-4">
                <ScoreRing value={coding.strength} size={82} stroke={8} sublabel="strength" tone="brand" />
                <div className="space-y-1.5 text-sm">
                  {leetcode && (
                    <p className="text-ink-700">
                      <b className="font-bold text-ink-900">{leetcode.solved_total ?? 0}</b> solved
                      {leetcode.contest_rating ? ` · ${leetcode.contest_rating} rating` : ''}
                    </p>
                  )}
                  {github && (
                    <p className="text-ink-700">
                      <b className="font-bold text-ink-900">{github.solved_total ?? 0}</b> public repos
                    </p>
                  )}
                </div>
              </div>

              {leetcode && (
                <div className="mt-4 space-y-2">
                  {[['Easy', leetcode.easy, 'bg-emerald-500'], ['Medium', leetcode.medium, 'bg-amber-500'], ['Hard', leetcode.hard, 'bg-rose-500']].map(
                    ([label, n, cls]) => (
                      <div key={label} className="flex items-center gap-2.5">
                        <span className="w-14 text-xs font-semibold text-ink-500">{label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, ((n || 0) / Math.max(leetcode.solved_total || 1, 1)) * 100)}%` }} />
                        </div>
                        <span className="w-8 text-right font-mono text-xs text-ink-500">{n ?? 0}</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              compact
              icon={IconCode}
              title="No coding profile linked"
              message="Add your LeetCode or GitHub handle and your stats appear here and on your resume."
              action={<Link to="/app/profile" className="btn-primary h-9 text-xs">Link a handle</Link>}
            />
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------ jobs */}
      <section className="card p-5">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-ink-900">Matched for you</h2>
            <p className="text-sm text-ink-500">Ranked against your skills and alert preferences.</p>
          </div>
          <Link to="/app/jobs" className="btn-secondary h-9 text-xs">All jobs <IconArrowRight size={14} /></Link>
        </header>

        {jobs.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {jobs.map((job) => (
              <Link
                key={job.id}
                to="/app/jobs"
                className="group rounded-xl border border-ink-200 p-4 transition hover:border-brand-300 hover:shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink-900 group-hover:text-brand-700">{job.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {job.company} · {job.location || 'India'}
                    </p>
                  </div>
                  <Badge tone={job.match >= 70 ? 'emerald' : job.match >= 50 ? 'sky' : 'slate'}>{job.match}% match</Badge>
                </div>
                {job.min_ctc && (
                  <p className="mt-2 text-xs font-semibold text-emerald-600">
                    ₹{job.min_ctc}{job.max_ctc ? `–${job.max_ctc}` : '+'} LPA
                  </p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={IconBriefcase}
            title="No matches yet"
            message="Add a few skills and set up your job alert — matches will show up here."
            action={<Link to="/app/alerts" className="btn-primary h-9 text-xs">Set up alerts</Link>}
          />
        )}
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, to, tone = 'slate' }) {
  const tones = {
    slate: 'text-ink-500 bg-ink-100',
    emerald: 'text-emerald-600 bg-emerald-50',
    sky: 'text-sky-600 bg-sky-50',
    amber: 'text-amber-600 bg-amber-50',
    rose: 'text-rose-600 bg-rose-50',
  };
  return (
    <Link to={to} className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start justify-between">
        <div className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon size={18} />
        </div>
        <IconArrowRight size={15} className="text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
      </div>
      <p className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900">{value}</p>
      <p className="text-[13px] font-semibold text-ink-700">{label}</p>
      <p className="mt-0.5 truncate text-xs text-ink-400">{sub}</p>
    </Link>
  );
}

const IconAlertFallback = IconSparkles;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
