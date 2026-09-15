import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../lib/api';
import Logo from '../components/Logo';
import { Badge, EmptyState, PageLoader } from '../components/ui';
import {
  IconAward, IconBriefcase, IconCheck, IconCode, IconExternal, IconGithub,
  IconGraduation, IconLayers, IconLeetCode, IconLink, IconLinkedin, IconMapPin, IconUser,
} from '../components/ui/Icons';

const PLATFORM_ICON = { github: IconGithub, linkedin: IconLinkedin, leetcode: IconLeetCode };

export default function PublicProfile() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    publicApi
      .profile(slug)
      .then((data) => { if (!cancelled) setState({ loading: false, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err }); });
    return () => { cancelled = true; };
  }, [slug]);

  if (state.loading) return <PageLoader label="Loading profile…" />;

  if (state.error) {
    const isPrivate = state.error.code === 'private_profile';
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <EmptyState
          icon={IconUser}
          title={isPrivate ? 'This profile is private' : 'Profile not found'}
          message={
            isPrivate
              ? 'The student has turned off public visibility for this page.'
              : `No student profile exists at /u/${slug}.`
          }
          action={<Link to="/students" className="btn-primary">Browse students</Link>}
        />
      </div>
    );
  }

  const p = state.data;
  const u = p.user;
  const initials = (u.name || '?').split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  const leetcode = p.coding.find((c) => c.platform === 'leetcode');
  const github = p.coding.find((c) => c.platform === 'github');

  return (
    <div className="min-h-screen bg-ink-50">
      {/* ------------------------------------------------------------- nav */}
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            {p.isOwner && <Link to="/app/profile" className="btn-secondary h-9 text-xs">Edit my profile</Link>}
            <Link to="/login" className="btn-primary h-9 text-xs">Build your own</Link>
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------- banner */}
      <section className="relative overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bg-mesh opacity-80" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 text-3xl font-black text-white shadow-lift ring-4 ring-white/10">
              {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
            </div>

            <div className="min-w-0 flex-1">
              {u.openToWork && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Open to work
                </span>
              )}
              <h1 className="mt-2.5 text-3xl font-black tracking-tight text-white sm:text-4xl">{u.name}</h1>
              {u.headline && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/70">{u.headline}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/55">
                {u.location && <span className="inline-flex items-center gap-1.5"><IconMapPin size={14} />{u.location}</span>}
                {u.branch && <span className="inline-flex items-center gap-1.5"><IconGraduation size={14} />{u.branch}</span>}
                {u.gradYear && <span>Batch of {u.gradYear}</span>}
                {u.cgpa != null && <span>{u.cgpa} CGPA</span>}
              </div>

              {p.links.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {p.links.filter((l) => l.url).map((l) => {
                    const Icon = PLATFORM_ICON[l.platform] ?? IconLink;
                    return (
                      <a
                        key={l.platform}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/85 backdrop-blur transition hover:bg-white/15"
                      >
                        <Icon size={15} /> <span className="capitalize">{l.platform}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      {(leetcode || github || p.codingStrength != null) && (
        <section className="border-b border-ink-200 bg-white">
          <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-ink-200 px-4 sm:px-6 lg:grid-cols-4">
            {[
              p.codingStrength != null && ['Coding strength', `${p.codingStrength}/100`],
              leetcode && ['LeetCode solved', leetcode.solved_total ?? '—'],
              leetcode?.contest_rating && ['Contest rating', leetcode.contest_rating],
              github && ['Public repos', github.solved_total ?? '—'],
              ['Projects', p.projects.length],
            ]
              .filter(Boolean)
              .slice(0, 4)
              .map(([label, value], i) => (
                <div key={label} className={`px-4 py-5 ${i < 2 ? 'border-b border-ink-200 lg:border-b-0' : ''}`}>
                  <p className="text-2xl font-extrabold tracking-tight text-ink-900">{value}</p>
                  <p className="mt-0.5 text-[13px] text-ink-500">{label}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- body */}
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-6">
          {u.about && (
            <Card title="About" icon={IconUser}>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-600">{u.about}</p>
            </Card>
          )}

          {p.experience.length > 0 && (
            <Card title="Experience" icon={IconBriefcase}>
              <ol className="space-y-5">
                {p.experience.map((x) => (
                  <li key={x.id} className="relative border-l-2 border-ink-100 pl-5">
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-ink-900">{x.role}</h3>
                      <Badge tone="slate">{x.type}</Badge>
                      {x.is_current && <Badge tone="emerald">Current</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-ink-600">{x.company}{x.location ? ` · ${x.location}` : ''}</p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {[fmt(x.start_date), x.is_current ? 'Present' : fmt(x.end_date)].filter(Boolean).join(' – ')}
                    </p>
                    {x.description && <p className="mt-2 text-sm leading-relaxed text-ink-600">{x.description}</p>}
                    {x.highlights?.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {x.highlights.map((h, i) => (
                          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                            <IconCheck size={14} className="mt-1 shrink-0 text-emerald-500" />{h}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {p.projects.length > 0 && (
            <Card title="Projects" icon={IconLayers}>
              <div className="space-y-5">
                {p.projects.map((proj) => (
                  <article key={proj.id} className="rounded-xl border border-ink-200 p-4 transition hover:border-brand-200 hover:shadow-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-ink-900">{proj.title}</h3>
                        {proj.featured && <Badge tone="brand">Featured</Badge>}
                      </div>
                      <div className="flex gap-2">
                        {proj.repo_url && (
                          <a href={proj.repo_url} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900" aria-label="Repository">
                            <IconGithub size={16} />
                          </a>
                        )}
                        {proj.live_url && (
                          <a href={proj.live_url} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900" aria-label="Live demo">
                            <IconExternal size={16} />
                          </a>
                        )}
                      </div>
                    </div>

                    {proj.role && <p className="mt-0.5 text-sm text-ink-500">{proj.role}</p>}
                    {proj.description && <p className="mt-2 text-sm leading-relaxed text-ink-600">{proj.description}</p>}

                    {proj.highlights?.length > 0 && (
                      <ul className="mt-2.5 space-y-1.5">
                        {proj.highlights.map((h, i) => (
                          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-400" />{h}
                          </li>
                        ))}
                      </ul>
                    )}

                    {proj.tech?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {proj.tech.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </Card>
          )}

          {p.achievements.length > 0 && (
            <Card title="Achievements & certifications" icon={IconAward}>
              <ul className="space-y-3.5">
                {p.achievements.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                      <IconAward size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink-900">{a.title}</h3>
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700" aria-label="Verify">
                            <IconExternal size={13} />
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-ink-500">{[a.issuer, fmt(a.date)].filter(Boolean).join(' · ')}</p>
                      {a.description && <p className="mt-1 text-sm leading-relaxed text-ink-600">{a.description}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* -------------------------------------------------------- sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-6">
          {p.skills.length > 0 && (
            <Card title="Skills" compact>
              {Object.entries(groupBy(p.skills, 'category')).map(([category, list]) => (
                <div key={category} className="mb-3 last:mb-0">
                  <p className="section-title mb-1.5 text-[11px]">{category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((s) => <Badge key={s.id} tone="slate">{s.name}</Badge>)}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {p.coding.length > 0 && (
            <Card title="Coding profiles" compact icon={IconCode}>
              <div className="space-y-3">
                {p.coding.map((c) => (
                  <a
                    key={c.platform}
                    href={c.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-ink-200 p-3 transition hover:border-brand-200"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold capitalize text-ink-900">{c.platform}</span>
                      <IconExternal size={13} className="text-ink-400" />
                    </div>
                    <p className="truncate font-mono text-[11px] text-ink-500">{c.username}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-600">
                      {c.solved_total != null && (
                        <span><b className="font-bold text-ink-900">{c.solved_total}</b> {c.platform === 'github' ? 'repos' : 'solved'}</span>
                      )}
                      {c.contest_rating && <span><b className="font-bold text-ink-900">{c.contest_rating}</b> rating</span>}
                      {c.global_rank && <span>rank {Number(c.global_rank).toLocaleString()}</span>}
                    </div>
                  </a>
                ))}
              </div>
            </Card>
          )}

          {p.education.length > 0 && (
            <Card title="Education" compact icon={IconGraduation}>
              <ul className="space-y-3.5">
                {p.education.map((e) => (
                  <li key={e.id}>
                    <p className="text-sm font-bold text-ink-900">{e.institution}</p>
                    <p className="text-xs text-ink-600">{[e.degree, e.branch].filter(Boolean).join(', ')}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {[e.start_year, e.end_year].filter(Boolean).join(' – ')}
                      {e.score != null && ` · ${e.score}${e.score_type === 'cgpa' ? ' CGPA' : '%'}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.isOwner && (u.email || u.phone) && (
            <Card title="Contact (only you see this)" compact>
              <p className="text-sm text-ink-600">{u.email}</p>
              {u.phone && <p className="text-sm text-ink-600">{u.phone}</p>}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                Visitors never see your email or phone on this page — they reach you through your resume.
              </p>
            </Card>
          )}
        </aside>
      </main>

      <footer className="border-t border-ink-200 bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center sm:px-6">
          <Logo />
          <p className="text-sm text-ink-500">
            Build a profile like this — free for students.{' '}
            <Link to="/login" className="font-semibold text-brand-600 hover:underline">Get started →</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Card({ title, icon: Icon, compact, children }) {
  return (
    <section className={`card ${compact ? 'p-4' : 'p-5 sm:p-6'}`}>
      <h2 className={`mb-4 flex items-center gap-2 font-bold tracking-tight text-ink-900 ${compact ? 'text-sm' : 'text-lg'}`}>
        {Icon && <Icon size={compact ? 15 : 18} className="text-ink-400" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

const groupBy = (list, key) =>
  list.reduce((acc, item) => {
    (acc[item[key]] ||= []).push(item);
    return acc;
  }, {});

function fmt(d) {
  if (!d) return '';
  const date = new Date(String(d).length === 7 ? `${d}-01` : d);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
