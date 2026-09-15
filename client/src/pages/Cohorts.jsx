import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cohortApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, PageLoader, Spinner } from '../components/ui';
import { IconArrowRight, IconChart, IconSearch, IconUser } from '../components/ui/Icons';

const BAND_TONE = {
  '50 LPA+': 'emerald',
  '20-40 LPA': 'sky',
  '10-20 LPA': 'brand',
  '8-10 LPA': 'amber',
  '6-10 LPA': 'amber',
};

/**
 * The placement cell's roster: every imported student, ranked by readiness,
 * filterable by band and branch. Contact details deliberately are not here —
 * they live on the individual report, where each read is logged.
 */
export default function Cohorts() {
  const [params, setParams] = useSearchParams();
  const code = params.get('cohort') || 'lpa8';
  const band = params.get('band') || '';
  const branch = params.get('branch') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [summary, setSummary] = useState(null);
  const [facets, setFacets] = useState({ branches: [], bands: [] });
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(q);
  const toast = useToast();

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in patch)) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    cohortApi.summary()
      .then((d) => setSummary(d.cohorts))
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      cohortApi.roster(code, { band, branch, q, page, perPage: 50 }),
      cohortApi.facets(code).catch(() => ({ branches: [], bands: [] })),
    ])
      .then(([list, f]) => {
        if (cancelled) return;
        setRoster(list);
        setFacets(f);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, band, branch, q, page]);

  if (!summary) return <PageLoader label="Loading cohorts…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display-md">Students</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every student imported from the placement workbooks, ranked by readiness index.
        </p>
      </header>

      {/* ------------------------------------------------------ cohort cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {summary.map((c) => {
          const active = c.code === code;
          return (
            <button
              key={c.code}
              onClick={() => setParam({ cohort: c.code, band: '', branch: '', q: '' })}
              className={`card p-5 text-left transition ${
                active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'hover:-translate-y-0.5 hover:shadow-lift'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="display-sm">{c.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-400">{c.code}</p>
                </div>
                <Badge tone={active ? 'brand' : 'slate'}>{c.students} students</Badge>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 border-t border-ink-100 pt-3">
                {[
                  ['Avg readiness', c.avg_readiness ?? '—'],
                  ['50 LPA+', c.band_50_plus ?? 0],
                  ['20-40', c.band_20_40 ?? 0],
                  ['Claimed', c.claimed ?? 0],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-lg font-extrabold tracking-tight text-ink-900">{value}</p>
                    <p className="text-[10px] text-ink-400">{label}</p>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- filters */}
      <div className="card space-y-3 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); setParam({ q: search }); }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-10"
              placeholder="Name or registration number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary h-[42px] shrink-0">Search</button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={!band} onClick={() => setParam({ band: '' })}>All bands</Chip>
          {facets.bands.map((b) => (
            <Chip key={b.target_band} active={band === b.target_band} onClick={() => setParam({ band: b.target_band })}>
              {b.target_band} ({b.n})
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={!branch} onClick={() => setParam({ branch: '' })}>All branches</Chip>
          {facets.branches.slice(0, 14).map((b) => (
            <Chip key={b.branch} active={branch === b.branch} onClick={() => setParam({ branch: b.branch })}>
              {b.branch} ({b.n})
            </Chip>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------- roster */}
      {loading ? (
        <PageLoader label="Loading students…" />
      ) : !roster?.items?.length ? (
        <EmptyState icon={IconUser} title="No students match" message="Clear a filter and try again." />
      ) : (
        <>
          <p className="text-sm text-ink-500">
            {roster.total} student{roster.total === 1 ? '' : 's'}
            {band ? ` in ${band}` : ''}{branch ? ` · ${branch}` : ''}
          </p>

          <div className="card overflow-hidden">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-left">
                    {['#', 'Student', 'Branch', 'Placed', 'Band', 'Readiness', 'CRT', 'CGPA', ''].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {roster.items.map((s, i) => (
                    <tr key={s.reg_no} className="transition hover:bg-ink-50/60">
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                        {(page - 1) * 50 + i + 1}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/app/students/${code}/${s.reg_no}`}
                          className="font-semibold text-ink-900 hover:text-brand-700"
                        >
                          {s.name}
                        </Link>
                        <p className="font-mono text-[11px] text-ink-400">{s.reg_no}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-600">{s.branch || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-600">
                        {s.company || '—'}
                        {s.ctc ? <span className="block text-[11px] text-emerald-600">₹{s.ctc} LPA</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {s.target_band ? (
                          <Badge tone={BAND_TONE[s.target_band] ?? 'slate'}>{s.target_band}</Badge>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {s.readiness_index != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-100">
                              <div
                                className="h-full rounded-full bg-brand-500"
                                style={{ width: `${Math.min(100, s.readiness_index)}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-ink-700">{s.readiness_index}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-600">
                        {s.crt_avg_pct != null ? `${s.crt_avg_pct}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-600">{s.ug_cgpa ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {s.claimed && <Badge tone="emerald">claimed</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {roster.pages > 1 && (
            <div className="flex items-center justify-between">
              <button
                className="btn-secondary h-9 text-xs"
                disabled={page <= 1}
                onClick={() => setParam({ page: String(page - 1) })}
              >
                ← Previous
              </button>
              <span className="text-xs text-ink-500">
                {loading ? <Spinner size={14} /> : `Page ${roster.page} of ${roster.pages}`}
              </span>
              <button
                className="btn-secondary h-9 text-xs"
                disabled={page >= roster.pages}
                onClick={() => setParam({ page: String(page + 1) })}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-brand-600 text-white shadow-sm' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
