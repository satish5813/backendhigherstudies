import { useEffect, useMemo, useState } from 'react';
import { followupApi } from './api';
import Brand from './Brand';

const CAMPUS = 'Vijayawada';

const FILTERS = [
  { key: 'all', label: 'Everyone', pick: () => true },
  { key: 'created', label: 'Profile created', pick: (s) => s.status === 'created' },
  { key: 'pending', label: 'Not yet signed in', pick: (s) => s.status === 'pending' },
  { key: 'resume', label: 'Has a resume', pick: (s) => Boolean(s.resume) },
  { key: 'noresume', label: 'Signed in, no resume', pick: (s) => s.status === 'created' && !s.resume },
  { key: 'public', label: 'Public profile', pick: (s) => Boolean(s.account?.publicUrl) },
];

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export default function Dashboard({ user, onSignOut }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await followupApi.list(CAMPUS));
    } catch (err) {
      setError(err.status === 403 ? 'This dashboard is for the placement cell. Your account is a student account.' : err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const pick = FILTERS.find((f) => f.key === filter)?.pick ?? (() => true);
    const needle = q.trim().toLowerCase();
    return data.items.filter(pick).filter((s) =>
      !needle || s.name.toLowerCase().includes(needle) || String(s.regNo).toLowerCase().includes(needle) || (s.branch || '').toLowerCase().includes(needle)
    );
  }, [data, filter, q]);

  // A new filter or search starts from the first page; the pager stays inside
  // whatever the list currently is.
  useEffect(() => { setPage(1); }, [filter, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const exportCsv = () => {
    const head = ['Name', 'Reg No', 'Branch', 'Cohort', 'Status', 'Last sign-in', 'ATS score', 'Resume', 'Public profile', 'Resume PDF', 'Mobile', 'Placement email', 'Personal email', 'Login email'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((s) => [
      s.name, s.regNo, s.branch, s.cohort, s.status, s.account?.lastLoginAt ? fmtDateTime(s.account.lastLoginAt) : '',
      s.resume?.atsScore ?? '', s.resume?.title ?? '', s.account?.publicUrl ?? '', s.resume?.printUrl ?? '',
      s.contact.mobile, s.contact.placementEmail, s.contact.personalEmail, s.loginEmail,
    ].map(esc).join(','));
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `followup-${CAMPUS.toLowerCase()}-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const s = data?.summary;

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-ink-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink-500 sm:inline">{user.email}</span>
            <button className="btn-secondary h-9 text-xs" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{CAMPUS} campus</p>
            <h1 className="display text-[28px] text-ink-900">Who has turned up, and who has not</h1>
            <p className="mt-1 text-sm text-ink-500">
              {data ? `Updated ${fmtDateTime(data.generatedAt)}` : 'Loading the roster…'}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary h-9 text-xs" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button className="btn-primary h-9 text-xs" onClick={exportCsv} disabled={!rows.length}>Export CSV ({rows.length})</button>
          </div>
        </div>

        {error && <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

        {s && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="On the roster" value={s.roster} onClick={() => setFilter('all')} active={filter === 'all'} />
            <Kpi label="Profile created" value={s.created} sub={pct(s.created, s.roster)} tone="emerald" onClick={() => setFilter('created')} active={filter === 'created'} />
            <Kpi label="Not yet signed in" value={s.pending} sub={pct(s.pending, s.roster)} tone="amber" onClick={() => setFilter('pending')} active={filter === 'pending'} />
            <Kpi label="Has a resume" value={s.withResume} sub={pct(s.withResume, s.roster)} onClick={() => setFilter('resume')} active={filter === 'resume'} />
            <Kpi label="Public profile" value={s.publicProfiles} sub={pct(s.publicProfiles, s.roster)} onClick={() => setFilter('public')} active={filter === 'public'} />
            <Kpi label="Average ATS" value={s.avgAts ?? '—'} sub={`${s.activeLast7Days} active this week`} tone="brand" />
          </div>
        )}

        <div className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              className="input sm:max-w-xs"
              placeholder="Search name, registration number, branch"
              value={q} onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === f.key ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr className="border-b border-ink-200">
                  <th className="py-2 pr-3">Student</th>
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Last sign-in</th>
                  <th className="py-2 pr-3">ATS</th>
                  <th className="py-2 pr-3">Open</th>
                  <th className="py-2 pr-3">Contact</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr><td colSpan={7} className="py-10 text-center text-ink-400">Loading…</td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={7} className="py-10 text-center text-ink-400">No students match.</td></tr>
                ) : pageRows.map((st) => (
                  <tr key={st.regNo} className="border-b border-ink-100 align-top hover:bg-ink-50/60">
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold text-ink-900">{st.name}</p>
                      <p className="text-xs text-ink-500">{st.regNo} · {st.cohort.toUpperCase()}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-700">{st.branch || '—'}</td>
                    <td className="py-2.5 pr-3">
                      {st.status === 'created'
                        ? <Pill tone="emerald">Created{st.account?.onboarded ? '' : ' · onboarding'}</Pill>
                        : <Pill tone="amber">Pending</Pill>}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-700">{fmtDate(st.account?.lastLoginAt)}</td>
                    <td className="py-2.5 pr-3">
                      {st.resume?.atsScore != null
                        ? <Pill tone={st.resume.atsScore >= 70 ? 'emerald' : st.resume.atsScore >= 50 ? 'sky' : 'rose'}>{st.resume.atsScore}</Pill>
                        : <span className="text-ink-400">—</span>}
                      {st.resume?.count > 1 && <span className="ml-1 text-[11px] text-ink-400">+{st.resume.count - 1}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        {st.account?.publicUrl && <a className="link" href={st.account.publicUrl} target="_blank" rel="noreferrer">Profile</a>}
                        {st.resume && <a className="link" href={st.resume.printUrl} target="_blank" rel="noreferrer">Resume PDF</a>}
                        {!st.account?.publicUrl && !st.resume && <span className="text-ink-400">—</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-600">
                      {st.contact.mobile && <p><a className="hover:underline" href={`tel:${st.contact.mobile}`}>{st.contact.mobile}</a></p>}
                      <p><a className="hover:underline" href={`mailto:${st.loginEmail}`}>{st.loginEmail}</a></p>
                      {st.contact.personalEmail && <p className="text-ink-400">{st.contact.personalEmail}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3 text-sm">
              <p className="text-ink-500">
                Showing <span className="font-semibold text-ink-900">{(current - 1) * PER_PAGE + 1}–{Math.min(current * PER_PAGE, rows.length)}</span> of{' '}
                <span className="font-semibold text-ink-900">{rows.length}</span>
              </p>
              <div className="flex items-center gap-1.5">
                <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setPage(1)} disabled={current === 1}>« First</button>
                <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setPage(current - 1)} disabled={current === 1}>‹ Prev</button>
                <span className="px-2 text-xs text-ink-500">Page {current} of {pages}</span>
                <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setPage(current + 1)} disabled={current === pages}>Next ›</button>
                <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setPage(pages)} disabled={current === pages}>Last »</button>
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] text-ink-400">
            Contact details are shown to the placement cell only; every load of this list is recorded in the activity log.
          </p>
        </div>
      </main>
    </div>
  );
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '');

function Kpi({ label, value, sub, tone = 'ink', onClick, active }) {
  const tones = { ink: 'text-ink-900', emerald: 'text-emerald-700', amber: 'text-amber-700', brand: 'text-brand-700' };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`card p-4 text-left transition ${onClick ? 'hover:-translate-y-0.5 hover:shadow-lift' : 'cursor-default'} ${active ? 'ring-2 ring-brand-500' : ''}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
      <p className={`display mt-1 text-[28px] leading-none ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </button>
  );
}

function Pill({ tone = 'slate', children }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    sky: 'bg-sky-50 text-sky-700 ring-sky-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    slate: 'bg-ink-100 text-ink-600 ring-ink-200',
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ${tones[tone]}`}>{children}</span>;
}
