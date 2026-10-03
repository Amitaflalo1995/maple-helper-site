"use strict";
const auth = require("../_lib/auth");

/* Best-effort brute-force brake, kept in this function instance's memory: failures per
   client, plus a cap on failures from everyone together so guessing spread over many
   addresses still stalls. Instances are reused (Fluid Compute) but not shared, so also add
   a Vercel Firewall rate-limit rule on /api/admin/login for a hard limit.
   Neither limit applies to a known device (a browser that signed in correctly before, see
   auth.isKnownDevice), so an attacker tripping the cap can't lock the real managers out. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;            // per client
const MAX_FAILS_TOTAL = 40;     // all clients together, per window
const MAX_TRACKED = 5000;
const fails = new Map();
let total = { first: 0, count: 0 };

/* Vercel sets both headers itself, so a client can't spoof them. An IPv6 client usually
   owns a whole /64, so it counts as one client. */
function clientKey(req) {
  const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (!ip) return "?";
  if (ip.includes(":") && !ip.startsWith("::ffff:")) {
    const full = ip.includes("::")
      ? ip.replace("::", ":" + "0:".repeat(8 - ip.split(":").filter(Boolean).length)).replace(/^:|:$/g, "")
      : ip;
    return full.split(":").slice(0, 4).join(":") + "::/64";
  }
  return ip;
}

const expired = (f, now) => now - f.first > WINDOW_MS;

function blocked(key) {
  const now = Date.now();
  if (expired(total, now)) total = { first: now, count: 0 };
  if (total.count >= MAX_FAILS_TOTAL) return true;
  const f = fails.get(key);
  if (!f) return false;
  if (expired(f, now)) { fails.delete(key); return false; }
  return f.count >= MAX_FAILS;
}

function recordFail(key) {
  const now = Date.now();
  total.count += 1;
  const f = fails.get(key);
  if (!f || expired(f, now)) fails.set(key, { first: now, count: 1 });
  else f.count += 1;
  /* Never wipe the table (that would reset an attacker's own count): drop expired entries only. */
  if (fails.size > MAX_TRACKED) {
    for (const [k, v] of fails) if (expired(v, now)) fails.delete(k);
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function login(req, res) {
  auth.noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  /* A JSON body can't be sent by a plain cross-site form, which closes the login-CSRF door. */
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
    return res.status(415).json({ error: "content-type" });
  }
  if (!auth.configured()) return res.status(503).json({ error: "not-configured" });

  const key = clientKey(req);
  const known = auth.isKnownDevice(req);
  if (!known && blocked(key)) return res.status(429).json({ error: "too-many-attempts" });

  const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
  if (!auth.passwordMatches(password)) {
    if (!known) recordFail(key);
    await pause(600);
    return res.status(401).json({ error: "wrong-password" });
  }
  fails.delete(key);
  auth.setSession(res);
  return res.status(200).json({ ok: true });
};
