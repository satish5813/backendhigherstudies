import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { resumeApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, ConfirmDialog, EmptyState, PageLoader } from '../components/ui';
import { IconDoc, IconPlus, IconTarget, IconTrash } from '../components/ui/Icons';
import CreateResumeModal from '../components/resume/CreateResumeModal';
import UploadResumeModal from '../components/resume/UploadResumeModal';

export default function ResumeList() {
  const [state, setState] = useState({ loading: true, items: [], templates: [], roles: [] });
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();

  const load = async () => {
    try {
      const [list, meta] = await Promise.all([resumeApi.list(), resumeApi.templates()]);
      setState({ loading: false, items: list.items, templates: meta.templates, roles: meta.roles });
    } catch (err) {
      toast.error(err.message);
      setState((s) => ({ ...s, loading: false }));
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const remove = async () => {
    try {
      await resumeApi.remove(confirm.id);
      toast.success('Resume deleted.');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirm(null);
    }
  };

  if (state.loading) return <PageLoader label="Loading your resumes…" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">Resumes</h1>
          <p className="mt-1 text-sm text-ink-500">
            One per target role. Each is scored against ATS criteria the moment you edit it.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setUploading(true)} className="btn-secondary h-10">
            <IconDoc size={16} /> Check an existing resume
          </button>
          <button onClick={() => setCreating(true)} className="btn-primary h-10">
            <IconPlus size={16} /> New resume
          </button>
        </div>
      </header>

      {!state.items.length ? (
        <EmptyState
          icon={IconDoc}
          title="No resumes yet"
          message="Generate one from your profile in a couple of clicks — pick a template and a target role, and everything autofills."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => setCreating(true)} className="btn-primary">Create my first resume</button>
              <button onClick={() => setUploading(true)} className="btn-secondary">Check an existing one</button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.items.map((r) => {
            const tmpl = state.templates.find((t) => t.id === r.template);
            const tone = r.ats_score >= 85 ? 'emerald' : r.ats_score >= 70 ? 'sky' : r.ats_score >= 50 ? 'amber' : 'rose';
            return (
              <div key={r.id} className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift">
                <Link to={`/app/resumes/${r.id}`} className="flex-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold tracking-tight text-ink-900 group-hover:text-brand-700">{r.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">{tmpl?.name ?? r.template}</p>
                    </div>
                    {r.is_default && <Badge tone="brand">Default</Badge>}
                  </div>

                  {r.target_role && (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600">
                      <IconTarget size={13} className="text-ink-400" /> {r.target_role}
                    </p>
                  )}

                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className={`text-3xl font-black tracking-tight ${
                        tone === 'emerald' ? 'text-emerald-600' : tone === 'sky' ? 'text-sky-600' :
                        tone === 'amber' ? 'text-amber-600' : 'text-rose-600'}`}>
                        {r.ats_score ?? '—'}
                      </p>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">ATS score</p>
                    </div>
                    <p className="text-[11px] text-ink-400">
                      Updated {new Date(r.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </Link>

                <div className="flex items-center justify-between border-t border-ink-100 bg-ink-50/50 px-4 py-2.5">
                  <Link to={`/app/resumes/${r.id}`} className="text-xs font-bold text-brand-600 hover:text-brand-700">
                    Open editor →
                  </Link>
                  <button
                    onClick={() => setConfirm(r)}
                    className="rounded-lg p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete resume"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateResumeModal open={creating} onClose={() => { setCreating(false); load(); }} />

      <UploadResumeModal
        open={uploading}
        onClose={() => setUploading(false)}
        onApplied={load}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Delete this resume?"
        message={`“${confirm?.title}” will be permanently removed. Your profile data stays untouched.`}
      />
    </div>
  );
}
