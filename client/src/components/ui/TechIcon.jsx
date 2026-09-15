import { useEffect, useState } from 'react';

/**
 * A technology's own logo, next to the skill name.
 *
 * Icons are self-hosted in public/icons (fetched once by
 * `server/src/db/fetch-skill-icons.js`), so a chip row costs no cross-origin
 * requests and cannot go blank if the source is down. The manifest is loaded
 * once and shared, which means a component can ask "is there an icon for this?"
 * synchronously instead of rendering a broken image and hoping.
 *
 * Not every skill has one — "System Design" and "Problem Solving" never will —
 * so the absence has to look deliberate rather than like a failed load. Callers
 * get `null` and simply render the label alone.
 */

let manifest = null;
let inflight = null;
const listeners = new Set();

function loadManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (inflight) return inflight;

  inflight = fetch('/icons/index.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])          // no icons deployed is a fine state, not an error
    .then((list) => {
      manifest = new Set(list);
      listeners.forEach((fn) => fn());
      listeners.clear();
      return manifest;
    });

  return inflight;
}

/**
 * Skill name -> icon slug.
 *
 * Students write the same technology a dozen ways ("Node", "NodeJS",
 * "Node.js"), and the resume vocabulary uses its own spellings, so this
 * normalises hard and then maps the aliases that normalising cannot fix.
 */
const ALIAS = {
  nodejs: 'nodejs', node: 'nodejs',
  reactjs: 'react', reactnative: 'react',
  nextjs: 'nextjs', next: 'nextjs',
  vuejs: 'vue', vue: 'vue',
  postgres: 'postgresql', postgresql: 'postgresql',
  mongo: 'mongodb', mongodb: 'mongodb',
  amazonwebservices: 'aws', aws: 'aws',
  googlecloud: 'gcp', gcp: 'gcp', googlecloudplatform: 'gcp',
  microsoftazure: 'azure', azure: 'azure',
  springboot: 'spring', spring: 'spring',
  tailwind: 'tailwindcss', tailwindcss: 'tailwindcss',
  cplusplus: 'cpp', cpp: 'cpp', c: 'c',
  csharp: 'csharp',
  html: 'html5', html5: 'html5',
  golang: 'go', go: 'go',
  restapi: null, systemdesign: null, datastructures: null, algorithms: null,
  oop: null, unittesting: null, problemsolving: null, agile: null,
};

export function iconSlug(name) {
  const k = String(name ?? '').toLowerCase().replace(/[^a-z0-9+#]/g, '');
  if (k in ALIAS) return ALIAS[k];
  return k || null;
}

/** True when an icon exists for this skill. Safe before the manifest loads. */
export function hasTechIcon(name) {
  const slug = iconSlug(name);
  return Boolean(slug && manifest?.has(slug));
}

export default function TechIcon({ name, size = 14, className = '' }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (manifest) return;
    let live = true;
    const bump = () => live && force((n) => n + 1);
    listeners.add(bump);
    loadManifest();
    return () => { listeners.delete(bump); live = false; };
  }, []);

  const slug = iconSlug(name);
  if (!slug || !manifest?.has(slug)) return null;

  return (
    <img
      src={`/icons/${slug}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
