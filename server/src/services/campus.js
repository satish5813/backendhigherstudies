/**
 * One spelling per campus.
 *
 * The placement spreadsheets were typed by different hands: LPA7 says VZA and
 * HYD, LPA8 says VJA and Hyd, and an older sheet may still say BZA. Left as
 * typed, a campus filter splits Vijayawada in half and lists Hyderabad twice.
 * Everything that stores or filters by campus goes through here.
 */
const CANONICAL = {
  vza: 'Vijayawada',
  vja: 'Vijayawada',
  bza: 'Vijayawada',
  vijayawada: 'Vijayawada',
  hyd: 'Hyderabad',
  hyderabad: 'Hyderabad',
};

/** "VZA" -> "Vijayawada"; an unknown value comes back unchanged (trimmed). */
export function canonicalCampus(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return null;
  return CANONICAL[key] ?? String(raw).trim();
}

/**
 * Every lower-cased spelling that means this campus, for a SQL IN (...). Lets
 * a filter work against rows imported before normalisation existed.
 */
export function campusAliases(canonical) {
  const target = canonicalCampus(canonical);
  const out = new Set([String(target).toLowerCase()]);
  for (const [alias, name] of Object.entries(CANONICAL)) if (name === target) out.add(alias);
  return [...out];
}
