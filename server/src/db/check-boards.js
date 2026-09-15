/**
 * Check every configured job board still resolves and still carries India roles.
 *
 *   node server/src/db/check-boards.js
 *   node server/src/db/check-boards.js --try razorpay,phonepe    # test candidates
 *
 * Board tokens drift: companies rename them, move ATS, or close their public
 * board. A dead token is silent — it just returns nothing — so this is the tool
 * that tells you BOARDS needs editing. Run it when the queue looks thin.
 *
 * Adding a company: find the token in its careers URL
 *   boards.greenhouse.io/<token>   jobs.lever.co/<token>   jobs.ashbyhq.com/<token>
 * then confirm it here before putting it in BOARDS. Guessing from the company
 * name usually fails — "atlassian", "freshworks" and "swiggy" all 404.
 */
import { BOARDS } from '../services/jobSources.js';

const UA = 'KLPlacementReadiness/1.0 (KL University placement portal)';

const URLS = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=false`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
};

// Deliberately looser than the ingester's isIndia(): this is a health check, so
// a token that returns *any* plausibly-Indian role counts as alive.
const INDIA = /india|bengaluru|bangalore|hyderabad|pune|chennai|mumbai|delhi|gurgaon|gurugram|noida|\bIND\b/i;

function locationOf(provider, j) {
  if (provider === 'greenhouse') return j.location?.name;
  if (provider === 'lever') return j.categories?.location;
  return j.location;
}

async function probe(provider, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(URLS[provider](token), {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': UA },
    });
    if (!res.ok) return { token, ok: false, why: `HTTP ${res.status}` };
    const data = await res.json();
    const list = provider === 'lever' ? (data ?? []) : (data?.jobs ?? []);
    const india = list.filter((j) => INDIA.test(String(locationOf(provider, j) ?? ''))).length;
    return { token, ok: true, total: list.length, india };
  } catch (err) {
    return { token, ok: false, why: err.message.slice(0, 50) };
  } finally {
    clearTimeout(timer);
  }
}

/** Six at a time, matching the ingester's own concurrency. */
async function probeAll(provider, tokens) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, tokens.length) }, async () => {
    while (i < tokens.length) out.push(await probe(provider, tokens[i++]));
  }));
  return out;
}

const args = process.argv.slice(2);
const tryIdx = args.indexOf('--try');
const candidates = tryIdx >= 0 && args[tryIdx + 1] ? args[tryIdx + 1].split(',') : null;

let dead = 0;
let empty = 0;
let totalIndia = 0;

for (const [provider, configured] of Object.entries(BOARDS)) {
  const tokens = candidates ?? configured;
  const results = (await probeAll(provider, tokens)).sort((a, b) => (b.india ?? 0) - (a.india ?? 0));

  console.log(`\n${provider}`);
  for (const r of results) {
    if (!r.ok) {
      dead++;
      console.log(`  DEAD  ${r.token.padEnd(32)} ${r.why}`);
    } else if (r.india === 0) {
      empty++;
      console.log(`  none  ${r.token.padEnd(32)} 0 India roles (${r.total} total) — consider removing`);
    } else {
      totalIndia += r.india;
      console.log(`  ok    ${r.token.padEnd(32)} ${String(r.india).padStart(4)} India / ${r.total} total`);
    }
  }
}

console.log(`\n${totalIndia} India roles reachable · ${dead} dead token(s) · ${empty} with nothing in India`);
if (dead) console.log('Remove or replace the dead tokens in BOARDS (server/src/services/jobSources.js).');
process.exit(dead ? 1 : 0);
