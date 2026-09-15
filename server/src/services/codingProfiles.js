/**
 * Live coding-profile fetchers.
 *
 * Every fetcher resolves to a normalised record with a `status` field so the UI
 * can tell "this student has no LeetCode account" apart from "the handle they
 * typed does not exist" apart from "LeetCode was down when we last looked".
 * Nothing here throws — a dead upstream must never break a profile page.
 */

const TIMEOUT_MS = 12_000;
const LC_URL = 'https://leetcode.com/graphql';

const LC_QUERY = `
query userData($username: String!) {
  matchedUser(username: $username) {
    username
    profile { ranking reputation starRating }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    badges { displayName }
  }
  userContestRanking(username: $username) {
    rating
    globalRanking
    attendedContestsCount
    topPercentage
  }
}`;

// Some accounts / schema versions reject starRating — this is the safe fallback.
const LC_QUERY_BASIC = LC_QUERY.replace(' starRating', '');

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts a bare handle or a full profile URL and returns the handle. */
export function normaliseHandle(platform, input) {
  let v = String(input || '').trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const patterns = {
    leetcode: /^(?:www\.)?leetcode\.com\/(?:u\/|profile\/)?/i,
    github: /^(?:www\.)?github\.com\//i,
    codechef: /^(?:www\.)?codechef\.com\/users\//i,
    hackerrank: /^(?:www\.)?hackerrank\.com\/(?:profile\/)?/i,
  };
  if (patterns[platform]) v = v.replace(patterns[platform], '');
  return v.split('/')[0].split('?')[0].trim();
}

export async function fetchLeetCode(username) {
  const handle = normaliseHandle('leetcode', username);
  if (!handle) return { status: 'unlinked' };

  for (const query of [LC_QUERY, LC_QUERY_BASIC]) {
    try {
      const res = await fetchWithTimeout(LC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: `https://leetcode.com/u/${handle}/`,
          'User-Agent': 'CareerForge/1.0 (student profile sync)',
        },
        body: JSON.stringify({ query, variables: { username: handle } }),
      });

      if (res.status === 429) return { status: 'error', error: 'LeetCode rate-limited us. Try again in a minute.' };
      const json = await res.json();
      const user = json?.data?.matchedUser;

      if (!user) {
        // A schema error on the rich query means: retry with the basic one.
        if (json?.errors && query === LC_QUERY) continue;
        return { status: 'not_found' };
      }

      const counts = Object.fromEntries(
        (user.submitStatsGlobal?.acSubmissionNum || []).map((d) => [d.difficulty, d.count])
      );
      const contest = json?.data?.userContestRanking || {};
      const profile = user.profile || {};
      const badges = (user.badges || []).map((b) => b.displayName).filter(Boolean);

      return {
        status: 'ok',
        username: user.username || handle,
        solved_total: counts.All ?? null,
        easy: counts.Easy ?? null,
        medium: counts.Medium ?? null,
        hard: counts.Hard ?? null,
        contest_rating: contest.rating ? Math.round(contest.rating) : null,
        contest_count: contest.attendedContestsCount ?? null,
        global_rank: contest.globalRanking ?? profile.ranking ?? null,
        star_rating: profile.starRating ?? null,
        reputation: profile.reputation ?? null,
        badges: badges.slice(0, 4).join(', ') || null,
        raw: { topPercentage: contest.topPercentage ?? null, badges },
      };
    } catch (err) {
      if (query === LC_QUERY_BASIC) return { status: 'error', error: err.message };
    }
  }
  return { status: 'error', error: 'LeetCode did not respond.' };
}

export async function fetchGitHub(username) {
  const handle = normaliseHandle('github', username);
  if (!handle) return { status: 'unlinked' };
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CareerForge/1.0',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    };
    const res = await fetchWithTimeout(`https://api.github.com/users/${encodeURIComponent(handle)}`, { headers });
    if (res.status === 404) return { status: 'not_found' };
    if (res.status === 403) return { status: 'error', error: 'GitHub rate limit reached. Set GITHUB_TOKEN to raise it.' };
    if (!res.ok) return { status: 'error', error: `GitHub returned ${res.status}` };
    const u = await res.json();

    let topRepos = [];
    try {
      const r = await fetchWithTimeout(
        `https://api.github.com/users/${encodeURIComponent(handle)}/repos?sort=updated&per_page=100`,
        { headers }
      );
      if (r.ok) {
        const repos = await r.json();
        topRepos = repos
          .filter((x) => !x.fork)
          .sort((a, b) => b.stargazers_count - a.stargazers_count)
          .slice(0, 6)
          .map((x) => ({
            name: x.name,
            url: x.html_url,
            stars: x.stargazers_count,
            language: x.language,
            description: x.description,
          }));
      }
    } catch { /* repo list is a bonus, not a requirement */ }

    return {
      status: 'ok',
      username: u.login,
      solved_total: u.public_repos ?? null, // reused column: public repo count
      reputation: u.followers ?? null,
      badges: topRepos.map((r) => r.language).filter(Boolean).slice(0, 4).join(', ') || null,
      raw: {
        name: u.name,
        bio: u.bio,
        followers: u.followers,
        following: u.following,
        public_repos: u.public_repos,
        avatar_url: u.avatar_url,
        html_url: u.html_url,
        topRepos,
      },
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function fetchCodeChef(username) {
  const handle = normaliseHandle('codechef', username);
  if (!handle) return { status: 'unlinked' };
  try {
    const res = await fetchWithTimeout(`https://www.codechef.com/users/${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CareerForge/1.0)' },
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error', error: `CodeChef returned ${res.status}` };
    const html = await res.text();
    if (/user not found|page not found/i.test(html)) return { status: 'not_found' };

    const rating = html.match(/<div class="rating-number">(\d+)/)?.[1];
    const stars = html.match(/<span class="rating">(\d+)&#9733;<\/span>/)?.[1]
      ?? html.match(/rating-star[^>]*>(?:\s*<span[^>]*>★<\/span>\s*){1,7}/)?.[0]?.match(/★/g)?.length;
    const globalRank = html.match(/Global Rank[\s\S]{0,120}?<strong>(\d+)</)?.[1];
    const solved = html.match(/Total Problems Solved:\s*<\/b>\s*(\d+)/)?.[1];

    if (!rating && !solved) return { status: 'error', error: 'Could not read the CodeChef profile page.' };
    return {
      status: 'ok',
      username: handle,
      contest_rating: rating ? Number(rating) : null,
      star_rating: stars ? Number(stars) : null,
      global_rank: globalRank ? Number(globalRank) : null,
      solved_total: solved ? Number(solved) : null,
      raw: {},
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export const FETCHERS = {
  leetcode: fetchLeetCode,
  github: fetchGitHub,
  codechef: fetchCodeChef,
};

export function profileUrl(platform, username) {
  const h = encodeURIComponent(normaliseHandle(platform, username));
  if (!h) return null;
  return {
    leetcode: `https://leetcode.com/u/${h}/`,
    github: `https://github.com/${h}`,
    codechef: `https://www.codechef.com/users/${h}`,
    hackerrank: `https://www.hackerrank.com/profile/${h}`,
    linkedin: `https://www.linkedin.com/in/${h}`,
  }[platform] ?? null;
}

/**
 * Derives a 0-100 "coding strength" number from whatever platforms are linked.
 * Returns null when there is nothing to score, so the UI can show an empty state
 * rather than a misleading zero.
 */
export function codingStrength(profiles = []) {
  const ok = profiles.filter((p) => p.status === 'ok');
  if (!ok.length) return null;

  const lc = ok.find((p) => p.platform === 'leetcode');
  const cc = ok.find((p) => p.platform === 'codechef');
  const gh = ok.find((p) => p.platform === 'github');

  let score = 0;
  let weight = 0;

  if (lc) {
    weight += 60;
    const solved = lc.solved_total || 0;
    const hard = lc.hard || 0;
    const medium = lc.medium || 0;
    score += Math.min(solved / 400, 1) * 25;                 // volume
    score += Math.min((medium + hard * 2) / 250, 1) * 20;    // difficulty mix
    score += lc.contest_rating ? Math.min(Math.max(lc.contest_rating - 1200, 0) / 900, 1) * 15 : 0;
  }
  if (cc) {
    weight += 20;
    score += cc.contest_rating ? Math.min(Math.max(cc.contest_rating - 1200, 0) / 800, 1) * 20 : 0;
  }
  if (gh) {
    weight += 20;
    score += Math.min((gh.solved_total || 0) / 20, 1) * 12;  // public repos
    score += Math.min((gh.reputation || 0) / 50, 1) * 8;     // followers
  }

  if (!weight) return null;
  return Math.round((score / weight) * 100);
}
