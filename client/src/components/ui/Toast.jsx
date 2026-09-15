import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { IconAlert, IconCheck, IconInfo, IconX } from './Icons';

const ToastContext = createContext(null);

const TONES = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: IconCheck, iconCls: 'text-emerald-600' },
  error: { cls: 'border-rose-200 bg-rose-50 text-rose-900', icon: IconAlert, iconCls: 'text-rose-600' },
  info: { cls: 'border-brand-200 bg-brand-50 text-brand-900', icon: IconInfo, iconCls: 'text-brand-600' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (message, tone = 'info', ttl = 4500) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, message, tone }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      success: (m, ttl) => push(m, 'success', ttl),
      error: (m, ttl) => push(m, 'error', ttl ?? 6500),
      info: (m, ttl) => push(m, 'info', ttl),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const tone = TONES[t.tone] ?? TONES.info;
          const Icon = tone.icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-full max-w-md animate-fade-up items-start gap-3 rounded-xl border px-4 py-3 shadow-lift ${tone.cls}`}
            >
              <Icon size={17} className={`mt-0.5 shrink-0 ${tone.iconCls}`} />
              <p className="flex-1 text-sm font-medium leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="-mr-1 shrink-0 rounded-lg p-1 opacity-50 transition hover:bg-black/5 hover:opacity-100"
                aria-label="Dismiss"
              >
                <IconX size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
