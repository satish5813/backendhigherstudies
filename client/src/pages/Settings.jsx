import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, meApi } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { Badge, Field, Modal, PageLoader, Spinner } from '../components/ui';
import { IconAlert, IconCheck, IconMail, IconShield, IconTrash } from '../components/ui/Icons';

export default function Settings() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [sessions, setSessions] = useState(null);
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    Promise.all([meApi.sessions(), authApi.diagnostics().catch(() => null)])
      .then(([s, d]) => { setSessions(s.items); setDiag(d); })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line
  }, []);

  const revokeAll = async () => {
    setBusy(true);
    try {
      const res = await meApi.revokeAll();
      toast.success(res.message);
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await meApi.remove(confirmText.trim());
      toast.success('Your account has been deleted.');
      await signOut();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!sessions) return <PageLoader label="Loading settings…" />;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-ink-900">Settings</h1>
        <p className="mt-1 text-sm text-ink-500">Account, sessions and delivery diagnostics.</p>
      </header>

      {/* ------------------------------------------------------------ account */}
      <section className="card p-5 sm:p-6">
        <h2 className="text-base font-bold tracking-tight text-ink-900">Account</h2>
        <dl className="mt-4 divide-y divide-ink-100">
          {[
            ['Email', user?.email],
            ['Name', user?.name || '—'],
            ['Public handle', user?.slug ? `/u/${user.slug}` : 'Not set'],
            ['Sign-in method', 'Email one-time code (passwordless)'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-ink-500">{label}</dt>
              <dd className="truncate text-sm font-semibold text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------- diagnostics */}
      {diag && (
        <section className="card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-ink-900">Email delivery</h2>
              <p className="mt-0.5 text-sm text-ink-500">Whether OTP and alert mail can actually leave the server.</p>
            </div>
            <Badge tone={diag.ready ? 'emerald' : 'rose'}>
              {diag.ready ? 'Operational' : 'Not configured'}
            </Badge>
          </div>

          <dl className="mt-4 divide-y divide-ink-100">
            {[
              ['SMTP host', diag.mail.host ? `${diag.mail.host}:${diag.mail.port}` : 'not set'],
              ['Sender', diag.mail.from],
              ['Connection verified', diag.mail.verified === true ? 'yes' : diag.mail.verified === false ? 'no' : 'pending'],
              ['Code length', `${diag.otpPolicy.length} digits`],
              ['Code lifetime', `${diag.otpPolicy.ttlMinutes} minutes`],
              ['Resend cooldown', `${diag.otpPolicy.resendCooldownSeconds}s`],
              ['Attempts per code', diag.otpPolicy.maxVerifyAttempts],
              ['Codes per address / hour', diag.otpPolicy.maxPerEmailPerHour],
              ['MX validation', diag.emailPolicy.mxCheck ? 'on' : 'off'],
              ['Allowed domains', diag.emailPolicy.allowedDomains.length ? diag.emailPolicy.allowedDomains.join(', ') : 'any'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-sm text-ink-500">{label}</dt>
                <dd className="font-mono text-xs font-semibold text-ink-900">{String(value)}</dd>
              </div>
            ))}
          </dl>

          {!diag.ready && (
            <div className="mt-4 flex gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <IconAlert size={17} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">
                Mail is not going out. Set <code className="font-mono">SMTP_HOST</code>,{' '}
                <code className="font-mono">SMTP_USER</code> and <code className="font-mono">SMTP_PASS</code> in the
                server's <code className="font-mono">.env</code> and restart. Until then, codes are printed in the server log
                (development only).
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------- sessions */}
      <section className="card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold tracking-tight text-ink-900">Signed-in devices</h2>
            <p className="mt-0.5 text-sm text-ink-500">Each sign-in creates a session valid for 30 days.</p>
          </div>
          <button onClick={revokeAll} disabled={busy} className="btn-secondary h-9 shrink-0 text-xs">
            {busy ? <Spinner size={14} /> : <IconShield size={14} />} Sign out everywhere
          </button>
        </div>

        <ul className="mt-4 divide-y divide-ink-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{s.device}</p>
                <p className="text-xs text-ink-400">
                  {s.ip} · started {new Date(s.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <Badge tone={s.active ? 'emerald' : 'slate'}>{s.active ? 'active' : 'expired'}</Badge>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ danger */}
      <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5 sm:p-6">
        <h2 className="text-base font-bold tracking-tight text-rose-900">Delete account</h2>
        <p className="mt-1 text-sm leading-relaxed text-rose-800/80">
          Permanently removes your profile, every resume, your coding stats, alert settings and activity log.
          This cannot be undone.
        </p>
        <button onClick={() => setDeleteOpen(true)} className="btn-danger mt-4 h-10">
          <IconTrash size={16} /> Delete my account
        </button>
      </section>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title="Delete your account?"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</button>
            <button
              className="btn-danger"
              onClick={deleteAccount}
              disabled={busy || confirmText.trim().toLowerCase() !== (user?.email || '').toLowerCase()}
            >
              {busy && <Spinner size={15} />} Delete permanently
            </button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          Everything is deleted immediately and cannot be recovered. Type{' '}
          <b className="font-semibold text-ink-900">{user?.email}</b> to confirm.
        </p>
        <Field className="mt-4">
          <input
            className="input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={user?.email}
            autoComplete="off"
          />
        </Field>
      </Modal>
    </div>
  );
}
