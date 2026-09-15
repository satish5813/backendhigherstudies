import { useEffect, useState } from 'react';

/**
 * The KL mark.
 *
 * The official artwork lives in `public/brand/` and is not in the repo — it is
 * the university's asset, and a hand-drawn imitation of that seal would be
 * wrong in the details. So this probes for the real file and renders a clean
 * typographic monogram until it is there. The fallback is deliberately NOT a
 * fake seal: it is the letters K and L set in the brand crimson, which is
 * honest about being a stand-in.
 *
 * Probing happens once per file per page load and the result is cached, so a
 * sidebar and a header asking for the same mark cost one request.
 */
const cache = new Map();

function useAsset(paths) {
  const key = paths.join('|');
  const [src, setSrc] = useState(() => cache.get(key) ?? null);
  const [checked, setChecked] = useState(() => cache.has(key));

  useEffect(() => {
    if (cache.has(key)) return;
    let cancelled = false;

    (async () => {
      for (const path of paths) {
        const ok = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = path;
        });
        if (cancelled) return;
        if (ok) {
          cache.set(key, path);
          setSrc(path);
          setChecked(true);
          return;
        }
      }
      if (cancelled) return;
      cache.set(key, null);
      setChecked(true);
    })();

    return () => { cancelled = true; };
  }, [key]);

  return { src, checked };
}

const LOCKUP = ['/brand/kl-lockup.svg', '/brand/kl-lockup.png'];
const SEAL = ['/brand/kl-seal.svg', '/brand/kl-seal.png'];

/**
 * The gear seal, or a crimson monogram tile standing in for it.
 * `size` is in pixels; it is square.
 */
export function KLSeal({ size = 36, className = '', spin = false }) {
  const { src, checked } = useAsset(SEAL);

  if (src) {
    return (
      <img
        src={src}
        alt="KL University"
        width={size}
        height={size}
        className={`${spin ? 'animate-spin-slow' : ''} ${className}`}
        style={{ objectFit: 'contain' }}
      />
    );
  }

  // Reserve the space while probing so the header does not jump.
  return (
    <span
      aria-label="KL University"
      role="img"
      className={`grid shrink-0 place-items-center rounded-xl bg-brand-600 font-display font-black leading-none text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42, letterSpacing: '-0.03em' }}
    >
      {checked ? 'KL' : ''}
    </span>
  );
}

/**
 * Seal + wordmark. `tone` picks the text colour for light or dark ground.
 */
export function KLLockup({ height = 34, tone = 'dark', showSubtitle = true, className = '' }) {
  const { src } = useAsset(LOCKUP);

  if (src) {
    return (
      <img
        src={src}
        alt="KL University — Koneru Lakshmaiah Education Foundation"
        height={height}
        className={className}
        style={{ height, width: 'auto', objectFit: 'contain' }}
      />
    );
  }

  const text = tone === 'light' ? 'text-white' : 'text-ink-900';
  const sub = tone === 'light' ? 'text-white/55' : 'text-ink-400';

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <KLSeal size={height} />
      <span className="flex flex-col justify-center leading-none">
        <span
          className={`font-display font-black tracking-tight ${text}`}
          style={{ fontSize: height * 0.62 }}
        >
          KL
        </span>
        {showSubtitle && (
          <span
            className={`mt-0.5 font-semibold uppercase tracking-[0.18em] ${sub}`}
            style={{ fontSize: Math.max(7, height * 0.2) }}
          >
            University
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The product signature: the university mark plus the platform name.
 *
 * The two are deliberately separated by a hairline rule — the institution is
 * the authority here and the platform is a thing it runs, not a co-brand.
 */
export default function Logo({ size = 'md', tone = 'dark', className = '' }) {
  const dims = {
    sm: { seal: 28, title: 'text-[13px]', sub: 'text-[9px]' },
    md: { seal: 36, title: 'text-[15px]', sub: 'text-[9.5px]' },
    lg: { seal: 46, title: 'text-lg', sub: 'text-[10px]' },
  }[size] ?? { seal: 36, title: 'text-[15px]', sub: 'text-[9.5px]' };

  const text = tone === 'light' ? 'text-white' : 'text-ink-900';
  const sub = tone === 'light' ? 'text-white/55' : 'text-ink-400';
  const rule = tone === 'light' ? 'bg-white/20' : 'bg-ink-200';

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <KLSeal size={dims.seal} />
      <span className={`hidden h-7 w-px sm:block ${rule}`} />
      <span className="hidden flex-col justify-center leading-tight sm:flex">
        <span className={`font-display font-extrabold tracking-tight ${text} ${dims.title}`}>
          Placement Readiness
        </span>
        <span className={`font-semibold uppercase tracking-[0.16em] ${sub} ${dims.sub}`}>
          KL University
        </span>
      </span>
    </span>
  );
}
