import { useEffect, useState } from 'react';
import { aiApi } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { Badge, Spinner } from '../ui';
import { IconAlert, IconCheck, IconSparkles } from '../ui/Icons';

/** Shared hook: is AI configured on this deployment? */
export function useAiEnabled() {
  const [state, setState] = useState({ loading: true, enabled: false, model: null });
  useEffect(() => {
    let cancelled = false;
    aiApi.status()
      .then((s) => { if (!cancelled) setState({ loading: false, enabled: s.configured, model: s.model }); })
      .catch(() => { if (!cancelled) setState({ loading: false, enabled: false, model: null }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

/* --------------------------------------------------------- bullet rewrite */

/**
 * Offers two rewrites of one bullet. The student picks — nothing is applied
 * automatically, and `[NUMBER]` placeholders are highlighted so it is obvious
 * where they still have to supply a real figure.
 */
export function AiBulletButton({ text, role, company, tech = [], onApply, compact }) {
  const { enabled } = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const toast = useToast();

  if (!enabled) return null;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await aiApi.bullet({ text, role, company, tech }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? '' : 'mt-1.5'}>
      <button
        type="button"
        onClick={run}
        disabled={busy || !String(text || '').trim()}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-50 disabled:opacity-40"
      >
        {busy ? <Spinner size={12} /> : <IconSparkles size={12} />}
        {busy ? 'Rewriting…' : 'Sharpen with AI'}
      </button>

      {error && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-rose-600">
          <IconAlert size={11} className="mt-px shrink-0" />{error}
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-2 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
          {result.options.map((option, i) => (
            <div key={i} className="rounded-lg bg-white p-2.5 ring-1 ring-ink-200">
              <p className="text-[12.5px] leading-relaxed text-ink-800">{highlight(option)}</p>
              <button
                type="button"
                onClick={() => { onApply(option); setResult(null); toast.success('Applied. Replace any [NUMBER] with your real figure.'); }}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700"
              >
                <IconCheck size={11} /> Use this
              </button>
            </div>
          ))}

          {result.note && (
            <p className="text-[11px] leading-relaxed text-brand-800/80">{result.note}</p>
          )}
          {result.rejected > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-700">
              {result.rejected} suggestion{result.rejected === 1 ? ' was' : 's were'} discarded for inventing
              numbers you did not provide.
            </p>
          )}
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-[11px] font-semibold text-ink-400 hover:text-ink-700"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/** Makes the [NUMBER] placeholder impossible to miss and to ship by accident. */
function highlight(text) {
  return String(text).split(/(\[NUMBER\])/g).map((part, i) =>
    part === '[NUMBER]' ? (
      <mark key={i} className="rounded bg-amber-200 px-1 font-bold text-amber-900">[your number]</mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/* --------------------------------------------------------- summary draft */

export function AiSummaryButton({ data, targetRole, onApply }) {
  const { enabled } = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  if (!enabled) return null;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await aiApi.summary({ data, targetRole });
      setDraft(res.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-50 disabled:opacity-40"
      >
        {busy ? <Spinner size={12} /> : <IconSparkles size={12} />}
        {busy ? 'Drafting…' : 'Draft with AI'}
      </button>

      {error && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-rose-600">
          <IconAlert size={11} className="mt-px shrink-0" />{error}
        </p>
      )}

      {draft && (
        <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
          <p className="text-[12.5px] leading-relaxed text-ink-800">{draft}</p>
          <p className="mt-1.5 text-[11px] text-brand-800/80">
            Written only from what is already in your profile. Read it before you keep it.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => { onApply(draft); setDraft(null); }}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700"
            >
              <IconCheck size={11} /> Use this
            </button>
            <button type="button" onClick={run} className="text-[11px] font-semibold text-ink-500 hover:text-ink-800">
              Try again
            </button>
            <button type="button" onClick={() => setDraft(null)} className="text-[11px] font-semibold text-ink-400 hover:text-ink-700">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- full review */

const EFFORT_TONE = { quick: 'emerald', medium: 'sky', substantial: 'amber' };

/** A placement officer's read of the whole resume, not a generic checklist. */
export function AiReviewPanel({ resumeId, onApplied }) {
  const { enabled, model } = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');

  if (!enabled) {
    return (
      <div className="rounded-xl bg-ink-50 p-4">
        <p className="text-[11.5px] leading-relaxed text-ink-500">
          AI review is switched off. Add <code className="font-mono">GEMINI_API_KEY</code> to
          <code className="font-mono"> server/.env</code> and restart to enable it.
        </p>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setReview(await aiApi.review(resumeId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <button onClick={run} disabled={busy} className="btn-primary h-9 w-full text-xs">
        {busy ? <Spinner size={14} /> : <IconSparkles size={14} />}
        {busy ? 'Reading your resume…' : review ? 'Review again' : 'Get an AI review'}
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <IconAlert size={14} className="mt-0.5 shrink-0 text-rose-600" />
          <p className="text-[11.5px] leading-relaxed text-rose-900">{error}</p>
        </div>
      )}

      {review && (
        <div className="space-y-3">
          {review.verdict && (
            <div className="rounded-xl bg-ink-900 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Verdict</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-white/90">{review.verdict}</p>
            </div>
          )}

          {review.strongest && (
            <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Strongest point</p>
              <p className="mt-1 text-[12px] leading-relaxed text-emerald-900">{review.strongest}</p>
            </div>
          )}

          <div>
            <p className="section-title mb-2">
              {review.fixes.length} fix{review.fixes.length === 1 ? '' : 'es'}, most valuable first
            </p>
            <ol className="space-y-2.5">
              {review.fixes.map((fix, i) => (
                <FixCard key={i} fix={fix} resumeId={resumeId} onApplied={onApplied} />
              ))}
            </ol>
          </div>

          <p className="text-[10.5px] leading-relaxed text-ink-400">
            Generated by {model}. It works only from what you have written — it will not invent
            achievements, and anything it suggests you should be able to defend in an interview.
          </p>
        </div>
      )}
    </div>
  );
}

const TARGET_LABEL = {
  headline: 'Use this headline',
  summary: 'Use this summary',
  skills: 'Add these skills',
};

/**
 * One suggestion, with a button when the AI gave us text we can actually write.
 *
 * Applying goes to the PROFILE, not this resume — so the fix also improves the
 * student's next resume, their public profile and their job matching. The card
 * says so, because "Apply" that silently edits something you are not looking at
 * is the kind of thing that makes people distrust a tool.
 *
 * Fixes needing the student's own numbers arrive with no `apply` object at all,
 * and correctly show as advice with nothing to click.
 */
function FixCard({ fix, resumeId, onApplied }) {
  const [state, setState] = useState('idle');   // idle | busy | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const toast = useToast();

  const patch = fix.apply;

  async function apply() {
    setState('busy');
    setError('');
    try {
      // Sending the resume id makes the server re-pull the profile into it and
      // re-score, so the response can report what the fix was actually worth.
      const res = await aiApi.apply({ ...patch, resumeId });
      setResult(res);
      setState('done');
      toast.success(res.ats?.delta > 0 ? `${res.message} ATS ${res.ats.before} → ${res.ats.after}.` : res.message);
      onApplied?.(res);
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  }

  return (
    <li className={`rounded-xl border p-3 transition ${
      state === 'done' ? 'border-emerald-200 bg-emerald-50/40' : 'border-ink-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{fix.where}</span>
        {fix.effort && <Badge tone={EFFORT_TONE[fix.effort] ?? 'slate'}>{fix.effort}</Badge>}
      </div>

      {fix.problem && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">{fix.problem}</p>}
      <p className="mt-1.5 text-[12.5px] font-medium leading-relaxed text-ink-900">{fix.action}</p>

      {patch && state !== 'done' && (
        <div className="mt-2.5 rounded-lg bg-ink-50 p-2.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
            {patch.target === 'skills' ? 'Skills to add' : `New ${patch.target}`}
          </p>
          {patch.target === 'skills' ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {patch.value.map((s) => (
                <span key={s} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink-700 ring-1 ring-ink-200">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-800">{patch.value}</p>
          )}

          <button onClick={apply} disabled={state === 'busy'} className="btn-primary mt-2 h-8 text-[11.5px]">
            {state === 'busy' ? <Spinner size={12} /> : <IconCheck size={13} />}
            {state === 'busy' ? 'Saving…' : TARGET_LABEL[patch.target]}
          </button>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
            Saves to your profile, so every resume you build next picks it up.
          </p>
        </div>
      )}

      {state === 'done' && (
        <div className="mt-2">
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-emerald-700">
            <IconCheck size={13} />
            {result?.target === 'skills' && result.added?.length === 0
              ? 'Already on your profile'
              : 'Saved to your profile'}
          </p>
          <AtsDelta ats={result?.ats} />
        </div>
      )}

      {/* No patch and no button: the fix needs something only the student has. */}
      {!patch && /\[NUMBER\]/.test(fix.action) && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-amber-700">
          Only you know this number — fill it in yourself in the Content tab.
        </p>
      )}

      {error && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{error}</p>}
    </li>
  );
}

/**
 * What the fix was worth, stated plainly.
 *
 * A rewritten headline usually moves the ATS score by nothing, because the
 * score rewards content and coverage rather than phrasing. Saying so is far
 * better than leaving the student to notice the number did not budge and
 * conclude the button is broken.
 */
function AtsDelta({ ats }) {
  if (!ats) return null;

  if (ats.delta > 0) {
    return (
      <p className="mt-1 text-[11.5px] font-bold text-emerald-700">
        ATS score {ats.before} → {ats.after} (+{ats.delta})
        {ats.closed?.length > 0 && (
          <span className="font-medium text-ink-500"> · covered {ats.closed.join(', ')}</span>
        )}
      </p>
    );
  }

  if (ats.delta < 0) {
    return (
      <p className="mt-1 text-[11.5px] font-bold text-amber-700">
        ATS score {ats.before} → {ats.after} ({ats.delta}). Undo this in your profile if that was not what you wanted.
      </p>
    );
  }

  return (
    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
      ATS score stays at {ats.after}. This fix improves how a person reads your resume —
      the score only moves when you add coverage a scanner is looking for.
    </p>
  );
}
