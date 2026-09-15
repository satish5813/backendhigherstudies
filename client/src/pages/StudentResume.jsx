import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { cohortApi } from '../lib/api';
import { useAuth } from '../store/auth';
import { Badge, EmptyState, PageLoader } from '../components/ui';
import ResumePreview from '../components/resume/ResumePreview';
import { IconDoc, IconDownload } from '../components/ui/Icons';

/**
 * A student's resume, opened by the placement cell.
 *
 * The PDF is produced by the browser's print dialog, exactly as it is for the
 * student, with the same template and the same print rules — so what the
 * officer saves is what the student would have handed to a recruiter, ATS
 * score and all. The follow-up dashboard links straight here.
 */
export default function StudentResume() {
  const { code, regNo, id } = useParams();
  const { user } = useAuth();
  const [resume, setResume] = useState(null);
  const [error, setError] = useState('');
  const docRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await cohortApi.resume(id);
        if (!cancelled) setResume(r);
      } catch (err) {
        if (!cancelled) setError(err.status === 403 ? 'Admin access required.' : err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const download = () => {
    const previousTitle = document.title;
    const who = resume.data?.basics?.fullName || resume.owner?.name || 'Resume';
    document.title = `${who.replace(/\s+/g, '_')}_Resume_ATS${resume.atsScore ?? ''}`;
    window.print();
    setTimeout(() => { document.title = previousTitle; }, 800);
  };

  // Opened from the follow-up dashboard with ?print=1: raise the print dialog
  // — the browser's own PDF preview with a Save button — as soon as the
  // document has rendered, so one click on "Resume PDF" is the whole job.
  const [params] = useSearchParams();
  const autoPrint = params.get('print') === '1';
  const printedRef = useRef(false);
  useEffect(() => {
    if (!autoPrint || !resume || printedRef.current) return;
    printedRef.current = true;
    let cancelled = false;
    const ready = document.fonts?.ready ?? Promise.resolve();
    ready.then(() => setTimeout(() => { if (!cancelled) download(); }, 500));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, resume]);

  if (user?.role !== 'admin') {
    return <EmptyState icon={IconDoc} title="Admin access required" message="Only the placement cell can open another student's resume." />;
  }
  if (error) return <EmptyState icon={IconDoc} title="Could not open this resume" message={error} />;
  if (!resume) return <PageLoader label="Opening the resume…" />;

  const score = resume.atsScore;
  const tone = score == null ? 'slate' : score >= 70 ? 'emerald' : score >= 50 ? 'sky' : 'amber';

  return (
    <div className="space-y-4">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            <Link to={`/app/students/${code}/${encodeURIComponent(regNo)}`} className="hover:text-brand-700">{regNo}</Link>
            {' · '}{code.toUpperCase()}
          </p>
          <h1 className="display-sm truncate">{resume.owner?.name || resume.data?.basics?.fullName || 'Resume'}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {resume.title}{resume.targetRole ? ` · for ${resume.targetRole}` : ''} · updated{' '}
            {new Date(resume.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>ATS {score ?? '—'}</Badge>
          <button onClick={download} className="btn-primary">
            <IconDownload size={15} /> Save as PDF
          </button>
        </div>
      </header>

      <ResumePreview data={resume.data} template={resume.template} accent={resume.accent} innerRef={docRef} />
    </div>
  );
}
