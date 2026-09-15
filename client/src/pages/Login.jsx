import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { Field, Spinner } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../store/auth';
import { ApiError, authApi } from '../lib/api';
import {
  IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconMail, IconShield, IconSparkles,
} from '../components/ui/Icons';

const OTP_LENGTH = 6;

export default function Login() {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);

  const [emailCheck, setEmailCheck] = useState(null); // { valid, message, suggestion, exists }
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');

  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);

  const inputsRef = useRef([]);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { signIn } = useAuth();

  const redirectTo = location.state?.from?.pathname || '/app';

  /* -------------------------------------------------- live email validation */
  useEffect(() => {
    const value = email.trim();
    if (step !== 'email' || value.length < 5 || !value.includes('@')) {
      setEmailCheck(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        setEmailCheck(await authApi.checkEmail(value, controller.signal));
      } catch (err) {
        if (err.name !== 'AbortError') setEmailCheck(null);
      } finally {
        setChecking(false);
      }
    }, 450);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [email, step]);

  /* ------------------------------------------------------------- countdowns */
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const t = setInterval(() => setExpiresIn((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [expiresIn]);

  useEffect(() => {
    if (step === 'code') setTimeout(() => inputsRef.current[0]?.focus(), 80);
  }, [step]);

  /* ---------------------------------------------------------------- actions */

  const requestOtp = async (e, { resend = false } = {}) => {
    e?.preventDefault();
    setError('');

    const value = email.trim().toLowerCase();
    if (!value) return setError('Enter your email address.');
    if (emailCheck && emailCheck.valid === false) return setError(emailCheck.message);

    setSubmitting(true);
    try {
      const res = await authApi.requestOtp(value);
      setEmail(res.email);
      setIsNewUser(res.isNewUser);
      setStep('code');
      setDigits(Array(OTP_LENGTH).fill(''));
      setCooldown(res.resendAfter || 60);
      setExpiresIn(Math.max(0, Math.round((new Date(res.expiresAt) - Date.now()) / 1000)));
      if (res.devCode) setDevCode(res.devCode);
      toast.success(resend ? 'New code sent.' : res.message);
    } catch (err) {
      if (err instanceof ApiError && err.payload?.retryAfter) setCooldown(err.payload.retryAfter);
      setError(err.message);
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (code) => {
    setError('');
    setSubmitting(true);
    try {
      const res = await authApi.verifyOtp(email, code, name.trim() || undefined);
      signIn(res);
      toast.success(res.isNewUser ? 'Account created. Welcome.' : 'Signed in.');
      navigate(res.isNewUser ? '/app/profile?onboarding=1' : redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
      setDigits(Array(OTP_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Accepts one digit per box, but also handles the case where the whole code
   * arrives in a single box — browser one-time-code autofill and fast typing
   * both do that, and neither fires a paste event.
   */
  const setDigit = (index, raw) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      setError('');
      return;
    }

    const next = [...digits];
    let cursor = index;
    for (const char of typed.slice(0, OTP_LENGTH - index)) {
      next[cursor] = char;
      cursor += 1;
    }
    setDigits(next);
    setError('');

    inputsRef.current[Math.min(cursor, OTP_LENGTH - 1)]?.focus();
    const code = next.join('');
    if (code.length === OTP_LENGTH && next.every(Boolean)) verify(code);
  };

  const onKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const onPaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array(OTP_LENGTH).fill('');
    text.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    if (text.length === OTP_LENGTH) verify(text);
    else inputsRef.current[text.length]?.focus();
  };

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  /* ------------------------------------------------------------------ view */

  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.1fr]">
      {/* ------------------------------------------------------- left panel */}
      <div className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div className="absolute inset-0 bg-mesh opacity-90" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo invert />

          <div className="max-w-md">
            <h2 className="text-4xl font-black leading-tight tracking-tight text-white">
              One profile.
              <span className="block text-white/50">Every application.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-white/60">
              Fill in your details once and we keep your ATS resume, your public profile and
              your job alerts in sync — automatically.
            </p>

            <ul className="mt-9 space-y-4">
              {[
                ['ATS-scored resumes', 'Eight weighted checks with a named fix for each gap.'],
                ['Live coding stats', 'LeetCode, GitHub and CodeChef sync onto your profile.'],
                ['Daily job alerts', 'Ranked against your real skill set, not a keyword blob.'],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-3.5">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                    <IconCheck size={13} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="text-sm text-white/50">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/35">
            Passwordless by design — we never store a password you could lose.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ right panel */}
      <div className="flex items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          {step === 'email' ? (
            <div className="animate-fade-up">
              <h1 className="text-[26px] font-black tracking-tight text-ink-900">Sign in or create an account</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
                Enter your email and we'll send you a {OTP_LENGTH}-digit code. No password needed.
              </p>

              <form onSubmit={requestOtp} className="mt-7 space-y-4" noValidate>
                <Field
                  label="Email address"
                  required
                  error={error || (emailCheck?.valid === false ? emailCheck.message : '')}
                  hint={
                    emailCheck?.valid
                      ? emailCheck.exists
                        ? `Welcome back${emailCheck.name ? ', ' + emailCheck.name.split(' ')[0] : ''} — we'll email you a sign-in code.`
                        : "New here? We'll email a code to confirm this address."
                      : 'Use your college or personal email — it becomes your login.'
                  }
                >
                  <div className="relative">
                    <IconMail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(''); }}
                      placeholder="you@college.edu"
                      className={`input pl-10 pr-10 ${error || emailCheck?.valid === false ? 'input-error' : ''} ${
                        emailCheck?.valid ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/10' : ''
                      }`}
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {checking ? (
                        <Spinner size={16} className="text-ink-400" />
                      ) : emailCheck?.valid ? (
                        <IconCheck size={17} className="text-emerald-500" />
                      ) : emailCheck?.valid === false ? (
                        <IconAlert size={16} className="text-rose-500" />
                      ) : null}
                    </span>
                  </div>
                </Field>

                {emailCheck?.suggestion && (
                  <button
                    type="button"
                    onClick={() => { setEmail(emailCheck.suggestion); setEmailCheck(null); }}
                    className="flex w-full items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-left text-sm text-amber-900 ring-1 ring-amber-200 transition hover:bg-amber-100"
                  >
                    <IconSparkles size={15} className="shrink-0 text-amber-600" />
                    Use <b className="font-semibold">{emailCheck.suggestion}</b> instead?
                  </button>
                )}

                {emailCheck?.valid && !emailCheck.exists && (
                  <Field label="Your full name" hint="Shown on your resume and public profile. You can change it later.">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Aarav Sharma"
                      autoComplete="name"
                      className="input"
                    />
                  </Field>
                )}

                <button
                  type="submit"
                  disabled={submitting || checking || emailCheck?.valid === false || !email.trim()}
                  className="btn-primary h-11 w-full"
                >
                  {submitting ? <Spinner size={16} /> : <IconMail size={17} />}
                  {submitting ? 'Sending code…' : 'Send verification code'}
                </button>
              </form>

              <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
                <IconShield size={15} className="mt-px shrink-0 text-ink-400" />
                Codes expire in 10 minutes and are limited to 5 requests per hour per address.
                We check your domain accepts mail before sending.
              </div>

              <p className="mt-6 text-center text-sm text-ink-500">
                <Link to="/" className="font-semibold text-brand-600 hover:text-brand-700">← Back to home</Link>
              </p>
            </div>
          ) : (
            <div className="animate-fade-up">
              <button
                onClick={() => { setStep('email'); setError(''); setDevCode(''); }}
                className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition hover:text-ink-900"
              >
                <IconArrowLeft size={15} /> Use a different email
              </button>

              <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                <IconMail size={22} />
              </div>

              <h1 className="text-[26px] font-black tracking-tight text-ink-900">Check your inbox</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
                We sent a {OTP_LENGTH}-digit code to <b className="font-semibold text-ink-900">{email}</b>.
                {isNewUser && ' Entering it creates your account.'}
              </p>

              {devCode && (
                <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Development mode</p>
                  <p className="mt-1 text-sm text-amber-900">
                    SMTP is not configured, so here is your code:{' '}
                    <b className="font-mono text-base tracking-widest">{devCode}</b>
                  </p>
                </div>
              )}

              <div className="mt-7">
                <div className="flex justify-between gap-2" onPaste={onPaste}>
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => (inputsRef.current[i] = el)}
                      value={digit}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => onKeyDown(i, e)}
                      onFocus={(e) => e.target.select()}
                      inputMode="numeric"
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      // not 1: autofill delivers the whole code into one box,
                      // and maxLength=1 would silently truncate it
                      maxLength={OTP_LENGTH}
                      disabled={submitting}
                      aria-label={`Digit ${i + 1}`}
                      className={`h-14 w-full rounded-xl border-2 text-center font-mono text-xl font-bold text-ink-900 transition
                        focus:outline-none focus:ring-4 disabled:opacity-60
                        ${error
                          ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10'
                          : digit
                          ? 'border-brand-500 bg-brand-50/40 focus:ring-brand-500/10'
                          : 'border-ink-200 focus:border-brand-500 focus:ring-brand-500/10'}`}
                    />
                  ))}
                </div>

                {error && (
                  <p className="error-text justify-center"><IconAlert size={13} />{error}</p>
                )}

                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-ink-400">
                    {expiresIn > 0 ? `Code expires in ${mmss(expiresIn)}` : 'This code has expired'}
                  </span>
                  <button
                    onClick={(e) => requestOtp(e, { resend: true })}
                    disabled={cooldown > 0 || submitting}
                    className="font-semibold text-brand-600 transition hover:text-brand-700 disabled:text-ink-400"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>

                <button
                  onClick={() => verify(digits.join(''))}
                  disabled={submitting || digits.some((d) => !d)}
                  className="btn-primary mt-6 h-11 w-full"
                >
                  {submitting ? <Spinner size={16} /> : null}
                  {submitting ? 'Verifying…' : 'Verify and continue'}
                  {!submitting && <IconArrowRight size={16} />}
                </button>
              </div>

              <p className="mt-6 text-center text-xs leading-relaxed text-ink-400">
                Didn't get it? Check spam, and confirm the address above is spelled correctly.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
