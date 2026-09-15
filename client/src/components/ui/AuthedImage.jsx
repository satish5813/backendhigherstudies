import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '../../lib/api';
import { Spinner } from './index';
import { IconAlert } from './Icons';

/**
 * An <img> for a source that sits behind authentication.
 *
 * A plain <img src="/api/..."> sends cookies but never an Authorization
 * header, and this API is bearer-only — so it 401s and the browser shows a
 * broken-image icon with no explanation. This fetches the bytes with the
 * token, points the <img> at a blob URL, and revokes it on unmount.
 *
 * `onUrl` hands the blob URL back up, so a "Full size" link can open the same
 * object rather than a second unauthenticated request that would fail the same
 * way.
 */
export default function AuthedImage({ src, alt = '', className = '', onUrl }) {
  const [state, setState] = useState({ url: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let created = null;

    setState({ url: null, error: null });

    fetchBlobUrl(src)
      .then((url) => {
        // The request may land after the component is gone; releasing here
        // rather than leaking the blob.
        if (cancelled) { URL.revokeObjectURL(url); return; }
        created = url;
        setState({ url, error: null });
        onUrl?.(url);
      })
      .catch((err) => {
        if (!cancelled) setState({ url: null, error: err.message });
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // onUrl is intentionally not a dependency: callers pass an inline closure
    // and re-running this on every render would refetch the image endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (state.error) {
    return (
      <div className={`flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-6 ${className}`}>
        <IconAlert size={15} className="shrink-0 text-rose-600" />
        <p className="text-[12.5px] font-medium text-rose-900">{state.error}</p>
      </div>
    );
  }

  if (!state.url) {
    return (
      <div className={`grid min-h-[160px] place-items-center rounded-lg border border-ink-200 bg-ink-50 ${className}`}>
        <Spinner size={20} className="text-ink-400" />
      </div>
    );
  }

  return <img src={state.url} alt={alt} className={className} />;
}
