import { Link } from 'react-router-dom';
import { Badge } from '../ui';
import { IconAlert, IconCheck, IconExternal, IconUser } from '../ui/Icons';

/**
 * What the student has done in their own login, next to the imported record.
 *
 * The rest of the report is the spreadsheet: CRT scores, bands, the cell's own
 * analysis, all frozen at import. This panel reads the tables the student edits,
 * so it is current by construction — no copy to fall out of date. Without it an
 * officer cannot tell an engaged student from a dormant one, and would be
 * quoting numbers from months ago back at someone whose profile has moved on.
 */
export default function LivePanel({ live, recordName }) {
  if (!live) {
    return (
      <section className="card p-5">
        <h2 className="section-title">Their own profile</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          This student has not claimed their record yet, so there is nothing beyond the import.
          They claim it by signing in with their college email, or by entering their registration
          number on their dashboard.
        </p>
      </section>
    );
  }

  const c = live.counts;
  const stale = live.lastLoginAt
    ? Math.floor((Date.now() - new Date(live.lastLoginAt)) / 86400000)
    : null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Their own profile</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-400">
            Live from their login — updates the moment they edit it.
          </p>
        </div>
        {live.profilePublic && live.slug && (
          <a
            href={`/u/${live.slug}`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary h-8 text-xs"
          >
            <IconExternal size={13} /> Open public profile
          </a>
        )}
      </div>

      {/* A claimed record whose account name is unrelated to the roster name is
          usually a mistyped registration number, and it matters: the wrong
          student would be reading this person's placement analysis. */}
      {live.nameMismatch && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <IconAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-[12px] leading-relaxed text-amber-900">
            The roster has <b>{recordName}</b> but this account is <b>{live.name}</b>. Worth
            confirming the right person claimed this registration number.
          </p>
        </div>
      )}

      <div className="mt-4 flex items-start gap-4">
        {live.avatarUrl ? (
          <img
            src={live.avatarUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-ink-200"
          />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-ink-100 text-ink-400">
            <IconUser size={24} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink-900">{live.name}</p>
          <p className="text-[12.5px] text-ink-500">{live.email}</p>
          {live.headline && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-700">{live.headline}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-400">
            {live.openToWork && <Badge tone="emerald">Open to work</Badge>}
            {!live.profilePublic && <Badge tone="slate">Profile private</Badge>}
            {stale != null && (
              <span className={stale > 30 ? 'font-semibold text-amber-700' : ''}>
                {stale === 0 ? 'Signed in today' : `Last signed in ${stale} day${stale === 1 ? '' : 's'} ago`}
              </span>
            )}
          </div>
        </div>

        {live.bestAtsScore != null && (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-black text-ink-900">{live.bestAtsScore}</p>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">best ATS</p>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- counts */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          ['Skills', c.skills], ['Projects', c.projects], ['Experience', c.experience],
          ['Awards', c.achievements], ['Resumes', c.resumes], ['Applied', c.applications],
        ].map(([label, n]) => (
          <div key={label} className={`rounded-lg p-2 text-center ${n ? 'bg-ink-50' : 'bg-ink-50/50'}`}>
            <p className={`text-lg font-black ${n ? 'text-ink-900' : 'text-ink-300'}`}>{n}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
          </div>
        ))}
      </div>

      {/* --------------------------------------------------------- details */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {live.skills.length > 0 && (
          <Block title="Skills they listed">
            <div className="flex flex-wrap gap-1">
              {live.skills.slice(0, 18).map((s) => (
                <span key={s} className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">
                  {s}
                </span>
              ))}
              {live.skills.length > 18 && (
                <span className="self-center text-[11px] text-ink-400">+{live.skills.length - 18}</span>
              )}
            </div>
          </Block>
        )}

        {live.projects.length > 0 && (
          <Block title="Projects">
            <ul className="space-y-1">
              {live.projects.map((p) => (
                <li key={p.title} className="text-[12px] text-ink-700">
                  <span className="font-semibold">{p.title}</span>
                  {p.tech?.length > 0 && <span className="text-ink-400"> · {p.tech.slice(0, 4).join(', ')}</span>}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {live.experience.length > 0 && (
          <Block title="Experience">
            <ul className="space-y-1">
              {live.experience.map((e, i) => (
                <li key={i} className="text-[12px] text-ink-700">
                  <span className="font-semibold">{e.role}</span>
                  <span className="text-ink-400"> at {e.company} · {e.type}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {live.coding.filter((x) => x.status === 'ok').length > 0 && (
          <Block title="Coding profiles they linked">
            <ul className="space-y-1">
              {live.coding.filter((x) => x.status === 'ok').map((x) => (
                <li key={x.platform} className="text-[12px] text-ink-700">
                  <span className="font-semibold capitalize">{x.platform}</span>
                  <span className="text-ink-400">
                    {' '}@{x.username}
                    {x.solved != null && ` · ${x.solved} solved`}
                    {x.rating != null && ` · rating ${x.rating}`}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {live.resumes.length > 0 && (
          <Block title="Resumes they built">
            <ul className="space-y-1">
              {live.resumes.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink-700">
                    <span className="font-semibold">{r.title}</span>
                    {r.targetRole && <span className="text-ink-400"> · {r.targetRole}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-500">ATS {r.atsScore}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {live.applications.length > 0 && (
          <Block title="Where they have applied">
            <ul className="space-y-1">
              {live.applications.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink-700">
                    <span className="font-semibold">{a.company}</span>
                    <span className="text-ink-400"> · {a.title}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400">
                    {a.hasProof && <IconCheck size={11} className="inline text-emerald-600" />} {a.status}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>

      {/* An account that exists but is empty is the most actionable thing on
          this page — that student needs a nudge, not an analysis. */}
      {c.skills === 0 && c.projects === 0 && c.resumes === 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          They have claimed their record but not filled anything in yet. Nothing here will reach a
          recruiter until they add skills and at least one project.
        </p>
      )}
    </section>
  );
}

function Block({ title, children }) {
  return (
    <div>
      <p className="section-title mb-1.5">{title}</p>
      {children}
    </div>
  );
}
