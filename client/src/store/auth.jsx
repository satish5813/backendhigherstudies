import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, onAuthLost, tokenStore } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokenStore.getUser());
  const [ready, setReady] = useState(false);

  // Validate whatever is in localStorage against the server once at boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokenStore.get()) {
        // there may still be a refresh cookie from a previous visit
        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (res.ok) {
            const data = await res.json();
            tokenStore.set(data.accessToken);
            tokenStore.setUser(data.user);
            if (!cancelled) setUser(data.user);
          }
        } catch { /* offline — stay signed out */ }
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const { user: me } = await authApi.me();
        tokenStore.setUser(me);
        if (!cancelled) setUser(me);
      } catch {
        tokenStore.clear();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => onAuthLost(() => setUser(null)), []);

  const signIn = useCallback((payload) => {
    tokenStore.set(payload.accessToken);
    tokenStore.setUser(payload.user);
    setUser(payload.user);
    return payload;
  }, []);

  const signOut = useCallback(async () => {
    try { await authApi.logout(user?.id); } catch { /* best effort */ }
    tokenStore.clear();
    setUser(null);
  }, [user?.id]);

  const patchUser = useCallback((partial) => {
    setUser((prev) => {
      const next = { ...prev, ...partial };
      tokenStore.setUser(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, ready, signIn, signOut, patchUser, isAuthed: Boolean(user) }),
    [user, ready, signIn, signOut, patchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
