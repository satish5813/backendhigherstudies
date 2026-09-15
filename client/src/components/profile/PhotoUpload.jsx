import { useRef, useState } from 'react';
import { tokenStore } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { Spinner } from '../ui';
import { IconAlert, IconTrash, IconUser } from '../ui/Icons';

/**
 * Profile photo. Uploaded images are squared and re-encoded to 512px JPEG on
 * the server, so a 6MB phone photo becomes ~40KB and prints predictably.
 */
export default function PhotoUpload({ value, name, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  const initials = String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

  const upload = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('photo', file);
      // FormData sets its own multipart boundary, so this bypasses the shared
      // JSON helper and sends only the Authorization header.
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        credentials: 'include',
        headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Upload failed (${res.status})`);
      onChange(data.avatarUrl);
      toast.success(`Photo saved (${Math.round(data.bytes / 1024)}KB).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/profile/avatar', {
        method: 'DELETE',
        credentials: 'include',
        headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
      });
      if (!res.ok) throw new Error('Could not remove the photo.');
      onChange(null);
      toast.success('Photo removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="label">Profile photo</p>
      <div className="flex items-center gap-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
          onClick={() => !busy && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          className={`grid h-24 w-24 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed transition ${
            dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-300 hover:border-brand-400'
          } ${value ? 'border-solid border-ink-200' : ''}`}
        >
          {busy ? (
            <Spinner size={22} className="text-ink-400" />
          ) : value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="text-center">
              <span className="block text-lg font-black text-ink-300">{initials}</span>
              <span className="mt-0.5 block text-[9px] font-semibold text-ink-400">Add photo</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn-secondary h-9 text-xs"
            >
              <IconUser size={14} /> {value ? 'Replace photo' : 'Upload photo'}
            </button>
            {value && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="btn-ghost h-9 text-xs text-rose-600 hover:bg-rose-50"
              >
                <IconTrash size={14} /> Remove
              </button>
            )}
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
            JPEG, PNG or WebP, up to 6MB. Cropped square and resized automatically.
            Shown on your public profile, and on the five photo templates.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
            A photo lowers your ATS score — parsers often drop the block around an image,
            and most Indian IT portals do not want one. Keep a photo-free resume for
            online applications.
          </p>

          {error && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-rose-600">
              <IconAlert size={12} className="mt-px shrink-0" />{error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
    </div>
  );
}
