import { useState } from 'react';
import { Badge, EmptyState, Field, ScoreRing, Spinner } from './ui';
import { IconAward, IconCheck, IconChart, IconTarget } from './ui/Icons';
import { meApi } from '../lib/api';
import { useToast } from './ui/Toast';

const BAND_TONE = {
  '50 LPA+': 'emerald',
  '20-40 LPA': 'sky',
  '10-20 LPA': 'brand',
  '8-10 LPA': 'amber',
  '6-10 LPA': 'amber',
};

const DIMENSIONS = [
  ['dsa', 'DSA'],
  ['cp', 'Competitive programming'],
  ['crt', 'CRT assessments'],
  ['dev', 'Development'],
  ['consistency', 'Consistency'],
  ['academic', 'Academics'],
];

/**
 * The student's placement-cell readiness record — band, index, dimension
 * scores, CRT history and the coaching notes written for them.
 *
 * Renders a claim prompt instead when no record is attached: most records have
 * no email on file, so registration number is the usual route in.
 */
export default function ReadinessCard({ readiness, onClaimed }) {
  if (!readiness) return <ClaimPrompt onClaimed={onClaimed} />;

  const { band, scores, crt, academics, coaching, cohort, coding } = readiness;
  const tone = BAND_TONE[band.target] ?? 'brand';
  const percentile =
    band.rankInCohort && band.cohortSize
      ? Math.round((1 - (band.rankInCohort - 1) / band.cohortSize) * 100)
      : null;

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
            <IconChart size={17} className="text-brand-500" /> Placement readiness
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            From your placement cell's {cohort.name} analysis · {readiness.regNo}
          </p>
        </div>
        {band.target && <Badge tone={tone}>Target band {band.target}</Badge>}
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-5">
          <ScoreRing
            value={band.readinessIndex ?? 0}
            size={108}
            stroke={10}
            sublabel="readiness"
            tone={tone === 'brand' ? 'brand' : tone}
          />
          <div className="space-y-1.5 text-sm">
            {band.rankInCohort && (
              <p className="text-ink-700">
                Rank <b className="font-bold text-ink-900">{band.rankInCohort}</b>
                <span className="text-ink-400"> of {band.cohortSize}</span>
              </p>
            )}
            {percentile != null && (
              <p className="text-ink-500">Top {100 - percentile === 0 ? 1 : 100 - percentile}% of the cohort</p>
            )}
            {band.nearNext && (
              <p className="text-xs font-semibold text-emerald-600">{band.nearNext}</p>
            )}
            {readiness.company && (
              <p className="pt-1 text-xs text-ink-400">
                Placed: {readiness.company}
                {readiness.ctc ? ` · ₹${readiness.ctc} LPA` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {DIMENSIONS.filter(([k]) => scores[k] != null).map(([key, label]) => {
            const v = Math.max(0, Math.min(100, scores[key]));
            const cls = v >= 70 ? 'bg-emerald-500' : v >= 45 ? 'bg-sky-500' : v >= 25 ? 'bg-amber-500' : 'bg-rose-500';
            return (
              <div key={key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-ink-700">{label}</span>
                  <span className="font-mono text-[11px] text-ink-400">{v}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div className={`h-full rounded-full transition-all duration-700 ${cls}`} style={{ width: `${v}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(academics.ug != null || crt.avgPercent != null || coding?.length > 0) && (
        <div className="grid grid-cols-2 gap-px border-t border-ink-100 bg-ink-100 sm:grid-cols-4">
          {[
            academics.ug != null && ['UG CGPA', academics.ug],
            crt.avgPercent != null && ['CRT average', `${crt.avgPercent}%`],
            crt.percentile != null && ['CRT percentile', crt.percentile],
            crt.attendance != null && ['CRT attendance', `${crt.attendance}%`],
          ]
            .filter(Boolean)
            .slice(0, 4)
            .map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3">
                <p className="text-lg font-extrabold tracking-tight text-ink-900">{value}</p>
                <p className="text-[11px] text-ink-400">{label}</p>
              </div>
            ))}
        </div>
      )}

      {crt.assessments.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="section-title mb-2.5">CRT assessments</p>
          <div className="flex flex-wrap gap-2">
            {crt.assessments.map((a) => (
              <div key={a.no} className="rounded-lg border border-ink-200 px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">#{a.no}</span>
                <span className="ml-2 font-mono text-sm font-bold text-ink-900">{a.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(coaching.strengths || coaching.gaps || coaching.plan) && (
        <div className="grid gap-4 border-t border-ink-100 px-5 py-4 sm:grid-cols-3">
          {[
            ['Strengths', coaching.strengths, 'emerald'],
            ['Gaps', coaching.gaps, 'amber'],
            ['Plan to next band', coaching.plan, 'brand'],
          ]
            .filter(([, text]) => text)
            .map(([label, text, colour]) => (
              <div key={label}>
                <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${
                  colour === 'emerald' ? 'text-emerald-600' : colour === 'amber' ? 'text-amber-600' : 'text-brand-600'
                }`}>
                  {label}
                </p>
                <p className="text-[13px] leading-relaxed text-ink-600">{text}</p>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- claim */

function ClaimPrompt({ onClaimed }) {
  const [regNo, setRegNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await meApi.claim(regNo);
      toast.success(res.message);
      onClaimed?.(res.readiness);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
        <IconTarget size={17} className="text-brand-500" /> Link your placement record
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-500">
        Your placement cell has a readiness analysis on file — target band, CRT scores, coding evidence
        and a plan to the next band. Enter your registration number to pull it in and prefill your profile.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Field error={error} className="flex-1">
          <input
            className={`input ${error ? 'input-error' : ''}`}
            value={regNo}
            onChange={(e) => { setRegNo(e.target.value); setError(''); }}
            placeholder="2300033153"
            inputMode="numeric"
            aria-label="Registration number"
          />
        </Field>
        <button type="submit" className="btn-primary h-[42px] shrink-0" disabled={busy || !regNo.trim()}>
          {busy ? <Spinner size={15} /> : <IconCheck size={16} />} Link my record
        </button>
      </form>

      <p className="mt-2 text-[11px] text-ink-400">
        Only you can claim your number, and it can be linked to one account.
      </p>
    </section>
  );
}
