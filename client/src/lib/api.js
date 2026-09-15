/**
 * Thin fetch wrapper with one job beyond transport: when the access token
 * expires mid-session it refreshes once, transparently, and replays the call.
 * Concurrent 401s share a single refresh promise so we never stampede.
 */

const ACCESS_KEY = 'cf.access';
const USER_KEY = 'cf.user';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(ACCESS_KEY); } catch { return null; }
  },
  set: (token) => {
    try { token ? localStorage.setItem(ACCESS_KEY, token) : localStorage.removeItem(ACCESS_KEY); } catch { /* private mode */ }
  },
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  setUser: (user) => {
    try { user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  },
  clear: () => {
    try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || `Request failed (${status})`);
    this.status = status;
    this.code = payload?.error;
    this.issues = payload?.issues || [];
    this.payload = payload || {};
  }
}

let refreshInFlight = null;
const listeners = new Set();

/** Notified when the session dies so the app can bounce to /login. */
export const onAuthLost = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const authLost = () => {
  tokenStore.clear();
  listeners.forEach((fn) => fn());
};

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return null;
      const data = await res.json();
      tokenStore.set(data.accessToken);
      if (data.user) tokenStore.setUser(data.user);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      // let the next 401 start a fresh attempt
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();

  return refreshInFlight;
}

async function request(method, path, body, options = {}) {
  const send = async (token) => {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  };

  let res = await send(tokenStore.get());

  if (res.status === 401 && !options.skipRefresh) {
    const payload = await res.clone().json().catch(() => ({}));
    // A bad OTP is a 401 too — only a dead *session* should trigger a refresh.
    if (payload.error === 'token_expired' || payload.error === 'unauthorized') {
      const fresh = await refreshAccessToken();
      if (fresh) res = await send(fresh);
      else if (!path.startsWith('/auth/')) authLost();
    }
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

/**
 * Fetch a binary response and hand back an object URL.
 *
 * `<img src="/api/...">` cannot be used for anything behind auth: the browser
 * sends cookies on an image request but never an Authorization header, and this
 * API is bearer-only. So the bytes are fetched properly, wrapped in a blob URL,
 * and that is what the <img> points at.
 *
 * The caller owns the returned URL and must URL.revokeObjectURL it when the
 * element goes away, or the blob is pinned in memory for the life of the tab.
 */
export async function fetchBlobUrl(path, options = {}) {
  const send = (token) =>
    fetch(`/api${path}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: options.signal,
    });

  let res = await send(tokenStore.get());

  // Same one-shot refresh the JSON path does, so an expired access token shows
  // the image instead of a broken icon.
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
    else authLost();
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload);
  }

  return URL.createObjectURL(await res.blob());
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  put: (path, body, options) => request('PUT', path, body ?? {}, options),
  patch: (path, body, options) => request('PATCH', path, body ?? {}, options),
  delete: (path, body, options) => request('DELETE', path, body, options),
};

/* ------------------------------------------------------------- endpoints */

export const authApi = {
  diagnostics: () => api.get('/auth/diagnostics'),
  checkEmail: (email, signal) => api.post('/auth/check-email', { email }, { signal, skipRefresh: true }),
  requestOtp: (email) => api.post('/auth/request-otp', { email }, { skipRefresh: true }),
  verifyOtp: (email, code, name) => api.post('/auth/verify-otp', { email, code, name }, { skipRefresh: true }),
  logout: (userId) => api.post('/auth/logout', { userId }),
  me: () => api.get('/auth/me'),
};

export const profileApi = {
  get: () => api.get('/profile'),
  update: (data) => api.patch('/profile', data),
  setLinks: (links) => api.put('/profile/links', { links }),
  addItem: (section, data) => api.post(`/profile/${section}`, data),
  updateItem: (section, id, data) => api.patch(`/profile/${section}/${id}`, data),
  deleteItem: (section, id) => api.delete(`/profile/${section}/${id}`),
  reorder: (section, ids) => api.put(`/profile/${section}/reorder`, { ids }),
};

export const resumeApi = {
  templates: () => api.get('/resumes/templates'),
  list: () => api.get('/resumes'),
  get: (id) => api.get(`/resumes/${id}`),
  autofill: (targetRole) => api.get(`/resumes/autofill${targetRole ? `?targetRole=${encodeURIComponent(targetRole)}` : ''}`),
  create: (payload) => api.post('/resumes', payload),
  update: (id, payload) => api.patch(`/resumes/${id}`, payload),
  refresh: (id) => api.post(`/resumes/${id}/refresh`),
  score: (payload) => api.post('/resumes/score', payload),
  export: (id, format) => api.post(`/resumes/${id}/export`, { format }),
  remove: (id) => api.delete(`/resumes/${id}`),
};

export const codingApi = {
  get: () => api.get('/coding'),
  sync: (platform, force) => api.post(`/coding/sync${platform ? '/' + platform : ''}${force ? '?force=1' : ''}`),
};

export const jobsApi = {
  list: (params = {}) => api.get(`/jobs?${new URLSearchParams(params)}`),
  recommended: (limit = 12) => api.get(`/jobs/recommended?limit=${limit}`),
  get: (id) => api.get(`/jobs/${id}`),
  alert: () => api.get('/jobs/alerts/me'),
  saveAlert: (data) => api.put('/jobs/alerts/me', data),
  testAlert: () => api.post('/jobs/alerts/me/test'),

  // --- applications (student) ---
  applications: () => api.get('/jobs/applications'),
  apply: (jobId, payload = {}) => api.post('/jobs/applications', { jobId, ...payload }),
  updateApplication: (id, payload) => api.patch(`/jobs/applications/${id}`, payload),
  removeApplication: (id) => api.delete(`/jobs/applications/${id}`),
  // multipart, so it goes through uploadFile rather than the JSON helper
  uploadProof: (id, file) => uploadFile(`/jobs/applications/${id}/proof`, 'screenshot', file),

  // --- moderation (admin) ---
  queue: (params = {}) => api.get(`/jobs/admin/queue?${new URLSearchParams(params)}`),
  sources: () => api.get('/jobs/admin/sources'),
  approve: (ids, note) => api.post('/jobs/admin/approve', { ids, note }),
  reject: (ids, note) => api.post('/jobs/admin/reject', { ids, note }),
  editJob: (id, payload) => api.patch(`/jobs/admin/${id}`, payload),
  verifyLinks: (params = {}) => api.post(`/jobs/admin/verify-links?${new URLSearchParams(params)}`),
  ingest: (source) => api.post(`/jobs/admin/ingest${source ? `?source=${source}` : ''}`),
  applicationStats: (limit) => api.get(`/jobs/admin/applications${limit ? `?limit=${limit}` : ''}`),
};

/**
 * Multipart upload. FormData has to set its own boundary header, so this skips
 * the JSON request helper and only carries the Authorization token.
 */
export async function uploadFile(path, field, file) {
  const body = new FormData();
  body.append(field, file);
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
    body,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const meApi = {
  stats: () => api.get('/me/stats'),
  readiness: () => api.get('/me/readiness'),
  claim: (regNo) => api.post('/me/claim', { regNo }),
  activity: (page = 1) => api.get(`/me/activity?page=${page}`),
  sessions: () => api.get('/me/sessions'),
  revokeAll: () => api.post('/me/sessions/revoke-all'),
  // Students cannot delete their own account; the placement cell does it via
  // cohortApi.deleteAccount. The endpoint returns 403 by design.

  // The guided first-run flow: confirm the imported record, upload an existing
  // resume, then fill the compulsory gaps.
  onboarding: () => api.get('/me/onboarding'),
  confirmRecord: (payload) => api.post('/me/onboarding/confirm', payload),
  skipRecord: () => api.post('/me/onboarding/skip'),
};

export const aiApi = {
  status: () => api.get('/ai/status'),
  bullet: (payload) => api.post('/ai/bullet', payload),
  summary: (payload) => api.post('/ai/summary', payload),
  review: (resumeId) => api.post(`/ai/review/${resumeId}`),
  // Writes an accepted suggestion into the PROFILE, so it also reaches the
  // student's next resume and their public profile — not just this document.
  apply: (patch) => api.post('/ai/apply', patch),
};

export const cohortApi = {
  summary: () => api.get('/cohorts'),
  roster: (code, params = {}) => api.get(`/cohorts/${code}/students?${new URLSearchParams(params)}`),
  facets: (code) => api.get(`/cohorts/${code}/facets`),
  analytics: (code) => api.get(`/cohorts/${code}/analytics`),
  deleteAccount: (userId, confirm) => api.delete(`/cohorts/accounts/${userId}`, { confirm }),
  student: (code, regNo) => api.get(`/cohorts/${code}/students/${encodeURIComponent(regNo)}`),
};

export const publicApi = {
  profile: (slug) => api.get(`/u/${encodeURIComponent(slug)}`),
  directory: (params = {}) => api.get(`/u?${new URLSearchParams(params)}`),
};
