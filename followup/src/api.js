/**
 * The smallest client the backend needs: bearer access token, one transparent
 * refresh on expiry, and the handful of endpoints this app uses. Same-origin
 * by construction (vercel.json / nginx / the Vite proxy forward /api), so the
 * refresh cookie the backend sets works unchanged.
 */

const ACCESS_KEY = 'fu.access';
const USER_KEY = 'fu.user';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(ACCESS_KEY); } catch { return null; } },
  set: (t) => { try { t ? localStorage.setItem(ACCESS_KEY, t) : localStorage.removeItem(ACCESS_KEY); } catch { /* private mode */ } },
  getUser: () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  setUser: (u) => { try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || `Request failed (${status})`);
    this.status = status;
    this.code = payload?.error;
    this.payload = payload || {};
  }
}

/** True when the backend has told this browser a session exists. */
export const sessionHinted = () => document.cookie.split('; ').some((c) => c.startsWith('cf_session='));

let refreshInFlight = null;
export async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!res.ok) return null;
      const data = await res.json();
      tokenStore.set(data.accessToken);
      if (data.user) tokenStore.setUser(data.user);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

async function request(method, path, body, { skipRefresh = false } = {}) {
  const send = (token) =>
    fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send(tokenStore.get());
  if (res.status === 401 && !skipRefresh) {
    const payload = await res.clone().json().catch(() => ({}));
    if (payload.error === 'token_expired' || payload.error === 'unauthorized') {
      const fresh = await refreshAccessToken();
      if (fresh) res = await send(fresh);
    }
  }
  const text = await res.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const authApi = {
  checkEmail: (email) => request('POST', '/auth/check-email', { email }, { skipRefresh: true }),
  requestOtp: (email) => request('POST', '/auth/request-otp', { email }, { skipRefresh: true }),
  verifyOtp: (email, code) => request('POST', '/auth/verify-otp', { email, code }, { skipRefresh: true }),
  me: () => request('GET', '/auth/me'),
  logout: (userId) => request('POST', '/auth/logout', { userId }),
};

export const followupApi = {
  list: (campus = 'Vijayawada') => request('GET', `/cohorts/followup?campus=${encodeURIComponent(campus)}`),
};
