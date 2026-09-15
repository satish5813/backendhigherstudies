/**
 * Invite students to claim the record the placement cell already holds for them.
 *
 *   node server/src/db/invite-students.js                      # dry run, prints who
 *   node server/src/db/invite-students.js --send               # actually email
 *   node server/src/db/invite-students.js --send --campus Vijayawada
 *   node server/src/db/invite-students.js --send --cohort lpa8 --limit 50
 *   node server/src/db/invite-students.js --send --again       # chase non-responders
 *
 * WHY THIS EXISTS
 *
 * The import gave us 656 students, but a record is not an account. The public
 * directory shows what a student writes about themselves — headline, skills,
 * projects — and the workbook has none of that; it has CRT scores and readiness
 * bands. Until a student signs in, there is nothing of theirs to show, which is
 * why a roster of 537 Vijayawada students produced an almost empty directory.
 *
 * This closes that gap the only way it can honestly be closed: by asking them.
 * Nobody is auto-published. They sign in, their record attaches itself, and
 * what appears is what they chose to write.
 *
 * ADDRESSES
 *
 * Only 96 records carry an email, and those are personal Gmail addresses from
 * the workbook. Every record has a clean 10-digit registration number, and KL
 * issues <regno>@kluniversity.in, so that is what we write to — it reaches the
 * student, and it is the address they would sign in with anyway.
 */
import { execute, pool, query } from '../config/db.js';
import { env } from '../config/env.js';
import { sendMail } from '../services/mailer.js';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SEND = args.includes('--send');
const AGAIN = args.includes('--again');
const CAMPUS = opt('campus');
const COHORT = opt('cohort');
const LIMIT = Number(opt('limit', '1000'));

/** KL issues every student <regno>@kluniversity.in. */
const addressFor = (regNo) =>
  /^\d{8,12}$/.test(String(regNo ?? '').trim())
    ? `${String(regNo).trim()}@kluniversity.in`
    : null;

function inviteEmail({ name, regNo, cohortName, band }) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || 'there';
  const url = `${env.appUrl}/login`;

  return {
    subject: `${first}, your placement profile is ready to claim`,
    html: `
<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#16161a">
  <p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6a6a76;margin:0 0 4px">
    KL University · Placement Cell
  </p>
  <h1 style="font-size:21px;margin:0 0 16px;color:#16161a">Claim your placement profile</h1>

  <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hi ${first},</p>

  <p style="font-size:15px;line-height:1.6;margin:0 0 14px">
    The placement cell already holds your readiness analysis — registration
    <strong>${regNo}</strong>${band ? `, target band <strong>${band}</strong>` : ''}${cohortName ? `, ${cohortName}` : ''}.
    Sign in to see it, build an ATS-scored resume from it, and get the openings
    we have approved for your batch.
  </p>

  <p style="margin:24px 0">
    <a href="${url}" style="background:#a41c24;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700;font-size:15px;display:inline-block">
      Sign in and claim it
    </a>
  </p>

  <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#4d4d58">
    Use <strong>${regNo}@kluniversity.in</strong>. There is no password — we email
    you a 6-digit code each time. Your record attaches itself when you sign in.
  </p>

  <p style="font-size:13px;line-height:1.6;color:#6a6a76;margin:22px 0 0;border-top:1px solid #e5e5e9;padding-top:14px">
    Nothing about you is published until you choose to publish it. Your CRT
    scores and readiness analysis stay visible only to you and the placement
    cell.
  </p>
</div>`.trim(),
  };
}

async function main() {
  const where = ['sr.user_id IS NULL'];
  const params = [];
  if (CAMPUS) { where.push('sr.campus = ?'); params.push(CAMPUS); }
  if (COHORT) { where.push('c.code = ?'); params.push(COHORT); }
  // Without --again, skip anyone already written to.
  if (!AGAIN) where.push('sr.invited_at IS NULL');

  const rows = await query(
    `SELECT sr.id, sr.reg_no, sr.name, sr.campus, sr.target_band, sr.invite_count,
            c.name AS cohort_name
       FROM student_records sr JOIN cohorts c ON c.id = sr.cohort_id
      WHERE ${where.join(' AND ')}
      ORDER BY sr.campus, sr.reg_no
      LIMIT ${Math.max(1, Math.min(2000, LIMIT))}`,
    params
  );

  const addressable = rows.filter((r) => addressFor(r.reg_no));
  const skipped = rows.length - addressable.length;

  console.log(`\n${rows.length} unclaimed record(s) match${CAMPUS ? ` · campus ${CAMPUS}` : ''}${COHORT ? ` · cohort ${COHORT}` : ''}`);
  if (skipped) console.log(`${skipped} have no usable registration number and are skipped.`);

  if (!SEND) {
    console.log('\nDRY RUN — nothing sent. Add --send to email them.\n');
    for (const r of addressable.slice(0, 12)) {
      console.log(`  ${addressFor(r.reg_no).padEnd(34)} ${String(r.name).slice(0, 28).padEnd(29)} ${r.campus ?? ''}`);
    }
    if (addressable.length > 12) console.log(`  … and ${addressable.length - 12} more`);
    console.log(`\nWould email ${addressable.length} student(s) from ${env.mail.fromAddress}.`);
    await pool.end();
    return;
  }

  if (!env.mail.host) {
    console.error('\nSMTP is not configured — set SMTP_HOST and friends in server/.env first.\n');
    await pool.end();
    process.exit(1);
  }

  console.log(`\nSending as ${env.mail.fromAddress}…\n`);
  let sent = 0;
  let failed = 0;

  for (const r of addressable) {
    const to = addressFor(r.reg_no);
    const { subject, html } = inviteEmail({
      name: r.name, regNo: r.reg_no, cohortName: r.cohort_name, band: r.target_band,
    });

    const result = await sendMail({ to, subject, html });
    if (result.sent) {
      sent++;
      await execute(
        `UPDATE student_records SET invited_at = NOW(), invite_count = invite_count + 1 WHERE id = ?`,
        [r.id]
      );
    } else {
      failed++;
      console.log(`  FAIL ${to} — ${result.error}`);
    }

    // A shared university mailbox will throttle or blacklist a burst. This is
    // deliberately unhurried: 656 students take a few minutes, which is fine
    // for something run once a semester.
    if (sent % 20 === 0) await new Promise((r2) => setTimeout(r2, 2000));
    else await new Promise((r2) => setTimeout(r2, 250));
  }

  console.log(`\nsent ${sent}, failed ${failed}`);
  console.log('Students appear in the directory once they sign in and publish a profile.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('\nfailed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
