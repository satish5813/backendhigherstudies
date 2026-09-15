import cron from 'node-cron';
import { env } from '../config/env.js';
import { runDailyDigest } from '../services/jobAlerts.js';
import { purgeExpiredOtps } from '../services/otp.js';
import { expireStaleJobs, ingestAll } from '../services/jobIngest.js';
import { execute } from '../config/db.js';

const tasks = [];

export function startScheduler() {
  // ---- job alerts -------------------------------------------------------
  // Runs hourly; runDailyDigest() only picks up students whose send_hour is
  // the current hour, so each person still gets exactly one digest a day.
  if (cron.validate(env.jobAlertCron)) {
    tasks.push(
      cron.schedule(
        '0 * * * *',
        async () => {
          try {
            const summary = await runDailyDigest();
            if (summary.due) console.log('[cron] job alerts', summary);
          } catch (err) {
            console.error('[cron] job alert sweep failed:', err.message);
          }
        },
        { timezone: env.timezone }
      )
    );
    console.log(`[cron] job alert sweep armed (hourly, ${env.timezone})`);
  }

  // ---- nightly job sourcing --------------------------------------------
  // Pulls 20 LPA+ Indian openings into the moderation queue. Nothing here
  // reaches a student: every row lands as `pending` and waits for a placement
  // officer. Scheduled away from the 08:00 digest so a slow board API can never
  // delay student mail.
  if (env.jobs.autoIngest) {
    tasks.push(
      cron.schedule(
        `0 ${env.jobs.ingestHour} * * *`,
        async () => {
          try {
            const { runs, inserted, pending } = await ingestAll();
            const closed = await expireStaleJobs();
            const failed = runs.filter((r) => r.status === 'failed').map((r) => r.source);
            console.log(`[cron] job sweep — queued:${inserted} pending:${pending} closed:${closed}`
              + (failed.length ? ` failed:${failed.join(',')}` : ''));
          } catch (err) {
            console.error('[cron] job sweep failed:', err.message);
          }
        },
        { timezone: env.timezone }
      )
    );
    console.log(`[cron] job sourcing armed (${String(env.jobs.ingestHour).padStart(2, '0')}:00, `
      + `min ${env.jobs.minCtc} LPA, ${env.timezone})`);
  }

  // ---- housekeeping, 03:20 daily ---------------------------------------
  tasks.push(
    cron.schedule(
      '20 3 * * *',
      async () => {
        try {
          const otps = await purgeExpiredOtps();
          const sessions = await execute(
            `DELETE FROM sessions WHERE expires_at < (NOW() - INTERVAL 7 DAY) OR revoked_at < (NOW() - INTERVAL 7 DAY)`
          );
          const logs = await execute(`DELETE FROM activity_logs WHERE created_at < (NOW() - INTERVAL 1 YEAR)`);
          console.log(`[cron] cleanup — otps:${otps} sessions:${sessions.affectedRows} logs:${logs.affectedRows}`);
        } catch (err) {
          console.error('[cron] cleanup failed:', err.message);
        }
      },
      { timezone: env.timezone }
    )
  );

  return tasks;
}

export function stopScheduler() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
