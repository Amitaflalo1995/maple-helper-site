/* Admin session: a password from ADMIN_PASSWORD, then a signed, HttpOnly cookie.
   Files under api/_lib are helpers; Vercel does not expose underscore paths as functions. */
"use strict";
const crypto = require("crypto");

const COOKIE = "mh_admin";
const SESSION_SECONDS = 12 * 3600;

/* The signing key changes with the password, so changing ADMIN_PASSWORD signs everyone out. */
function key() {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  const pass = process.env.ADMIN_PASSWORD || "";
  return crypto.createHash("sha256").update("mh-admin\0" + secret + "\0" + pass).digest();
}

function sign(payload) {
  return crypto.createHmac("sha256", key()).update(payload).digest("base64url");
}

function configured() {
  return (process.env.ADMIN_PASSWORD || "").length >= 8;
}

/* Hash both sides first so the comparison takes the same time whatever the lengths. */
function passwordMatches(given) {
  if (!configured() || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function newToken() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return exp + "." + sign(exp);
}

function tokenValid(token) {
  if (!configured() || typeof token !== "string") return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(mac);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

function cookie(value, maxAge) {
  /* Path=/api/admin: the cookie only travels with admin API calls, never with page loads. */
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function setSession(res) {
  res.setHeader("Set-Cookie", cookie(newToken(), SESSION_SECONDS));
}

function clearSession(res) {
  res.setHeader("Set-Cookie", cookie("", 0));
}

function isAdmin(req) {
  return tokenValid(readCookie(req, COOKIE));
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

module.exports = { configured, passwordMatches, setSession, clearSession, isAdmin, noStore };
