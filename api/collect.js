/* Anonymous site stats for the admin dashboard: page views, a once-a-minute "still here"
   ping (for the online-now count) and download clicks, forwarded to PostHog.

   Off until POSTHOG_PROJECT_KEY is set. No cookies: the id is random per browser tab
   (sessionStorage). The visitor's IP is not forwarded and PostHog's GeoIP is disabled;
   the country comes from Vercel's x-vercel-ip-country header. */
"use strict";

const EVENTS = new Set(["pageview", "heartbeat", "download"]);
const BOTS = /bot|crawl|spider|slurp|preview|lighthouse|headless|curl|wget|python|monitor/i;
const HOST = (process.env.POSTHOG_INGEST_HOST || "https://eu.i.posthog.com").replace(/\/$/, "");

const short = (v, n = 64) => (typeof v === "string" ? v.slice(0, n) : undefined);

function parse(body) {
  if (body && typeof body === "object") return body;
  try { return JSON.parse(body || "{}"); } catch (e) { return {}; }
}

module.exports = async function collect(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(204);
  const key = process.env.POSTHOG_PROJECT_KEY;
  if (req.method !== "POST" || !key) return res.end();
  if (BOTS.test(String(req.headers["user-agent"] || ""))) return res.end();

  const b = parse(req.body);
  if (!EVENTS.has(b.e) || typeof b.sid !== "string" || !/^[a-z0-9]{8,40}$/.test(b.sid)) return res.end();

  let refHost;
  try { refHost = b.ref ? new URL(b.ref).hostname.replace(/^www\./, "") : "(direct)"; } catch (e) { refHost = "(unknown)"; }
  if (refHost === "maplehelper.app") refHost = "(internal)";

  const event = {
    api_key: key,
    event: "site_" + b.e,
    distinct_id: "web-" + b.sid,
    properties: {
      page: short(b.p, 120),
      lang: short(b.lang, 8),
      os: short(b.os, 16),
      target: short(b.target, 16),
      ref_host: b.e === "pageview" ? refHost : undefined,
      country: short(String(req.headers["x-vercel-ip-country"] || ""), 4) || undefined,
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: "maplehelper-site",
    },
  };

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    await fetch(`${HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: ctl.signal,
    }).finally(() => clearTimeout(t));
  } catch (e) {
    /* stats are best-effort: a failed forward is dropped */
  }
  return res.end();
};
