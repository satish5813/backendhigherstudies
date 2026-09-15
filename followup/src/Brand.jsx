export default function Brand({ className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img src="/brand/kl-seal.png" alt="" className="h-10 w-10" />
      <div className="border-l border-ink-200 pl-3 leading-tight">
        <p className="display text-[17px] text-ink-900">Placement Follow-up</p>
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-700">KL University</p>
      </div>
    </div>
  );
}
