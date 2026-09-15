/**
 * The printable resume.
 *
 * Section rendering is shared; templates differ only in a style token set and
 * one of three layout shells (single / banner / sidebar). Markup stays as plain
 * as the design allows — no tables, no text boxes, no absolutely positioned
 * content — because those are what actually break an ATS parse.
 *
 * The sidebar layout is the one real compromise. It is two columns visually,
 * but the DOM order is header -> summary -> experience -> projects -> education
 * -> skills, so a parser reading source order still gets a sensible document.
 * It still costs points in the ATS score, which is the honest trade.
 */

const SANS = "Calibri, Carlito, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Cambria, Georgia, 'Times New Roman', serif";

const BASE = {
  layout: 'single',
  font: SANS,
  accent: '#111827',
  rule: '#9ca3af',
  nameSize: '20pt',
  gap: '13pt',
  headerAlign: 'left',
  headingStyle: 'rule', // rule | plain | caps
  showRuleUnderName: true,
  dense: false,
};

const TEMPLATE_STYLES = {
  'ats-classic': { ...BASE },

  'ats-compact': { ...BASE, rule: '#d1d5db', nameSize: '17pt', gap: '9pt', dense: true },

  'ats-minimal': {
    ...BASE,
    rule: 'transparent',
    nameSize: '19pt',
    gap: '15pt',
    headingStyle: 'caps',
    showRuleUnderName: false,
    accent: '#111827',
  },

  'ats-modern': { ...BASE, accent: '#4f46e5', rule: '#c7d2fe', nameSize: '22pt', gap: '14pt' },

  'ats-technical': {
    ...BASE,
    accent: '#0369a1',
    rule: '#bae6fd',
    gap: '12pt',
    order: ['summary', 'skills', 'projects', 'experience', 'education', 'achievements', 'coding'],
  },

  'ats-academic': {
    ...BASE,
    accent: '#0f766e',
    rule: '#99f6e4',
    headerAlign: 'center',
    order: ['summary', 'education', 'achievements', 'experience', 'projects', 'skills', 'coding'],
  },

  'ats-elegant': {
    ...BASE,
    font: SERIF,
    accent: '#1f2937',
    rule: '#d1d5db',
    nameSize: '23pt',
    gap: '14pt',
    headerAlign: 'center',
    headingStyle: 'caps',
  },

  'ats-timeline': {
    ...BASE,
    layout: 'timeline',
    accent: '#0f766e',
    rule: '#99f6e4',
    gap: '13pt',
  },

  'ats-executive': {
    ...BASE,
    accent: '#1e3a8a',
    rule: '#1e3a8a',
    nameSize: '23pt',
    gap: '14pt',
  },

  'ats-banner': {
    ...BASE,
    layout: 'banner',
    accent: '#4338ca',
    rule: '#c7d2fe',
    nameSize: '24pt',
    gap: '13pt',
    showRuleUnderName: false,
  },

  'ats-sidebar': {
    ...BASE,
    layout: 'sidebar',
    accent: '#0f766e',
    rule: '#99f6e4',
    nameSize: '21pt',
    gap: '12pt',
    asideSections: ['education', 'skills', 'coding'],
    mainSections: ['summary', 'experience', 'projects', 'achievements'],
  },

  'ats-crimson': {
    ...BASE,
    accent: '#b91c1c',
    rule: '#fecaca',
    nameSize: '21pt',
    gap: '11pt',
  },

  'ats-slate': {
    ...BASE,
    layout: 'sidebar',
    accent: '#334155',
    rule: '#94a3b8',
    nameSize: '21pt',
    gap: '12pt',
    asideSections: ['skills', 'education', 'coding'],
    mainSections: ['summary', 'experience', 'projects', 'achievements'],
  },

  'ats-azure': {
    ...BASE,
    layout: 'banner',
    accent: '#1d4ed8',
    rule: '#bfdbfe',
    nameSize: '23pt',
    gap: '11pt',
    dense: true,
    showRuleUnderName: false,
  },

  'ats-amber': {
    ...BASE,
    layout: 'timeline',
    accent: '#92400e',
    rule: '#fed7aa',
    gap: '13pt',
  },

  'ats-plum': {
    ...BASE,
    font: SERIF,
    accent: '#6d28d9',
    rule: '#ddd6fe',
    nameSize: '23pt',
    gap: '14pt',
    headerAlign: 'center',
  },

  /* ----------------------------------------------------- design-first */
  'modern-portrait': {
    ...BASE,
    layout: 'photo-header',
    accent: '#4338ca',
    rule: '#c7d2fe',
    nameSize: '25pt',
    gap: '12pt',
    showRuleUnderName: false,
    photoShape: 'rounded',
  },

  'modern-profile': {
    ...BASE,
    layout: 'photo-header',
    accent: '#0f766e',
    rule: '#99f6e4',
    nameSize: '23pt',
    gap: '12pt',
    showRuleUnderName: false,
    headerAlign: 'center',
    photoShape: 'circle',
  },

  'modern-coral': {
    ...BASE,
    layout: 'photo-header',
    accent: '#be123c',
    rule: '#fecdd3',
    nameSize: '25pt',
    gap: '12pt',
    showRuleUnderName: false,
    photoShape: 'rounded',
  },

  'modern-aside': {
    ...BASE,
    layout: 'photo-sidebar',
    accent: '#1e3a8a',
    rule: 'rgba(255,255,255,.28)',
    nameSize: '21pt',
    gap: '11pt',
    photoShape: 'circle',
    asideSections: ['skills', 'education', 'coding'],
    mainSections: ['summary', 'experience', 'projects', 'achievements'],
  },

  'modern-slate-aside': {
    ...BASE,
    layout: 'photo-sidebar',
    accent: '#334155',
    rule: 'rgba(255,255,255,.28)',
    nameSize: '21pt',
    gap: '11pt',
    photoShape: 'rounded',
    asideSections: ['skills', 'education', 'coding'],
    mainSections: ['summary', 'experience', 'projects', 'achievements'],
  },
};

const DEFAULT_ORDER = ['summary', 'education', 'skills', 'experience', 'projects', 'achievements', 'coding'];

// Layouts whose coloured block runs to the paper edge. Each supplies its own
// inner padding, so the page must not add any.
const FULL_BLEED = new Set(['banner', 'photo-header', 'photo-sidebar']);

export default function ResumeDocument({ data = {}, template = 'ats-classic', accent, innerRef }) {
  const base = TEMPLATE_STYLES[template] ?? TEMPLATE_STYLES['ats-classic'];
  // A per-resume accent recolours any template. Only a 6-digit hex is accepted
  // (validated server-side too) so nothing arbitrary reaches an inline style.
  const style = /^#[0-9a-fA-F]{6}$/.test(String(accent || ''))
    ? { ...base, accent, rule: base.rule === 'transparent' ? 'transparent' : `${accent}44` }
    : base;
  const basics = data.basics || {};
  const sections = buildSections(data, style);

  const page = (children) => (
    <div
      ref={innerRef}
      className="resume-page shadow-lift"
      style={{
        fontFamily: style.font,
        // Full-bleed layouts paint a colour block that has to reach the paper
        // edge, and they re-add their own inner padding. Leaving the page
        // padding on inset the colour AND made the document taller than A4 —
        // 14mm + 297mm + 14mm — so a one-page resume printed as two.
        padding: FULL_BLEED.has(style.layout) ? 0 : style.dense ? '12mm 14mm' : undefined,
      }}
    >
      {children}
      {isEmpty(data) && (
        <p style={{ marginTop: '30pt', textAlign: 'center', color: '#9ca3af' }}>
          Your resume is empty. Fill in your profile, then hit "Pull from profile".
        </p>
      )}
    </div>
  );

  /* ------------------------------------------------------------- banner */
  if (style.layout === 'banner') {
    return page(
      <>
        <header style={{ background: style.accent, color: '#fff', padding: '12mm 15mm 9mm' }}>
          <h1 style={{ fontSize: style.nameSize, margin: 0, color: '#fff' }}>
            {basics.fullName || 'Your Name'}
          </h1>
          {basics.headline && (
            <p style={{ margin: '2pt 0 0', fontSize: '10.5pt', color: 'rgba(255,255,255,.85)' }}>
              {basics.headline}
            </p>
          )}
          <ContactLines basics={basics} colour="rgba(255,255,255,.9)" />
        </header>
        <div style={{ padding: '6mm 15mm 14mm' }}>
          {(style.order ?? data.meta?.sectionOrder ?? DEFAULT_ORDER).map((k) => sections[k]?.()).filter(Boolean)}
        </div>
      </>
    );
  }

  /* -------------------------------------------------------- photo header */
  if (style.layout === 'photo-header') {
    const centred = style.headerAlign === 'center';
    return page(
      <>
        <header
          style={{
            background: style.accent,
            color: '#fff',
            padding: centred ? '10mm 15mm 8mm' : '9mm 15mm',
            display: 'flex',
            alignItems: 'center',
            gap: '7mm',
            flexDirection: centred ? 'column' : 'row',
            textAlign: centred ? 'center' : 'left',
          }}
        >
          <Portrait basics={basics} style={style} size={centred ? 92 : 104} />
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: style.nameSize, margin: 0, color: '#fff', letterSpacing: '-0.5pt' }}>
              {basics.fullName || 'Your Name'}
            </h1>
            {basics.headline && (
              <p style={{ margin: '2pt 0 0', fontSize: '11pt', color: 'rgba(255,255,255,.88)' }}>
                {basics.headline}
              </p>
            )}
            <ContactLines basics={basics} colour="rgba(255,255,255,.92)" />
          </div>
        </header>
        <div style={{ padding: '6mm 15mm 14mm' }}>
          {(style.order ?? data.meta?.sectionOrder ?? DEFAULT_ORDER).map((k) => sections[k]?.()).filter(Boolean)}
        </div>
      </>
    );
  }

  /* ------------------------------------------------------- photo sidebar */
  if (style.layout === 'photo-sidebar') {
    // Headings inside the coloured rail must be light, or they render in the
    // accent colour on top of the accent colour and vanish.
    const asideStyle = { ...style, accent: '#ffffff', rule: 'rgba(255,255,255,.35)' };
    const aside = style.asideSections
      .map((k) => buildSections(data, asideStyle)[k]?.())
      .filter(Boolean);
    const main = style.mainSections.map((k) => sections[k]?.()).filter(Boolean);

    return page(
      <div style={{ display: 'flex', minHeight: '297mm' }}>
        {/* Main column is FIRST in the DOM and second visually. `order` moves
            the rail to the left for a reader without moving it ahead of the
            experience for a parser. */}
        <div style={{ order: 2, flex: 1, padding: '10mm 9mm 10mm 8mm' }}>{main}</div>

        <aside
          style={{
            order: 1,
            width: '58mm',
            flexShrink: 0,
            background: style.accent,
            color: '#fff',
            padding: '10mm 6mm',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '6mm' }}>
            <Portrait basics={basics} style={style} size={104} centred />
            <h1 style={{ fontSize: style.nameSize, margin: '4mm 0 0', color: '#fff', lineHeight: 1.15 }}>
              {basics.fullName || 'Your Name'}
            </h1>
            {basics.headline && (
              <p style={{ margin: '2pt 0 0', fontSize: '9pt', color: 'rgba(255,255,255,.85)' }}>
                {basics.headline}
              </p>
            )}
          </div>

          <div style={{ fontSize: '9pt', lineHeight: 1.55, color: 'rgba(255,255,255,.92)' }}>
            {[basics.phone, basics.email, basics.location]
              .filter(Boolean)
              .map((v) => <p key={v} style={{ margin: '0 0 2pt', wordBreak: 'break-word' }}>{v}</p>)}
            {[basics.linkedin, basics.github, basics.portfolio]
              .filter(Boolean)
              .map((v) => (
                <p key={v} style={{ margin: '0 0 2pt', wordBreak: 'break-word', fontSize: '8.5pt' }}>
                  {stripProtocol(v)}
                </p>
              ))}
          </div>

          <div style={{ marginTop: '6mm' }}>{aside}</div>
        </aside>
      </div>
    );
  }

  /* ------------------------------------------------------------ timeline */
  if (style.layout === 'timeline') {
    return page(
      <>
        <Header basics={basics} style={style} />
        {(style.order ?? data.meta?.sectionOrder ?? DEFAULT_ORDER)
          .map((k) => sections[k]?.())
          .filter(Boolean)}
      </>
    );
  }

  /* ------------------------------------------------------------ sidebar */
  if (style.layout === 'sidebar') {
    const aside = style.asideSections.map((k) => sections[k]?.()).filter(Boolean);
    const main = style.mainSections.map((k) => sections[k]?.()).filter(Boolean);

    return page(
      <>
        <Header basics={basics} style={style} />
        {/* DOM order is main-then-aside; grid placement puts the aside on the
            left visually without reordering the source a parser reads. */}
        <div style={{ display: 'grid', gridTemplateColumns: '33% 1fr', columnGap: '7mm', marginTop: '2pt' }}>
          <div style={{ gridColumn: 2, gridRow: 1 }}>{main}</div>
          <div
            style={{
              gridColumn: 1,
              gridRow: 1,
              borderRight: `0.8pt solid ${style.rule}`,
              paddingRight: '5mm',
            }}
          >
            {aside}
          </div>
        </div>
      </>
    );
  }

  /* ------------------------------------------------------------- single */
  return page(
    <>
      <Header basics={basics} style={style} />
      {(style.order ?? data.meta?.sectionOrder ?? DEFAULT_ORDER).map((k) => sections[k]?.()).filter(Boolean)}
    </>
  );
}

/* ----------------------------------------------------------------- photo */

/**
 * The profile photo on a design-first template.
 *
 * Falls back to initials rather than a broken-image icon: a student who picked
 * a photo template but has not uploaded one should still get a usable document,
 * not an obviously broken one.
 */
function Portrait({ basics, style, size = 100, centred = false }) {
  const radius = style.photoShape === 'circle' ? '50%' : '4mm';
  const initials = String(basics.fullName || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const frame = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    overflow: 'hidden',
    border: '2pt solid rgba(255,255,255,.65)',
    margin: centred ? '0 auto' : undefined,
    background: 'rgba(255,255,255,.18)',
  };

  if (basics.photo) {
    return (
      <div style={frame}>
        <img
          src={basics.photo}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...frame,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size / 2.6,
        fontWeight: 700,
        color: 'rgba(255,255,255,.9)',
      }}
    >
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function Header({ basics, style }) {
  return (
    <header
      style={{
        textAlign: style.headerAlign,
        paddingBottom: '6pt',
        borderBottom: style.showRuleUnderName ? `1.2pt solid ${style.rule}` : 'none',
      }}
    >
      <h1
        style={{
          fontSize: style.nameSize,
          color: style.accent,
          margin: 0,
          letterSpacing: style.headingStyle === 'caps' ? '1pt' : '-0.4pt',
        }}
      >
        {basics.fullName || 'Your Name'}
      </h1>
      {basics.headline && (
        <p style={{ margin: '1.5pt 0 0', fontSize: '10.5pt', color: '#374151' }}>{basics.headline}</p>
      )}
      <ContactLines basics={basics} />
    </header>
  );
}

function ContactLines({ basics, colour = '#111827' }) {
  const contact = [basics.phone, basics.email, basics.location].filter(Boolean).join('  |  ');
  const links = [basics.linkedin, basics.github, basics.portfolio, basics.leetcode]
    .filter(Boolean)
    .map(stripProtocol)
    .join('  |  ');

  return (
    <>
      {contact && <p style={{ margin: '3.5pt 0 0', fontSize: '10pt', color: colour }}>{contact}</p>}
      {links && (
        <p style={{ margin: '1.5pt 0 0', fontSize: '9.5pt', color: colour === '#111827' ? '#374151' : colour }}>
          {links}
        </p>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- sections */

function buildSections(data, style) {
  const S = (key, title, children) => (
    <Section key={key} title={title} style={style}>{children}</Section>
  );

  return {
    summary: () =>
      data.summary?.trim()
        ? S('summary', 'Professional Summary', <p style={{ margin: 0, textAlign: 'justify' }}>{data.summary}</p>)
        : null,

    education: () =>
      data.education?.length
        ? S('education', 'Education',
            data.education.map((e, i) => (
              <div key={i} style={{ marginBottom: style.dense ? '4pt' : '7pt' }}>
                <Row left={<b>{e.institution}</b>} right={[e.startYear, e.endYear].filter(Boolean).join(' - ')} stack={style.layout === 'sidebar'} />
                <Row
                  left={<span>{e.degree}</span>}
                  right={e.score != null ? `${e.score}${e.scoreType === 'cgpa' ? ' CGPA' : '%'}` : e.location}
                  stack={style.layout === 'sidebar'}
                />
              </div>
            )))
        : null,

    skills: () =>
      data.skills?.length
        ? S('skills', 'Technical Skills',
            Object.entries(groupSkills(data.skills)).map(([category, list]) => (
              <p key={category} style={{ margin: '0 0 2.5pt' }}>
                <b>{CATEGORY_LABELS[category] ?? titleCase(category)}: </b>
                {list.join(', ')}
              </p>
            )))
        : null,

    experience: () =>
      data.experience?.length
        ? S('experience', 'Experience',
            data.experience.map((x, i) => (
              <Entry key={i} style={style} period={x.period}>
                <Row left={<b>{x.role}</b>} right={style.layout === 'timeline' ? null : x.period} />
                <Row
                  left={<span style={{ fontStyle: 'italic' }}>
                    {x.company}{x.type && x.type !== 'full-time' ? ` (${titleCase(x.type)})` : ''}
                  </span>}
                  right={x.location}
                />
                {x.description && <p style={{ margin: '2pt 0 0' }}>{x.description}</p>}
                {x.highlights?.length > 0 && <ul>{x.highlights.map((h, j) => <li key={j}>{h}</li>)}</ul>}
              </Entry>
            )))
        : null,

    projects: () =>
      data.projects?.length
        ? S('projects', 'Projects',
            data.projects.map((p, i) => (
              <Entry key={i} style={style} period={p.period}>
                <Row
                  left={<span><b>{p.title}</b>{p.tech?.length > 0 && <span> — {p.tech.join(', ')}</span>}</span>}
                  right={style.layout === 'timeline' ? null : p.period}
                />
                {p.description && <p style={{ margin: '2pt 0 0' }}>{p.description}</p>}
                {p.highlights?.length > 0 && <ul>{p.highlights.map((h, j) => <li key={j}>{h}</li>)}</ul>}
                {(p.repoUrl || p.liveUrl) && (
                  <p style={{ margin: '1.5pt 0 0', fontSize: '9.5pt' }}>
                    {[p.repoUrl, p.liveUrl].filter(Boolean).map(stripProtocol).join('  |  ')}
                  </p>
                )}
              </Entry>
            )))
        : null,

    achievements: () =>
      data.achievements?.length
        ? S('achievements', 'Achievements & Certifications',
            <ul style={{ marginTop: 0 }}>
              {data.achievements.map((a, i) => (
                <li key={i}>
                  <b>{a.title}</b>
                  {a.issuer ? ` — ${a.issuer}` : ''}
                  {a.dateLabel ? ` (${a.dateLabel})` : ''}
                  {a.description ? `. ${a.description}` : ''}
                </li>
              ))}
            </ul>)
        : null,

    coding: () =>
      data.coding?.length
        ? S('coding', 'Coding Profiles',
            <ul style={{ marginTop: 0 }}>
              {data.coding.map((c, i) => (
                <li key={i}>
                  <b>{titleCase(c.platform)}</b>
                  {c.username ? ` (${c.username})` : ''}
                  {c.solved != null ? ` — ${c.solved} problems solved` : ''}
                  {c.rating ? `, contest rating ${c.rating}` : ''}
                  {c.rank ? `, global rank ${Number(c.rank).toLocaleString()}` : ''}
                </li>
              ))}
            </ul>)
        : null,
  };
}

function Section({ title, style, children }) {
  const caps = style.headingStyle === 'caps';
  return (
    <section style={{ marginTop: style.gap }}>
      <h2
        style={{
          color: style.accent,
          borderBottom: style.headingStyle === 'rule' ? `0.8pt solid ${style.rule}` : 'none',
          marginTop: 0,
          letterSpacing: caps ? '1.4pt' : '0.6pt',
          fontSize: caps ? '9.5pt' : '11pt',
          paddingBottom: style.headingStyle === 'rule' ? '2pt' : 0,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One dated item. In the timeline template the date moves to a left gutter
 * with a rule beside it; everywhere else it is a plain block and the date
 * rides on the title row instead.
 *
 * The gutter keeps the date FIRST in DOM order, so a parser flattening the
 * entry reads "May 2025 - Jul 2025  Backend Intern  Nexpay ...", which is the
 * order a human would write it in anyway.
 */
function Entry({ style, period, children }) {
  const spacing = style.dense ? '6pt' : '9pt';

  if (style.layout !== 'timeline') {
    return <div style={{ marginBottom: spacing }}>{children}</div>;
  }

  return (
    <div style={{ display: 'flex', gap: '5mm', marginBottom: spacing }}>
      <div style={{ width: '26mm', flexShrink: 0, fontSize: '9.5pt', color: '#4b5563', paddingTop: '1pt' }}>
        {period || ''}
      </div>
      <div style={{ flex: 1, borderLeft: `1pt solid ${style.rule}`, paddingLeft: '4mm' }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Two-column line that still reads correctly when a parser flattens it.
 * `stack` drops to one line per value in the narrow sidebar column.
 */
function Row({ left, right, stack = false }) {
  if (stack) {
    return (
      <div>
        <div>{left}</div>
        {right ? <div style={{ fontSize: '9.5pt', color: '#374151' }}>{right}</div> : null}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10pt' }}>
      <span style={{ flex: 1 }}>{left}</span>
      {right ? <span style={{ whiteSpace: 'nowrap', fontSize: '10pt', color: '#374151' }}>{right}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

const CATEGORY_LABELS = {
  language: 'Languages',
  framework: 'Frameworks & Libraries',
  database: 'Databases',
  tool: 'Tools',
  cloud: 'Cloud & DevOps',
  concept: 'Core Concepts',
  soft: 'Soft Skills',
  other: 'Other',
};

const CATEGORY_ORDER = ['language', 'framework', 'database', 'cloud', 'tool', 'concept', 'soft', 'other'];

function groupSkills(skills) {
  const grouped = {};
  for (const s of skills) {
    const key = s.category || 'other';
    (grouped[key] ||= []).push(s.name);
  }
  return Object.fromEntries(CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((c) => [c, grouped[c]]));
}

const titleCase = (s) => String(s || '').replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
const stripProtocol = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function isEmpty(data) {
  return !data.summary && !['education', 'skills', 'experience', 'projects', 'achievements'].some((k) => data[k]?.length);
}

export { TEMPLATE_STYLES };
