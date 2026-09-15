/**
 * A company's mark on a job card.
 *
 * Deliberately NOT a real logo. The logo libraries cover startups and developer
 * tools well, but not the employers that matter for a KL placement — no
 * Databricks, Zscaler, Meesho, Swiggy, PhonePe, TCS or Infosys. Coverage came
 * out at 30% of job rows, and a board where seven cards in ten fall back to a
 * placeholder while three show artwork looks unfinished in a way that no
 * placeholder does.
 *
 * So every company gets the same treatment: its initials on a tile whose colour
 * is derived from the name. Deterministic, so a company looks identical on the
 * job board, the queue and the application list, and the eye starts using
 * colour to recognise employers after a day or two.
 */

// Deep enough to carry white text at 11px, varied enough to tell apart. KL
// crimson is deliberately absent — that colour belongs to the university, not
// to whichever employer happens to hash into it.
const PALETTE = [
  '#1e3a5f', '#2d4a3e', '#4a3b5c', '#5c3a2e', '#2f4858',
  '#3d3a5c', '#1f4a4a', '#54402a', '#42365c', '#25455c',
  '#4a3550', '#2c4a35',
];

/** FNV-1a: small, fast, and spreads short strings well. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * "Tata Consultancy Services" -> TC, "Databricks" -> Da, "PhonePe" -> PP.
 * Two letters reads better than one at small sizes and collides far less.
 */
function initials(name) {
  const clean = String(name ?? '')
    .replace(/\b(software|technologies|technology|private|pvt|limited|ltd|inc|corp|india)\b/gi, '')
    .trim();

  const words = clean.split(/[\s.\-_]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();

  const one = words[0] ?? '?';
  // An internal capital is a real word boundary: PhonePe, GitLab, MongoDB.
  const camel = one.match(/^([A-Z][a-z]*)([A-Z])/);
  if (camel) return (camel[1][0] + camel[2]).toUpperCase();
  return one.slice(0, 2).toUpperCase();
}

export default function CompanyMark({ name, size = 36, className = '', rounded = 'rounded-xl' }) {
  const label = String(name ?? '').trim() || 'Unknown';
  const bg = PALETTE[hash(label.toLowerCase()) % PALETTE.length];

  return (
    <span
      className={`grid shrink-0 place-items-center font-display font-bold leading-none text-white ${rounded} ${className}`}
      style={{ width: size, height: size, background: bg, fontSize: Math.max(10, size * 0.36) }}
      aria-hidden="true"
      title={label}
    >
      {initials(label)}
    </span>
  );
}
