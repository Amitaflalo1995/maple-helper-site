"use strict";
const auth = require("../_lib/auth");

module.exports = function logout(req, res) {
  auth.noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  auth.clearSession(res);
  return res.status(200).json({ ok: true });
};
