import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resumeApi } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { Badge, Field, Modal, Spinner } from '../ui';
import { IconBriefcase, IconSparkles, IconTarget } from '../ui/Icons';
import TemplateGallery from './TemplateGallery';

/**
 * Creates a resume aimed at something specific.
 *
 * A generic resume scores against a generic keyword list. Opened from a job
 * posting, this pre-loads that job's title and requirements so the ATS score
 * is measured against the posting the student is actually applying to — which
 * is the only score that matters.
 */
export default function CreateResumeModal({ open, onClose, job = null, presetRole = '' }) {
  const [templates, setTemplates] = useState([]);
  const [roles, setRoles] = useState([]);
  const [profileData, setProfileData] = useState(null);

  const [title, setTitle] = useState('My Resume');
  const [template, setTemplate] = useState('ats-classic');
  const [targetRole, setTargetRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [meta, autofill] = await Promise.all([
          resumeApi.templates(),
          resumeApi.autofill().catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        setTemplates(meta.templates);
        setRoles(meta.roles);
        setProfileData(autofill.data);
      } catch (err) {
        toast.error(err.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Seed the form from whatever opened it.
  useEffect(() => {
    if (!open) return;
    if (job) {
      setTitle(`${job.title} — ${job.company}`.slice(0, 150));
      setTargetRole(job.title);
      setJobDescription(jobToDescription(job));
    } else {
      setTitle(presetRole ? `${titleCase(presetRole)} resume` : 'My Resume');
      setTargetRole(presetRole || '');
      setJobDescription('');
    }
  }, [open, job, presetRole]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const resume = await resumeApi.create({
        title: title.trim() || 'My Resume',
        template,
        targetRole: targetRole.trim() || null,
        jobDescription: jobDescription.trim() || null,
        autofill: true,
      });
      toast.success(`Created — ATS score ${resume.ats_score}.`);
      onClose?.();
      navigate(`/app/resumes/${resume.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const subtitle = job
    ? `Scored against the actual ${job.company} posting, not a generic keyword list.`
    : 'Your profile autofills into the document — you can edit anything afterwards.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={job ? `Resume for ${job.title}` : 'New resume'}
      subtitle={subtitle}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="hidden text-xs text-ink-400 sm:block">
            {templates.find((t) => t.id === template)?.name ?? 'Template'} selected
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button form="new-resume" type="submit" className="btn-primary" disabled={busy}>
              {busy ? <Spinner size={15} /> : <IconSparkles size={16} />}
              {busy ? 'Generating…' : 'Generate resume'}
            </button>
          </div>
        </div>
      }
    >
      <form id="new-resume" onSubmit={create} className="space-y-5">
        {job && (
          <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
            <IconBriefcase size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-900">{job.title} · {job.company}</p>
              <p className="mt-0.5 text-xs text-brand-800/80">
                {[job.location, job.work_mode, job.job_type].filter(Boolean).join(' · ')}
                {job.min_ctc ? ` · ₹${job.min_ctc}${job.max_ctc ? `–${job.max_ctc}` : '+'} LPA` : ''}
              </p>
              {job.skills?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {job.skills.slice(0, 10).map((s) => <Badge key={s} tone="brand">{s}</Badge>)}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Resume name" hint="For your own reference — not printed.">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field
            label="Target role"
            hint={job ? 'Taken from the posting.' : 'Drives the keyword match in your ATS score.'}
          >
            <input
              className="input"
              list="create-role-options"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="Software Engineer"
            />
            <datalist id="create-role-options">
              {roles.map((r) => <option key={r} value={r} />)}
            </datalist>
          </Field>
        </div>

        {!job && roles.length > 0 && (
          <div>
            <p className="label">Or pick a role to target</p>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setTargetRole(r);
                    setTitle(`${titleCase(r)} resume`);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    targetRole === r ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field
          label={job ? 'Job description used for scoring' : 'Job description (optional)'}
          hint="Paste a posting and your score is matched against its exact wording."
        >
          <textarea
            className="input font-mono text-[11px]"
            rows={job ? 5 : 3}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the responsibilities and requirements here…"
          />
        </Field>

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <p className="label mb-0">Template</p>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-400">
              <IconTarget size={12} /> previews use your own content
            </span>
          </div>
          {templates.length ? (
            <div className="scroll-thin max-h-[24rem] overflow-y-auto pr-1">
              <TemplateGallery
                templates={templates}
                value={template}
                onChange={setTemplate}
                data={profileData}
                columns="sm:grid-cols-3"
                thumbWidth={150}
              />
            </div>
          ) : (
            <div className="flex justify-center py-8"><Spinner size={22} /></div>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Flattens a job row into the text the ATS keyword extractor reads. */
function jobToDescription(job) {
  return [
    `${job.title} at ${job.company}`,
    [job.location, job.work_mode, job.job_type].filter(Boolean).join(' · '),
    job.experience ? `Experience: ${job.experience}` : '',
    job.skills?.length ? `Required skills: ${job.skills.join(', ')}` : '',
    '',
    job.description || '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

const titleCase = (s) => String(s || '').replace(/(^|\s)\w/g, (m) => m.toUpperCase());
