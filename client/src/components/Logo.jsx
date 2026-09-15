import { Link } from 'react-router-dom';
import { KLSeal } from './brand/Logo';

/**
 * The product signature, linked home.
 *
 * Keeps the original `to / compact / invert` API so every existing call site
 * picks up the KL mark without being edited. The real artwork is probed for in
 * `public/brand/`; see components/brand/Logo.jsx for why it is not committed.
 *
 * The university mark and the platform name are separated by a hairline rule
 * rather than run together into one wordmark. KL is the institution; this is a
 * system it operates, not a co-brand with equal standing.
 */
export default function Logo({ to = '/', compact = false, invert = false, size = 36 }) {
  const title = invert ? 'text-white' : 'text-ink-900';
  const sub = invert ? 'text-white/55' : 'text-ink-400';
  const rule = invert ? 'bg-white/20' : 'bg-ink-200';

  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      aria-label="KL Placement Readiness — home"
    >
      <KLSeal size={size} />

      {/* On a phone the seal alone carries the identity. Showing the wordmark
          too wraps it to two lines against the action button and makes the bar
          feel cramped, so it appears from `sm` up. */}
      {!compact && (
        <>
          <span className={`hidden h-7 w-px shrink-0 sm:block ${rule}`} aria-hidden="true" />
          <span className="hidden flex-col justify-center whitespace-nowrap leading-tight sm:flex">
            <span className={`font-display text-[15px] font-extrabold tracking-tight ${title}`}>
              Placement Readiness
            </span>
            <span className={`text-[9.5px] font-bold uppercase tracking-[0.16em] ${sub}`}>
              KL University
            </span>
          </span>
        </>
      )}
    </Link>
  );
}
