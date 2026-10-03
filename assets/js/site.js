/* Maple Helper website: progressive enhancement only. Everything works without this file. */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  /* ---------- which computer is this? ---------- */
  function detectOS() {
    var ua = navigator.userAgent || "";
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/android|iphone|ipad|ipod/i.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return "mobile";
    if (/win/i.test(platform) || /Windows/.test(ua)) return "windows";
    if (/mac/i.test(platform) || /Mac OS X/.test(ua)) return "mac";
    return "other";
  }
  var os = detectOS();
  if (os === "mobile") root.classList.add("is-mobile");

  /* The page ships with Windows as the primary button. On a Mac, swap the emphasis and order. */
  if (os === "mac") {
    document.querySelectorAll(".dl").forEach(function (group) {
      var win = group.querySelector("[data-os=windows]");
      var mac = group.querySelector("[data-os=mac]");
      if (!win || !mac) return;
      win.classList.add("secondary");
      mac.classList.remove("secondary");
      group.insertBefore(mac, win);
    });
  }

  /* The header's Download button downloads right away (it used to scroll to the hero, which at the top of the
     page did nothing visible): the Windows installer, the Mac app on a Mac, and on a phone the hero instead. */
  document.querySelectorAll("a.nav-dl").forEach(function (a) {
    if (os === "mac") a.href = a.href.replace("MapleHelper-Setup.exe", "MapleHelper-macOS.dmg");
    else if (os === "mobile") a.href = "#download";
  });

  /* ---------- install tabs (Windows / macOS) ---------- */
  document.querySelectorAll(".tabs").forEach(function (box) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll("[role=tab]"));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var rtl = getComputedStyle(box).direction === "rtl";
        var next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, Home: -i, End: tabs.length - 1 - i }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(tabs[(i + next + tabs.length) % tabs.length], true);
      });
    });
    if (os === "mac") {
      var macTab = box.querySelector("[data-os=mac]");
      if (macTab) select(macTab, false);
    }
  });

  /* ---------- latest version number (nice to have; silent on failure) ----------
     Cached for an hour per browser so repeat visits don't spend the GitHub API's 60/hour limit. */
  var slot = document.querySelectorAll("[data-version]");
  function showVersion(v) {
    slot.forEach(function (el) {
      el.querySelector("bdi").textContent = v;
      el.hidden = false;
    });
  }
  if (slot.length) {
    var KEY = "mh-latest-version", cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { cached = null; }
    if (cached && cached.v && Date.now() - cached.t < 3600 * 1000) {
      showVersion(cached.v);
    } else if (window.fetch) {
      fetch("https://api.github.com/repos/Maple-Helper/maple-helper/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rel) {
          if (!rel || !rel.tag_name) return;
          var v = String(rel.tag_name).replace(/^v/, "");
          showVersion(v);
          try { localStorage.setItem(KEY, JSON.stringify({ v: v, t: Date.now() })); } catch (e) { /* storage blocked */ }
        })
        .catch(function () {});
    }
  }

  /* ---------- anonymous visit counts (for the site's own admin dashboard) ----------
     No cookies, no third-party script: a random per-tab id, sent to our /api/collect.
     Skipped with Do Not Track / Global Privacy Control, and on local previews. */
  (function () {
    var dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
    if (dnt || !navigator.sendBeacon || !/(^|\.)maplehelper\.app$|\.vercel\.app$/.test(location.hostname)) return;
    var sid = null;
    try {
      sid = sessionStorage.getItem("mh-sid");
      if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("mh-sid", sid); }
    } catch (e) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); }
    function send(e, extra) {
      var body = { e: e, sid: sid, p: location.pathname, lang: root.lang, os: os };
      for (var k in extra) body[k] = extra[k];
      try { navigator.sendBeacon("/api/collect", new Blob([JSON.stringify(body)], { type: "text/plain" })); } catch (err) { /* ignore */ }
    }
    send("pageview", { ref: document.referrer || "" });
    /* "still here" once a minute while the tab is visible, for at most 30 minutes */
    var beats = 0;
    var timer = setInterval(function () {
      if (document.visibilityState !== "visible") return;
      if (++beats > 30) { clearInterval(timer); return; }
      send("heartbeat");
    }, 60 * 1000);
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a[href*='/releases/latest/download/']");
      if (!a) return;
      send("download", { target: /\.dmg$/.test(a.href) ? "mac" : /\.exe$/.test(a.href) ? "windows" : "other" });
    });
  })();

  /* ---------- gentle reveal on scroll ---------- */
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = document.querySelectorAll(".reveal");
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
})();
