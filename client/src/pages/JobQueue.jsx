import { useCallback, useEffect, useMemo, useState } from 'react';
import { jobsApi } from '../lib/api';
import { Badge, EmptyState, PageLoader, Spinner } from '../components/ui';
import CompanyMark from '../components/ui/CompanyMark';
import { useToast } from '../components/ui/Toast';
import {
  IconAlert, IconBriefcase, IconCheck, IconExternal, IconRefresh, IconSearch, IconTrash,
} from '../components/ui/Icons';

const TABS = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'approved', label: 'Published' },
  { key: 'rejected', label: 'Rejected' },
];

/**
 * The gate between the nightly sweep and 656 students.
 *
 * Bulk selection is the primary interaction, not an afterthought: a morning's
 * queue is often 200 rows, and an officer who has to open each one will stop
 * using the feature by Wednesday.
 */
export default function JobQueue() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [sources, setSources] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    const res = await jobsApi.queue({ status: tab, q, perPage: 100 });
    setData(res);
    setSelected(new Set());
  }, [tab, q]);

  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [load]);
  useEffect(() => { jobsApi.sources().then(setSources).catch(() => {}); }, []);

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && selected.size === items.length;

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  async function decide(kind) {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = kind === 'approve' ? await jobsApi.approve(ids) : await jobsApi.reject(ids);

      if (kind === 'approve') {
        const held = res.heldBack?.length ?? 0;
        toast.success(
          `${res.updated} opening${res.updated === 1 ? '' : 's'} published to students.`
          + (res.verified ? ` ${res.verified} link${res.verified === 1 ? '' : 's'} checked first.` : '')
        );
        // Held-back rows are a decision the officer still has to make, so they
        // get their own message rather than being buried in the success toast.
        if (held) {
          toast.error(
            `${held} held back — the apply link is dead: `
            + res.heldBack.map((d) => d.company).join(', ')
          );
        }
      } else {
        toast.success(`${res.updated} rejected.`);
      }
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyLinks() {
    setVerifying(true);
    try {
      const r = await jobsApi.verifyLinks();
      toast.success(
        r.checked
          ? `Checked ${r.checked}: ${r.live + r.redirect} working, ${r.dead} dead, ${r.blocked} could not be reached.`
          : 'Every link here was checked recently.'
      );
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setVerifying(false);
    }
  }

  async function runIngest() {
    setIngesting(true);
    try {
      const res = await jobsApi.ingest();
      const live = res.runs.filter((r) => r.status !== 'skipped');
      toast.success(
        res.inserted
          ? `Found ${res.inserted} new opening${res.inserted === 1 ? '' : 's'} across ${live.length} sources.`
          : 'Sweep finished — nothing new since the last run.'
      );
      setSources(await jobsApi.sources());
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setIngesting(false);
    }
  }

  if (!data) return <PageLoader label="Loading the queue…" />;

  const counts = data.counts ?? {};

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="display-md">Job queue</h1>
          <p className="mt-1 text-sm text-ink-500">
            Sourced openings wait here. Nothing reaches a student until you approve it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={verifyLinks} disabled={verifying} className="btn-secondary h-10">
            {verifying ? <Spinner size={15} /> : <IconCheck size={15} />}
            {verifying ? 'Checking links…' : 'Verify apply links'}
          </button>
          <button onClick={runIngest} disabled={ingesting} className="btn-secondary h-10">
            {ingesting ? <Spinner size={15} /> : <IconRefresh size={15} />}
            {ingesting ? 'Searching…' : 'Search for jobs now'}
          </button>
        </div>
      </div>

      <SourcePanel sources={sources} />

      {/* -------------------------------------------------------------- tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold transition ${
              tab === t.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-black text-ink-600">
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5 pb-1.5">
          <IconSearch size={14} className="text-ink-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by title or company"
            className="h-8 w-56 rounded-lg border border-ink-200 px-2.5 text-sm"
          />
        </div>
      </div>

      {/* ------------------------------------------------------- bulk action */}
      {items.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white/95 px-3 py-2 backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
              className="h-4 w-4 rounded border-ink-300"
            />
            {selected.size ? `${selected.size} selected` : `Select all ${items.length}`}
          </label>

          {selected.size > 0 && tab !== 'approved' && (
            <button onClick={() => decide('approve')} disabled={busy} className="btn-primary h-8 text-xs">
              <IconCheck size={14} /> Publish to students
            </button>
          )}
          {selected.size > 0 && tab !== 'rejected' && (
            <button
              onClick={() => decide('reject')}
              disabled={busy}
              className="btn-ghost h-8 text-xs text-rose-600 hover:bg-rose-50"
            >
              <IconTrash size={14} /> Reject
            </button>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- rows */}
      {items.length === 0 ? (
        <EmptyState
          icon={IconBriefcase}
          title={tab === 'pending' ? 'Nothing waiting' : `No ${tab} openings`}
          message={
            tab === 'pending'
              ? 'The sweep runs nightly. Use “Search for jobs now” to pull the latest immediately.'
              : 'Approved openings appear on the student job board.'
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((job) => (
            <QueueRow
              key={job.id}
              job={job}
              checked={selected.has(job.id)}
              onToggle={() => toggle(job.id)}
              open={expanded === job.id}
              onExpand={() => setExpanded(expanded === job.id ? null : job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- rows */

function QueueRow({ job, checked, onToggle, open, onExpand }) {
  const estimated = job.ctcSource === 'estimated';

  return (
    <div
      className={`rounded-xl border transition ${
        checked
          ? 'border-brand-400 bg-white ring-1 ring-brand-500/20'
          : job.link?.status === 'dead'
            ? 'border-rose-200 bg-rose-50/40'
            : 'border-ink-200 bg-white hover:border-ink-300'
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0 rounded border-ink-300"
        />

        <CompanyMark name={job.company} size={34} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold text-ink-900">{job.title}</span>
            <span className="text-sm text-ink-500">· {job.company}</span>
            <Badge tone="slate">{job.source}</Badge>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-500">
            {job.location && <span>{job.location}</span>}
            <span className="capitalize">{job.workMode ?? job.work_mode}</span>
            {(job.minCtc ?? job.min_ctc) != null && (
              <span className="font-semibold text-ink-700">
                ₹{job.minCtc ?? job.min_ctc}–{job.maxCtc ?? job.max_ctc} LPA
              </span>
            )}
            {/* An inferred package must never look like a published one. */}
            {estimated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                <IconAlert size={11} /> package estimated from the job title
              </span>
            )}
          </div>

          {open && job.excerpt && (
            <p className="mt-2 whitespace-pre-line rounded-lg bg-ink-50 p-2.5 text-[12.5px] leading-relaxed text-ink-600">
              {job.excerpt}
              {job.excerpt.length >= 400 && '…'}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
            <button onClick={onExpand} className="font-semibold text-brand-700 hover:underline">
              {open ? 'Hide description' : 'Read description'}
            </button>
            {job.applyUrl && (
              <a
                href={job.link?.finalUrl || job.applyUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline"
              >
                <IconExternal size={12} /> Open the apply page
              </a>
            )}
            <LinkStatus link={job.link} />
            {job.reviewNote && <span className="text-ink-400">Note: {job.reviewNote}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What the last link check found.
 *
 * "blocked" is worth showing separately from "dead": a careers site that rate-
 * limits us or refuses a non-browser request tells us nothing about whether the
 * posting exists, and marking it dead would have an officer rejecting real
 * openings. It reads as "look yourself", which is the honest instruction.
 */
function LinkStatus({ link }) {
  if (!link || link.status === 'unchecked') {
    return <span className="text-[11.5px] text-ink-400">link not checked</span>;
  }

  const map = {
    live: ['text-emerald-700', 'apply link works'],
    redirect: ['text-emerald-700', 'works (redirects)'],
    dead: ['text-rose-700', `dead link${link.code ? ' · ' + link.code : ''}`],
    blocked: ['text-amber-700', `could not check${link.code ? ' · ' + link.code : ''} — open it yourself`],
  };
  const [tone, label] = map[link.status] ?? ['text-ink-400', link.status];

  return <span className={`text-[11.5px] font-semibold ${tone}`}>{label}</span>;
}

/* ---------------------------------------------------------------- sources */

function SourcePanel({ sources }) {
  const lastRuns = useMemo(() => {
    const seen = new Map();
    for (const r of sources?.runs ?? []) if (!seen.has(r.source)) seen.set(r.source, r);
    return seen;
  }, [sources]);

  if (!sources) return null;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-title">Where jobs come from</p>
        <p className="text-[12px] text-ink-500">
          Keeping openings paying <strong className="text-ink-700">₹{sources.minCtc} LPA</strong> and above, in India.
          {sources.autoIngest && ` Runs daily at ${String(sources.ingestHour).padStart(2, '0')}:00.`}
        </p>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sources.sources.map((s) => {
          const run = lastRuns.get(s.id);
          return (
            <div key={s.id} className="rounded-lg border border-ink-100 bg-ink-50/60 p-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    !s.enabled ? 'bg-ink-300' : run?.status === 'failed' ? 'bg-rose-500' : 'bg-emerald-500'
                  }`}
                />
                <span className="text-sm font-bold text-ink-800">{s.label}</span>
              </div>
              {s.enabled ? (
                <p className="mt-0.5 text-[11.5px] text-ink-500">
                  {run
                    ? `Last run: ${run.found} seen, ${run.inserted} queued${run.error ? ` — ${run.error}` : ''}`
                    : 'Never run'}
                </p>
              ) : (
                // Say exactly what is missing rather than just "disabled".
                <p className="mt-0.5 text-[11.5px] text-ink-400">Off. Needs {s.needs}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
