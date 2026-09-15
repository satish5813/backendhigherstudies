import { Link } from 'react-router-dom';

export default function Logo({ to = '/', compact = false, invert = false }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 outline-none">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-500 shadow-sm">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 19V8.5L12 4l7 4.5V19" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.5 19v-5h5v5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className={`text-[17px] font-extrabold tracking-tight ${invert ? 'text-white' : 'text-ink-900'}`}>
          Career<span className="text-brand-600">Forge</span>
        </span>
      )}
    </Link>
  );
}
