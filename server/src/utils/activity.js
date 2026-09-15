import { execute } from '../config/db.js';

/**
 * The profiling log. Every meaningful thing a student does gets a row here so
 * the "My activity" page and any placement-cell report can be built from it.
 */
export const ACTIONS = {
  OTP_REQUESTED: 'otp.requested',
  OTP_VERIFIED: 'otp.verified',
  OTP_FAILED: 'otp.failed',
  SIGNUP: 'auth.signup',
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.refresh',
  PROFILE_UPDATED: 'profile.updated',
  SECTION_CREATED: 'section.created',
  SECTION_UPDATED: 'section.updated',
  SECTION_DELETED: 'section.deleted',
  CODING_SYNCED: 'coding.synced',
  RESUME_CREATED: 'resume.created',
  RESUME_UPDATED: 'resume.updated',
  RESUME_DELETED: 'resume.deleted',
  RESUME_SCORED: 'resume.scored',
  RESUME_EXPORTED: 'resume.exported',
  RESUME_UPLOADED: 'resume.uploaded',
  AI_USED: 'ai.used',
  AI_APPLIED: 'ai.applied',
  ALERT_UPDATED: 'alert.updated',
  ALERT_SENT: 'alert.sent',
  PROFILE_VIEWED: 'profile.viewed',
  JOB_APPLIED: 'job.applied',
  JOB_PROOF_UPLOADED: 'job.proof_uploaded',
  JOB_APPROVED: 'job.approved',
  JOB_REJECTED: 'job.rejected',
  JOB_INGESTED: 'job.ingested',
  RECORD_CONFIRMED: 'profile.record_confirmed',
  ACCOUNT_DELETED: 'admin.account_deleted',
};

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '').slice(0, 64);
}

export function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 300);
}

/**
 * Fire-and-forget: logging must never break the request it is describing.
 */
export async function logActivity(req, { userId = null, email = null, action, detail = null }) {
  try {
    await execute(
      `INSERT INTO activity_logs (user_id, email, action, detail, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, email, action, detail ? JSON.stringify(detail) : null, clientIp(req), userAgent(req)]
    );
  } catch (err) {
    console.error('[activity] failed to log', action, err.message);
  }
}
