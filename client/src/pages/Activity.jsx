import { useEffect, useState } from 'react';
import { meApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, PageLoader, Spinner } from '../components/ui';
import { IconClock } from '../components/ui/Icons';

const TONE = {
  'auth.login': 'emerald', 'auth.signup': 'emerald', 'otp.verified': 'emerald',
  'otp.failed': 'rose', 'section.deleted': 'rose', 'resume.deleted': 'rose',
  'otp.requested': 'sky', 'alert.sent': 'sky', 'coding.synced': 'sky',
};

export default function Activity() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    meApi
      .activity(page)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => toast.error(err.message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [page]);

  if (loading && !data) return <PageLoader label="Loading your activity…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display-md">Activity log</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every action on your account — sign-ins, edits, syncs and alert deliveries. {data?.total ?? 0} entries.
        </p>
      </header>

      {!data?.items?.length ? (
        <EmptyState icon={IconClock} title="Nothing logged yet" message="Your actions will appear here as you use the platform." />
      ) : (
        <>
          <div className="card divide-y divide-ink-100">
            {data.items.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Badge tone={TONE[item.action] ?? 'slate'} className="mt-0.5 shrink-0">
                    {item.action.split('.')[0]}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{item.label}</p>
                    {item.detail && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">{summarise(item.detail)}</p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-left text-xs text-ink-400 sm:text-right">
                  <p>{new Date(item.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="mt-0.5">{[item.device, item.ip].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ))}
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-between">
              <button className="btn-secondary h-9 text-xs" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </button>
              <span className="text-xs text-ink-500">
                {loading ? <Spinner size={14} /> : `Page ${data.page} of ${data.pages}`}
              </span>
              <button className="btn-secondary h-9 text-xs" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function summarise(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || v === '') continue;
    const value = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${value}`);
  }
  return parts.join(' · ').slice(0, 160);
}
