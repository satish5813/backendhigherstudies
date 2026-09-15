import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../lib/api';
import Logo from '../components/Logo';
import { Badge, EmptyState, PageLoader } from '../components/ui';
import { IconArrowRight, IconMapPin, IconSearch, IconUser } from '../components/ui/Icons';

export default function Directory() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = async (search = q, p = page) => {
    setLoading(true);
    try {
      setData(await publicApi.directory({ q: search, page: p, perPage: 24 }));
    } catch {
      setData({ items: [], total: 0, pages: 1 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load('', 1); /* eslint-disable-next-line */ }, []);

  const search = (e) => { e.preventDefault(); setPage(1); load(q, 1); };

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link to="/login" className="btn-primary h-9 text-xs">Create my profile</Link>
        </div>
      </header>

      <section className="relative overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bg-mesh opacity-80" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Student directory</h1>
          <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-white/65">
            Public profiles from KL University students, published by the students themselves.
          </p>

          <form onSubmit={search} className="mt-7 flex max-w-xl gap-2">
            <div className="relative flex-1">
              <IconSearch size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="input h-11 pl-10"
                placeholder="Name, branch or headline"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary h-11 px-6">Search</button>
          </form>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {loading ? (
          <PageLoader label="Loading profiles…" />
        ) : !data?.items?.length ? (
          <EmptyState
            icon={IconUser}
            title="No profiles found"
            message={q ? `Nothing matched “${q}”. Try a broader search.` : 'No public profiles have been published yet.'}
            action={<Link to="/login" className="btn-primary">Be the first</Link>}
          />
        ) : (
          <>
            <p className="mb-5 text-sm text-ink-500">
              {data.total} public profile{data.total === 1 ? '' : 's'}
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((s) => {
                const initials = (s.name || '?').split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
                return (
                  <Link
                    key={s.slug}
                    to={`/u/${s.slug}`}
                    className="card group p-5 transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-sm font-black text-white">
                        {s.avatarUrl ? <img src={s.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-bold text-ink-900 group-hover:text-brand-700">{s.name}</p>
                          {s.openToWork && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Open to work" />}
                        </div>
                        {s.headline && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{s.headline}</p>}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                      {s.branch && <span className="truncate">{s.branch}</span>}
                      {s.gradYear && <span>· {s.gradYear}</span>}
                      {s.location && <span className="inline-flex items-center gap-1">· <IconMapPin size={11} />{s.location}</span>}
                    </div>

                    {s.skills?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.skills.map((k) => <Badge key={k} tone="slate">{k}</Badge>)}
                      </div>
                    )}

                    <p className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-600">
                      View profile <IconArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                    </p>
                  </Link>
                );
              })}
            </div>

            {data.pages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button className="btn-secondary h-9 text-xs" disabled={page <= 1} onClick={() => { setPage(page - 1); load(q, page - 1); }}>
                  ← Previous
                </button>
                <span className="text-sm text-ink-500">Page {data.page} of {data.pages}</span>
                <button className="btn-secondary h-9 text-xs" disabled={page >= data.pages} onClick={() => { setPage(page + 1); load(q, page + 1); }}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
