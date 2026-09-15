import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env, assertProductionConfig } from './config/env.js';
import { healthCheck } from './config/db.js';
import { apiLimiter, errorHandler, notFound } from './middleware/common.js';
import { verifyMailer, mailerStatus } from './services/mailer.js';
import { aiStatus } from './services/ai.js';
import { startScheduler } from './jobs/scheduler.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import resumeRoutes from './routes/resumes.js';
import codingRoutes from './routes/coding.js';
import jobRoutes from './routes/jobs.js';
import meRoutes from './routes/me.js';
import publicRoutes from './routes/publicProfile.js';
import cohortRoutes from './routes/cohorts.js';
import aiRoutes from './routes/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

assertProductionConfig();

// Behind nginx on the VPS — needed for correct client IPs and secure cookies.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // the SPA sets its own; API responses are JSON
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(env.isProd ? 'combined' : 'dev'));

// In production the SPA is served from this same process, so the API's own
// origin has to be allowed alongside the Vite dev server.
const allowedOrigins = new Set([
  env.appUrl,
  env.apiUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    // Deny the CORS headers, but let the request continue. Calling back with an
    // Error instead turns every disallowed request into a 500 — including
    // same-origin asset loads that merely carry an Origin header.
    return cb(null, false);
  },
  credentials: true,
});

// Scoped to the API: static files and the SPA fallback need no CORS handling.
app.use('/api', corsMiddleware);

/* -------------------------------------------------------------------- health */

app.get('/api/health', async (_req, res) => {
  let db = false;
  let dbError = null;
  try {
    db = await healthCheck();
  } catch (err) {
    db = false;
    // The driver's error code, and only while the database is actually down.
    // ENOTFOUND, ECONNREFUSED and ER_ACCESS_DENIED_ERROR are three unrelated
    // faults with three unrelated fixes, and telling them apart otherwise means
    // getting someone to read the container log. Nothing identifying goes in
    // here - no host, user, password or query.
    dbError = err?.code || 'UNKNOWN';
  }
  const mail = mailerStatus();
  res.status(db ? 200 : 503).json({
    ok: db,
    service: env.appName,
    env: env.nodeEnv,
    db,
    ...(dbError ? { dbError } : {}),
    mail: { configured: mail.configured, verified: mail.verified },
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

/* -------------------------------------------------------------------- routes */

app.use('/api/auth', authRoutes);
app.use('/api/profile', apiLimiter, profileRoutes);
app.use('/api/resumes', apiLimiter, resumeRoutes);
app.use('/api/coding', apiLimiter, codingRoutes);
app.use('/api/jobs', apiLimiter, jobRoutes);
app.use('/api/me', apiLimiter, meRoutes);
app.use('/api/cohorts', apiLimiter, cohortRoutes);
app.use('/api/ai', apiLimiter, aiRoutes);
app.use('/api/u', publicRoutes);

/* ----------------------------------------------------------- uploaded files */

// Profile photos. Long cache is safe because every upload gets a fresh
// filename, so a replaced photo can never be served from a stale cache.
const uploadsDir = path.resolve(here, '../uploads');
fs.mkdirSync(path.join(uploadsDir, 'avatars'), { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '30d',
  index: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'),
}));

/* ------------------------------------------------- static SPA (production) */

const clientDist = path.resolve(here, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        // Hashed build assets are immutable; index.html must never be cached or
        // a browser keeps asking for chunk names that no longer exist.
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else res.setHeader('Cache-Control', 'public, max-age=604800');
      },
    })
  );

  // A build asset that express.static did not find is genuinely gone — almost
  // always a stale tab asking for a chunk from a previous deploy. It has to
  // 404. Falling through to index.html hands back HTML with a JS content type,
  // which the browser rejects as a MIME error and the app dies on a blank page.
  app.get(/^\/assets\/.*/, (_req, res) => {
    res.status(404).type('text/plain').send('Asset not found — this build no longer exists.');
  });

  // Everything else is a client-side route.
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[web] serving SPA from ${clientDist}`);
}

app.use('/api', notFound);
app.use(errorHandler);

/* ---------------------------------------------------------------- lifecycle */

const server = app.listen(env.port, () => {
  console.log(`\n  ${env.appName} API`);
  console.log(`  env    ${env.nodeEnv}`);
  console.log(`  api    http://localhost:${env.port}/api`);
  console.log(`  app    ${env.appUrl}\n`);

  healthCheck()
    .then(() => console.log(`[db] connected to ${env.db.database}@${env.db.host}`))
    .catch((err) => console.error(`[db] CONNECTION FAILED: ${err.message}`));

  verifyMailer();
  const ai = aiStatus();
  console.log(ai.configured
    ? `[ai] Gemini ready (${ai.model})`
    : '[ai] GEMINI_API_KEY not set — AI writing help is disabled');
  startScheduler();
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

export default app;
