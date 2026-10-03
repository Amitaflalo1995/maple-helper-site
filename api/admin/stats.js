"use strict";
const auth = require("../_lib/auth");
const sources = require("../_lib/sources");

/* One snapshot per function instance for a minute: the dashboard refreshes itself and
   several managers may have it open, but GitHub (60 calls/hour without a token) and
   PostHog's query API shouldn't be hit on every request. */
const TTL_MS = 60 * 1000;
const MIN_FORCE_MS = 10 * 1000;
let cache = null;

async function settle(name, fn) {
  try {
    return await fn();
  } catch (e) {
    return { configured: true, error: e.message || String(e) };
  }
}

async function snapshot() {
  const [github, uptime, posthog, vercel] = await Promise.all([
    settle("github", sources.github),
    settle("uptime", sources.uptime),
    settle("posthog", sources.posthog),
    settle("vercel", sources.vercel),
  ]);
  return { generatedAt: new Date().toISOString(), github, uptime, posthog, vercel };
}

module.exports = async function stats(req, res) {
  auth.noStore(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!auth.isAdmin(req)) {
    return res.status(401).json({
      error: "unauthorized", configured: auth.configured(), reason: auth.setupProblem(), env: process.env.VERCEL_ENV || "local",
    });
  }

  const age = cache ? Date.now() - cache.at : Infinity;
  const force = req.query && req.query.fresh === "1" && age > MIN_FORCE_MS;
  if (!cache || age > TTL_MS || force) {
    cache = { at: Date.now(), data: await snapshot() };
  }
  return res.status(200).json(cache.data);
};
