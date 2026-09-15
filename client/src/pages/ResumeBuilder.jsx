import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resumeApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, Field, Modal, PageLoader, ScoreRing, Spinner } from '../components/ui';
import ResumePreview from '../components/resume/ResumePreview';
import TemplateGallery from '../components/resume/TemplateGallery';
import { AiReviewPanel, AiSummaryButton } from '../components/resume/AiAssist';
import {
  IconAlert, IconArrowLeft, IconCheck, IconDoc, IconDownload, IconRefresh,
  IconSparkles, IconTarget,
} from '../components/ui/Icons';

const AUTOSAVE_MS = 1200;

export default function ResumeBuilder() {
  const { id } = useParams();
  const toast = useToast();

  const [resume, setResume] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [roles, setRoles] = useState([]);
  const [accents, setAccents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [jdOpen, setJdOpen] = useState(false);
  const [panel, setPanel] = useState('score'); // score | content | template

  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const docRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, meta] = await Promise.all([resumeApi.get(id), resumeApi.templates()]);
        setResume(r);
        setTemplates(meta.templates);
        setRoles(meta.roles);
        setAccents(meta.accents ?? []);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ------------------------------------------------------------- autosave */

  const persist = useCallback(
    async (payload) => {
      setSaving(true);
      try {
        const updated = await resumeApi.update(id, payload);
        setResume(updated);
        setSavedAt(new Date());
        dirtyRef.current = false;
      } catch (err) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
    },
    [id, toast]
  );

  const queueSave = useCallback(
    (next) => {
      dirtyRef.current = true;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        persist({
          title: next.title,
          template: next.template,
          targetRole: next.target_role,
          jobDescription: next.job_description,
          data: next.data,
        });
      }, AUTOSAVE_MS);
    },
    [persist]
  );

  // don't let a half-typed edit vanish on navigate
  useEffect(() => {
    const warn = (e) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timerRef.current); };
  }, []);

  const patch = useCallback(
    (partial) => {
      setResume((prev) => {
        const next = { ...prev, ...partial };
        queueSave(next);
        return next;
      });
    },
    [queueSave]
  );

  const patchData = useCallback((updater) => {
    setResume((prev) => {
      const next = { ...prev, data: updater(prev.data || {}) };
      queueSave(next);
      return next;
    });
  }, [queueSave]);

  /* -------------------------------------------------------------- actions */

  const pullFromProfile = async () => {
    setSaving(true);
    try {
      const updated = await resumeApi.refresh(id);
      setResume(updated);
      setSavedAt(new Date());
      toast.success(`Pulled from your profile — ATS score ${updated.ats_score}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    clearTimeout(timerRef.current);
    if (dirtyRef.current) {
      await persist({
        title: resume.title, template: resume.template, targetRole: resume.target_role,
        jobDescription: resume.job_description, data: resume.data,
      });
    }
    resumeApi.export(id, 'pdf').catch(() => {});
    const previousTitle = document.title;
    document.title = `${(resume.data?.basics?.fullName || 'Resume').replace(/\s+/g, '_')}_Resume`;
    window.print();
    setTimeout(() => { document.title = previousTitle; }, 800);
  };

  if (loading) return <PageLoader label="Opening your resume…" />;
  if (!resume) {
    return (
      <EmptyState
        icon={IconDoc}
        title="Resume not found"
        message="It may have been deleted."
        action={<Link to="/app/resumes" className="btn-primary">Back to resumes</Link>}
      />
    );
  }

  const report = resume.ats_report;

  return (
    <div className="print-root -mx-4 -my-6 min-h-screen bg-ink-100 sm:-mx-6 lg:-mx-8 lg:-my-10">
      {/* ---------------------------------------------------------- toolbar */}
      <header className="no-print sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/app/resumes" className="btn-ghost h-9 shrink-0 px-2" aria-label="Back">
            <IconArrowLeft size={17} />
          </Link>

          <input
            value={resume.title}
            onChange={(e) => patch({ title: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1.5 text-base font-bold tracking-tight text-ink-900 transition hover:border-ink-200 focus:border-brand-400 focus:outline-none"
            aria-label="Resume title"
          />

          <span className="hidden items-center gap-1.5 text-xs text-ink-400 sm:flex">
            {saving ? (
              <><Spinner size={13} /> Saving…</>
            ) : savedAt ? (
              <><IconCheck size={13} className="text-emerald-500" /> Saved {savedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
            ) : null}
          </span>

          <button onClick={pullFromProfile} className="btn-secondary h-9 text-xs" disabled={saving}>
            <IconRefresh size={14} /> <span className="hidden sm:inline">Pull from profile</span>
          </button>
          <button onClick={download} className="btn-primary h-9 text-xs">
            <IconDownload size={14} /> Download PDF
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 p-4 sm:p-6 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* ------------------------------------------------------- side panel */}
        <aside className="no-print space-y-4 lg:sticky lg:top-[4.5rem]">
          <div className="card overflow-hidden">
            <div className="flex border-b border-ink-100">
              {[['score', 'ATS score'], ['content', 'Content'], ['template', 'Design'], ['ai', 'AI review']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPanel(key)}
                  className={`flex-1 px-3 py-2.5 text-xs font-bold transition ${
                    panel === key ? 'border-b-2 border-brand-600 text-brand-700' : 'text-ink-500 hover:bg-ink-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="scroll-thin max-h-[calc(100vh-11rem)] overflow-y-auto p-5">
              {panel === 'score' && <ScorePanel report={report} resume={resume} roles={roles} onPatch={patch} onOpenJd={() => setJdOpen(true)} />}
              {panel === 'content' && <ContentPanel data={resume.data} onPatchData={patchData} />}
              {panel === 'ai' && (
                <AiReviewPanel
                  resumeId={id}
                  // The apply endpoint writes to the profile. Pull it straight
                  // back in so the preview and the ATS score reflect the change
                  // the student just accepted, instead of making them find
                  // "Pull from profile" to see any effect.
                  onApplied={pullFromProfile}
                />
              )}
              {panel === 'template' && (
                <TemplatePanel
                  templates={templates}
                  current={resume.template}
                  onPick={(t) => patch({ template: t })}
                  accents={accents}
                  accent={resume.accent}
                  onAccent={(a) => patch({ accent: a })}
                  data={resume.data}
                />
              )}
            </div>
          </div>
        </aside>

        {/* ---------------------------------------------------------- preview */}
        <main className="min-w-0">
          <ResumePreview data={resume.data} template={resume.template} accent={resume.accent} innerRef={docRef} />
        </main>
      </div>

      <JobDescriptionModal
        open={jdOpen}
        onClose={() => setJdOpen(false)}
        value={resume.job_description || ''}
        onSave={(jd) => { patch({ job_description: jd }); setJdOpen(false); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- score */

function ScorePanel({ report, resume, roles, onPatch, onOpenJd }) {
  if (!report) return <p className="text-sm text-ink-500">Save an edit to generate your score.</p>;

  const tone = report.band?.tone ?? 'brand';
  const toneText = { emerald: 'text-emerald-600', sky: 'text-sky-600', amber: 'text-amber-600', rose: 'text-rose-600' }[tone] ?? 'text-brand-600';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <ScoreRing value={report.score} size={92} stroke={9} sublabel="/ 100" tone={tone} />
        <div>
          <p className={`text-base font-black tracking-tight ${toneText}`}>{report.band?.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{report.band?.note}</p>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Target role" hint="Sets the keyword list your resume is matched against.">
          <input
            className="input"
            list="builder-roles"
            value={resume.target_role || ''}
            onChange={(e) => onPatch({ target_role: e.target.value })}
            placeholder="Software Engineer"
          />
          <datalist id="builder-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>

        <button onClick={onOpenJd} className="btn-secondary h-9 w-full text-xs">
          <IconTarget size={14} />
          {resume.job_description ? 'Edit job description' : 'Paste a job description'}
        </button>
        {resume.job_description && (
          <p className="text-[11px] text-emerald-600">
            ✓ Scoring against {report.keywordUniverse} keywords from your pasted JD.
          </p>
        )}
      </div>

      {report.topFixes?.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">
            <IconAlert size={12} /> Fix these first
          </p>
          <ul className="mt-2 space-y-2">
            {report.topFixes.map((fix, i) => (
              <li key={i} className="text-xs leading-relaxed text-amber-900">• {fix}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="section-title mb-2.5">Breakdown</p>
        <div className="space-y-3">
          {report.breakdown.map((b) => {
            const pct = (b.score / b.max) * 100;
            const cls = pct >= 90 ? 'bg-emerald-500' : pct >= 65 ? 'bg-sky-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
            return (
              <details key={b.key} className="group">
                <summary className="cursor-pointer list-none">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-ink-700 group-open:text-brand-700">{b.label}</span>
                    <span className="font-mono text-[11px] text-ink-400">{b.score}/{b.max}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className={`h-full rounded-full transition-all duration-500 ${cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </summary>
                {b.tips?.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-l-2 border-ink-100 pl-3">
                    {b.tips.map((t, i) => (
                      <li key={i} className="text-[11.5px] leading-relaxed text-ink-500">{t}</li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
      </div>

      {report.missingKeywords?.length > 0 && (
        <div>
          <p className="section-title mb-2">Missing keywords</p>
          <div className="flex flex-wrap gap-1.5">
            {report.missingKeywords.map((k) => (
              <span key={k} className="chip bg-rose-50 text-rose-700 ring-1 ring-rose-100">{k}</span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            Only add the ones that are genuinely true of you — a recruiter will ask.
          </p>
        </div>
      )}

      {report.matchedKeywords?.length > 0 && (
        <div>
          <p className="section-title mb-2">Matched ({report.matchedKeywords.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {report.matchedKeywords.slice(0, 18).map((k) => (
              <span key={k} className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">{k}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-4 border-t border-ink-100 pt-4 text-xs text-ink-400">
        <span>{report.wordCount} words</span>
        <span>{report.bulletCount} bullets</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- content */

function ContentPanel({ data, onPatchData }) {
  const sections = useMemo(
    () => [
      ['education', 'Education', data.education?.length],
      ['skills', 'Skills', data.skills?.length],
      ['experience', 'Experience', data.experience?.length],
      ['projects', 'Projects', data.projects?.length],
      ['achievements', 'Achievements', data.achievements?.length],
      ['coding', 'Coding profiles', data.coding?.length],
    ],
    [data]
  );

  return (
    <div className="space-y-5">
      <Field label="Professional summary" hint="2–3 lines. Name the role you want and your strongest evidence.">
        <textarea
          className="input"
          rows={6}
          value={data.summary || ''}
          onChange={(e) => onPatchData((d) => ({ ...d, summary: e.target.value }))}
          placeholder="Final-year Computer Science student focused on backend engineering…"
        />
        <AiSummaryButton
          data={data}
          targetRole={data.meta?.targetRole}
          onApply={(text) => onPatchData((d) => ({ ...d, summary: text }))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {['fullName', 'headline', 'email', 'phone', 'location'].map((key) => (
          <Field
            key={key}
            label={{ fullName: 'Name', headline: 'Headline', email: 'Email', phone: 'Phone', location: 'Location' }[key]}
            className={key === 'headline' ? 'col-span-2' : 'col-span-2 sm:col-span-1'}
          >
            <input
              className="input"
              value={data.basics?.[key] || ''}
              onChange={(e) => onPatchData((d) => ({ ...d, basics: { ...d.basics, [key]: e.target.value } }))}
            />
          </Field>
        ))}
      </div>

      <div>
        <p className="section-title mb-2.5">Sections in this resume</p>
        <ul className="space-y-1.5">
          {sections.map(([key, label, count]) => (
            <li key={key} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
              <span className="text-[13px] font-semibold text-ink-700">{label}</span>
              {count ? (
                <Badge tone="emerald">{count} item{count === 1 ? '' : 's'}</Badge>
              ) : (
                <Badge tone="slate">empty</Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
          Empty sections are left out of the document entirely. Add entries in{' '}
          <Link to="/app/profile" className="font-semibold text-brand-600 hover:underline">your profile</Link>, then hit
          “Pull from profile”.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- template */

function TemplatePanel({ templates, current, onPick, accents = [], accent, onAccent, data }) {
  const active = templates.find((t) => t.id === current);

  return (
    <div className="space-y-2.5">
      {accents.length > 0 && (
        <div className="mb-4 rounded-xl border border-ink-200 p-3.5">
          <p className="section-title mb-2.5">Accent colour</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onAccent(null)}
              title={`Template default${active?.accent ? ` (${active.accent})` : ''}`}
              className={`grid h-7 w-7 place-items-center rounded-full border-2 transition ${
                !accent ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink-200 hover:border-ink-400'
              }`}
              style={{ background: active?.accent ?? '#111827' }}
            >
              {!accent && <IconCheck size={12} className="text-white" />}
            </button>
            {accents.map((a) => (
              <button
                key={a.value}
                onClick={() => onAccent(a.value)}
                title={a.name}
                className={`grid h-7 w-7 place-items-center rounded-full border-2 transition ${
                  accent === a.value ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-transparent hover:scale-110'
                }`}
                style={{ background: a.value }}
              >
                {accent === a.value && <IconCheck size={12} className="text-white" />}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            Colour never changes the ATS score — every preset stays legible printed in greyscale.
          </p>
        </div>
      )}

      <TemplateGallery
        templates={templates}
        value={current}
        onChange={onPick}
        data={data}
        accent={accent}
        columns="grid-cols-2"
        thumbWidth={140}
      />

      <div className="mt-4 flex gap-2.5 rounded-xl bg-ink-50 p-3.5">
        <IconSparkles size={15} className="mt-0.5 shrink-0 text-ink-400" />
        <p className="text-[11.5px] leading-relaxed text-ink-500">
          Every template is a single column with standard headings. Nothing here uses tables, text boxes
          or columns — the three things that most reliably break an ATS parse.
        </p>
      </div>
    </div>
  );
}

function JobDescriptionModal({ open, onClose, value, onSave }) {
  const [text, setText] = useState(value);
  useEffect(() => { if (open) setText(value); }, [open, value]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Score against a job description"
      subtitle="Paste the posting. We extract its keywords and match your resume against them."
      footer={
        <div className="flex justify-between gap-2">
          <button className="btn-ghost" onClick={() => { setText(''); onSave(''); }}>Clear</button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => onSave(text)}>Score against this</button>
          </div>
        </div>
      }
    >
      <textarea
        className="input font-mono text-xs"
        rows={16}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full job description here — responsibilities, requirements, everything."
      />
      <p className="mt-2 text-xs text-ink-400">{text.length.toLocaleString()} characters</p>
    </Modal>
  );
}
