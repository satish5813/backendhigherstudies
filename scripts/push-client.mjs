/**
 * Publish one directory of this monorepo to its own repository, with history.
 *
 *   node scripts/push-client.mjs                          # client/  -> KLEFHigherPlacement
 *   node scripts/push-client.mjs --prefix followup        # followup/ -> KLEFFollowUp
 *   node scripts/push-client.mjs --prefix followup --remote https://github.com/you/other.git
 *   node scripts/push-client.mjs --dry-run                # builds the split, pushes nothing
 *
 * Development happens here; the published repositories are mirrors that
 * Vercel deploys from, and this is the only way they should ever change.
 *
 * `git subtree` is not part of every Git for Windows install, so this uses
 * filter-branch on a throwaway clone — a few seconds slower, present in every
 * git, and it never touches this working copy.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };

const DEFAULT_REMOTES = {
  client: 'https://github.com/satish5813/KLEFHigherPlacement.git',
  followup: 'https://github.com/satish5813/KLEFFollowUp.git',
};

const PREFIX = opt('prefix', 'client').replace(/\/$/, '');
const REMOTE = opt('remote', process.env.PUBLISH_REPO || DEFAULT_REMOTES[PREFIX]);
const BRANCH = opt('branch', 'main');
const DRY = argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sh = (cmd, cwd = root, opts = {}) =>
  execSync(cmd, { cwd, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' }, ...opts });

function main() {
  if (!REMOTE) {
    console.error(`\nNo remote known for ${PREFIX}/ — pass --remote https://github.com/...\n`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(root, PREFIX))) {
    console.error(`\n${PREFIX}/ does not exist.\n`);
    process.exit(1);
  }
  const dirty = sh(`git status --porcelain -- ${PREFIX}`, root, { quiet: true }).trim();
  if (dirty) {
    console.error(`\n${PREFIX}/ has uncommitted changes. Commit them first — the mirror is built from history, not the working copy:\n`);
    console.error(dirty.split('\n').map((l) => '  ' + l).join('\n') + '\n');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cf-${PREFIX}-`));
  console.log(`\nsplitting ${PREFIX}/ into ${tmp}`);
  try {
    sh(`git clone --quiet --no-local "${root}" "${tmp}"`);
    sh(`git filter-branch -f --subdirectory-filter ${PREFIX} -- --all`, tmp, { stdio: 'pipe' });
    const commits = sh('git rev-list --count HEAD', tmp, { quiet: true }).trim();
    const head = sh('git log -1 --format=%h%x20%s', tmp, { quiet: true }).trim();
    console.log(`  ${commits} commits of ${PREFIX}/ history; head: ${head}`);

    if (DRY) {
      console.log('\n  dry run — not pushed\n');
      return;
    }
    console.log(`\npushing to ${REMOTE} (${BRANCH})`);
    sh(`git push --force --quiet "${REMOTE}" HEAD:refs/heads/${BRANCH}`, tmp);
    console.log('\n  published. The deployment rebuilds from that repository on its next build.\n');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp dir; the OS will get it */ }
  }
}

main();
