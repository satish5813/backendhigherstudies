/**
 * Publish client/ to the frontend repository as its own history.
 *
 *   node scripts/push-client.js              # pushes to KLEFHigherPlacement, main
 *   node scripts/push-client.js --dry-run    # builds the split, pushes nothing
 *
 * Development happens in this monorepo; the frontend repository is a mirror
 * that Coolify deploys from, and this is the only way it should ever change.
 *
 * `git subtree` is not part of every Git for Windows install, so this uses
 * filter-branch on a throwaway clone — slower by a few seconds, present in
 * every git, and it never touches this working copy.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOTE = process.env.CLIENT_REPO || 'https://github.com/satish5813/KLEFHigherPlacement.git';
const BRANCH = process.env.CLIENT_BRANCH || 'main';
const DRY = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sh = (cmd, cwd = root, opts = {}) =>
  execSync(cmd, { cwd, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' }, ...opts });

function main() {
  const dirty = sh('git status --porcelain -- client', root, { quiet: true }).trim();
  if (dirty) {
    console.error('\nclient/ has uncommitted changes. Commit them first — the mirror is built from history, not the working copy:\n');
    console.error(dirty.split('\n').map((l) => '  ' + l).join('\n') + '\n');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-client-'));
  console.log(`\nsplitting client/ into ${tmp}`);
  try {
    sh(`git clone --quiet --no-local "${root}" "${tmp}"`);
    sh('git filter-branch --quiet --subdirectory-filter client -- --all', tmp);
    const commits = sh('git rev-list --count HEAD', tmp, { quiet: true }).trim();
    const head = sh('git log -1 --format=%h%x20%s', tmp, { quiet: true }).trim();
    console.log(`  ${commits} commits of client history; head: ${head}`);

    if (DRY) {
      console.log('\n  dry run — not pushed\n');
      return;
    }
    console.log(`\npushing to ${REMOTE} (${BRANCH})`);
    sh(`git push --force --quiet "${REMOTE}" HEAD:refs/heads/${BRANCH}`, tmp);
    console.log('\n  published. Coolify deploys from that repository on its next build.\n');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp dir; the OS will get it */ }
  }
}

main();
