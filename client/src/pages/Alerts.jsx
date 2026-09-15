import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobsApi } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, Field, PageLoader, Spinner, TagInput } from '../components/ui';
import { IconBell, IconCheck, IconClock, IconMail, IconSparkles } from '../components/ui/Icons';

const WORK_MODES = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']];
const JOB_TYPES = [['full-time', 'Full-time'], ['internship', 'Internship'], ['contract', 'Contract']];

export default function Alerts() {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState({ loading: true });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const data = await jobsApi.alert();
      setState({ loading: false, ...data });
      setForm(data.alert);
    } catch (err) {
      toast.error(err.message);
      setState({ loading: false, error: err.message });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleIn = (key, value) => {
    const list = form[key] || [];
    set(key, list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await jobsApi.saveAlert({
        active: form.active,
        roles: form.roles || [],
        skills: form.skills || [],
        locations: form.locations || [],
        work_modes: form.work_modes || [],
        job_types: form.job_types || [],
        min_ctc: form.min_ctc === '' ? null : form.min_ctc,
        frequency: form.frequency,
        send_hour: form.send_hour,
      });
      setForm(res.alert);
      setState((s) => ({ ...s, alert: res.alert, preview: res.preview }));
      toast.success('Alert preferences saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await jobsApi.testAlert();
      toast[res.sent ? 'success' : 'info'](res.message);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  if (state.loading || !form) return <PageLoader label="Loading your alert settings…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display-md">Daily job alerts</h1>
        <p className="mt-1 text-sm text-ink-500">
          A ranked digest of new openings, emailed to <b className="font-semibold text-ink-700">{user?.email}</b>.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <form onSubmit={save} className="card p-5 sm:p-6">
          {/* master switch */}
          <div
            className={`flex items-start gap-4 rounded-xl border p-4 transition ${
              form.active ? 'border-brand-200 bg-brand-50/50' : 'border-ink-200 bg-ink-50'
            }`}
          >
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(form.active)}
              onClick={() => set('active', !form.active)}
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${form.active ? 'bg-brand-600' : 'bg-ink-300'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${form.active ? 'left-[1.375rem]' : 'left-0.5'}`} />
            </button>
            <div>
              <p className="text-sm font-bold text-ink-900">
                {form.active ? 'Job alerts are on' : 'Job alerts are off'}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                {form.active
                  ? `You will get a ${form.frequency} digest at ${String(form.send_hour).padStart(2, '0')}:00 IST when there are new matches.`
                  : 'Turn this on to receive matched openings by email.'}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <Field label="Target roles" hint="Job titles you are applying for. Press Enter after each.">
              <TagInput value={form.roles || []} onChange={(v) => set('roles', v)} max={10} placeholder="Software Engineer, Data Analyst…" />
            </Field>

            <Field label="Skills to match on" hint="Left empty, we use the skills already on your profile.">
              <TagInput value={form.skills || []} onChange={(v) => set('skills', v)} max={30} placeholder="React, Python, SQL…" />
            </Field>

            <Field label="Preferred locations" hint="Remote roles always match, whatever you list here.">
              <TagInput value={form.locations || []} onChange={(v) => set('locations', v)} max={15} placeholder="Hyderabad, Bengaluru…" />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Work mode">
                <div className="flex flex-wrap gap-2">
                  {WORK_MODES.map(([value, label]) => (
                    <Chip key={value} active={(form.work_modes || []).includes(value)} onClick={() => toggleIn('work_modes', value)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Job type">
                <div className="flex flex-wrap gap-2">
                  {JOB_TYPES.map(([value, label]) => (
                    <Chip key={value} active={(form.job_types || []).includes(value)} onClick={() => toggleIn('job_types', value)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Minimum CTC" hint="In LPA.">
                <input
                  type="number"
                  step="0.5"
                  className="input"
                  value={form.min_ctc ?? ''}
                  onChange={(e) => set('min_ctc', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="6"
                />
              </Field>

              <Field label="Frequency">
                <select className="input" value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="off">Paused</option>
                </select>
              </Field>

              <Field label="Send at" hint="IST.">
                <select className="input" value={form.send_hour} onChange={(e) => set('send_hour', Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5">
            <button type="button" onClick={sendTest} disabled={testing} className="btn-secondary h-10">
              {testing ? <Spinner size={15} /> : <IconMail size={16} />}
              {testing ? 'Sending…' : 'Send me one now'}
            </button>
            <button type="submit" className="btn-primary h-10" disabled={saving}>
              {saving ? <Spinner size={15} /> : <IconCheck size={16} />} Save preferences
            </button>
          </div>
        </form>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
              <IconSparkles size={17} className="text-brand-500" /> What you'd receive today
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">Top matches under the current settings.</p>

            {state.preview?.length ? (
              <ul className="mt-4 space-y-2.5">
                {state.preview.map((job) => (
                  <li key={job.id} className="rounded-xl border border-ink-200 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink-900">{job.title}</p>
                        <p className="truncate text-xs text-ink-500">{job.company} · {job.location || 'India'}</p>
                      </div>
                      <Badge tone={job.match >= 70 ? 'emerald' : 'sky'}>{job.match}%</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={IconBell}
                title="No matches right now"
                message="Loosen a filter or add more skills — matching is generous once your profile has content."
                action={<Link to="/app/profile?tab=skills" className="btn-secondary h-8 text-xs">Add skills</Link>}
              />
            )}
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
              <IconClock size={17} className="text-ink-400" /> Delivery history
            </h2>

            {state.history?.length ? (
              <ul className="mt-4 divide-y divide-ink-100">
                {state.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-ink-800">
                        {h.status === 'sent' ? `${h.job_count} job${h.job_count === 1 ? '' : 's'} sent` :
                         h.status === 'skipped' ? 'Skipped' : 'Failed'}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {new Date(h.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {h.error ? ` · ${h.error}` : ''}
                      </p>
                    </div>
                    <Badge tone={h.status === 'sent' ? 'emerald' : h.status === 'failed' ? 'rose' : 'slate'}>
                      {h.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ink-500">
                No digests sent yet. Hit “Send me one now” to confirm delivery works.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-brand-600 text-white shadow-sm' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
