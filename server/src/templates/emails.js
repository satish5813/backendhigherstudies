import { env } from '../config/env.js';

const shell = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(2,6,23,.35);">
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#0ea5e9);padding:22px 28px;">
          <span style="color:#fff;font-size:19px;font-weight:700;letter-spacing:-.3px;">${env.appName}</span>
          <span style="color:rgba(255,255,255,.75);font-size:12px;display:block;margin-top:2px;">Student career profile &amp; ATS resume platform</span>
        </td></tr>
        <tr><td style="padding:30px 28px 34px;color:#0f172a;font-size:15px;line-height:1.65;">${body}</td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
          You received this because an account action was requested for this address at
          <a href="${env.appUrl}" style="color:#4f46e5;text-decoration:none;">${env.appUrl.replace(/^https?:\/\//, '')}</a>.<br>
          If it wasn't you, you can safely ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export function otpEmail({ code, ttlMinutes, isNewUser }) {
  const heading = isNewUser ? 'Confirm your email to get started' : 'Your sign-in code';
  const body = `
    <h1 style="margin:0 0 8px;font-size:21px;font-weight:700;letter-spacing:-.4px;">${heading}</h1>
    <p style="margin:0 0 22px;color:#475569;">Enter this code in the browser tab you just opened. It expires in <strong>${ttlMinutes} minutes</strong>.</p>
    <div style="text-align:center;margin:0 0 24px;">
      <div style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:14px;padding:16px 28px;">
        <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#0f172a;">${code}</span>
      </div>
    </div>
    <p style="margin:0;color:#64748b;font-size:13px;">Never share this code. ${env.appName} staff will never ask you for it.</p>`;
  return { subject: `${code} is your ${env.appName} verification code`, html: shell(heading, body) };
}

export function welcomeEmail({ name }) {
  const body = `
    <h1 style="margin:0 0 8px;font-size:21px;font-weight:700;letter-spacing:-.4px;">Welcome${name ? ', ' + escapeHtml(name) : ''} 👋</h1>
    <p style="margin:0 0 18px;color:#475569;">Your ${env.appName} account is live. Here's the fastest path to a recruiter-ready profile:</p>
    <ol style="margin:0 0 22px;padding-left:20px;color:#334155;">
      <li style="margin-bottom:7px;">Fill in your personal details and education.</li>
      <li style="margin-bottom:7px;">Add projects, skills and achievements — these feed the resume automatically.</li>
      <li style="margin-bottom:7px;">Link your LeetCode / GitHub handle to pull your live coding stats.</li>
      <li style="margin-bottom:7px;">Generate an ATS resume and check its score against a target role.</li>
      <li>Turn on daily job alerts so openings come to you.</li>
    </ol>
    <p style="margin:0 0 8px;"><a href="${env.appUrl}/app/profile" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;">Complete my profile</a></p>`;
  return { subject: `Welcome to ${env.appName}`, html: shell('Welcome', body) };
}

export function jobAlertEmail({ name, jobs, appUrl = env.appUrl }) {
  const cards = jobs
    .map(
      (j) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(j.title)}</div>
          <div style="font-size:13px;color:#475569;margin-top:2px;">${escapeHtml(j.company)} &middot; ${escapeHtml(j.location || 'India')} &middot; ${escapeHtml(j.work_mode)}</div>
          ${j.min_ctc ? `<div style="font-size:13px;color:#059669;font-weight:600;margin-top:4px;">₹${j.min_ctc}${j.max_ctc ? '–' + j.max_ctc : '+'} LPA</div>` : ''}
          ${Array.isArray(j.skills) && j.skills.length ? `<div style="margin-top:8px;">${j.skills.slice(0, 6).map((s) => `<span style="display:inline-block;background:#eef2ff;color:#4338ca;font-size:11px;padding:3px 8px;border-radius:999px;margin:0 4px 4px 0;">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
          <div style="margin-top:10px;"><a href="${escapeHtml(j.apply_url || appUrl + '/app/jobs')}" style="color:#4f46e5;font-weight:600;text-decoration:none;font-size:13px;">Apply &rarr;</a></div>
        </td></tr>
      </table>`
    )
    .join('');

  const body = `
    <h1 style="margin:0 0 6px;font-size:21px;font-weight:700;letter-spacing:-.4px;">${jobs.length} new match${jobs.length === 1 ? '' : 'es'} for you</h1>
    <p style="margin:0 0 20px;color:#475569;">Hi${name ? ' ' + escapeHtml(name.split(' ')[0]) : ''}, these openings match the alert you set up.</p>
    ${cards}
    <p style="margin:18px 0 0;font-size:13px;color:#64748b;">
      <a href="${appUrl}/app/alerts" style="color:#4f46e5;text-decoration:none;">Tune or pause these alerts</a>
    </p>`;
  return { subject: `${jobs.length} job match${jobs.length === 1 ? '' : 'es'} — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, html: shell('Job alerts', body) };
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
