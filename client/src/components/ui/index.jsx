import { useEffect, useRef } from 'react';
import { IconAlert, IconSpinner, IconX } from './Icons';

/* ------------------------------------------------------------------ Modal */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/45 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex max-h-[92vh] w-full ${widths[size]} animate-fade-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-lift outline-none sm:rounded-2xl`}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-bold tracking-tight text-ink-900">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 rounded-lg p-2" aria-label="Close">
              <IconX size={18} />
            </button>
          </div>
        )}
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3.5 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Confirm */

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy && <IconSpinner size={15} />}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-600">
          <IconAlert size={19} />
        </div>
        <p className="pt-2 text-sm leading-relaxed text-ink-600">{message}</p>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- ScoreRing */

export function ScoreRing({ value = 0, size = 120, stroke = 10, label, sublabel, tone = 'brand' }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colors = {
    brand: '#4f46e5', emerald: '#059669', sky: '#0284c7', amber: '#d97706', rose: '#e11d48',
  };
  const color = colors[tone] ?? colors.brand;

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (safe / 100) * c}
          style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-extrabold tracking-tight text-ink-900" style={{ fontSize: size / 4.2 }}>
          {label ?? safe}
        </div>
        {sublabel && <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{sublabel}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Empty */

export function EmptyState({ icon: Icon, title, message, action, compact }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 text-center ${compact ? 'px-5 py-8' : 'px-6 py-14'}`}>
      {Icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white text-ink-400 shadow-sm">
          <Icon size={22} />
        </div>
      )}
      <h3 className="text-sm font-bold text-ink-800">{title}</h3>
      {message && <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */

export const Badge = ({ children, tone = 'slate', className = '' }) => {
  const tones = {
    slate: 'bg-ink-100 text-ink-700',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
    sky: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  };
  return <span className={`chip ${tones[tone] ?? tones.slate} ${className}`}>{children}</span>;
};

export const Spinner = ({ size = 18, className = '' }) => <IconSpinner size={size} className={className} />;

export const PageLoader = ({ label = 'Loading…' }) => (
  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-400">
    <IconSpinner size={26} />
    <p className="text-sm font-medium">{label}</p>
  </div>
);

export const Skeleton = ({ className = 'h-4 w-full' }) => <div className={`skeleton ${className}`} />;

export function Field({ label, hint, error, required, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="error-text"><IconAlert size={13} className="mt-px shrink-0" />{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** Comma/Enter-separated tag input used for skills, tech stacks and alert filters. */
export function TagInput({ value = [], onChange, placeholder = 'Type and press Enter', max = 30 }) {
  const inputRef = useRef(null);

  const add = (raw) => {
    const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
  };

  return (
    <div
      className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-2 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span key={tag} className="chip bg-brand-50 text-brand-700 ring-1 ring-brand-100">
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== tag)); }}
            className="-mr-0.5 rounded-full p-0.5 transition hover:bg-brand-200/60"
            aria-label={`Remove ${tag}`}
          >
            <IconX size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="min-w-[120px] flex-1 border-0 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-400"
        placeholder={value.length >= max ? `Limit of ${max} reached` : placeholder}
        disabled={value.length >= max}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={(e) => { add(e.currentTarget.value); e.currentTarget.value = ''; }}
      />
    </div>
  );
}
