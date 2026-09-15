import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ResumeDocument from './ResumeDocument';

/** A4 at 96dpi: 210mm wide, 297mm tall. */
const PAGE_W = 794;
const PAGE_H = 1123;
const GUTTER = 48; // breathing room either side of the page

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5];

/**
 * Scaled, scrollable A4 preview.
 *
 * `transform: scale()` shrinks what you see but not the element's layout box —
 * the page still claims 794px. Combined with `justify-center` that clipped the
 * left edge of the document and made it unreachable, because browsers cannot
 * scroll into the start-side overflow of a centred flex item.
 *
 * So the scaled page is wrapped in a sizer whose width and height are the
 * *scaled* dimensions. Layout then matches what is drawn, centring is done with
 * auto margins instead of flexbox, and scrolling reaches every edge.
 */
export default function ResumePreview({ data, template, accent, innerRef }) {
  const viewportRef = useRef(null);
  const pageRef = useRef(null);

  const [available, setAvailable] = useState(PAGE_W + GUTTER);
  const [pageHeight, setPageHeight] = useState(PAGE_H);
  const [zoom, setZoom] = useState('fit'); // 'fit' | number

  // Track the space the preview actually has.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track how tall the document actually renders — it grows with content.
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const measure = () => setPageHeight(Math.max(el.offsetHeight, PAGE_H));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, template, accent]);

  const fitScale = Math.min(1, Math.max(0.25, (available - GUTTER) / PAGE_W));
  const scale = zoom === 'fit' ? fitScale : zoom;

  // A tolerance stops a few stray pixels of rounding claiming a second page.
  const pageCount = Math.max(1, Math.ceil((pageHeight - 8) / PAGE_H));

  const setRefs = useCallback(
    (node) => {
      pageRef.current = node;
      if (typeof innerRef === 'function') innerRef(node);
      else if (innerRef) innerRef.current = node;
    },
    [innerRef]
  );

  // Ctrl/Cmd +/- and 0 while the preview has focus
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom((z) => step(z === 'fit' ? fitScale : z, 1)); }
      else if (e.key === '-') { e.preventDefault(); setZoom((z) => step(z === 'fit' ? fitScale : z, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitScale]);

  return (
    <div className="flex min-w-0 flex-col">
      {/* ------------------------------------------------------ zoom bar */}
      <div className="no-print mb-2 flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-medium text-ink-400">
          A4 preview · {Math.round(scale * 100)}%
        </p>

        <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
          <button
            onClick={() => setZoom((z) => step(z === 'fit' ? fitScale : z, -1))}
            className="rounded-md px-2 py-1 text-sm font-bold text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => setZoom('fit')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              zoom === 'fit' ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            Fit
          </button>
          <button
            onClick={() => setZoom(1)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              zoom === 1 ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            100%
          </button>
          <button
            onClick={() => setZoom((z) => step(z === 'fit' ? fitScale : z, 1))}
            className="rounded-md px-2 py-1 text-sm font-bold text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- viewport */}
      <div
        ref={viewportRef}
        className="resume-viewport scroll-thin max-h-[calc(100vh-9rem)] min-w-0 overflow-auto rounded-2xl bg-ink-200/60 p-6"
      >
        {/* Sizer: occupies the SCALED footprint, so nothing overflows and
            auto margins can centre it honestly. */}
        <div
          className="resume-sizer relative mx-auto"
          style={{ width: PAGE_W * scale, height: pageHeight * scale }}
        >
          <div
            className="resume-scaler"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }}
          >
            <ResumeDocument data={data} template={template} accent={accent} innerRef={setRefs} />
          </div>

          {/* Where the printer will actually cut the paper. A fresher resume
              that quietly runs onto page 2 is the single most common thing
              students get wrong, so show the boundary rather than hide it. */}
          {Array.from({ length: pageCount - 1 }, (_, i) => (
            <div
              key={i}
              className="no-print pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-rose-400/70"
              style={{ top: PAGE_H * (i + 1) * scale }}
            >
              <span className="absolute right-0 -translate-y-full rounded-t bg-rose-400/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                end of page {i + 1}
              </span>
            </div>
          ))}
        </div>
      </div>

      {pageCount > 1 && (
        <div className="no-print mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200">
          <span className="mt-px text-amber-600">!</span>
          <p className="text-[11.5px] leading-relaxed text-amber-900">
            This resume runs to <b className="font-semibold">{pageCount} pages</b>. For a fresher,
            recruiters expect one — drop the weakest project or trim bullets to a single line each.
            The dashed line marks where page 1 ends.
          </p>
        </div>
      )}

      {/* The single most damaging mistake a student can make at this point:
          Windows' "Microsoft Print to PDF" driver rasterises the page, so the
          file contains a picture of the resume and no text at all. It looks
          perfect and is invisible to every ATS. */}
      <div className="no-print mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200">
        <span className="mt-px shrink-0 font-bold text-amber-600">!</span>
        <p className="text-[11.5px] leading-relaxed text-amber-900">
          In the print dialog choose <b className="font-semibold">“Save as PDF”</b> (the browser's own
          option). Do <b className="font-semibold">not</b> pick “Microsoft Print to PDF” — that driver
          saves your resume as a picture with no text in it, which every ATS reads as a blank page.
        </p>
      </div>

      <p className="no-print mt-2 px-1 text-[11px] text-ink-400">
        This is exactly what prints — margins are already set for A4.
      </p>
    </div>
  );
}

function step(current, direction) {
  const idx = ZOOM_STEPS.findIndex((z) => z >= current - 0.001);
  const next = direction > 0 ? Math.min(idx + 1, ZOOM_STEPS.length - 1) : Math.max(idx - 1, 0);
  return ZOOM_STEPS[next];
}
