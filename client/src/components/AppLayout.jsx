import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import Logo from './Logo';
import {
  IconBell, IconBriefcase, IconChart, IconClock, IconDoc, IconEye,
  IconCheck, IconLayers, IconLogout, IconMenu, IconSettings, IconUser, IconX,
} from './ui/Icons';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: IconChart, end: true },
  { to: '/app/profile', label: 'My profile', icon: IconUser },
  { to: '/app/resumes', label: 'Resumes', icon: IconDoc },
  { to: '/app/jobs', label: 'Jobs', icon: IconBriefcase },
  { to: '/app/alerts', label: 'Job alerts', icon: IconBell },
  { to: '/app/activity', label: 'Activity log', icon: IconClock },
  { to: '/app/admin', label: 'Placement cell', icon: IconChart, adminOnly: true, end: true },
  { to: '/app/admin/jobs', label: 'Job queue', icon: IconBriefcase, adminOnly: true },
  { to: '/app/admin/applications', label: 'Applications', icon: IconCheck, adminOnly: true },
  { to: '/app/students', label: 'All students', icon: IconLayers, adminOnly: true },
  { to: '/app/settings', label: 'Settings', icon: IconSettings },
];

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo to="/app" />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.filter((item) => !item.adminOnly || user?.role === 'admin')
          .map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-white' : 'text-ink-400 group-hover:text-ink-600'} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-ink-100 p-3">
        {user?.slug && (
          <a
            href={`/u/${user.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <IconEye size={17} className="text-ink-400" />
            View public profile
          </a>
        )}
        <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-xs font-bold text-white">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">{user?.name || 'Complete your profile'}</p>
            <p className="truncate text-xs text-ink-500">{user?.email}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-white hover:text-rose-600"
            title="Sign out"
            aria-label="Sign out"
          >
            <IconLogout size={17} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-full bg-ink-50">
      {/* desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-200 bg-white lg:block">
        {sidebar}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 animate-fade-in bg-white shadow-lift">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-2 text-ink-400 hover:bg-ink-100"
              aria-label="Close menu"
            >
              <IconX size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur-md lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-600 hover:bg-ink-100" aria-label="Open menu">
            <IconMenu size={20} />
          </button>
          <Logo compact />
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
