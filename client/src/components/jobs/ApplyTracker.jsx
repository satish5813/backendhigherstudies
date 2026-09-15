import { useRef, useState } from 'react';
import { jobsApi } from '../../lib/api';
import { Badge, Spinner } from '../ui';
import { useToast } from '../ui/Toast';
import { IconAlert, IconCheck, IconExternal } from '../ui/Icons';
import AuthedImage from '../ui/AuthedImage';

export const STATUS_LABEL = {
  applied: 'Applied',
  screening: 'In screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE = {
  applied: 'brand',
  screening: 'amber',
  interviewing: 'amber',
  offer: 'emerald',
  rejected: 'slate',
  withdrawn: 'slate',
};

/**
 * "I applied to this" — and the proof.
 *
 * The screenshot is the part that makes the placement cell's numbers real. A
 * self-reported count is a guess; a confirmation screen is evidence. It stays
 * optional, because a student who genuinely applied should not be marked down
 * for closing the tab too early.
 */
export default function ApplyTracker({ job, application, onChange, compact }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const fileRef = useRef(null);

  async function markApplied() {
    setBusy(true);
    try {
      const created = await jobsApi.apply(job.id);
      onChange?.(created);
      toast.success('Tracked. Add the confirmation screenshot when you have it.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {
    setBusy(true);
    try {
      onChange?.(await jobsApi.updateApplication(application.id, { status }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadProof(file) {
    if (!file) return;
    setUploading(true);
    try {
      const updated = await jobsApi.uploadProof(application.id, file);
      onChange?.(updated);
      toast.success('Screenshot attached.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  /* ------------------------------------------------- not applied yet */
  if (!application) {
    return (
      <div className={compact ? '' : 'rounded-xl border border-ink-200 bg-white p-3'}>
        <div className="flex flex-wrap items-center gap-2">
          {job.applyUrl && (
            <a
              href={job.applyUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-primary h-9 text-xs"
            >
              <IconExternal size={14} /> Apply on the company site
            </a>
          )}
          <button onClick={markApplied} disabled={busy} className="btn-secondary h-9 text-xs">
            {busy ? <Spinner size={14} /> : <IconCheck size={14} />} I applied
          </button>
        </div>
        {!compact && (
          <p className="mt-1.5 text-[11.5px] text-ink-400">
            Marking it here lets the placement cell see where the batch is applying.
          </p>
        )}
      </div>
    );
  }

  /* ----------------------------------------------------- already applied */
  return (
    <div className={compact ? '' : 'rounded-xl border border-emerald-200 bg-emerald-50/50 p-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[application.status]}>{STATUS_LABEL[application.status]}</Badge>

        <select
          value={application.status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={busy}
          className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs font-semibold"
          aria-label="Application stage"
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        {application.hasProof ? (
          // Not a plain <a href>: the endpoint is bearer-authenticated, and a
          // new tab carries no Authorization header, so the link would open a
          // 401. Opening it inline instead.
          <button
            type="button"
            onClick={() => setViewing(true)}
            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline"
          >
            <IconCheck size={13} /> Screenshot attached
          </button>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-ghost h-8 text-xs text-amber-700 hover:bg-amber-50"
          >
            {uploading ? <Spinner size={13} /> : <IconAlert size={13} />}
            {uploading ? 'Uploading…' : 'Add proof screenshot'}
          </button>
        )}

        {application.hasProof && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            Replace
          </button>
        )}
      </div>

      {!application.hasProof && !compact && (
        <p className="mt-1.5 text-[11.5px] text-ink-500">
          Upload the confirmation screen from the company portal. Only you and the placement
          cell can open it — it is never shown on your public profile.
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => uploadProof(e.target.files?.[0])}
      />

      {viewing && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-900/70 p-4"
          onClick={() => setViewing(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Your application screenshot"
        >
          <div
            className="max-h-full w-full max-w-2xl overflow-auto rounded-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-ink-900">Your proof screenshot</p>
                <p className="truncate text-[12.5px] text-ink-500">
                  Only you and the placement cell can open this.
                </p>
              </div>
              <button onClick={() => setViewing(false)} className="btn-secondary h-8 shrink-0 text-xs">
                Close
              </button>
            </div>
            <AuthedImage
              src={application.proofUrl.replace(/^\/api/, '')}
              alt="Your application confirmation"
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-ink-200 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
