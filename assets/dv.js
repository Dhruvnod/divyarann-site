/* Divyarann: the site grows as you read.
   Everything a reader has read, where they stopped, and what has unsealed for them lives on their own device
   (localStorage, key "divyarann-progress"). Nothing is sent anywhere, except reactions and poll votes when that
   service is switched on. Released-but-unread content ships in the page and is sealed here; unreleased content
   never reaches the page at all (the build removes it). */
(function () {
  "use strict";
  var KEY = "divyarann-progress", PREFS = "divyarann-reading";
  var root = document.documentElement;
  var DATA = {};
  try { var dataEl = document.getElementById("dv-data"); if (dataEl) DATA = JSON.parse(dataEl.textContent); } catch (e) {}
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var P = loadJSON(KEY); P.read = P.read || {}; P.pos = P.pos || {}; P.seen = P.seen || {};
  if (!P.v) {  // first visit with this version: carry over the old "last chapter opened" marker
    P.v = 1;
    try { var last = parseInt(localStorage.getItem("divyarann-last"), 10); if (last > 1) for (var i = 1; i < last; i++) P.read[i] = P.read[i] || Date.now(); } catch (e) {}
    saveJSON(KEY, P);
  }
  // ?preview-read=N shows the site as a reader who has read N chapters, without saving anything (for checking pages)
  var PREVIEW = /[?&]preview-read=(\d+)/.exec(location.search);
  if (PREVIEW) { P = { v: 1, read: {}, pos: {}, seen: {} }; for (var pr = 1; pr <= +PREVIEW[1]; pr++) P.read[pr] = 1; saveJSON = function () {}; }
  var prefs = loadJSON(PREFS);
  function savePrefs() { saveJSON(PREFS, prefs); }
  function save() { saveJSON(KEY, P); }
  function fire() { try { window.dispatchEvent(new Event("dv:progress")); } catch (e) {} }

  var DV = window.DV = {
    data: DATA,
    reached: function () { var m = 0; for (var k in P.read) m = Math.max(m, +k); return m; },
    readCount: function () { return Object.keys(P.read).length; },
    isRead: function (n) { return !!P.read[n]; },
    markRead: function (n) { if (P.read[n]) return false; P.read[n] = Date.now(); delete P.pos[n]; save(); fire(); return true; },
    unmarkRead: function (n) { delete P.read[n]; save(); fire(); },
    getPos: function (n) { return P.pos[n] || null; },
    setPos: function (n, p, pct) { P.pos[n] = { p: p, pct: Math.round(pct * 100) / 100, t: Date.now() }; save(); },
    seen: function (id) { return !!P.seen[id]; },
    markSeen: function (id) { P.seen[id] = 1; save(); },
    prefs: prefs, savePrefs: savePrefs
  };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var DEVA = "०१२३४५६७८९";
  function deva(n) { return String(n).replace(/\d/g, function (d) { return DEVA[+d]; }); }
  var WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-One", "Twenty-Two", "Twenty-Three", "Twenty-Four", "Twenty-Five", "Twenty-Six"];

  // ---------- Reveal: sealed until read, unsealed with a moment the first time it is seen ----------
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      var uid = en.target.getAttribute("data-uid");
      if (uid) DV.markSeen(uid);
      if (!reduced) { en.target.classList.add("dv-unsealing"); setTimeout(function () { en.target.classList.remove("dv-unsealing"); }, 2600); }
    });
  }, { threshold: 0.35 }) : null;
  function veilMode(node) {
    if (node.hasAttribute("data-seal")) return node.getAttribute("data-seal");
    return node.matches("section, .section, .frame, .card, .feature, .book, .truth-hero, [data-page], .sealable") ? "veil" : "hide";
  }
  function reveal(scope) {
    var reached = DV.reached();
    (scope || document).querySelectorAll("[data-ch]").forEach(function (node) {
      if (node.closest(".prose, .timeline")) return;
      var ch = parseInt(node.getAttribute("data-ch"), 10); if (!ch) return;
      var mode = veilMode(node), sealed = ch > reached;
      node.classList.toggle("dv-veiled", sealed && mode === "veil");
      node.classList.toggle("dv-hidden", sealed && mode === "hide");
      if (sealed) node.setAttribute("data-unseal", "Read Chapter " + WORDS[ch] + " to unseal this");
      var uid = node.getAttribute("data-uid");
      if (!sealed && uid && !P.seen[uid] && reached > 0 && io) io.observe(node);
    });
  }
  DV.reveal = reveal;

  // ---------- Countdown to the next chapter, and add-to-calendar ----------
  function countdowns() {
    var nodes = document.querySelectorAll("[data-release]");
    if (!nodes.length) return;
    function tick() {
      nodes.forEach(function (n) {
        var t = Date.parse(n.getAttribute("data-release")); if (isNaN(t)) return;
        var ms = t - Date.now(), out;
        if (ms <= 0) out = "Out now";
        else { var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
          out = d > 0 ? d + " day" + (d > 1 ? "s" : "") + ", " + h + " hour" + (h !== 1 ? "s" : "") : h > 0 ? h + " hour" + (h !== 1 ? "s" : "") + ", " + m + " min" : m + " minutes"; }
        var tgt = n.querySelector(".cd-left") || n; tgt.textContent = out;
      });
    }
    tick(); setInterval(tick, 30000);
    document.querySelectorAll("[data-ics]").forEach(function (b) {
      b.addEventListener("click", function () {
        var when = new Date(b.getAttribute("data-ics")), stamp = function (d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); };
        var end = new Date(when.getTime() + 30 * 6e4);
        var ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Divyarann//EN", "BEGIN:VEVENT", "UID:" + stamp(when) + "@divyarann.com", "DTSTAMP:" + stamp(new Date()),
          "DTSTART:" + stamp(when), "DTEND:" + stamp(end), "SUMMARY:" + b.getAttribute("data-title"), "URL:" + b.getAttribute("data-url"), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
        var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "divyarann-next-chapter.ics";
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      });
    });
  }

  // ---------- Home: the timeline knows what you have read; the wheel lives ----------
  function home() {
    var tl = document.querySelector(".timeline"); if (!tl) return;
    var next = null;
    tl.querySelectorAll(".entry[data-n]").forEach(function (li) {
      var n = +li.getAttribute("data-n"), locked = li.classList.contains("is-locked"), read = DV.isRead(n);
      li.classList.toggle("is-read", read);
      li.classList.remove("is-next");
      if (!locked && !read && !next) next = li;
      var go = li.querySelector(".tl-go");
      if (go && !locked) {
        var pos = DV.getPos(n);
        go.textContent = read ? "Read again →" : pos ? "Continue · " + Math.round(pos.pct * 100) + "% read →" : (n === 1 && !DV.reached() ? "Start here →" : "Read chapter " + WORDS[n].toLowerCase() + " →");
      }
    });
    if (next) next.classList.add("is-next");
    var cont = document.getElementById("continue");
    if (cont && next) {
      var nn = +next.getAttribute("data-n"), pos = DV.getPos(nn), a = document.getElementById("continue-link");
      if (DV.reached() || pos) { cont.hidden = false; a.href = "/read/" + nn + "/"; a.textContent = "Chapter " + WORDS[nn] + (pos ? " · " + Math.round(pos.pct * 100) + "% read" : ""); }
    }
    var count = document.getElementById("dv-count");
    if (count) { var rc = DV.readCount(); count.textContent = rc ? "You have read " + rc + " of " + tl.querySelectorAll(".entry:not(.is-locked)").length + "." : ""; }
    // one point of the wheel lights for every chapter read
    var pts = document.querySelectorAll(".wheel .pt"), lit = Math.min(DV.readCount(), pts.length);
    pts.forEach(function (p, i) { p.classList.toggle("lit", i < lit); });
    fire();
  }
  function livingWheel() {
    var wrap = document.querySelector(".hero .wheel-wrap"); if (!wrap || reduced) return;
    var svg = wrap.querySelector("svg.wheel"), tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    function apply() {
      cx += (tx - cx) * 0.1; cy += (ty - cy) * 0.1;
      wrap.style.transform = "perspective(900px) rotateX(" + cy.toFixed(2) + "deg) rotateY(" + cx.toFixed(2) + "deg)";
      if (svg) { svg.style.setProperty("--px", cx.toFixed(2)); svg.style.setProperty("--py", (-cy).toFixed(2)); }  // the rings shift by different amounts
      if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) raf = requestAnimationFrame(apply); else raf = 0;
    }
    function aim(x, y) { tx = x; ty = y; if (!raf) raf = requestAnimationFrame(apply); }
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var r = wrap.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
      aim(Math.max(-1, Math.min(1, dx)) * 12, Math.max(-1, Math.min(1, -dy)) * 10);
    }, { passive: true });

    // phones: the wheel follows the tilt, measured from however the reader is holding the phone
    var base = null;
    function orient(e) {
      if (e.gamma == null || e.beta == null) return;
      if (base === null) base = e.beta;
      base += (e.beta - base) * 0.004;   // slowly re-centre, so a new way of holding the phone becomes the rest position
      var gx = Math.max(-25, Math.min(25, e.gamma)), by = Math.max(-25, Math.min(25, e.beta - base));
      aim(gx / 25 * 14, -by / 25 * 12);
    }
    function listen() { window.addEventListener("deviceorientation", orient); }
    var D = window.DeviceOrientationEvent;
    if (!D) return;
    if (typeof D.requestPermission !== "function") { listen(); return; }   // Android and most browsers: no permission needed
    // iPhone and iPad Safari only send motion after the reader allows it, from a tap
    var touch = ("ontouchstart" in window) || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (!touch) return;
    var state = null; try { state = localStorage.getItem("divyarann-tilt"); } catch (e) {}
    if (state === "denied") return;
    var btn = null;
    function ask() {
      return D.requestPermission().then(function (s) {
        try { localStorage.setItem("divyarann-tilt", s); } catch (e) {}
        if (s === "granted") listen();
        if (btn) { btn.remove(); btn = null; }
      }).catch(function () {});
    }
    if (state === "granted") {   // allowed before: Safari still wants a tap before it sends motion, so the first tap resumes it
      var resume = function () { document.removeEventListener("touchend", resume); ask(); };
      document.addEventListener("touchend", resume, { passive: true });
      return;
    }
    btn = el("button", "dv-tilt", '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.6 6.2c-.9 1.2-.9 2.4 0 3.6M14.4 6.2c.9 1.2.9 2.4 0 3.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>Tilt to move the wheel');
    btn.type = "button";
    btn.addEventListener("click", ask);
    wrap.appendChild(btn);
  }

  // ---------- Contents page: progress per chapter, and marking chapters you read elsewhere ----------
  function contents() {
    var list = document.querySelector(".contents"); if (!list) return;
    list.querySelectorAll("li[data-n]").forEach(function (li) {
      var n = +li.getAttribute("data-n"), meta = li.querySelector(".when");
      var badge = li.querySelector(".dv-state") || el("span", "dv-state"); if (!badge.parentNode && meta) meta.appendChild(badge);
      var btn = li.querySelector(".dv-mark") || el("button", "dv-mark"); btn.type = "button";
      if (!btn.parentNode) li.appendChild(btn);
      function paint() {
        var read = DV.isRead(n), pos = DV.getPos(n);
        li.classList.toggle("is-read", read);
        badge.textContent = read ? " · read" : pos ? " · " + Math.round(pos.pct * 100) + "% read" : "";
        btn.textContent = read ? "Read ✓" : "Mark as read";
        btn.setAttribute("aria-pressed", String(read));
        btn.setAttribute("aria-label", (read ? "Unmark" : "Mark") + " Chapter " + n + " as read");
      }
      btn.onclick = function () { if (DV.isRead(n)) DV.unmarkRead(n); else DV.markRead(n); paint(); };
      paint();
    });
  }

  // ---------- Codex page: the four, the map, and everything you have collected ----------
  function codexPage() {
    var host = document.getElementById("dv-cards"); if (!host) return;
    var reached = DV.reached(), cards = DATA.cards || [], entries = DATA.entries || [], places = DATA.places || [];
    var sum = document.getElementById("dv-codex-sum");
    var openE = entries.filter(function (e) { return e.ch <= reached; }).length;
    if (sum) sum.textContent = reached ? "You have read up to Chapter " + WORDS[reached] + ". " + openE + " of " + entries.length + " entries unsealed so far." : "Read Chapter One and this codex begins to fill.";
    // cards
    var ch = document.getElementById("dv-cards");
    if (ch) {
      ch.innerHTML = "";
      cards.forEach(function (c) {
        var open = c.ch <= reached, card = el("article", "dv-card" + (open ? "" : " is-sealed"));
        if (open) {
          var facts = c.facts.filter(function (f) { return f.ch <= reached; }), more = c.facts.length - facts.length;
          card.setAttribute("data-uid", "card-" + c.id + "-" + facts.length);
          card.innerHTML = '<div class="dv-card-top"><span class="dv-card-sigil" aria-hidden="true">' + esc(c.name.charAt(0)) + '</span><div><h3>' + esc(c.name) + '</h3><p class="dv-card-line">' + esc(c.line) + "</p></div></div>" +
            "<ul>" + facts.map(function (f) { return '<li data-fact-ch="' + f.ch + '">' + esc(f.text) + "</li>"; }).join("") + "</ul>" +
            (more ? '<p class="dv-more">' + more + " more as you read on</p>" : "");
        } else {
          card.innerHTML = '<div class="dv-card-top"><span class="dv-card-sigil" aria-hidden="true">?</span><div><h3>Sealed</h3><p class="dv-card-line">Read Chapter ' + WORDS[c.ch] + " to meet them.</p></div></div>";
        }
        ch.appendChild(card);
        var uid = card.getAttribute("data-uid"); if (open && uid && !P.seen[uid] && reached > 0 && io) io.observe(card);
      });
    }
    // map
    if (window.DV_MAP) window.DV_MAP(document.getElementById("dv-map"), places, reached);
    // entries
    var eh = document.getElementById("dv-entries");
    if (eh) {
      eh.innerHTML = "";
      [["person", "People"], ["place", "Places"], ["thing", "Things"], ["sign", "Signs"]].forEach(function (k) {
        var group = entries.filter(function (e) { return e.kind === k[0]; }); if (!group.length) return;
        var sec = el("section", "dv-group"), h = el("h3", null, esc(k[1])); sec.appendChild(h);
        var grid = el("div", "dv-grid");
        group.forEach(function (e) {
          var open = e.ch <= reached, t = el("div", "dv-entry" + (open ? "" : " is-sealed"));
          if (open) {
            t.setAttribute("data-uid", "entry-" + e.id);
            t.innerHTML = '<span class="dv-entry-ch">Ch ' + e.ch + "</span><h4>" + esc(e.name) + (e.deva ? ' <span class="deva">' + esc(e.deva) + "</span>" : "") + "</h4><p>" + esc(e.text) + "</p>";
            if (!P.seen["entry-" + e.id] && io) io.observe(t);
          } else t.innerHTML = '<span class="dv-entry-ch">Ch ' + e.ch + '</span><h4>Sealed</h4><p>Read Chapter ' + WORDS[e.ch] + " to unseal.</p>";
          grid.appendChild(t);
        });
        sec.appendChild(grid); eh.appendChild(sec);
      });
    }
  }

  // ---------- Chapter pages ----------
  function reader() {
    var n = parseInt(document.body.getAttribute("data-chapter"), 10); if (!n) return;
    var prose = document.querySelector(".prose"); if (!prose) return;
    var paras = Array.prototype.slice.call(prose.querySelectorAll("p"));
    try { localStorage.setItem("divyarann-last", String(n)); } catch (e) {}

    // settings: theme, spacing, font, word help
    var panel = document.getElementById("dv-settings"), toggle = document.getElementById("dv-settings-btn");
    function setAttr(name, val, on) { if (on) root.setAttribute(name, val); else root.removeAttribute(name); }
    function paintSettings() {
      if (!panel) return;
      panel.querySelectorAll("[data-set]").forEach(function (b) {
        var k = b.getAttribute("data-set"), v = b.getAttribute("data-val");
        var cur = k === "words" ? (prefs.words ? "on" : "off") : (prefs[k] || b.parentNode.getAttribute("data-default"));
        b.setAttribute("aria-pressed", String(cur === v));
      });
    }
    if (panel && toggle) {
      toggle.addEventListener("click", function () { var open = panel.hidden; panel.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) paintSettings(); });
      panel.addEventListener("click", function (e) {
        var b = e.target.closest("[data-set]"); if (!b) return;
        var k = b.getAttribute("data-set"), v = b.getAttribute("data-val");
        if (k === "words") { prefs.words = v === "on"; setAttr("data-words", "on", prefs.words); }
        else { var def = b.parentNode.getAttribute("data-default"); prefs[k] = v; setAttr("data-read-" + k, v, v !== def); }
        savePrefs(); paintSettings(); window.dispatchEvent(new Event("resize"));
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } });
    }

    // word help: glossary popovers, only when switched on
    var gloss = {}; (DATA.glossary || []).forEach(function (g) { gloss[g.id] = g; });
    var pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    prose.addEventListener("click", function (e) {
      var w = e.target.closest(".w"); if (!w || !prefs.words) return;
      var g = gloss[w.getAttribute("data-g")]; if (!g) return;
      var same = pop && pop.__for === w; closePop(); if (same) return;
      pop = el("span", "dv-pop", "<b>" + esc(g.term) + "</b>" + esc(g.def)); pop.setAttribute("role", "note"); pop.__for = w;
      w.appendChild(pop);
      var r = pop.getBoundingClientRect(), shift = 0;   // keep the note on screen
      if (r.right > window.innerWidth - 10) shift = window.innerWidth - 10 - r.right;
      if (r.left + shift < 10) shift = 10 - r.left;
      if (shift) pop.style.left = shift + "px";
    });
    prose.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("w") && prefs.words) { e.preventDefault(); e.target.click(); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePop(); });
    function wordsTabbable() { prose.querySelectorAll(".w").forEach(function (w) { w.tabIndex = prefs.words ? 0 : -1; w.setAttribute("role", prefs.words ? "button" : "presentation"); }); }
    wordsTabbable(); window.addEventListener("resize", wordsTabbable);

    // resume where you stopped
    var pos = DV.getPos(n), resumeBar = document.getElementById("dv-resume");
    if (pos && pos.p > 2 && pos.pct < 0.97 && resumeBar && paras[pos.p]) {
      resumeBar.hidden = false;
      resumeBar.querySelector(".dv-resume-pct").textContent = Math.round(pos.pct * 100) + "%";
      resumeBar.querySelector("button").addEventListener("click", function () { paras[pos.p].scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); resumeBar.hidden = true; });
      resumeBar.querySelector(".dv-resume-x").addEventListener("click", function () { resumeBar.hidden = true; });
    }
    var posTimer = 0;
    window.addEventListener("scroll", function () {
      clearTimeout(posTimer);
      posTimer = setTimeout(function () {
        if (DV.isRead(n)) return;
        var top = window.innerHeight * 0.25, idx = 0;
        for (var i = 0; i < paras.length; i++) { if (paras[i].getBoundingClientRect().top > top) break; idx = i; }
        var r = prose.getBoundingClientRect(), pct = Math.max(0, Math.min(1, (top - r.top) / r.height));
        if (idx > 0) DV.setPos(n, idx, pct);
      }, 400);
    }, { passive: true });

    // finishing the chapter: it counts as read, and the codex gains what it introduced
    var endNode = document.getElementById("nodeEnd"), unlock = document.getElementById("dv-unlock"), done = false;
    function finish() {
      if (done) return; done = true;
      var fresh = DV.markRead(n);
      if (unlock) showUnlock(fresh);
      if (fresh) { var t = el("div", "dv-toast", "Chapter " + WORDS[n] + " read. The site has grown a little."); document.body.appendChild(t); setTimeout(function () { t.classList.add("out"); }, 3600); setTimeout(function () { t.remove(); }, 4400); }
    }
    if (DV.isRead(n) && unlock) showUnlock(false);
    var endWatch = document.querySelector(".chapter-nav");
    if (endWatch && "IntersectionObserver" in window) {
      var seenAt = 0;
      new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { seenAt = seenAt || Date.now(); setTimeout(function () { if (seenAt) finish(); }, 800); } else seenAt = 0; }); }, { threshold: 0.6 }).observe(endWatch);
    }
    function showUnlock(animate) {
      var items = DATA.codex || [];
      if (!items.length) return;
      unlock.hidden = false;
      var grid = unlock.querySelector(".dv-unlock-grid"); grid.innerHTML = "";
      items.forEach(function (e, i) {
        var c = el("div", "dv-entry" + (animate && !reduced ? " flip" : ""), '<span class="dv-entry-ch">' + esc({ person: "Person", place: "Place", thing: "Thing", sign: "Sign" }[e.kind] || "") + "</span><h4>" + esc(e.name) + (e.deva ? ' <span class="deva">' + esc(e.deva) + "</span>" : "") + "</h4><p>" + esc(e.text) + "</p>");
        c.style.animationDelay = (i * 0.16) + "s"; grid.appendChild(c);
      });
      unlock.querySelector(".dv-unlock-h").textContent = animate ? items.length + " entr" + (items.length === 1 ? "y" : "ies") + " added to your codex" : "In your codex from this chapter";
    }

    // listen: the device reads the chapter aloud, paragraph by paragraph
    var lb = document.getElementById("dv-listen");
    if (lb) {
      if (!("speechSynthesis" in window)) lb.hidden = true;
      else {
        var playing = false, idx = 0, voice = null;
        function pickVoice() {
          var vs = speechSynthesis.getVoices(); if (!vs.length) return null;
          return vs.filter(function (v) { return /en[-_]IN/i.test(v.lang); })[0] || vs.filter(function (v) { return /en[-_]GB/i.test(v.lang); })[0] || vs.filter(function (v) { return /^en/i.test(v.lang); })[0] || vs[0];
        }
        speechSynthesis.onvoiceschanged = function () { voice = pickVoice(); };
        // sentences without regex lookbehind, which older iPhones (Safari before 16.4) cannot parse
        function chunks(text) { var out = [], cur = "", parts = text.match(/[^.!?…]+(?:[.!?…]+["”’]?|$)\s*/g) || [text]; parts.forEach(function (s) { s = s.trim(); if (!s) return; if ((cur + " " + s).length > 220 && cur) { out.push(cur); cur = s; } else cur = cur ? cur + " " + s : s; }); if (cur) out.push(cur); return out; }
        function clearMark() { paras.forEach(function (p) { p.classList.remove("dv-speaking"); }); }
        function say(i) {
          if (!playing || i >= paras.length) { stop(); if (i >= paras.length) finish(); return; }
          idx = i; clearMark(); paras[i].classList.add("dv-speaking");
          var r = paras[i].getBoundingClientRect(); if (r.top < 80 || r.bottom > window.innerHeight - 40) paras[i].scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
          var parts = chunks(paras[i].innerText.replace(/\s+/g, " ").trim()), k = 0;
          (function next() {
            if (!playing) return;
            if (k >= parts.length) { say(i + 1); return; }
            var u = new SpeechSynthesisUtterance(parts[k++]); u.voice = voice || pickVoice(); u.lang = (u.voice && u.voice.lang) || "en-IN"; u.rate = prefs.rate || 0.95;
            u.onend = next; u.onerror = function () { if (playing) next(); };
            speechSynthesis.speak(u);
          })();
        }
        function start() {
          var top = window.innerHeight * 0.2; idx = 0;
          for (var i = 0; i < paras.length; i++) { if (paras[i].getBoundingClientRect().bottom > top) { idx = i; break; } }
          playing = true; lb.setAttribute("aria-pressed", "true"); lb.querySelector(".lbl").textContent = "Stop";
          speechSynthesis.cancel(); say(idx);
        }
        function stop() { playing = false; speechSynthesis.cancel(); clearMark(); lb.setAttribute("aria-pressed", "false"); lb.querySelector(".lbl").textContent = "Listen"; }
        lb.addEventListener("click", function () { if (playing) stop(); else start(); });
        window.addEventListener("pagehide", stop);
      }
    }

    // sound: a quiet room for the chapter, made in the browser (no recordings)
    var sb = document.getElementById("dv-sound"), vol = document.getElementById("dv-volume");
    if (sb) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !DATA.sound) sb.hidden = true;
      else {
        var amb = null;
        function on() { amb = amb || new Ambience(new AC(), DATA.sound); amb.start(prefs.volume == null ? 0.5 : prefs.volume); sb.setAttribute("aria-pressed", "true"); sb.querySelector(".lbl").textContent = "Sound on"; if (vol) vol.hidden = false; }
        function off() { if (amb) amb.stop(); sb.setAttribute("aria-pressed", "false"); sb.querySelector(".lbl").textContent = "Sound"; if (vol) vol.hidden = true; }
        sb.addEventListener("click", function () { if (sb.getAttribute("aria-pressed") === "true") off(); else on(); });
        if (vol) { vol.value = Math.round((prefs.volume == null ? 0.5 : prefs.volume) * 100); vol.addEventListener("input", function () { prefs.volume = vol.value / 100; savePrefs(); if (amb) amb.level(prefs.volume); }); }
        document.addEventListener("visibilitychange", function () { if (amb && amb.ctx) { if (document.hidden) amb.ctx.suspend(); else if (sb.getAttribute("aria-pressed") === "true") amb.ctx.resume(); } });
      }
    }

    // reactions and the poll (only when the service is switched on)
    reactions(n);
  }

  // ---------- Ambience: procedural sound beds ----------
  function Ambience(ctx, recipe) { this.ctx = ctx; this.recipe = recipe; this.nodes = []; this.timers = []; }
  Ambience.prototype.noise = function (kind) {
    var ctx = this.ctx, len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0, b = [0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === "pink") { b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852; b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898; d[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11; b[6] = w * 0.115926; }
      else d[i] = w;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start(); this.nodes.push(src); return src;
  };
  Ambience.prototype.chain = function (src, list, gain) {
    var ctx = this.ctx, node = src;
    list.forEach(function (f) { var bq = ctx.createBiquadFilter(); bq.type = f[0]; bq.frequency.value = f[1]; if (f[2]) bq.Q.value = f[2]; node.connect(bq); node = bq; });
    var g = ctx.createGain(); g.gain.value = gain; node.connect(g); g.connect(this.out); this.nodes.push(g); return g;
  };
  Ambience.prototype.every = function (min, max, fn) { var self = this; (function loop() { var t = setTimeout(function () { if (!self.running) return; fn(); loop(); }, (min + Math.random() * (max - min)) * 1000); self.timers.push(t); })(); };
  Ambience.prototype.tone = function (freq, dur, gain, type, pan) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null, t = ctx.currentTime;
    o.type = type || "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.05, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(this.out); } else g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05); return o;
  };
  Ambience.prototype.layer = function (L) {
    var self = this, ctx = this.ctx, v = L.gain == null ? 1 : L.gain;
    switch (L.type) {
      case "fan": {
        var g = this.chain(this.noise("brown"), [["lowpass", 420]], 0.5 * v);
        var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = L.speed || 3.4; lg.gain.value = 0.18 * v; lfo.connect(lg); lg.connect(g.gain); lfo.start(); this.nodes.push(lfo);
        var hum = ctx.createOscillator(), hg = ctx.createGain(); hum.frequency.value = 100; hg.gain.value = 0.012 * v; hum.connect(hg); hg.connect(this.out); hum.start(); this.nodes.push(hum);
        break; }
      case "traffic": {
        var tg = this.chain(this.noise("brown"), [["lowpass", 650]], 0.45 * v);
        this.every(2, 5, function () { tg.gain.setTargetAtTime((0.25 + Math.random() * 0.35) * v, ctx.currentTime, 1.2); });
        if (L.horns !== false) this.every(7, 18, function () { var f = 380 + Math.random() * 180, pan = Math.random() * 1.6 - 0.8, d = 0.18 + Math.random() * 0.4; self.tone(f, d, 0.018 * v, "sawtooth", pan); self.tone(f * 1.26, d, 0.012 * v, "sawtooth", pan); });
        break; }
      case "hvac": { this.chain(this.noise("brown"), [["lowpass", 260]], 0.55 * v); var h2 = ctx.createOscillator(), g2 = ctx.createGain(); h2.frequency.value = 120; g2.gain.value = 0.008 * v; h2.connect(g2); g2.connect(this.out); h2.start(); this.nodes.push(h2); break; }
      case "rain": {
        this.chain(this.noise("pink"), [["highpass", 700], ["lowpass", 6500]], 0.32 * v);
        this.every(0.03, 0.14, function () { self.tone(1800 + Math.random() * 3200, 0.03, 0.012 * v * Math.random(), "triangle", Math.random() * 1.8 - 0.9); });
        break; }
      case "crickets": this.every(0.4, 1.6, function () { var pan = Math.random() * 1.6 - 0.8, f = 4100 + Math.random() * 500; for (var k = 0; k < 3; k++) (function (k) { setTimeout(function () { if (self.running) self.tone(f, 0.03, 0.01 * v, "sine", pan); }, k * 55); })(k); }); break;
      case "clock": { var tickTock = 0; this.every(1, 1, function () { self.tone(tickTock++ % 2 ? 2400 : 2000, 0.025, 0.02 * v, "square", 0.3); }); break; }
      case "murmur": { var mg = this.chain(this.noise("pink"), [["bandpass", 520, 0.8]], 0.22 * v); this.every(1.5, 3.5, function () { mg.gain.setTargetAtTime((0.12 + Math.random() * 0.16) * v, ctx.currentTime, 0.8); }); this.every(5, 12, function () { self.tone(2600 + Math.random() * 900, 0.08, 0.006 * v, "sine", Math.random() - 0.5); }); break; }
      case "wind": { var wg = this.chain(this.noise("pink"), [["bandpass", 380, 0.5]], 0.3 * v); this.every(2, 6, function () { wg.gain.setTargetAtTime((0.15 + Math.random() * 0.3) * v, ctx.currentTime, 1.5); }); break; }
      case "pulse": this.every(L.every || 16, (L.every || 16) * 1.5, function () { var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.9); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1); o.connect(g); g.connect(self.out); o.start(t); o.stop(t + 1.2); }); break;
    }
  };
  Ambience.prototype.start = function (level) {
    if (this.running) return;
    var ctx = this.ctx; if (ctx.state === "suspended") ctx.resume();
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(ctx.destination);
    this.running = true; this.nodes = []; this.timers = [];
    var self = this; (this.recipe.layers || []).forEach(function (L) { self.layer(L); });
    this.out.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
  };
  Ambience.prototype.level = function (v) { if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); };
  Ambience.prototype.stop = function () {
    if (!this.running) return; this.running = false;
    var self = this, out = this.out, ctx = this.ctx; out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    this.timers.forEach(clearTimeout);
    setTimeout(function () { self.nodes.forEach(function (n) { try { n.stop && n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); out.disconnect(); }, 1800);
  };

  // ---------- Reactions and "what happens next?" ----------
  function reactions(n) {
    var api = DATA.reactions_api, box = document.getElementById("dv-react");
    if (!api || !box) return;
    box.hidden = false;
    var mine = loadJSON("divyarann-votes");
    function call(path, body) { return fetch(api + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function paint(counts) {
      box.querySelectorAll("[data-r]").forEach(function (b) {
        var k = b.getAttribute("data-r"), c = counts && counts.reactions ? counts.reactions[k] || 0 : 0;
        b.querySelector(".n").textContent = c ? String(c) : "";
        b.setAttribute("aria-pressed", String(mine["r" + n] === k));
      });
    }
    call("/counts?ch=" + n).then(paint);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-r]"); if (!b || mine["r" + n]) return;
      var k = b.getAttribute("data-r"); mine["r" + n] = k; saveJSON("divyarann-votes", mine);
      call("/react", { ch: n, r: k }).then(paint);
    });
    var poll = DATA.poll, ph = document.getElementById("dv-poll");
    if (!poll || !ph) return;
    ph.hidden = false; ph.querySelector(".dv-poll-q").textContent = poll.q;
    var opts = ph.querySelector(".dv-poll-opts");
    function showResults(res) {
      // results show once you have read the next chapter, whenever that is
      var canSee = DV.isRead(n + 1), total = 0; poll.options.forEach(function (o, i) { total += (res && res.votes && res.votes[i]) || 0; });
      opts.innerHTML = "";
      poll.options.forEach(function (o, i) {
        var b = el("button", "dv-poll-opt"); b.type = "button"; b.setAttribute("data-i", i);
        var v = (res && res.votes && res.votes[i]) || 0, pct = total ? Math.round(v / total * 100) : 0;
        b.innerHTML = "<span>" + esc(o) + "</span>" + (mine["p" + n] != null && canSee ? '<span class="pct">' + pct + "%</span><i style=\"width:" + pct + '%"></i>' : "");
        b.setAttribute("aria-pressed", String(mine["p" + n] === i)); b.disabled = mine["p" + n] != null;
        opts.appendChild(b);
      });
      ph.querySelector(".dv-poll-note").textContent = mine["p" + n] == null ? "Vote, then read on. The results open once you have read Chapter " + WORDS[n + 1] + "." : canSee ? total + " vote" + (total === 1 ? "" : "s") + "." : "Thanks. The results open once you have read Chapter " + WORDS[n + 1] + ".";
    }
    call("/poll?ch=" + n).then(showResults);
    opts.addEventListener("click", function (e) {
      var b = e.target.closest("[data-i]"); if (!b || mine["p" + n] != null) return;
      var i = +b.getAttribute("data-i"); mine["p" + n] = i; saveJSON("divyarann-votes", mine);
      call("/vote", { ch: n, i: i }).then(showResults);
    });
  }

  // ---------- Start ----------
  function init() {
    reveal(); home(); livingWheel(); contents(); codexPage(); reader(); countdowns();
    window.addEventListener("hashchange", function () { setTimeout(reveal, 0); });
    window.addEventListener("dv:progress", function () { reveal(); });
  }
  // deferred scripts run before DOMContentLoaded; waiting for it lets dv-map.js (also deferred) arrive first
  if (document.readyState === "complete") init(); else document.addEventListener("DOMContentLoaded", init);
})();
