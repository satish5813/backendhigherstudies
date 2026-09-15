import { Link } from 'react-router-dom';
import Logo from '../components/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <p className="font-mono text-7xl font-black tracking-tight text-ink-200">404</p>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-ink-900">Page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-500">
            The page you're after doesn't exist, or it moved.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/" className="btn-primary h-11 px-6">Back to home</Link>
            <Link to="/app" className="btn-secondary h-11 px-6">Go to dashboard</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
