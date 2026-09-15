import { useRef, useState } from 'react';
import { tokenStore } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { Badge, Modal, ScoreRing, Spinner } from '../ui';
import { IconAlert, IconCheck, IconDoc, IconSparkles } from '../ui/Icons';

const SECTION_LABELS = {
  summary: 'Summary', education: 'Education', skills: 'Skills',
  experience: 'Experience', projects: 'Projects', achievements: 'Achievements',
};

/**
 * Upload an existing resume, score it, and optionally pull the reliable bits
 * into the profile.
 *
 * The parse is deliberately conservative — contact details and skills matched
 * against a known vocabulary. Everything is shown as a suggestion with its
 * confidence, and nothing is written until the student presses Add.
 */
export default function UploadResumeModal({ open, onClose, onApplied }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState({ basics: true, skills: true });
  const inputRef = useRef(null);
  const toast = useToast();

  const reset = () => { setFile(null); setResult(null); setError(''); setBusy(false); };

  const analyse = async (picked) => {
    setError('');
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', picked);

      // FormData must not carry a JSON content-type, so this bypasses the
      // shared api helper and sets only Authorization.
      const res = await fetch('/api/resumes/analyse', {
        method: 'POST',
        credentials: 'include',
        headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Upload failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (picked) => {
    if (!picked) return;
    setFile(picked);
    analyse(picked);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/resumes/analyse/apply', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {}),
        },
        body: JSON.stringify({
          basics: chosen.basics ? result.suggestions.basics : {},
          skills: chosen.skills ? result.suggestions.skills : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast.success(data.message);
      onApplied?.();
      onClose();
      reset();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ats = result?.ats;

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); reset(); }}
      size="lg"
      title="Check an existing resume"
      subtitle="Upload a PDF or Word file. We score it and pull out what we can read reliably."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-400">Your file is read in memory and never stored.</p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => { onClose(); reset(); }} disabled={busy}>
              Close
            </button>
            {result && (
              <button className="btn-primary" onClick={apply} disabled={busy || (!chosen.basics && !chosen.skills)}>
                {busy ? <Spinner size={15} /> : <IconCheck size={16} />} Add to my profile
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* ------------------------------------------------------------ picker */}
      {!result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-300 hover:border-brand-400 hover:bg-ink-50'
          }`}
        >
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-ink-400 shadow-sm">
            {busy ? <Spinner size={22} /> : <IconDoc size={22} />}
          </div>
          <p className="mt-3 text-sm font-bold text-ink-800">
            {busy ? `Reading ${file?.name}…` : 'Drop your resume here, or click to browse'}
          </p>
          <p className="mt-1 text-xs text-ink-500">PDF, Word (.docx) or plain text · up to 4MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-200">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-900">{error}</p>
            <button onClick={reset} className="mt-1 text-xs font-bold text-rose-700 hover:underline">
              Try a different file
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ result */}
      {result && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">{result.file.name}</p>
              <p className="text-xs text-ink-500">
                {result.file.kind.toUpperCase()} · {result.wordCount} words
                {result.file.pages ? ` · ${result.file.pages} page${result.file.pages === 1 ? '' : 's'}` : ''}
              </p>
            </div>
            <button onClick={reset} className="btn-ghost h-8 shrink-0 text-xs">Use another file</button>
          </div>

          {/* ---- score --------------------------------------------------- */}
          <div className="flex items-center gap-5 rounded-xl bg-ink-50 p-4">
            <ScoreRing value={ats.score} size={88} stroke={9} sublabel="/ 100" tone={ats.band?.tone ?? 'brand'} />
            <div>
              <p className="text-base font-black tracking-tight text-ink-900">{ats.band?.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{ats.band?.note}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                Scored from the text we could extract. A resume built here scores more accurately,
                because the sections are structured rather than guessed.
              </p>
            </div>
          </div>

          {ats.topFixes?.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Fix these first</p>
              <ul className="mt-2 space-y-1.5">
                {ats.topFixes.map((f, i) => (
                  <li key={i} className="text-xs leading-relaxed text-amber-900">• {f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- sections ------------------------------------------------ */}
          <div>
            <p className="section-title mb-2">Sections detected</p>
            <div className="flex flex-wrap gap-1.5">
              {result.sectionsFound.map((s) => (
                <Badge key={s} tone="emerald">✓ {SECTION_LABELS[s] ?? s}</Badge>
              ))}
              {result.sectionsMissing.map((s) => (
                <Badge key={s} tone="rose">missing {SECTION_LABELS[s] ?? s}</Badge>
              ))}
            </div>
          </div>

          {/* ---- suggestions --------------------------------------------- */}
          <div>
            <p className="section-title mb-2">What we could read</p>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3.5 transition hover:bg-ink-50">
              <input
                type="checkbox"
                checked={chosen.basics}
                onChange={(e) => setChosen((c) => ({ ...c, basics: e.target.checked }))}
                className="mt-1 h-4 w-4 accent-indigo-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900">Contact details</p>
                <dl className="mt-1.5 space-y-1">
                  {[
                    ['Name', result.suggestions.basics.fullName, result.suggestions.confidence.fullName],
                    ['Email', result.suggestions.basics.email, result.suggestions.confidence.email],
                    ['Phone', result.suggestions.basics.phone, result.suggestions.confidence.phone],
                    ['LinkedIn', result.suggestions.basics.linkedin, 'high'],
                    ['GitHub', result.suggestions.basics.github, 'high'],
                  ]
                    .filter(([, v]) => v)
                    .map(([label, value, conf]) => (
                      <div key={label} className="flex items-center justify-between gap-3 text-xs">
                        <dt className="text-ink-500">{label}</dt>
                        <dd className="flex items-center gap-2 truncate">
                          <span className="truncate font-medium text-ink-800">{value}</span>
                          <Badge tone={conf === 'high' ? 'emerald' : 'amber'}>{conf}</Badge>
                        </dd>
                      </div>
                    ))}
                </dl>
                {!result.suggestions.basics.email && !result.suggestions.basics.phone && (
                  <p className="mt-1 text-xs text-ink-400">Nothing readable — add these by hand.</p>
                )}
              </div>
            </label>

            <label className="mt-2.5 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3.5 transition hover:bg-ink-50">
              <input
                type="checkbox"
                checked={chosen.skills}
                onChange={(e) => setChosen((c) => ({ ...c, skills: e.target.checked }))}
                className="mt-1 h-4 w-4 accent-indigo-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900">
                  {result.suggestions.skills.length} skill{result.suggestions.skills.length === 1 ? '' : 's'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {result.suggestions.skills.map((s) => <Badge key={s} tone="brand">{s}</Badge>)}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                  Only skills we recognise are listed — nothing is invented. Anything missing you can add by hand.
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-ink-50 px-4 py-3">
            <IconSparkles size={15} className="mt-0.5 shrink-0 text-ink-400" />
            <p className="text-[11.5px] leading-relaxed text-ink-500">
              Work history and projects are not auto-imported. Dates, employers and bullet points vary too much
              between resumes to extract without guessing, and a wrong guess in your profile is worse than a blank.
              Add those in <b className="font-semibold">My profile</b> — then every resume you generate stays in sync.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
