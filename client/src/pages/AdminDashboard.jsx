import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cohortApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, PageLoader, ScoreRing } from '../components/ui';
import {
  IconArrowRight, IconAward, IconBriefcase, IconChart, IconCode,
  IconGraduation, IconLayers, IconUser,
} from '../components/ui/Icons';

const BAND_COLOUR = {
  '50 LPA+': '#059669',
  '20-40 LPA': '#0284c7',
  '10-20 LPA': '#4f46e5',
  '8-10 LPA': '#d97706',
  '6-10 LPA': '#d97706',
};

/**
 * Placement-cell overview for one cohort. Everything here is an aggregate the
 * staff already own; the identifiable detail lives one click away on each
 * student's own report.
 */
export default function AdminDashboard() {
  const [cohorts, setCohorts] = useState(null);
  const [code, setCode] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    cohortApi.summary()
      .then((d) => {
        setCohorts(d.cohorts);
        setCode(d.cohorts.find((c) => c.students > 0)?.code ?? d.cohorts[0]?.code ?? null);
      })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true);
    cohortApi.analytics(code)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => toast.error(err.message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!cohorts) return <PageLoader label="Loading cohorts…" />;
  if (!cohorts.length) {
    return (
      <EmptyState
        icon={IconLayers}
        title="No cohorts imported yet"
        message="Run the importer to load the placement workbooks: node server/src/db/import-cohorts.js"
      />
    );
  }

  const t = data?.totals ?? {};
  const claimedPct = t.students ? Math.round((t.claimed / t.students) * 100) : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-title text-brand-600">KL University · Placement cell</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-ink-900">Cohort dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            {data?.cohort?.name ?? '—'} · imported from the placement workbooks.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {cohorts.map((c) => (
            <button
              key={c.code}
              onClick={() => setCode(c.code)}
              className={`rounded-xl border px-4 py-2.5 text-left transition ${
                c.code === code
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20'
                  : 'border-ink-200 bg-white hover:border-ink-300'
              }`}
            >
              <p className="text-sm font-bold text-ink-900">{c.name}</p>
              <p className="font-mono text-[11px] text-ink-400">{c.code} · {c.students} students</p>
            </button>
          ))}
        </div>
      </header>

      {loading || !data ? (
        <PageLoader label="Crunching the numbers…" />
      ) : (
        <>
          {/* ------------------------------------------------------ headline */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={IconUser} label="Students" value={t.students} sub={`${t.banded} with a readiness band`} tone="brand" />
            <Metric icon={IconChart} label="Avg readiness" value={t.avg_readiness ?? '—'} sub="index out of 100" tone="sky" />
            <Metric icon={IconGraduation} label="Avg UG CGPA" value={t.avg_cgpa ?? '—'} sub={`CRT average ${t.avg_crt ?? '—'}%`} tone="emerald" />
            <Metric icon={IconBriefcase} label="Avg package" value={t.avg_ctc ? `₹${t.avg_ctc}L` : '—'} sub={t.max_ctc ? `top ₹${t.max_ctc}L` : ''} tone="amber" />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* --------------------------------------------------- bands */}
            <section className="card p-5 lg:col-span-2">
              <h2 className="text-base font-bold tracking-tight text-ink-900">Readiness bands</h2>
              <p className="text-sm text-ink-500">Where the cohort could realistically target.</p>

              <div className="mt-5 space-y-3">
                {data.bands.map((b) => {
                  const pct = t.banded ? (b.n / t.banded) * 100 : 0;
                  return (
                    <Link
                      key={b.label}
                      to={`/app/students?cohort=${code}&band=${encodeURIComponent(b.label)}`}
                      className="group block"
                    >
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-ink-800 group-hover:text-brand-700">{b.label}</span>
                        <span className="font-mono text-xs text-ink-500">
                          {b.n} <span className="text-ink-400">({Math.round(pct)}%)</span>
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: BAND_COLOUR[b.label] ?? '#64748b' }}
                        />
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-400">avg readiness {b.avg_readiness ?? '—'}</p>
                    </Link>
                  );
                })}
              </div>

              <div className="mt-6 border-t border-ink-100 pt-4">
                <p className="section-title mb-2.5">Readiness distribution</p>
                <Histogram buckets={data.readiness} />
              </div>
            </section>

            {/* ------------------------------------------------- adoption */}
            <section className="card flex flex-col p-5">
              <h2 className="text-base font-bold tracking-tight text-ink-900">Account adoption</h2>
              <p className="text-sm text-ink-500">Students who have claimed their record.</p>

              <div className="mt-4 flex flex-col items-center">
                <ScoreRing value={claimedPct} size={128} stroke={11} sublabel="claimed" tone={claimedPct > 50 ? 'emerald' : 'amber'} />
                <p className="mt-3 text-center text-sm text-ink-600">
                  <b className="font-bold text-ink-900">{t.claimed}</b> of {t.students} students
                </p>
              </div>

              <dl className="mt-5 space-y-2 border-t border-ink-100 pt-4">
                {[
                  ['CRT measured', data.crt.measured],
                  ['CRT above 80%', data.crt.above_80],
                  ['CRT below 50%', data.crt.below_50],
                  ['With coding evidence', data.coding.with_any],
                  ['Avg LeetCode solved', data.coding.avg_lc_solved],
                ]
                  .filter(([, v]) => v != null)
                  .map(([label, value]) => (
                    <div key={label} className="flex justify-between text-sm">
                      <dt className="text-ink-500">{label}</dt>
                      <dd className="font-mono font-semibold text-ink-900">{value}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ------------------------------------------------- branches */}
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
                <IconLayers size={17} className="text-ink-400" /> By branch
              </h2>
              <div className="mt-4 space-y-2.5">
                {data.branches.map((b) => {
                  const max = Math.max(...data.branches.map((x) => x.n));
                  return (
                    <Link
                      key={b.label}
                      to={`/app/students?cohort=${code}&branch=${encodeURIComponent(b.label)}`}
                      className="group flex items-center gap-3"
                    >
                      <span className="w-20 shrink-0 truncate text-xs font-semibold text-ink-700 group-hover:text-brand-700">
                        {b.label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(b.n / max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono text-xs text-ink-500">{b.n}</span>
                      <span className="w-10 text-right font-mono text-[11px] text-ink-400">{b.avg_readiness ?? '—'}</span>
                    </Link>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-ink-400">Right column is the branch's average readiness index.</p>
            </section>

            {/* ------------------------------------------------ companies */}
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
                <IconBriefcase size={17} className="text-ink-400" /> Where they were placed
              </h2>
              <div className="mt-4 space-y-2.5">
                {data.companies.map((c) => {
                  const max = Math.max(...data.companies.map((x) => x.n));
                  return (
                    <div key={c.label} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-xs font-semibold text-ink-700" title={c.label}>
                        {c.label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(c.n / max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono text-xs text-ink-500">{c.n}</span>
                      <span className="w-12 text-right font-mono text-[11px] text-emerald-600">
                        {c.avg_ctc ? `₹${c.avg_ctc}L` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* ----------------------------------------------------- top ten */}
          <section className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
                  <IconAward size={17} className="text-amber-500" /> Top 10 by readiness
                </h2>
                <p className="text-sm text-ink-500">Your strongest candidates for high-band roles.</p>
              </div>
              <Link to={`/app/students?cohort=${code}`} className="btn-secondary h-9 text-xs">
                All students <IconArrowRight size={14} />
              </Link>
            </header>

            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-left">
                    {['#', 'Student', 'Branch', 'Band', 'Readiness', 'CGPA', 'Placed'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.top.map((s, i) => (
                    <tr key={s.reg_no} className="transition hover:bg-ink-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-400">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/app/students/${code}/${s.reg_no}`} className="font-semibold text-ink-900 hover:text-brand-700">
                          {s.name}
                        </Link>
                        <p className="font-mono text-[11px] text-ink-400">{s.reg_no}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">{s.branch || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={s.target_band === '50 LPA+' ? 'emerald' : s.target_band === '20-40 LPA' ? 'sky' : 'brand'}>
                          {s.target_band}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink-900">{s.readiness_index}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-600">{s.ug_cgpa ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">
                        {s.company || '—'}{s.ctc ? <span className="text-emerald-600"> ₹{s.ctc}L</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="card p-5">
      <div className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon size={18} />
      </div>
      <p className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900">{value ?? '—'}</p>
      <p className="text-[13px] font-semibold text-ink-700">{label}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-400">{sub}</p>}
    </div>
  );
}

/** Ten-point readiness buckets as a small column chart. */
function Histogram({ buckets }) {
  if (!buckets?.length) return <p className="text-sm text-ink-400">No readiness scores yet.</p>;
  const max = Math.max(...buckets.map((b) => b.n));
  const filled = Array.from({ length: 10 }, (_, i) => {
    const found = buckets.find((b) => b.bucket === i * 10);
    return { bucket: i * 10, n: found?.n ?? 0 };
  });

  return (
    <div>
      <div className="flex h-24 items-end gap-1.5">
        {filled.map((b) => (
          <div key={b.bucket} className="group flex flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[10px] font-bold text-ink-400 opacity-0 transition group-hover:opacity-100">
              {b.n}
            </span>
            <div
              className="w-full rounded-t bg-brand-400 transition-all duration-500 group-hover:bg-brand-600"
              style={{ height: `${max ? Math.max((b.n / max) * 100, b.n ? 4 : 0) : 0}%` }}
              title={`${b.bucket}–${b.bucket + 9}: ${b.n} students`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {filled.map((b) => (
          <span key={b.bucket} className="flex-1 text-center font-mono text-[9px] text-ink-400">{b.bucket}</span>
        ))}
      </div>
    </div>
  );
}
