/**
 * Grants (or revokes) the admin role, which unlocks the cohort roster and the
 * per-student profiling reports.
 *
 *   node server/src/db/make-admin.js you@klu.ac.in
 *   node server/src/db/make-admin.js you@klu.ac.in --revoke
 *   node server/src/db/make-admin.js --list
 *
 * The account must already exist — sign in once first, then run this.
 */
import { execute, pool, query, queryOne } from '../config/db.js';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const list = args.includes('--list');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

async function main() {
  if (list) {
    const admins = await query(`SELECT email, name, last_login_at FROM users WHERE role = 'admin' ORDER BY email`);
    if (!admins.length) console.log('\nNo admin accounts yet.\n');
    else {
      console.log(`\n${admins.length} admin account(s):`);
      for (const a of admins) console.log(`  ${a.email}${a.name ? ` — ${a.name}` : ''}`);
      console.log('');
    }
    return;
  }

  if (!email) {
    console.error('\nUsage: node server/src/db/make-admin.js <email> [--revoke]');
    console.error('       node server/src/db/make-admin.js --list\n');
    process.exitCode = 1;
    return;
  }

  const user = await queryOne(`SELECT id, email, name, role FROM users WHERE email = ?`, [email]);
  if (!user) {
    console.error(`\nNo account for ${email}.`);
    console.error('Sign in once with that address first, then re-run this.\n');
    process.exitCode = 1;
    return;
  }

  const next = revoke ? 'student' : 'admin';
  if (user.role === next) {
    console.log(`\n${email} is already ${next}.\n`);
    return;
  }

  await execute(`UPDATE users SET role = ? WHERE id = ?`, [next, user.id]);
  console.log(`\n${email} is now ${next}.`);
  if (next === 'admin') {
    console.log('They can now open Students in the sidebar for the cohort roster');
    console.log('and each student\'s profiling report.\n');
  } else {
    console.log('Cohort roster access removed.\n');
  }
}

main()
  .catch((err) => {
    console.error('\nfailed:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
