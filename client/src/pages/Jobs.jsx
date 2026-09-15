import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobsApi } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { Badge, EmptyState, Modal, PageLoader, Spinner } from '../components/ui';
import CreateResumeModal from '../components/resume/CreateResumeModal';
import ApplyTracker from '../components/jobs/ApplyTracker';
import CompanyMark from '../components/ui/CompanyMark';
import TechIcon from '../components/ui/TechIcon';
import { IconBriefcase, IconDoc, IconExternal, IconMapPin, IconSearch, IconTarget } from '../components/ui/Icons';

export default function Jobs() {
  const [tab, setTab] = useState('matched');
  const [query, setQuery] = useState({ q: '', location: '', mode: '', type: '' });
  const [matched, setMatched] = useState(null);
  const [all, setAll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [tailorFor, setTailorFor] = useState(null);
  // jobId -> application. One fetch keeps every card and the detail modal in sync.
  const [applications, setApplications] = useState({});
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const [rec, list, apps] = await Promise.all([
          jobsApi.recommended(20),
          jobsApi.list({ perPage: 30 }),
          jobsApi.applications(),
        ]);
        setMatched(rec.items);
        setAll(list);
        setApplications(Object.fromEntries(apps.items.map((a) => [a.job.id, a])));
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const search = async (e) => {
    e?.preventDefault();
    setTab('all');
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v));
      setAll(await jobsApi.list({ ...params, perPage: 30 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id) => {
    try {
      setDetail({ loading: true });
      setDetail(await jobsApi.get(id));
    } catch (err) {
      toast.error(err.message);
      setDetail(null);
    }
  };

  const items = tab === 'matched' ? matched : all?.items;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display-md">Jobs</h1>
        <p className="mt-1 text-sm text-ink-500">
          Openings ranked against your skills. Tune what reaches your inbox in{' '}
          <Link to="/app/alerts" className="font-semibold text-brand-600 hover:underline">job alerts</Link>.
        </p>
      </header>

      <form onSubmit={search} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-10"
            placeholder="Role, company or keyword"
            value={query.q}
            onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value }))}
          />
        </div>
        <input
          className="input sm:w-44"
          placeholder="Location"
          value={query.location}
          onChange={(e) => setQuery((q) => ({ ...q, location: e.target.value }))}
        />
        <select className="input sm:w-36" value={query.mode} onChange={(e) => setQuery((q) => ({ ...q, mode: e.target.value }))}>
          <option value="">Any mode</option>
          <option value="onsite">On-site</option>
          <option value="hybrid">Hybrid</option>
          <option value="remote">Remote</option>
        </select>
        <select className="input sm:w-36" value={query.type} onChange={(e) => setQuery((q) => ({ ...q, type: e.target.value }))}>
          <option value="">Any type</option>
          <option value="full-time">Full-time</option>
          <option value="internship">Internship</option>
          <option value="contract">Contract</option>
        </select>
        <button type="submit" className="btn-primary h-[42px] shrink-0">Search</button>
      </form>

      <div className="flex gap-1 rounded-xl border border-ink-200 bg-white p-1">
        {[['matched', `Matched for you${matched ? ` (${matched.length})` : ''}`], ['all', `All openings${all ? ` (${all.total})` : ''}`]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader label="Loading jobs…" />
      ) : !items?.length ? (
        <EmptyState
          icon={IconBriefcase}
          title={tab === 'matched' ? 'No matches yet' : 'No openings found'}
          message={
            tab === 'matched'
              ? 'Add skills to your profile and set your alert preferences — matching improves immediately.'
              : 'Try a broader search, or clear the filters.'
          }
          action={tab === 'matched' ? <Link to="/app/profile?tab=skills" className="btn-primary h-9 text-xs">Add skills</Link> : null}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((job) => (
            <JobCard key={job.id} job={job} applied={applications[job.id]} onOpen={() => openDetail(job.id)} />
          ))}
        </div>
      )}

      <JobDetail
        job={detail}
        application={detail?.id ? applications[detail.id] : null}
        onApplicationChange={(a) => setApplications((prev) => ({ ...prev, [a.job.id]: a }))}
        onClose={() => setDetail(null)}
        onTailor={(j) => { setDetail(null); setTailorFor(j); }}
      />

      <CreateResumeModal
        open={Boolean(tailorFor)}
        job={tailorFor}
        onClose={() => setTailorFor(null)}
      />
    </div>
  );
}

function JobCard({ job, applied, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="card group p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CompanyMark name={job.company} size={40} />
          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight text-ink-900 group-hover:text-brand-700">{job.title}</p>
            <p className="mt-0.5 text-sm text-ink-600">{job.company}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {job.match != null && (
            <Badge tone={job.match >= 70 ? 'emerald' : job.match >= 50 ? 'sky' : 'slate'}>{job.match}% match</Badge>
          )}
          {applied && <Badge tone="emerald">Applied</Badge>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1"><IconMapPin size={13} />{job.location || 'India'}</span>
        <span className="capitalize">{job.work_mode}</span>
        <span className="capitalize">{job.job_type}</span>
        {job.min_ctc && (
          <span className="font-semibold text-emerald-600">₹{job.min_ctc}{job.max_ctc ? `–${job.max_ctc}` : '+'} LPA</span>
        )}
      </div>

      {/* Core subjects first. These are what a campus student revises for the
          interview — DSA, OS, DBMS — and the model reads them out of the
          description rather than guessing from the title. The technology chips
          below are what they would pick up on the job. */}
      {job.coreSubjects?.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-eyebrow text-ink-400">Tests</span>
          {job.coreSubjects.map((k) => (
            <span
              key={k}
              className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-100"
            >
              {k}
            </span>
          ))}
          {job.yearsRequired === 0 && (
            <span className="text-[10.5px] font-semibold text-emerald-700">· open to freshers</span>
          )}
        </div>
      )}

      {job.skills?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.skills.slice(0, 6).map((s) => (
            <Badge key={s} tone="slate"><TechIcon name={s} size={12} />{s}</Badge>
          ))}
          {job.skills.length > 6 && <span className="self-center text-xs text-ink-400">+{job.skills.length - 6}</span>}
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-400">
        Posted {new Date(job.posted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </p>
    </button>
  );
}

function JobDetail({ job, application, onApplicationChange, onClose, onTailor }) {
  if (!job) return null;
  if (job.loading) {
    return (
      <Modal open onClose={onClose} title="Loading…">
        <div className="flex justify-center py-10"><Spinner size={24} /></div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={job.title}
      subtitle={`${job.company} · ${job.location || 'India'}`}
      footer={
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-400">
              Posted {new Date(job.posted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => onTailor(job)} className="btn-secondary">
              <IconDoc size={15} /> Resume for this job
            </button>
          </div>
          {/* Apply + track live together: the moment a student opens the company
              site is the moment to offer to record it. */}
          <ApplyTracker
            job={{ id: job.id, applyUrl: job.apply_url }}
            application={application}
            onChange={onApplicationChange}
          />
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone="slate" className="capitalize">{job.work_mode}</Badge>
          <Badge tone="slate" className="capitalize">{job.job_type}</Badge>
          {job.experience && <Badge tone="slate">{job.experience}</Badge>}
          {job.min_ctc && <Badge tone="emerald">₹{job.min_ctc}{job.max_ctc ? `–${job.max_ctc}` : '+'} LPA</Badge>}
          {job.match != null && (
            <Badge tone={job.match >= 70 ? 'emerald' : 'sky'}><IconTarget size={12} /> {job.match}% match</Badge>
          )}
        </div>

        {job.description && (
          <div>
            <p className="section-title mb-2">About the role</p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">{job.description}</p>
          </div>
        )}

        {job.matchedSkills?.length > 0 && (
          <div>
            <p className="section-title mb-2">Skills you already have</p>
            <div className="flex flex-wrap gap-1.5">
              {job.matchedSkills.map((s) => <Badge key={s} tone="emerald">✓ {s}</Badge>)}
            </div>
          </div>
        )}

        {job.missingSkills?.length > 0 && (
          <div>
            <p className="section-title mb-2">Skills to pick up</p>
            <div className="flex flex-wrap gap-1.5">
              {job.missingSkills.map((s) => <Badge key={s} tone="amber">{s}</Badge>)}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">
              Build one of these into a project and it lands on your resume and in your match score.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
