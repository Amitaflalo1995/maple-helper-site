/* Where the admin dashboard's numbers come from. Each source returns
   { configured: false } when its env vars are missing, or { error } when the call fails,
   so one broken source never blanks the whole dashboard. */
"use strict";

const REPO = process.env.GITHUB_REPO || "Maple-Helper/maple-helper";
const SITE = (process.env.SITE_URL || "https://www.maplehelper.app").replace(/\/$/, "");

async function fetchWithTimeout(url, opts = {}, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, headers) {
  const r = await fetchWithTimeout(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(url).pathname}`);
  return r.json();
}

/* A failed sub-request becomes null instead of rejecting the whole source. */
const soft = (p) => p.catch(() => null);

/* ---------------------------------------------------------------- GitHub */

/* What each release asset's download_count actually measures. */
function assetKind(name) {
  if (name === "MapleHelper-Setup.exe") return "windows";          // site downloads + Windows in-app updates
  if (name.endsWith(".dmg")) return "mac";
  if (/portable\.zip$/.test(name)) return "portable";
  if (name === "kb-manifest.json") return "kbChecks";              // running apps checking for game-data updates
  if (name === "kb.zip") return "kbDownloads";                     // apps that then pulled new game data
  if (name === "SHA256SUMS.txt") return "updateChecks";            // Windows apps verifying an app update
  return "other";
}

async function github() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "maplehelper-admin", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const api = `https://api.github.com/repos/${REPO}`;
  const traffic = !!process.env.GITHUB_TOKEN;   // the traffic API needs push access

  const [repo, releases, runs, views, clones, referrers, paths, rate] = await Promise.all([
    getJson(api, headers),
    getJson(`${api}/releases?per_page=50`, headers),
    soft(getJson(`${api}/actions/runs?per_page=8`, headers)),
    traffic ? soft(getJson(`${api}/traffic/views`, headers)) : null,
    traffic ? soft(getJson(`${api}/traffic/clones`, headers)) : null,
    traffic ? soft(getJson(`${api}/traffic/popular/referrers`, headers)) : null,
    traffic ? soft(getJson(`${api}/traffic/popular/paths`, headers)) : null,
    soft(getJson("https://api.github.com/rate_limit", headers)),
  ]);

  const totals = { windows: 0, mac: 0, portable: 0, kbChecks: 0, kbDownloads: 0, updateChecks: 0, other: 0 };
  const rel = releases
    .filter((r) => !r.draft)
    .map((r) => {
      const counts = { windows: 0, mac: 0, portable: 0, kbChecks: 0, kbDownloads: 0, updateChecks: 0, other: 0 };
      for (const a of r.assets || []) {
        const k = assetKind(a.name);
        counts[k] += a.download_count;
        totals[k] += a.download_count;
      }
      return { tag: r.tag_name, name: r.name, published: r.published_at, prerelease: r.prerelease, url: r.html_url, counts };
    });

  return {
    configured: true,
    repo: REPO,
    tokenUsed: !!process.env.GITHUB_TOKEN,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    openIssues: repo.open_issues_count,
    pushedAt: repo.pushed_at,
    totals,
    releases: rel,
    workflowRuns: runs && runs.workflow_runs
      ? runs.workflow_runs.map((w) => ({
          name: w.name, branch: w.head_branch, event: w.event, status: w.status,
          conclusion: w.conclusion, created: w.created_at, url: w.html_url, title: w.display_title,
        }))
      : null,
    traffic: traffic
      ? {
          views: views && { count: views.count, uniques: views.uniques, daily: views.views },
          clones: clones && { count: clones.count, uniques: clones.uniques, daily: clones.clones },
          referrers,
          paths,
        }
      : null,
    rateLimit: rate && rate.resources && rate.resources.core
      ? { remaining: rate.resources.core.remaining, limit: rate.resources.core.limit, reset: rate.resources.core.reset }
      : null,
  };
}

/* ---------------------------------------------------------------- uptime checks */

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "maplehelper-admin" } }, 8000);
    return { name, url, ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { name, url, ok: false, status: 0, ms: Date.now() - t0, error: e.name === "AbortError" ? "timeout" : e.message };
  }
}

async function uptime() {
  const dl = `https://github.com/${REPO}/releases/latest/download`;
  const checks = await Promise.all([
    probe("Site (English)", `${SITE}/`),
    probe("Site (Hebrew)", `${SITE}/he/`),
    probe("Windows installer", `${dl}/MapleHelper-Setup.exe`),
    probe("macOS DMG", `${dl}/MapleHelper-macOS.dmg`),
    probe("Game-data manifest", `${dl}/kb-manifest.json`),
    probe("Checksums", `${dl}/SHA256SUMS.txt`),
  ]);
  return { configured: true, checks };
}

/* ---------------------------------------------------------------- PostHog */

/* App events come from maplehelper/telemetry.py (opt-in); site events from /api/collect. */
const APP_EVENTS = "('app_started', 'app_updated', 'question_asked', 'voice_used')";
/* Source runs of the app (frozen = false) are development, not players. */
const NOT_DEV = "coalesce(toString(properties.frozen), '') != 'false'";
const SCOPE = `(startsWith(event, 'site_') OR (event IN ${APP_EVENTS} AND ${NOT_DEV}))`;
const isApp = `event IN ${APP_EVENTS}`;
const isSite = "startsWith(event, 'site_')";
const truthy = (p) => `toString(properties.${p}) IN ('true', '1')`;

const QUERIES = {
  summary: `
    SELECT
      uniqIf(distinct_id, ${isSite} AND timestamp > now() - INTERVAL 5 MINUTE),
      uniqIf(distinct_id, ${isApp} AND timestamp > now() - INTERVAL 15 MINUTE),
      uniqIf(distinct_id, ${isApp} AND timestamp > now() - INTERVAL 1 DAY),
      uniqIf(distinct_id, ${isApp} AND timestamp > now() - INTERVAL 7 DAY),
      uniqIf(distinct_id, ${isApp}),
      countIf(event = 'question_asked' AND timestamp > now() - INTERVAL 1 DAY),
      countIf(event = 'question_asked'),
      countIf(event = 'question_asked' AND ${truthy("screenshot")}),
      countIf(event = 'voice_used'),
      countIf(event = 'app_started' AND ${truthy("fresh_install")}),
      countIf(event = 'app_updated'),
      uniqIf(distinct_id, event = 'site_pageview' AND timestamp > now() - INTERVAL 1 DAY),
      countIf(event = 'site_pageview' AND timestamp > now() - INTERVAL 1 DAY),
      uniqIf(distinct_id, event = 'site_pageview'),
      countIf(event = 'site_pageview'),
      countIf(event = 'site_download' AND timestamp > now() - INTERVAL 1 DAY),
      countIf(event = 'site_download')
    FROM events
    WHERE timestamp > now() - INTERVAL 30 DAY AND ${SCOPE}`,
  daily: `
    SELECT toDate(timestamp) AS day,
      uniqIf(distinct_id, ${isApp}),
      countIf(event = 'question_asked'),
      countIf(event = 'app_started' AND ${truthy("fresh_install")}),
      uniqIf(distinct_id, event = 'site_pageview'),
      countIf(event = 'site_download')
    FROM events
    WHERE timestamp > now() - INTERVAL 30 DAY AND ${SCOPE}
    GROUP BY day ORDER BY day`,
  hourly: `
    SELECT toStartOfHour(timestamp) AS hour,
      uniqIf(distinct_id, ${isSite}),
      uniqIf(distinct_id, ${isApp})
    FROM events
    WHERE timestamp > now() - INTERVAL 48 HOUR AND ${SCOPE}
    GROUP BY hour ORDER BY hour`,
  breakdowns: `
    SELECT 'answered_by', toString(properties.answered_by) AS v, count() FROM events
      WHERE event = 'question_asked' AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_DEV} GROUP BY v
    UNION ALL SELECT 'app_version', toString(properties.app_version) AS v, uniq(distinct_id) FROM events
      WHERE ${isApp} AND timestamp > now() - INTERVAL 7 DAY AND ${NOT_DEV} GROUP BY v
    UNION ALL SELECT 'app_os', toString(properties.$os) AS v, uniq(distinct_id) FROM events
      WHERE ${isApp} AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_DEV} GROUP BY v
    UNION ALL SELECT 'app_language', toString(properties.language) AS v, uniq(distinct_id) FROM events
      WHERE event = 'app_started' AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_DEV} GROUP BY v
    UNION ALL SELECT 'app_provider', toString(properties.provider) AS v, uniq(distinct_id) FROM events
      WHERE event = 'app_started' AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_DEV} GROUP BY v
    UNION ALL SELECT 'site_country', toString(properties.country) AS v, uniq(distinct_id) FROM events
      WHERE event = 'site_pageview' AND timestamp > now() - INTERVAL 30 DAY GROUP BY v
    UNION ALL SELECT 'site_referrer', toString(properties.ref_host) AS v, count() FROM events
      WHERE event = 'site_pageview' AND timestamp > now() - INTERVAL 30 DAY GROUP BY v
    UNION ALL SELECT 'site_page', toString(properties.page) AS v, count() FROM events
      WHERE event = 'site_pageview' AND timestamp > now() - INTERVAL 30 DAY GROUP BY v
    UNION ALL SELECT 'site_visitor_os', toString(properties.os) AS v, uniq(distinct_id) FROM events
      WHERE event = 'site_pageview' AND timestamp > now() - INTERVAL 30 DAY GROUP BY v
    UNION ALL SELECT 'site_download_os', toString(properties.target) AS v, count() FROM events
      WHERE event = 'site_download' AND timestamp > now() - INTERVAL 30 DAY GROUP BY v`,
  recent: `
    SELECT timestamp, event, substring(distinct_id, 1, 6),
      toString(properties.app_version), toString(properties.$os), toString(properties.answered_by),
      toString(properties.country), toString(properties.page), toString(properties.target)
    FROM events
    WHERE timestamp > now() - INTERVAL 1 DAY AND event != 'site_heartbeat' AND ${SCOPE}
    ORDER BY timestamp DESC LIMIT 30`,
};

async function hogql(host, project, key, query) {
  const r = await fetchWithTimeout(`${host}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "maplehelper-admin" }),
  }, 15000);
  if (!r.ok) throw new Error(`PostHog ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).results || [];
}

const num = (v) => Number(v) || 0;

async function posthog() {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  if (!key || !project) return { configured: false };
  const host = (process.env.POSTHOG_HOST || "https://eu.posthog.com").replace(/\/$/, "");

  const names = Object.keys(QUERIES);
  const settled = await Promise.allSettled(names.map((n) => hogql(host, project, key, QUERIES[n])));
  const res = {};
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") res[names[i]] = s.value;
    else errors.push(`${names[i]}: ${s.reason.message}`);
  });
  if (!Object.keys(res).length) throw new Error(errors[0] || "PostHog returned nothing");

  const s = (res.summary && res.summary[0]) || [];
  const breakdowns = {};
  for (const [dim, value, count] of res.breakdowns || []) {
    (breakdowns[dim] = breakdowns[dim] || []).push({ value: value || "(unknown)", count: num(count) });
  }
  for (const k in breakdowns) breakdowns[k].sort((a, b) => b.count - a.count).splice(12);

  return {
    configured: true,
    errors,
    siteKeySet: !!process.env.POSTHOG_PROJECT_KEY,
    summary: res.summary ? {
      siteOnline: num(s[0]), appActive15m: num(s[1]), appDau: num(s[2]), appWau: num(s[3]), appMau: num(s[4]),
      questions24h: num(s[5]), questions30d: num(s[6]), questionsWithScreenshot30d: num(s[7]),
      voice30d: num(s[8]), freshInstalls30d: num(s[9]), appUpdates30d: num(s[10]),
      siteVisitors24h: num(s[11]), pageviews24h: num(s[12]), siteVisitors30d: num(s[13]), pageviews30d: num(s[14]),
      siteDownloads24h: num(s[15]), siteDownloads30d: num(s[16]),
    } : null,
    daily: (res.daily || []).map((r) => ({
      day: String(r[0]).slice(0, 10), appUsers: num(r[1]), questions: num(r[2]), installs: num(r[3]),
      visitors: num(r[4]), downloads: num(r[5]),
    })),
    hourly: (res.hourly || []).map((r) => ({ hour: r[0], siteVisitors: num(r[1]), appUsers: num(r[2]) })),
    breakdowns,
    recent: (res.recent || []).map((r) => ({
      at: r[0], event: r[1], who: r[2], version: r[3], os: r[4], answeredBy: r[5], country: r[6], page: r[7], target: r[8],
    })),
  };
}

/* ---------------------------------------------------------------- Vercel */

async function vercel() {
  const token = process.env.VERCEL_API_TOKEN;
  const project = process.env.VERCEL_PROJECT;
  const runtime = {
    env: process.env.VERCEL_ENV || "local",
    region: process.env.VERCEL_REGION || "",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7),
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || "",
    node: process.version,
  };
  if (!token || !project) return { configured: false, runtime };

  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const data = await getJson(
    `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(project)}&limit=12${team}`,
    { Authorization: `Bearer ${token}` },
  );
  return {
    configured: true,
    runtime,
    deployments: (data.deployments || []).map((d) => ({
      url: d.url, state: d.state || d.readyState, target: d.target || "preview", created: d.created,
      ready: d.ready || null, branch: d.meta && d.meta.githubCommitRef,
      message: d.meta && d.meta.githubCommitMessage, sha: d.meta && (d.meta.githubCommitSha || "").slice(0, 7),
      inspector: d.inspectorUrl,
    })),
  };
}

module.exports = { github, uptime, posthog, vercel };
