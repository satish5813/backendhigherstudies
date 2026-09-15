import { useEffect, useState } from 'react';
import { jobsApi } from '../lib/api';
import { Badge, EmptyState, PageLoader } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import AuthedImage from '../components/ui/AuthedImage';
import { IconBriefcase, IconCheck, IconExternal } from '../components/ui/Icons';
import { STATUS_LABEL, STATUS_TONE } from '../components/jobs/ApplyTracker';

/**
 * Who applied where — the number the placement cell could never get out of a
 * spreadsheet.
 */
export default function Applications() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [proof, setProof] = useState(null);

  useEffect(() => {
    jobsApi.applicationStats(60).then(setData).catch((e) => toast.error(e.message));
  }, []);

  if (!data) return <PageLoader label="Counting applications…" />;

  const { totals, byStatus, topJobs, recent } = data;

  if (!totals.total) {
    return (
      <EmptyState
        icon={IconBriefcase}
        title="No applications yet"
        message="Once students start marking openings as applied, their activity appears here with the proof screenshots they attach."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display-md">Applications</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every opening a student has marked applied, and the proof they attached.
        </p>
      </div>

      {/* ------------------------------------------------------------ totals */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Applications" value={totals.total} />
        <Stat label="Students applying" value={totals.students} />
        <Stat label="Openings applied to" value={totals.jobs} />
        <Stat
          label="With proof attached"
          value={`${totals.proofRate}%`}
          sub={`${totals.with_proof} of ${totals.total}`}
          // Below half, the numbers are mostly self-reported — say so rather
          // than presenting the count as verified.
          tone={totals.proofRate >= 50 ? 'emerald' : 'amber'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(byStatus).map(([status, n]) => (
          <Badge key={status} tone={STATUS_TONE[status] ?? 'slate'}>
            {STATUS_LABEL[status] ?? status}: {n}
          </Badge>
        ))}
      </div>

      {/* --------------------------------------------------------- top jobs */}
      <section>
        <h2 className="section-title">Most applied to</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50/70 text-left text-[12px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2 font-bold">Opening</th>
                <th className="px-3 py-2 font-bold">Package</th>
                <th className="px-3 py-2 text-right font-bold">Applicants</th>
                <th className="px-3 py-2 text-right font-bold">With proof</th>
              </tr>
            </thead>
            <tbody>
              {topJobs.map((j) => (
                <tr key={j.id} className="border-b border-ink-50 last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-bold text-ink-900">{j.title}</span>
                    <span className="text-ink-500"> · {j.company}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {j.min_ctc != null ? `₹${j.min_ctc}–${j.max_ctc} LPA` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-ink-900">{j.applicants}</td>
                  <td className="px-3 py-2 text-right text-ink-600">{Number(j.with_proof ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- recent */}
      <section>
        <h2 className="section-title">Recent activity</h2>
        <div className="mt-2 space-y-1.5">
          {recent.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ink-200 bg-white px-3 py-2"
            >
              <span className="font-bold text-ink-900">{r.student.name ?? 'Unnamed student'}</span>
              <span className="text-[12.5px] text-ink-400">
                {[r.student.branch, r.student.gradYear].filter(Boolean).join(' · ')}
              </span>
              <span className="text-sm text-ink-600">
                → {r.job.title} at {r.job.company}
              </span>
              <Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12px] text-ink-400">
                  {new Date(r.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
                {r.hasProof ? (
                  <button
                    onClick={() => setProof(r)}
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-emerald-700 hover:underline"
                  >
                    <IconCheck size={12} /> View proof
                  </button>
                ) : (
                  <span className="text-[12px] text-ink-300">no proof</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {proof && <ProofViewer row={proof} onClose={() => setProof(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'slate' }) {
  const ring = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50/50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50/50'
      : 'border-ink-200 bg-white';
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <p className="section-title">{label}</p>
      <p className="mt-0.5 text-2xl font-black text-ink-900">{value}</p>
      {sub && <p className="text-[11.5px] text-ink-500">{sub}</p>}
    </div>
  );
}

/**
 * The screenshot itself. It is fetched with the session's own credentials from
 * an authenticated endpoint — there is no public URL for these images, which is
 * the point of storing them outside the static tree.
 */
function ProofViewer({ row, onClose }) {
  // The blob URL AuthedImage created. "Full size" opens that same object —
  // pointing the link at the API path would make a second, unauthenticated
  // request and fail exactly the way the <img> used to.
  const [blobUrl, setBlobUrl] = useState(null);

  // Escape closes, which is what anyone expects of a lightbox.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Application proof from ${row.student.name}`}
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-black text-ink-900">{row.student.name}</p>
            <p className="truncate text-sm text-ink-500">{row.job.title} at {row.job.company}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {blobUrl && (
              <a href={blobUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost h-8 text-xs">
                <IconExternal size={13} /> Full size
              </a>
            )}
            <button onClick={onClose} className="btn-secondary h-8 text-xs">Close</button>
          </div>
        </div>

        <AuthedImage
          src={row.proofUrl.replace(/^\/api/, '')}
          alt={`Application confirmation from ${row.student.name}`}
          className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-ink-200 object-contain"
          onUrl={setBlobUrl}
        />
      </div>
    </div>
  );
}
