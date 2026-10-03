/* Maple Helper admin dashboard. Talks only to /api/admin/*; the session is an HttpOnly cookie. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var REFRESH_MS = 60 * 1000;
  var data = null;
  var timer = null;
  var nf = new Intl.NumberFormat("en");
  var compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  /* ---------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return n == null ? "–" : n >= 100000 ? compact.format(n) : nf.format(n); }
  function ago(t) {
    if (!t) return "–";
    var s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function dateShort(d) {
    return new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" });
  }
  function hourShort(d) {
    return new Date(d).toLocaleString("en", { weekday: "short", hour: "numeric" });
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "–"; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    });
  }

  function tile(label, value, sub, cls) {
    var na = value == null || value === "–";
    return '<div class="tile ' + (cls || "") + '"><div class="label">' + esc(label) + '</div>' +
      '<div class="value' + (na ? " na" : "") + '">' + (na ? "–" : esc(value)) + "</div>" +
      (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function empty(html) { return '<p class="empty">' + html + "</p>"; }

  /* ---------------------------------------------------------------- tooltip */

  var tip = $("tip");
  function showTip(ev, title, rows) {
    tip.innerHTML = '<div class="t">' + esc(title) + "</div>" + rows.map(function (r) {
      return '<div class="r"><span>' + (r.color ? '<i style="background:' + r.color + '"></i>' : "") + esc(r.name) +
        "</span><b>" + esc(fmt(r.value)) + "</b></div>";
    }).join("");
    tip.hidden = false;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  /* ---------------------------------------------------------------- charts
     series: [{ name, color: "--s1", values: [...] }], labels: [...] (x categories) */

  var NS = "http://www.w3.org/2000/svg";
  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function frame(el, labels, maxVal, fmtLabel) {
    var W = Math.max(280, el.clientWidth), H = 210;
    var m = { t: 10, r: 8, b: 26, l: 40 };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    var max = niceMax(maxVal || 1);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var g = svgEl("g", { class: "grid" }, svg);
    for (var i = 0; i <= 4; i++) {
      var y = m.t + ih - (ih * i) / 4;
      if (i > 0) svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y }, g);
      var t = svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, svg);
      t.textContent = compact.format((max * i) / 4);
    }
    svgEl("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, svg);
    /* x labels: as many as fit without colliding */
    var every = Math.max(1, Math.ceil(labels.length / Math.floor(iw / 64)));
    var band = iw / labels.length;
    labels.forEach(function (lab, j) {
      if (j % every) return;
      var t = svgEl("text", { x: m.l + band * j + band / 2, y: H - 8, "text-anchor": "middle" }, svg);
      t.textContent = fmtLabel ? fmtLabel(lab) : lab;
    });
    return { svg: svg, W: W, H: H, m: m, iw: iw, ih: ih, max: max, band: band };
  }

  function legend(series) {
    if (series.length < 2) return "";
    return '<div class="legend">' + series.map(function (s) {
      return '<span style="--c:var(' + s.color + ')">' + esc(s.name) + "</span>";
    }).join("") + "</div>";
  }

  function lineChart(el, labels, series, fmtLabel) {
    var max = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { max = Math.max(max, v); }); });
    var f = frame(el, labels, max, fmtLabel);
    var x = function (j) { return f.m.l + f.band * j + f.band / 2; };
    var y = function (v) { return f.m.t + f.ih - (f.ih * v) / f.max; };
    series.forEach(function (s) {
      var d = s.values.map(function (v, j) { return (j ? "L" : "M") + x(j).toFixed(1) + " " + y(v).toFixed(1); }).join("");
      svgEl("path", { d: d, class: "line", stroke: "var(" + s.color + ")" }, f.svg);
      var last = s.values.length - 1;
      if (last >= 0) svgEl("circle", { cx: x(last), cy: y(s.values[last]), r: 4, class: "dot", fill: "var(" + s.color + ")" }, f.svg);
    });
    var cross = svgEl("line", { class: "cross", y1: f.m.t, y2: f.m.t + f.ih, visibility: "hidden" }, f.svg);
    var dots = series.map(function (s) { return svgEl("circle", { r: 4, class: "dot", fill: "var(" + s.color + ")", visibility: "hidden" }, f.svg); });
    var hit = svgEl("rect", { class: "hit", x: f.m.l, y: f.m.t, width: f.iw, height: f.ih }, f.svg);
    function move(ev) {
      var r = f.svg.getBoundingClientRect();
      var px = ((ev.clientX - r.left) / r.width) * f.W;
      var j = Math.min(labels.length - 1, Math.max(0, Math.floor((px - f.m.l) / f.band)));
      cross.setAttribute("x1", x(j)); cross.setAttribute("x2", x(j)); cross.setAttribute("visibility", "visible");
      dots.forEach(function (d, i) {
        d.setAttribute("cx", x(j)); d.setAttribute("cy", y(series[i].values[j])); d.setAttribute("visibility", "visible");
      });
      showTip(ev, fmtLabel ? fmtLabel(labels[j]) : labels[j], series.map(function (s) {
        return { name: s.name, value: s.values[j], color: css(s.color) };
      }));
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", function () {
      hideTip(); cross.setAttribute("visibility", "hidden");
      dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); });
    });
    el.innerHTML = legend(series);
    el.appendChild(f.svg);
  }

  function columnChart(el, labels, series, fmtLabel) {
    var totals = labels.map(function (_, j) { return series.reduce(function (a, s) { return a + s.values[j]; }, 0); });
    var f = frame(el, labels, Math.max.apply(null, totals.concat([0])), fmtLabel);
    var bw = Math.min(24, f.band * 0.7);
    labels.forEach(function (lab, j) {
      var x = f.m.l + f.band * j + (f.band - bw) / 2;
      var base = f.m.t + f.ih;
      var segs = series.filter(function (s) { return s.values[j] > 0; });
      var g = svgEl("g", { class: "bar" }, f.svg);
      segs.forEach(function (s, k) {
        var h = (f.ih * s.values[j]) / f.max;
        var top = k === segs.length - 1;
        var gap = k > 0 ? 2 : 0;   // 2px surface gap between stacked segments
        var y = base - h;
        var hh = Math.max(0, h - gap);
        if (top && hh > 4) {
          var r = 4;
          svgEl("path", {
            d: "M" + x + " " + (y + hh) + "V" + (y + r) + "Q" + x + " " + y + " " + (x + r) + " " + y +
               "H" + (x + bw - r) + "Q" + (x + bw) + " " + y + " " + (x + bw) + " " + (y + r) + "V" + (y + hh) + "Z",
            fill: "var(" + s.color + ")",
          }, g);
        } else {
          svgEl("rect", { x: x, y: y, width: bw, height: hh, fill: "var(" + s.color + ")" }, g);
        }
        base = y;
      });
      /* hit target: the whole column band, taller than the mark */
      var hit = svgEl("rect", { class: "hit", x: f.m.l + f.band * j, y: f.m.t, width: f.band, height: f.ih }, f.svg);
      hit.addEventListener("pointermove", function (ev) {
        g.classList.add("on");
        var rows = series.map(function (s) { return { name: s.name, value: s.values[j], color: css(s.color) }; });
        if (series.length > 1) rows.push({ name: "Total", value: totals[j] });
        showTip(ev, fmtLabel ? fmtLabel(lab) : lab, rows);
      });
      hit.addEventListener("pointerleave", function () { g.classList.remove("on"); hideTip(); });
    });
    el.innerHTML = legend(series);
    el.appendChild(f.svg);
  }

  /* A chart card with a "Show table" toggle, so no number is only readable from the drawing. */
  var charts = [];
  function chartCard(container, title, sub, kind, labels, series, fmtLabel) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="card-head"><h3>' + esc(title) + "</h3>" +
      '<span class="muted small">' + esc(sub || "") + ' <button class="link" type="button">Show table</button></span></div>' +
      '<div class="chart"></div>';
    container.appendChild(card);
    var el = card.querySelector(".chart");
    var btn = card.querySelector("button");
    var spec = { el: el, kind: kind, labels: labels, series: series, fmtLabel: fmtLabel, table: false };
    btn.addEventListener("click", function () {
      spec.table = !spec.table;
      btn.textContent = spec.table ? "Show chart" : "Show table";
      draw(spec);
    });
    charts.push(spec);
    draw(spec);
  }
  function draw(spec) {
    if (spec.table) {
      spec.el.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th></th>' +
        spec.series.map(function (s) { return '<th class="num">' + esc(s.name) + "</th>"; }).join("") +
        "</tr></thead><tbody>" + spec.labels.map(function (l, j) {
          return "<tr><td>" + esc(spec.fmtLabel ? spec.fmtLabel(l) : l) + "</td>" +
            spec.series.map(function (s) { return '<td class="num">' + fmt(s.values[j]) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
      return;
    }
    if (!spec.labels.length) { spec.el.innerHTML = empty("No data yet."); return; }
    (spec.kind === "line" ? lineChart : columnChart)(spec.el, spec.labels, spec.series, spec.fmtLabel);
  }
  var resizeT = null;
  addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { charts.forEach(function (c) { if (!c.table) draw(c); }); }, 150);
  });

  function ranked(title, items, sub) {
    var html = '<div class="card"><div class="card-head"><h3>' + esc(title) + "</h3>" +
      (sub ? '<span class="muted small">' + esc(sub) + "</span>" : "") + "</div>";
    if (!items || !items.length) return html + empty("No data yet.") + "</div>";
    var max = items[0].count || 1;
    return html + '<ul class="bars">' + items.map(function (it) {
      return '<li><span class="name" title="' + esc(it.value) + '">' + esc(it.value) + '</span><span class="n">' + fmt(it.count) +
        '</span><span class="track"><span class="fill" style="display:block;width:' + ((it.count / max) * 100).toFixed(1) + '%"></span></span></li>';
    }).join("") + "</ul></div>";
  }

  /* fill gaps so a day with no events shows as 0, not as a skipped point */
  function lastDays(rows, n, key) {
    var map = {};
    rows.forEach(function (r) { map[r[key]] = r; });
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push(map[d] || { day: d });
    }
    return out;
  }
  var val = function (rows, k) { return rows.map(function (r) { return r[k] || 0; }); };

  /* ---------------------------------------------------------------- sections */

  function setupHint(what) {
    return {
      github: "Set <code>GITHUB_TOKEN</code> (a fine-grained token with read access to the repository's Administration or Traffic) to see repository views, clones and referrers, and to lift the 60 calls/hour limit.",
      posthog: "Set <code>POSTHOG_PERSONAL_API_KEY</code> (scope: query:read) and <code>POSTHOG_PROJECT_ID</code> in Vercel to read app and site stats. EU cloud is the default; set <code>POSTHOG_HOST</code> for US.",
      site: "Set <code>POSTHOG_PROJECT_KEY</code> (the project's phc_ key) in Vercel to start counting site visits. Nothing is recorded until then.",
      app: "The app sends stats only when a player turns them on, and only once <code>PROJECT_KEY</code> is filled in <code>maplehelper/telemetry.py</code> and that version is released.",
      vercel: "Set <code>VERCEL_API_TOKEN</code> and <code>VERCEL_PROJECT</code> (project id or name; add <code>VERCEL_TEAM_ID</code> for a team project) to list deployments.",
    }[what];
  }

  function renderNotices(d) {
    var out = [];
    ["github", "uptime", "posthog", "vercel"].forEach(function (k) {
      var s = d[k];
      if (s && s.error) out.push('<div class="notice err"><b>' + esc(k) + ":</b> " + esc(s.error) + "</div>");
    });
    if (d.posthog && d.posthog.errors && d.posthog.errors.length) {
      out.push('<div class="notice err"><b>PostHog:</b> some queries failed: ' + esc(d.posthog.errors.join("; ")) + "</div>");
    }
    $("notices").innerHTML = out.join("");
  }

  function renderNow(d) {
    var ph = d.posthog || {}, s = ph.summary || {}, gh = d.github || {};
    var t = gh.totals || {};
    var latest = (gh.releases || []).find(function (r) { return !r.prerelease; });
    var latestDl = latest ? latest.counts.windows + latest.counts.mac + latest.counts.portable : null;
    $("now-tiles").innerHTML = [
      tile("Visitors online", ph.configured && ph.siteKeySet ? fmt(s.siteOnline) : null, "on the site, last 5 minutes", "live"),
      tile("App in use", ph.configured ? fmt(s.appActive15m) : null, "installs active, last 15 minutes", "live"),
      tile("Total downloads", gh.totals ? fmt(t.windows + t.mac + t.portable) : null, "installer, DMG and portable"),
      tile("Latest release", latest ? latest.tag : null, latest ? ago(latest.published) + " · " + fmt(latestDl) + " downloads" : ""),
    ].join("");
  }

  function renderDownloads(d) {
    var gh = d.github || {};
    var host = $("dl-chart-host");
    host.innerHTML = "";
    charts = charts.filter(function (c) { return document.body.contains(c.el); });
    if (!gh.totals) { $("dl-tiles").innerHTML = ""; host.innerHTML = '<div class="card">' + empty("GitHub data unavailable.") + "</div>"; return; }
    var t = gh.totals;
    $("dl-tiles").innerHTML = [
      tile("Windows installer", fmt(t.windows), "MapleHelper-Setup.exe"),
      tile("macOS", fmt(t.mac), "MapleHelper-macOS.dmg"),
      tile("Portable", fmt(t.portable), "Windows zip"),
      tile("Update checks", fmt(t.updateChecks), "SHA256SUMS.txt"),
      tile("Game-data checks", fmt(t.kbChecks), "kb-manifest.json"),
      tile("Game-data downloads", fmt(t.kbDownloads), "kb.zip"),
    ].join("");
    var rel = gh.releases.slice(0, 24).reverse();
    chartCard(host, "Downloads per release", rel.length + " most recent releases", "column",
      rel.map(function (r) { return r.tag; }),
      [
        { name: "Windows", color: "--s1", values: rel.map(function (r) { return r.counts.windows; }) },
        { name: "macOS", color: "--s2", values: rel.map(function (r) { return r.counts.mac; }) },
        { name: "Portable", color: "--s3", values: rel.map(function (r) { return r.counts.portable; }) },
      ]);
    chartCard(host, "Installs checking in, per release", "game-data and update checks", "column",
      rel.map(function (r) { return r.tag; }),
      [
        { name: "Game-data checks", color: "--s1", values: rel.map(function (r) { return r.counts.kbChecks; }) },
        { name: "Update checks", color: "--s2", values: rel.map(function (r) { return r.counts.updateChecks; }) },
      ]);
  }

  function renderApp(d) {
    var box = $("app-body"), ph = d.posthog || {};
    box.innerHTML = "";
    if (!ph.configured) { box.innerHTML = '<div class="card">' + empty(setupHint("posthog")) + empty(setupHint("app")) + "</div>"; return; }
    var s = ph.summary || {};
    if (!s.appMau) box.insertAdjacentHTML("beforeend", '<div class="notice">No app events in the last 30 days. ' + setupHint("app") + "</div>");
    box.insertAdjacentHTML("beforeend", '<div class="tiles">' + [
      tile("Active today", fmt(s.appDau), "installs, last 24 h"),
      tile("Active this week", fmt(s.appWau), "installs, last 7 days"),
      tile("Active this month", fmt(s.appMau), "installs, last 30 days"),
      tile("Questions today", fmt(s.questions24h), "last 24 h"),
      tile("Questions", fmt(s.questions30d), pct(s.questionsWithScreenshot30d, s.questions30d) + " with a screenshot"),
      tile("Voice questions", fmt(s.voice30d), "last 30 days"),
      tile("New installs", fmt(s.freshInstalls30d), "first start, opted in"),
      tile("App updates", fmt(s.appUpdates30d), "first start on a new version"),
    ].join("") + "</div>");
    var grid = document.createElement("div");
    grid.className = "grid2";
    box.appendChild(grid);
    var days = lastDays(ph.daily || [], 30, "day");
    var labels = days.map(function (r) { return r.day; });
    chartCard(grid, "Active installs per day", "", "line", labels,
      [{ name: "Active installs", color: "--s1", values: val(days, "appUsers") }], dateShort);
    chartCard(grid, "Questions per day", "", "column", labels,
      [{ name: "Questions", color: "--s1", values: val(days, "questions") }], dateShort);
    var b = ph.breakdowns || {};
    box.insertAdjacentHTML("beforeend", '<div class="grid3">' +
      ranked("Who answered", b.answered_by, "instant = local answer, no AI") +
      ranked("App versions", b.app_version, "active installs, last 7 days") +
      ranked("Operating system", b.app_os, "installs") +
      ranked("App language", b.app_language, "installs") +
      ranked("AI provider setting", b.app_provider, "installs") +
      "</div>");
  }

  function renderSite(d) {
    var box = $("site-body"), ph = d.posthog || {};
    box.innerHTML = "";
    if (!ph.configured) { box.innerHTML = '<div class="card">' + empty(setupHint("posthog")) + empty(setupHint("site")) + "</div>"; return; }
    if (!ph.siteKeySet) box.insertAdjacentHTML("beforeend", '<div class="notice">' + setupHint("site") + "</div>");
    var s = ph.summary || {};
    box.insertAdjacentHTML("beforeend", '<div class="tiles">' + [
      tile("Visitors today", fmt(s.siteVisitors24h), "last 24 h"),
      tile("Page views today", fmt(s.pageviews24h), "last 24 h"),
      tile("Visitors", fmt(s.siteVisitors30d), "last 30 days"),
      tile("Page views", fmt(s.pageviews30d), "last 30 days"),
      tile("Download clicks today", fmt(s.siteDownloads24h), "last 24 h"),
      tile("Download clicks", fmt(s.siteDownloads30d), pct(s.siteDownloads30d, s.siteVisitors30d) + " of visitors"),
    ].join("") + "</div>");
    var grid = document.createElement("div");
    grid.className = "grid2";
    box.appendChild(grid);
    var hours = [];
    var hmap = {};
    (ph.hourly || []).forEach(function (r) { hmap[new Date(r.hour).getTime()] = r; });
    var h0 = new Date(); h0.setMinutes(0, 0, 0);
    for (var i = 47; i >= 0; i--) {
      var t = h0.getTime() - i * 3600000;
      hours.push(hmap[t] || { hour: new Date(t).toISOString() });
    }
    chartCard(grid, "Visitors per hour", "last 48 hours", "line", hours.map(function (r) { return r.hour; }),
      [{ name: "Site visitors", color: "--s1", values: val(hours, "siteVisitors") },
       { name: "App installs active", color: "--s2", values: val(hours, "appUsers") }], hourShort);
    var days = lastDays(ph.daily || [], 30, "day");
    chartCard(grid, "Visitors and download clicks per day", "", "line", days.map(function (r) { return r.day; }),
      [{ name: "Visitors", color: "--s1", values: val(days, "visitors") },
       { name: "Download clicks", color: "--s2", values: val(days, "downloads") }], dateShort);
    var b = ph.breakdowns || {};
    box.insertAdjacentHTML("beforeend", '<div class="grid3">' +
      ranked("Countries", b.site_country, "visitors") +
      ranked("Referrers", b.site_referrer, "page views") +
      ranked("Pages", b.site_page, "page views") +
      ranked("Visitor devices", b.site_visitor_os, "visitors") +
      ranked("Download clicks by platform", b.site_download_os, "clicks") +
      "</div>");
  }

  function renderGithub(d) {
    var gh = d.github || {};
    var box = $("gh-traffic");
    box.innerHTML = "";
    if (!gh.configured || gh.error) { $("gh-tiles").innerHTML = ""; return; }
    var rl = gh.rateLimit;
    $("gh-tiles").innerHTML = [
      tile("Stars", fmt(gh.stars)),
      tile("Forks", fmt(gh.forks)),
      tile("Watchers", fmt(gh.watchers)),
      tile("Open issues and PRs", fmt(gh.openIssues)),
      tile("Last push", ago(gh.pushedAt), gh.repo),
      tile("GitHub API calls left", rl ? fmt(rl.remaining) : null, rl ? "of " + fmt(rl.limit) + " this hour" + (gh.tokenUsed ? "" : " (no token)") : ""),
    ].join("");
    var tr = gh.traffic;
    if (!tr) { box.innerHTML = '<div class="card">' + empty(setupHint("github")) + "</div>"; return; }
    var grid = document.createElement("div");
    grid.className = "grid2";
    box.appendChild(grid);
    var v = (tr.views && tr.views.daily) || [];
    chartCard(grid, "Repository page views", tr.views ? fmt(tr.views.count) + " views, " + fmt(tr.views.uniques) + " unique, 14 days" : "", "line",
      v.map(function (x) { return x.timestamp; }),
      [{ name: "Views", color: "--s1", values: v.map(function (x) { return x.count; }) },
       { name: "Unique visitors", color: "--s2", values: v.map(function (x) { return x.uniques; }) }], dateShort);
    var c = (tr.clones && tr.clones.daily) || [];
    chartCard(grid, "Repository clones", tr.clones ? fmt(tr.clones.count) + " clones, 14 days" : "", "column",
      c.map(function (x) { return x.timestamp; }),
      [{ name: "Clones", color: "--s1", values: c.map(function (x) { return x.count; }) }], dateShort);
    box.insertAdjacentHTML("beforeend", '<div class="grid2">' +
      ranked("Repository referrers", (tr.referrers || []).map(function (r) { return { value: r.referrer, count: r.count }; }), "views, 14 days") +
      ranked("Popular repository pages", (tr.paths || []).map(function (p) { return { value: p.path, count: p.count }; }), "views, 14 days") +
      "</div>");
  }

  function pill(state) {
    var s = String(state || "").toLowerCase();
    var cls = /^(ok|ready|success|completed)$/.test(s) ? "good"
      : /^(error|failure|failed|canceled|cancelled|timed_out|down)$/.test(s) ? "bad" : "warn";
    return '<span class="pill ' + cls + '">' + esc(state || "unknown") + "</span>";
  }

  function renderMonitoring(d) {
    var up = d.uptime || {};
    $("uptime").innerHTML = up.checks ? '<div class="tbl-wrap"><table><thead><tr><th>Check</th><th>Status</th><th class="num">Response</th></tr></thead><tbody>' +
      up.checks.map(function (c) {
        return '<tr><td><a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.name) + "</a></td><td>" +
          pill(c.ok ? "ok" : "down") + ' <span class="muted small">' + esc(c.status || c.error || "") + '</span></td><td class="num">' + fmt(c.ms) + " ms</td></tr>";
      }).join("") + "</tbody></table></div>" : empty("Unavailable.");

    var runs = (d.github && d.github.workflowRuns) || null;
    $("runs").innerHTML = runs && runs.length ? '<div class="tbl-wrap"><table><thead><tr><th>Workflow</th><th>Result</th><th>Branch</th><th>When</th></tr></thead><tbody>' +
      runs.map(function (r) {
        return '<tr><td class="wrap-cell"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a><div class="muted small">' + esc(r.title) +
          "</div></td><td>" + pill(r.conclusion || r.status) + "</td><td>" + esc(r.branch) + "</td><td>" + ago(r.created) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : empty("No workflow runs visible.");

    var v = d.vercel || {};
    var rt = v.runtime || {};
    var runtime = '<p class="muted small" style="margin:10px 0 0">This dashboard: ' + esc(rt.env || "?") +
      (rt.region ? " · region " + esc(rt.region) : "") + (rt.commit ? " · commit " + esc(rt.commit) : "") + " · Node " + esc(rt.node || "") + "</p>";
    if (!v.configured) { $("deploys").innerHTML = empty(setupHint("vercel")) + runtime; return; }
    if (v.error) { $("deploys").innerHTML = empty(esc(v.error)) + runtime; return; }
    $("deploys").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Deployment</th><th>State</th><th>Target</th><th>Branch</th><th class="num">Build</th><th>When</th></tr></thead><tbody>' +
      v.deployments.map(function (x) {
        var build = x.ready && x.created ? Math.round((x.ready - x.created) / 1000) + " s" : "–";
        return '<tr><td class="wrap-cell"><a href="' + esc(x.inspector || "https://" + x.url) + '" target="_blank" rel="noopener">' + esc(x.message || x.url) +
          '</a><div class="muted small">' + esc(x.sha || x.url) + "</div></td><td>" + pill(x.state) + "</td><td>" + esc(x.target) + "</td><td>" + esc(x.branch || "") +
          '</td><td class="num">' + build + "</td><td>" + ago(x.created) + "</td></tr>";
      }).join("") + "</tbody></table></div>" + runtime;
  }

  var EVENT_NAMES = {
    app_started: "App started", app_updated: "App updated", question_asked: "Question asked", voice_used: "Voice question",
    site_pageview: "Site visit", site_download: "Download click",
  };
  function renderFeed(d) {
    var ph = d.posthog || {};
    if (!ph.configured) { $("feed").innerHTML = empty("Needs PostHog (see above)."); return; }
    var rows = ph.recent || [];
    if (!rows.length) { $("feed").innerHTML = empty("Nothing in the last 24 hours."); return; }
    var clean = function (v) { return v && v !== "null" ? v : ""; };
    $("feed").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Event</th><th>Install / visitor</th><th>Details</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var det = [clean(r.version) && "v" + r.version, clean(r.os), clean(r.answeredBy) && "answered by " + r.answeredBy,
          clean(r.page), clean(r.target), clean(r.country)].filter(Boolean).join(" · ");
        return "<tr><td>" + ago(r.at) + "</td><td>" + esc(EVENT_NAMES[r.event] || r.event) + '</td><td><code>' + esc(r.who) + "</code></td><td>" + esc(det) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function render(d) {
    data = d;
    charts = [];
    renderNotices(d);
    renderNow(d);
    renderDownloads(d);
    renderApp(d);
    renderSite(d);
    renderGithub(d);
    renderMonitoring(d);
    renderFeed(d);
    /* charts measured their width while their grid was still filling in: draw again at final size */
    charts.forEach(function (c) { if (!c.table) draw(c); });
    $("updated").textContent = "Updated " + new Date(d.generatedAt).toLocaleTimeString();
  }

  /* ---------------------------------------------------------------- flow */

  function showLogin(msg) {
    clearInterval(timer);
    $("app").hidden = true;
    $("login").hidden = false;
    var err = $("login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
    $("password").focus();
  }

  function load(force) {
    var btn = $("refresh");
    btn.disabled = true;
    return api("/api/admin/stats" + (force ? "?fresh=1" : "")).then(function (r) {
      btn.disabled = false;
      if (r.status === 401) {
        return showLogin(r.body.configured === false ? "Admin sign-in isn't set up: add ADMIN_PASSWORD (12+ characters) in Vercel and redeploy." : "");
      }
      if (r.status !== 200) { $("updated").textContent = "Refresh failed (" + r.status + ")"; return; }
      $("login").hidden = true;
      $("app").hidden = false;
      render(r.body);
      schedule();
    }).catch(function () {
      btn.disabled = false;
      $("updated").textContent = "Offline? Refresh failed.";
    });
  }

  function schedule() {
    clearInterval(timer);
    if ($("auto").checked) timer = setInterval(function () { if (document.visibilityState === "visible") load(false); }, REFRESH_MS);
  }

  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var b = ev.submitter || this.querySelector("button");
    b.disabled = true;
    api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    }).then(function (r) {
      b.disabled = false;
      if (r.status === 200) { $("password").value = ""; return load(false); }
      showLogin({
        "wrong-password": "Wrong password.",
        "too-many-attempts": "Too many attempts. Try again in 15 minutes.",
        "not-configured": "Admin sign-in isn't set up: add ADMIN_PASSWORD (12+ characters) in Vercel and redeploy.",
      }[r.body.error] || "Sign-in failed (" + r.status + ").");
    }).catch(function () { b.disabled = false; showLogin("Network error."); });
  });

  $("refresh").addEventListener("click", function () { load(true); });
  $("auto").addEventListener("change", schedule);
  $("logout").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).then(function () { showLogin(""); });
  });

  load(false);
})();
