import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { PageLoader } from './components/ui';
import AppLayout from './components/AppLayout';

/**
 * After a deploy the hashed chunk names change, so a tab left open asks for a
 * file that no longer exists and the import rejects. The fix is simply to fetch
 * the new index.html — reload once, guarded by a sessionStorage flag so a
 * genuinely broken build cannot put us in a reload loop.
 */
const RELOAD_FLAG = 'cf.chunk-reloaded';

function lazyWithReload(factory) {
  return lazy(() =>
    factory()
      .then((mod) => {
        try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* private mode */ }
        return mod;
      })
      .catch((err) => {
        let alreadyTried = false;
        try { alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* ignore */ }

        if (!alreadyTried) {
          try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* ignore */ }
          window.location.reload();
          // Keep the promise pending so React does not flash an error first.
          return new Promise(() => {});
        }
        throw err;
      })
  );
}

const lazyPage = lazyWithReload;

const Landing = lazyPage(() => import('./pages/Landing'));
const Login = lazyPage(() => import('./pages/Login'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const ProfileEditor = lazyPage(() => import('./pages/ProfileEditor'));
const ResumeList = lazyPage(() => import('./pages/ResumeList'));
const ResumeBuilder = lazyPage(() => import('./pages/ResumeBuilder'));
const Jobs = lazyPage(() => import('./pages/Jobs'));
const Alerts = lazyPage(() => import('./pages/Alerts'));
const Activity = lazyPage(() => import('./pages/Activity'));
const Settings = lazyPage(() => import('./pages/Settings'));
const AdminDashboard = lazyPage(() => import('./pages/AdminDashboard'));
const JobQueue = lazyPage(() => import('./pages/JobQueue'));
const Applications = lazyPage(() => import('./pages/Applications'));
const Cohorts = lazyPage(() => import('./pages/Cohorts'));
const StudentReport = lazyPage(() => import('./pages/StudentReport'));
const PublicProfile = lazyPage(() => import('./pages/PublicProfile'));
const Directory = lazyPage(() => import('./pages/Directory'));
const NotFound = lazyPage(() => import('./pages/NotFound'));

function RequireAuth({ children }) {
  const { isAuthed, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader label="Checking your session…" />;
  if (!isAuthed) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { isAuthed, ready } = useAuth();
  if (!ready) return <PageLoader />;
  if (isAuthed) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
        <Route path="/students" element={<Directory />} />
        <Route path="/u/:slug" element={<PublicProfile />} />

        <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<ProfileEditor />} />
          <Route path="resumes" element={<ResumeList />} />
          <Route path="resumes/:id" element={<ResumeBuilder />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="admin/jobs" element={<JobQueue />} />
          <Route path="admin/applications" element={<Applications />} />
          <Route path="students" element={<Cohorts />} />
          <Route path="students/:code/:regNo" element={<StudentReport />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
