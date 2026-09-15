/**
 * Drive the Coolify deployment from here, so nobody retypes forty variables
 * into a web form and gets one wrong.
 *
 *   node server/src/db/coolify.js list
 *   node server/src/db/coolify.js show  <app-uuid>
 *   node server/src/db/coolify.js apply <app-uuid> [--keys A,B,C] [--deploy]
 *   node server/src/db/coolify.js deploy <app-uuid>
 *   node server/src/db/coolify.js watch  <deployment-uuid>
 *
 * `apply` reads _private-data/coolify.env (the file make-prod-env.js writes)
 * and creates or updates every variable in it on the application; --keys
 * limits that to a few. Values are never printed.
 *
 * The API token comes from COOLIFY_TOKEN, or _private-data/coolify-token.txt.
 * It is a Coolify token with write + deploy permission — not a shell on the
 * server — and the right thing to do once the deployment is settled is to
 * revoke it in Coolify -> Keys & Tokens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = path.resolve(here, '../../../../_private-data');
const BASE = (process.env.COOLIFY_URL || 'http://187.127.135.148:8000').replace(/\/$/, '') + '/api/v1';

const args = process.argv.slice(2);
const cmd = args[0];
const arg = args[1];
const flag = (n) => args.includes(`--${n}`);
const option = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

function token() {
  if (process.env.COOLIFY_TOKEN) return process.env.COOLIFY_TOKEN.trim();
  const f = path.join(PRIVATE, 'coolify-token.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('\nNo COOLIFY_TOKEN and no _private-data/coolify-token.txt.\n');
  process.exit(1);
}

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.raw || res.statusText;
    throw new Error(`${method} ${p} -> ${res.status}: ${msg}`);
  }
  return data;
}

/** KEY=value lines from coolify.env; comments and blanks skipped. */
function readEnvFile() {
  const f = path.join(PRIVATE, 'coolify.env');
  if (!fs.existsSync(f)) { console.error(`\n${f} not found — run make-prod-env.js first.\n`); process.exit(1); }
  const out = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const mask = (v) => (v ? `${v.slice(0, 2)}…(${v.length})` : '(empty)');

async function list() {
  const apps = await api('GET', '/applications');
  if (!apps.length) { console.log('\nNo applications.\n'); return; }
  console.log('');
  for (const a of apps) {
    console.log(`  ${a.uuid}  ${String(a.name).padEnd(28)} ${a.fqdn || ''}`);
    if (a.git_repository) console.log(`  ${''.padEnd(a.uuid.length)}  ${a.git_repository}@${a.git_branch}`);
  }
  console.log('');
}

async function show(uuid) {
  const envs = await api('GET', `/applications/${uuid}/envs`);
  console.log(`\n${envs.length} variables on ${uuid}:\n`);
  for (const e of envs.sort((x, y) => x.key.localeCompare(y.key))) {
    console.log(`  ${e.key.padEnd(30)} ${mask(e.value)}`);
  }
  console.log('');
}

async function apply(uuid) {
  const wanted = readEnvFile();
  const only = option('keys')?.split(',').map((k) => k.trim()).filter(Boolean);
  const keys = only ?? Object.keys(wanted);
  // A token with write but not read cannot list the variables. That is fine:
  // update by key first, and create only when Coolify says the key is new.
  let byKey = null;
  try {
    const existing = await api('GET', `/applications/${uuid}/envs`);
    byKey = new Map(existing.map((e) => [e.key, e]));
  } catch (err) {
    if (!/403|401/.test(err.message)) throw err;
    console.log('\n  (token cannot read variables — updating blind, creating on 404)');
  }

  let created = 0, updated = 0, same = 0;
  console.log('');
  for (const key of keys) {
    if (!(key in wanted)) { console.log(`  skip     ${key} (not in coolify.env)`); continue; }
    const value = wanted[key];
    const body = { key, value, is_preview: false, is_buildtime: false, is_runtime: true, is_literal: false, is_multiline: false, is_shown_once: false };
    const cur = byKey?.get(key);
    if (cur && cur.value === value) { same++; console.log(`  same     ${key}`); continue; }
    if (byKey && !cur) {
      await api('POST', `/applications/${uuid}/envs`, body); created++; console.log(`  created  ${key}`); continue;
    }
    try {
      await api('PATCH', `/applications/${uuid}/envs`, body); updated++; console.log(`  updated  ${key}`);
    } catch (err) {
      if (!/404/.test(err.message)) throw err;
      await api('POST', `/applications/${uuid}/envs`, body); created++; console.log(`  created  ${key}`);
    }
  }
  console.log(`\n  ${created} created, ${updated} updated, ${same} unchanged\n`);

  if (flag('deploy')) await deploy(uuid);
  else console.log('  Not deployed. Coolify applies variables on the next deploy: add --deploy, or run `deploy`.\n');
}

/**
 * Create an application from a public repository with a Dockerfile.
 *
 *   node server/src/db/coolify.js create --name klef-frontend \
 *     --server <server-uuid> --project <project-uuid> --env <environment-uuid> \
 *     --repo https://github.com/satish5813/KLEFHigherPlacement --branch main \
 *     --port 80 --domain https://placement.187.127.135.148.sslip.io
 */
async function create() {
  const need = (n) => { const v = option(n); if (!v) { console.error(`\n  --${n} is required\n`); process.exit(1); } return v; };
  const body = {
    name: need('name'),
    server_uuid: need('server'),
    project_uuid: need('project'),
    environment_uuid: need('env'),
    git_repository: need('repo'),
    git_branch: option('branch') || 'main',
    build_pack: 'dockerfile',
    ports_exposes: option('port') || '80',
    instant_deploy: false,
    ...(option('domain') ? { domains: option('domain') } : {}),
  };
  const r = await api('POST', '/applications/public', body);
  const uuid = r?.uuid;
  console.log(`\n  created ${body.name}: ${uuid}${option('domain') ? `  at ${option('domain')}` : ''}\n`);
  if (!uuid) { console.log(JSON.stringify(r).slice(0, 300)); return; }
  if (flag('deploy')) await deploy(uuid);
  else console.log('  Not deployed yet. Run: node server/src/db/coolify.js deploy ' + uuid + '\n');
  return uuid;
}

async function deploy(uuid) {
  const r = await api('GET', `/deploy?uuid=${encodeURIComponent(uuid)}&force=true`);
  const d = r?.deployments?.[0];
  if (!d) { console.log('\n  deploy request accepted, no deployment id returned:', JSON.stringify(r).slice(0, 200), '\n'); return; }
  console.log(`\n  ${d.message || 'deployment queued'}  (${d.deployment_uuid})\n`);
  await watch(d.deployment_uuid);
}

/**
 * Without read permission the deployments API is closed, but the application
 * itself says when it has been replaced: its uptime drops back to seconds.
 */
async function watchByHealth(healthUrl) {
  const t0 = Date.now();
  let sawOld = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const up = Number(j.uptime ?? 0);
      if (up > 120) sawOld = true;
      if (sawOld && up < 90) {
        console.log(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  new container up (uptime ${up}s, db ${j.db}, tables ${j.tables ?? '?'}, mail ${j.mail?.verified})`);
        console.log('\n  Deployed.\n');
        return;
      }
      if (i % 6 === 0) console.log(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${sawOld ? 'building…' : 'waiting for the old container to be replaced…'} (uptime ${up}s)`);
    } catch {
      if (i % 6 === 0) console.log(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  restarting…`);
      sawOld = true;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('\n  Still not back after 10 minutes — check Coolify.\n');
}

async function watch(depUuid) {
  const t0 = Date.now();
  let last = '';
  const health = option('health');
  for (let i = 0; i < 120; i++) {
    let d;
    try {
      d = await api('GET', `/deployments/${depUuid}`);
    } catch (err) {
      if (/403|401/.test(err.message) && health) {
        console.log('  (token cannot read deployments — watching the app\'s health endpoint instead)');
        return watchByHealth(health);
      }
      throw err;
    }
    const status = d.status || '?';
    if (status !== last) { console.log(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${status}`); last = status; }
    if (status === 'finished') { console.log('\n  Deployed.\n'); return; }
    if (status === 'failed' || status === 'cancelled-by-user') {
      const logs = typeof d.logs === 'string' ? d.logs : JSON.stringify(d.logs || '');
      console.log('\n  Deployment FAILED. Tail of the log:\n');
      console.log(logs.slice(-2500));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('\n  Still running after 10 minutes — check Coolify.\n');
}

(async () => {
  try {
    if (cmd === 'list') await list();
    else if (cmd === 'show' && arg) await show(arg);
    else if (cmd === 'apply' && arg) await apply(arg);
    else if (cmd === 'create') await create();
    else if (cmd === 'deploy' && arg) await deploy(arg);
    else if (cmd === 'watch' && arg) await watch(arg);
    else {
      console.log(`
  node server/src/db/coolify.js list
  node server/src/db/coolify.js show  <app-uuid>
  node server/src/db/coolify.js apply <app-uuid> [--keys A,B,C] [--deploy]
  node server/src/db/coolify.js deploy <app-uuid>
  node server/src/db/coolify.js watch  <deployment-uuid>
`);
    }
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }
})();
