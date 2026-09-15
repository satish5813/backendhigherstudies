import { useState } from 'react';
import { authApi } from './api';
import Brand from './Brand';

/**
 * Same passwordless sign-in as the main portal: an address, then the code it
 * receives. Only ADMIN_EMAILS get anywhere past this screen — a student can
 * sign in, and is then told this is not for them.
 */
export default function Login({ onSignedIn }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    const value = email.trim().toLowerCase();
    if (!value) return setError('Enter your email address.');
    setBusy(true);
    try {
      const res = await authApi.requestOtp(value);
      setInfo(res.message);
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4,8}$/.test(code.trim())) return setError('Enter the numeric code from your email.');
    setBusy(true);
    try {
      const res = await authApi.verifyOtp(email.trim().toLowerCase(), code.trim());
      onSignedIn(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-[26rem]">
        <Brand className="mb-8" />
        <div className="card p-7">
          <h1 className="display text-[24px] text-ink-900">Placement follow-up</h1>
          <p className="mt-1.5 text-sm text-ink-500">For the placement cell. Sign in with your KL University address.</p>

          {step === 'email' ? (
            <form onSubmit={requestCode} className="mt-6 space-y-4" noValidate>
              <div>
                <label className="label">Email address</label>
                <input
                  type="email" inputMode="email" autoComplete="email" autoFocus
                  className={`input ${error ? 'input-error' : ''}`}
                  placeholder="you@kluniversity.in"
                  value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }}
                />
                {error && <p className="error-text">{error}</p>}
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send sign-in code'}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-6 space-y-4" noValidate>
              <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">{info}</p>
              <div>
                <label className="label">6-digit code</label>
                <input
                  inputMode="numeric" autoComplete="one-time-code" autoFocus
                  className={`input text-center text-[22px] font-bold tracking-[.4em] ${error ? 'input-error' : ''}`}
                  placeholder="••••••"
                  value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 8)); setError(''); }}
                />
                {error && <p className="error-text">{error}</p>}
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button type="button" className="btn-ghost w-full text-xs" onClick={() => { setStep('email'); setCode(''); setError(''); }}>
                Use a different address
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-ink-400">Passwordless by design — a code is emailed each time.</p>
      </div>
    </div>
  );
}
