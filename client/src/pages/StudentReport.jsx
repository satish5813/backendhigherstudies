import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cohortApi } from '../lib/api';
import { Badge, EmptyState, PageLoader, ScoreRing } from '../components/ui';
import {
  IconArrowLeft, IconAward, IconCode, IconDownload, IconExternal, IconUser,
} from '../components/ui/Icons';

const BAND_TONE = {
  '50 LPA+': 'emerald', '20-40 LPA': 'sky', '10-20 LPA': 'brand',
  '8-10 LPA': 'amber', '6-10 LPA': 'amber',
};

const DIMENSIONS = [
  ['dsa', 'DSA'], ['cp', 'Competitive programming'], ['crt', 'CRT assessments'],
  ['dev', 'Development'], ['consistency', 'Consistency'], ['academic', 'Academics'],
];

/**
 * One student's full profiling report, for the placement cell.
 * Print-friendly: the `print-root` / `no-print` classes give a clean hand-out.
 */
export default function StudentReport() {
  const { code, regNo } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    cohortApi
      .student(code, regNo)
      .then((data) => { if (!cancelled) setState({ loading: false, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err }); });
    return () => { cancelled = true; };
  }, [code, regNo]);

  if (state.loading) return <PageLoader label="Loading the report…" />;
  if (state.error) {
    return (
      <EmptyState
        icon={IconUser}
        title={state.error.status === 403 ? 'Admin access required' : 'Report not found'}
        message={state.error.message}
        action={<Link to="/app/students" className="btn-primary">Back to students</Link>}
      />
    );
  }

  const s = state.data;
  const tone = BAND_TONE[s.band.target] ?? 'brand';
  const percentile =
    s.band.rankInCohort && s.band.cohortSize
      ? Math.max(1, Math.round((s.band.rankInCohort / s.band.cohortSize) * 100))
      : null;

  return (
    <div className="print-root space-y-6">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link to="/app/students" className="btn-ghost h-9 px-2">
          <IconArrowLeft size={17} /> All students
        </Link>
        <button onClick={() => window.print()} className="btn-secondary h-9 text-xs">
          <IconDownload size={14} /> Print / save as PDF
        </button>
      </header>

      {/* ------------------------------------------------------------ header */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 p-5">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-ink-900">{s.name}</h1>
            <p className="mt-1 text-sm text-ink-500">
              <span className="font-mono">{s.regNo}</span>
              {s.branch ? ` · ${s.branch}` : ''}{s.campus ? ` · ${s.campus}` : ''}
              {` · ${s.cohort.name}`}
            </p>
            {s.company && (
              <p className="mt-1.5 text-sm font-semibold text-emerald-600">
                Placed at {s.company}{s.ctc ? ` · ₹${s.ctc} LPA` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {s.band.target && <Badge tone={tone}>Target band {s.band.target}</Badge>}
            {s.claimed ? <Badge tone="emerald">Account claimed</Badge> : <Badge tone="slate">Not claimed</Badge>}
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <ScoreRing
              value={s.band.readinessIndex ?? 0}
              size={112}
              stroke={10}
              sublabel="readiness"
              tone={tone === 'brand' ? 'brand' : tone}
            />
            <div className="space-y-1 text-sm">
              {s.band.rankInCohort && (
                <p className="text-ink-700">
                  Rank <b className="font-bold text-ink-900">{s.band.rankInCohort}</b>
                  <span className="text-ink-400"> of {s.band.cohortSize}</span>
                </p>
              )}
              {percentile != null && <p className="text-ink-500">Top {percentile}% of the cohort</p>}
              {s.band.nearNext && <p className="text-xs font-semibold text-emerald-600">{s.band.nearNext}</p>}
            </div>
          </div>

          <div className="space-y-2.5">
            {DIMENSIONS.filter(([k]) => s.scores[k] != null).map(([key, label]) => {
              const v = Math.max(0, Math.min(100, s.scores[key]));
              const cls = v >= 70 ? 'bg-emerald-500' : v >= 45 ? 'bg-sky-500' : v >= 25 ? 'bg-amber-500' : 'bg-rose-500';
              return (
                <div key={key}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-ink-700">{label}</span>
                    <span className="font-mono text-[11px] text-ink-400">{v}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className={`h-full rounded-full ${cls}`} style={{ width: `${v}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------------ academics */}
        <section className="card p-5">
          <h2 className="text-base font-bold tracking-tight text-ink-900">Academics & CRT</h2>
          <dl className="mt-3 divide-y divide-ink-100">
            {[
              ['UG CGPA', s.academics.ug],
              ['Inter / Diploma', s.academics.inter],
              ['SSC', s.academics.ssc],
              ['CRT average', s.crt.avgPercent != null ? `${s.crt.avgPercent}%` : null],
              ['CRT percentile', s.crt.percentile],
              ['CRT attendance', s.crt.attendance != null ? `${s.crt.attendance}%` : null],
            ]
              .filter(([, v]) => v != null)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between py-2">
                  <dt className="text-sm text-ink-500">{label}</dt>
                  <dd className="font-mono text-sm font-semibold text-ink-900">{value}</dd>
                </div>
              ))}
          </dl>

          {s.crt.assessments.length > 0 && (
            <>
              <p className="section-title mb-2 mt-4">Assessments</p>
              <div className="flex flex-wrap gap-1.5">
                {s.crt.assessments.map((a) => (
                  <span key={a.no} className="rounded-lg border border-ink-200 px-2.5 py-1">
                    <span className="text-[10px] font-bold uppercase text-ink-400">#{a.no}</span>
                    <span className="ml-1.5 font-mono text-xs font-bold text-ink-900">{a.score}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        {/* --------------------------------------------------------- coding */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
            <IconCode size={17} className="text-ink-400" /> Coding evidence
          </h2>
          {s.coding.length ? (
            <div className="mt-3 space-y-3">
              {s.coding.map((c) => (
                <div key={c.platform} className="rounded-xl border border-ink-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold capitalize text-ink-900">{c.platform}</span>
                    <Badge tone={c.confidence === 'HIGH' ? 'emerald' : c.confidence === 'LOW' ? 'amber' : 'slate'}>
                      {c.confidence?.toLowerCase() ?? 'unknown'}
                    </Badge>
                  </div>
                  {c.username && (
                    <a
                      href={c.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-brand-600 hover:underline"
                    >
                      {c.username} {c.url && <IconExternal size={10} />}
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-600">
                    {c.solved != null && <span><b className="text-ink-900">{c.solved}</b> solved</span>}
                    {c.rating != null && <span><b className="text-ink-900">{c.rating}</b> rating</span>}
                    {c.maxRating != null && <span>max {c.maxRating}</span>}
                    {c.stars != null && <span>{c.stars}★</span>}
                    {c.repos != null && <span><b className="text-ink-900">{c.repos}</b> repos</span>}
                    {c.totalStars != null && <span>{c.totalStars} stars</span>}
                  </div>
                  {(c.easy != null || c.medium != null || c.hard != null) && (
                    <p className="mt-1.5 text-[11px] text-ink-400">
                      E {c.easy ?? '—'} · M {c.medium ?? '—'} · H {c.hard ?? '—'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-500">No coding profile was matched for this student.</p>
          )}
        </section>

        {/* -------------------------------------------------------- contact */}
        <section className="card p-5">
          <h2 className="text-base font-bold tracking-tight text-ink-900">Contact</h2>
          <p className="mt-0.5 text-[11px] text-ink-400">Visible to placement staff. Every view is logged.</p>
          <dl className="mt-3 divide-y divide-ink-100">
            {[
              ['Placement email', s.contact.placementEmail],
              ['Personal email', s.contact.personalEmail],
              ['Mobile', s.contact.mobile],
              ['Gender', s.contact.gender],
              ['Date of birth', s.contact.dateOfBirth],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2">
                  <dt className="shrink-0 text-sm text-ink-500">{label}</dt>
                  <dd className="truncate text-sm font-medium text-ink-900">{value}</dd>
                </div>
              ))}
          </dl>
          {!s.contact.placementEmail && !s.contact.personalEmail && !s.contact.mobile && (
            <p className="mt-3 text-sm text-ink-500">
              No contact details in the source workbook for this student.
            </p>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------ notes */}
      {(s.coaching.strengths || s.coaching.gaps || s.coaching.plan || s.coaching.notes) && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
            <IconAward size={17} className="text-ink-400" /> Analysis
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            {[
              ['Strengths', s.coaching.strengths, 'text-emerald-600'],
              ['Gaps', s.coaching.gaps, 'text-amber-600'],
              ['Plan to next band', s.coaching.plan, 'text-brand-600'],
            ]
              .filter(([, text]) => text)
              .map(([label, text, colour]) => (
                <div key={label}>
                  <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${colour}`}>{label}</p>
                  <p className="text-[13px] leading-relaxed text-ink-600">{text}</p>
                </div>
              ))}
          </div>
          {s.coaching.notes && (
            <p className="mt-4 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
              {s.coaching.notes}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
