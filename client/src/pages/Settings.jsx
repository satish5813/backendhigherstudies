import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, meApi } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { Badge, PageLoader, Spinner } from '../components/ui';
import { IconAlert, IconCheck, IconMail, IconShield } from '../components/ui/Icons';

export default function Settings() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [sessions, setSessions] = useState(null);
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(false);

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


  if (!sessions) return <PageLoader label="Loading settings…" />;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="display-md">Settings</h1>
        <p className="mt-1 text-sm text-ink-500">Account, sessions and delivery diagnostics.</p>
      </header>

      {/* ------------------------------------------------------------ account */}
      <section className="card p-5 sm:p-6">
        <h2 className="display-sm">Account</h2>
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
              <h2 className="display-sm">Email delivery</h2>
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
            <h2 className="display-sm">Signed-in devices</h2>
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

      {/* --------------------------------------------------------- account */}
      {/* Deletion is deliberately NOT offered here. A profile is linked to a
          placement record, carries the cell's readiness analysis and holds the
          applications the student logged, so a self-serve delete destroys
          institutional data nobody can recover. The route returns 403; the
          placement cell removes accounts. */}
      <section className="rounded-2xl border border-ink-200 bg-ink-50/50 p-5 sm:p-6">
        <h2 className="display-sm">Closing your account</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          Your profile is tied to your placement record, so accounts are managed by the placement
          cell rather than deleted from here. Email them if you need yours removed and they will
          confirm before anything is deleted.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
          To stop appearing in the public student directory in the meantime, switch off
          <b className="font-semibold text-ink-700"> Public profile</b> above — that takes effect
          immediately and keeps your data.
        </p>
      </section>
    </div>
  );
}
