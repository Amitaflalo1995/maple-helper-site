"use strict";
const auth = require("../_lib/auth");

/* Best-effort brute-force brake: failures per IP, kept in this function instance's memory.
   Instances are reused (Fluid Compute) but not shared, so also add a Vercel Firewall
   rate-limit rule on /api/admin/login for a hard limit. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map();

function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
}

function blocked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { fails.delete(ip); return false; }
  return f.count >= MAX_FAILS;
}

function recordFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) fails.set(ip, { first: Date.now(), count: 1 });
  else f.count += 1;
  if (fails.size > 5000) fails.clear();
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

  const ip = clientIp(req);
  if (blocked(ip)) return res.status(429).json({ error: "too-many-attempts" });

  const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
  if (!auth.passwordMatches(password)) {
    recordFail(ip);
    await pause(600);
    return res.status(401).json({ error: "wrong-password" });
  }
  fails.delete(ip);
  auth.setSession(res);
  return res.status(200).json({ ok: true });
};
