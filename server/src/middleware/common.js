import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { clientIp } from '../utils/activity.js';

const jsonLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => clientIp(req) || 'unknown',
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited', message }),
  });

/** OTP request: an IP may only ask for so many codes, whatever address it uses. */
export const otpRequestLimiter = jsonLimit(
  15 * 60 * 1000,
  env.otp.maxRequestsPerIp,
  'Too many verification codes requested from this network. Try again in 15 minutes.'
);

/** OTP verify: blunt brute-force stop on top of the per-code attempt counter. */
export const otpVerifyLimiter = jsonLimit(
  15 * 60 * 1000,
  env.otp.maxVerifiesPerIp,
  'Too many verification attempts. Try again in 15 minutes.'
);

export const apiLimiter = jsonLimit(60 * 1000, env.rateLimits.apiPerMinute, 'Slow down a moment and try again.');

export const writeLimiter = jsonLimit(60 * 1000, env.rateLimits.writesPerMinute, 'You are saving too quickly — try again shortly.');

/** Validates a body against a zod schema, replacing req.body with the parsed value. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join('.') || '(root)',
      message: i.message,
    }));
    return res.status(422).json({
      error: 'validation_failed',
      message: issues[0]?.message || 'Please check the highlighted fields.',
      issues,
    });
  }
  req[source] = result.data;
  next();
};

export function notFound(_req, res) {
  res.status(404).json({ error: 'not_found', message: 'That endpoint does not exist.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);

  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'file_too_large', message: 'That file is over 4MB. Export a smaller PDF and try again.' });
  if (err.code === 'ER_DUP_ENTRY')
    return res.status(409).json({ error: 'duplicate', message: 'That value is already taken.' });
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR')
    return res.status(503).json({ error: 'db_unavailable', message: 'Database unavailable. Try again shortly.' });

  res.status(status).json({
    error: err.error || (status >= 500 ? 'server_error' : 'request_failed'),
    message: status >= 500 ? 'Something went wrong on our side.' : err.message || 'Request failed.',
    // field-level detail lets the client highlight the offending input
    issues: err.issues?.length
      ? err.issues.map((i) => ({ field: i.field ?? i.path?.join('.') ?? '(root)', message: i.message }))
      : undefined,
  });
}

/** Wraps an async route so rejections reach errorHandler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, error) {
    super(message);
    this.status = status;
    this.error = error;
  }
}
