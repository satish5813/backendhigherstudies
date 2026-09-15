import { useEffect, useState } from 'react';
import { authApi, refreshAccessToken, sessionHinted, tokenStore } from './api';
import Login from './Login';
import Dashboard from './Dashboard';

export default function App() {
  const [user, setUser] = useState(() => tokenStore.getUser());
  const [ready, setReady] = useState(false);

  // Validate whatever is stored once at boot; otherwise try the refresh cookie,
  // but only when the backend has said a session exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (tokenStore.get()) {
          const { user: me } = await authApi.me();
          tokenStore.setUser(me);
          if (!cancelled) setUser(me);
        } else if (sessionHinted()) {
          const token = await refreshAccessToken();
          if (token && !cancelled) setUser(tokenStore.getUser());
        }
      } catch {
        tokenStore.clear();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signOut = async () => {
    try { await authApi.logout(user?.id); } catch { /* best effort */ }
    tokenStore.clear();
    setUser(null);
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-500">Loading…</div>
    );
  }
  if (!user) {
    return <Login onSignedIn={(payload) => { tokenStore.set(payload.accessToken); tokenStore.setUser(payload.user); setUser(payload.user); }} />;
  }
  return <Dashboard user={user} onSignOut={signOut} />;
}
