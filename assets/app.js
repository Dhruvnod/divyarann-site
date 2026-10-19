/* Divyarann, the live site (Threshold design; built by tools/build_site_v2.py). Real paths, the reader's progress kept
   under the same keys as the earlier site, the Kit sign-up. Was the Threshold rebuild prototype. Threshold, a rebuild of divyarann.com: the pages, the router, the tear between pages, the threshold intro, reading,
   the codex dial and the sound. Plain DOM; every word stays real HTML. The WebGL scene (gl.js) only listens. */
(function () {
  "use strict";
  const C = window.DV_CONTENT;
  const root = document.documentElement;
  const view = document.getElementById("view");
  const gs = window.gsap || null, ST = window.ScrollTrigger || null;
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- PERF 1: how heavy this device is, and when the page rests ----------
  // Traces of the page alone (no wheel) on a 144 Hz laptop showed where the main thread goes, and almost none of it was script. (a) Two frame loops never stop:
  // GSAP's ticker and ScrollTrigger's own "rAF bug fix" ask for a frame at every vsync for ever, and while any frame loop runs every animation costs a style
  // recalc, a paint and a commit per frame (the scroll cue and the next chapter's ring alone were 4 to 8% of the thread at rest). (b) Every scroll listener read
  // layout (scrollY, getBoundingClientRect) after another had written, and Lenis's scrollTo ran after GSAP had written, so each frame recalculated style two or
  // three times. (c) The thread pulse read layout on every frame. (d) The reading line repainted a drop-shadow filter on every scroll event.
  // The fixes are marked PERF 1 to 6: 1 device class and rest, 2 one ordered frame, 3 the ticker and ScrollTrigger's loop sleep at rest, 4 the endless CSS loops,
  // 5 the thread pulse, 6 the reading line. They do not depend on the wheel.
  const CORES = navigator.hardwareConcurrency || 8, COARSE = window.matchMedia("(pointer: coarse)").matches;
  const CPU = (() => { const run = () => { const t = performance.now(); let x = 0; for (let i = 0; i < 400000; i++) x += Math.sqrt(i) * 1.0001 + (i & 7); return performance.now() - t + (x < 0 ? 1 : 0); }; const r = [run(), run(), run(), run(), run()].slice(1); return Math.min(...r) / 0.5; })();   // the fastest of four runs (noise only slows): about 1 on a fast laptop, 5 under 4x throttling
  // Only a measurably slow CPU counts as weak here (this laptop reads 1 to 2, under 4x throttling 3.4 to 7): the wheel's governor then starts a step down. The prototype's
  // visible changes for phones and small CPUs (native scrolling instead of Lenis, no reveal tweens, a 30 fps ticker, the title rising as one piece, html.dv-weak) are
  // not switched on: they wait for the author's decision.
  const WEAK = CPU > 3;
  window.DVCPU = { cpu: +CPU.toFixed(1), cores: CORES, coarse: COARSE, weak: WEAK };
  const plain = () => reduced();
  const FPSQ = /[?&]fps=(\d+)/.exec(location.search), PAGE_FPS = FPSQ ? +FPSQ[1] : 60;   // the ticker never asks for more frames than this
  // the page rests a few seconds after the last input: endless decorative loops pause (CSS, html.dv-rest), the thread pulse waits, the ticker sleeps
  let sleepFrame = -1;   // the ticker's frame count when the page put it to sleep: if it has moved, GSAP woke itself (a tween was made)
  const rest = (() => {
    let last = performance.now(), on = false;
    const set = (v) => { if (v === on) return; on = v; root.classList.toggle("dv-rest", v); if (v) setTimeout(trySleep, 400); };
    const touch = () => { last = performance.now(); if (on) { set(false); if (window.DVAsleep) { window.DVAsleep = false; gs.ticker.wake(); } if (api.onWake) api.onWake(); } };
    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll", "resize", "hashchange", "popstate", "focus", "online"].forEach((t) => window.addEventListener(t, touch, { passive: true }));
    document.addEventListener("visibilitychange", touch);
    setInterval(() => {
      if (!on && performance.now() - last > 5000) set(true);
      if (on && gs) { if (window.DVAsleep && gs.ticker.frame !== sleepFrame) window.DVAsleep = false; if (!window.DVAsleep) trySleep(); }   // asleep again once whatever woke it is done
    }, 1000);
    const api = { get on() { return on; }, touch, onWake: null };
    return api;
  })();
  const reduced = () => reduceMQ.matches || root.classList.contains("dv-still");
  const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-one", "Twenty-two", "Twenty-three", "Twenty-four", "Twenty-five", "Twenty-six"];
  const DEVA = (n) => String(n).replace(/\d/g, (d) => "०१२३४५६७८९"[d]);
  const pad = (n) => String(n).padStart(2, "0");
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = (s, el) => (el || document).querySelector(s);
  function rng(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function jagged(a, b, depth, rough, R) { let pts = [a, b]; for (let k = 0; k < depth; k++) { const next = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [px, py] = pts[i], [qx, qy] = pts[i + 1]; const dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy) || 1, off = (R() - 0.5) * len * rough; next.push([(px + qx) / 2 - dy / len * off, (py + qy) / 2 + dx / len * off], pts[i + 1]); } pts = next; rough *= 0.92; } return pts; }

  // ---------- the reader's progress (kept apart from the live site) ----------
  const KEY = "divyarann-progress";
  let P = { read: {}, demo: 0 };
  try { P = Object.assign(P, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };
  const fire = () => window.dispatchEvent(new CustomEvent("dvr:progress"));
  const DVR = window.DVR = {
    reached() { if (P.demo) return P.demo; let m = 0; for (const k in P.read) m = Math.max(m, +k); return Math.min(m, C.released); },
    isRead: (n) => !!P.read[n] || (P.demo >= n),
    markRead(n) { if (P.read[n]) return false; P.read[n] = Date.now(); P.demo = 0; save(); fire(); return true; },
    setReached(n) { P.read = {}; P.demo = 0; for (let i = 1; i <= n; i++) P.read[i] = 1; save(); fire(); },
    demo(n) { P.demo = n; save(); fire(); },
  };
  // the bookmark: one word in each chapter, kept as { chapter: { p: paragraph, o: where in it, w: the word, t: when } }
  const BKEY = "divyarann-bookmark";
  let BM = {};
  try { BM = JSON.parse(localStorage.getItem(BKEY) || "{}") || {}; } catch (e) {}
  const bmSave = () => { try { localStorage.setItem(BKEY, JSON.stringify(BM)); } catch (e) {} };
  // a bookmark left after the last chapter they finished is where they stopped reading
  const bmBack = () => { let last = 0, best = 0; for (const k in P.read) last = Math.max(last, +P.read[k] || 0); for (const k in BM) if (chap(+k) && BM[k].t > last && (!best || BM[k].t > BM[best].t)) best = +k; return best; };
  function updateCount() { const n = DVR.reached(); const el = $("#litCount b"); if (el) el.textContent = pad(n); }
  window.addEventListener("dvr:progress", updateCount);

  // ---------- pages ----------
  const chap = (n) => C.chapters.find((c) => c.n === n);
  const nextLine = () => (C.next ? (C.next.date ? `Chapter ${WORDS[C.next.n]} arrives ${C.next.date}.` : `Chapter ${WORDS[C.next.n]} is on its way.`) : "");
  const foot = () => `<footer class="foot"><div class="foot-in"><p>© ${C.year || new Date().getFullYear()} ${esc(C.author)}. All rights reserved.</p>
      <p>Divyarann is a work of fiction. This is the draft web edition of Book One: chapters may be revised, and this edition may be withdrawn when the book is published. Please share the link rather than reposting chapters elsewhere.</p>
      <p class="foot-links"><a href="/about/">About and privacy</a><a href="/author/">About the author</a><a href="/disclaimer/">Disclaimer</a><a href="mailto:hello@divyarann.com">hello@divyarann.com</a>${C.instagram ? `<a href="${esc(C.instagram)}" rel="noopener">Instagram</a>` : ""}<a href="/feed.xml">RSS</a></p></div></footer>`;
  const follow = () => {
    const nl = C.newsletter, insta = C.instagram, handle = insta ? insta.replace(/\/+$/, "").split("/").pop() : "";
    return `<section class="section follow"><p class="kicker"><span>New chapters</span></p><h2>Be told when the next tear opens</h2>
      <p class="follow-lead">${esc(C.nextLead || "")}</p>
      ${nl ? `<form class="follow-form" action="${esc(nl.action)}" method="post"><label class="visually-hidden" for="em">Email address</label><input id="em" type="email" name="${esc(nl.field)}" placeholder="Your email" autocomplete="email" required><button type="submit">Get each chapter</button></form>
      <p class="fine">One email when a chapter is released, nothing else. The list is kept by Kit, the mail service; every email has a one-click unsubscribe.</p>` : ""}
      <p class="follow-links">${insta ? `<a href="${esc(insta)}" rel="noopener">Instagram @${esc(handle)}</a>` : ""}<a href="/feed.xml">RSS feed</a></p></section>`;
  };

  function home() {
    const r = DVR.reached();
    const begin = r >= C.released ? 1 : r + 1;
    const nextN = r >= C.released ? 0 : r + 1;
    const back = bmBack();
    const rows = C.chapters.map((c) => `
      <li class="ix-row${DVR.isRead(c.n) ? " is-read" : ""}${c.n === nextN ? " is-next" : ""}" data-n="${c.n}"><a class="ix-link" href="/read/${c.n}/">
        <span class="ix-side ix-l"><span class="ix-t">${esc(c.title)}</span><span class="ix-g">${esc(c.gloss)}</span></span>
        <span class="ix-node"><span class="ix-no" lang="hi">${DEVA(pad(c.n))}</span></span>
        <span class="ix-side ix-r"><span class="ix-meta">${DVR.isRead(c.n) ? "Lit" : c.n === nextN ? (r ? "Next" : "Begin") + " · " + c.minutes + " min" : c.minutes + " min"}</span><span class="ix-teaser">${esc(c.teaser)}</span></span></a></li>`).join("");
    const locked = C.next ? `<li class="ix-row is-locked"><span class="ix-link"><span class="ix-side ix-l"><span class="ix-t">Sealed</span></span><span class="ix-node"><span class="ix-no" lang="hi">${DEVA(pad(C.next.n))}</span></span><span class="ix-side ix-r"><span class="ix-meta">Soon</span><span class="ix-teaser">${esc(nextLine())}</span></span></span></li>` : "";
    return `
      <div class="torn" id="torn"><svg class="thread" id="thread" aria-hidden="true"></svg><svg class="thread thread-pulse" id="threadPulse" aria-hidden="true"></svg>
      <section class="hero" data-gl="hero">
        <div class="hero-wheel" data-wheel>${fallbackWheel()}</div>
        <div class="hero-type">
          <div class="hero-sub"><p class="kicker"><span>Book One</span><span>Vinash</span></p><p class="title-deva" lang="hi">दिव्यारण</p></div>
          <h1 class="title" aria-label="Divyarann">${"Divyarann".split("").map((ch, i) => `<span style="--i:${i}" aria-hidden="true">${ch}</span>`).join("")}</h1>
        </div>
        <span class="scroll-cue" aria-hidden="true">Scroll</span>
      </section>
      <section class="section premise" data-scene="hero">
        <p class="kicker"><span>Seven tears</span><span>One above Dwarka</span></p>
        <p class="premise-text" data-lines data-hush>${esc(C.lede)}</p>
        <div class="cta-row" data-hush><a class="cta" href="/read/${back || begin}/">${back ? "Your bookmark · Chapter " + WORDS[back] : r === 0 ? "Begin · Chapter One" : r >= C.released ? "Read again · Chapter One" : "Continue · Chapter " + WORDS[begin]}</a><a class="cta ghost" href="/read/">All chapters</a></div>
        <p class="nogl-note fine" style="margin-top:28px">The sky would not open on this device. The story is all here.</p>
      </section>
      <section class="section index" data-scene="index">
        <header class="sec-head" data-hush><p class="kicker"><span>Book One so far</span><span>${C.released} of 26</span></p><h2>The chapters</h2></header>
        <ol class="ix">${rows}${locked}</ol>
      </section></div>
      <section class="section four" data-scene="four">
        <header class="sec-head"><p class="kicker"><span>Under the Dwarka tear</span></p><h2>Four ordinary people</h2></header>
        <div class="four-grid">${C.cards.map((k, i) => `<a class="four-card" href="/codex/"><span class="four-n">${pad(i + 1)}</span><span class="four-name">${esc(k.name)}</span><span class="four-line">${esc(k.line)}</span></a>`).join("")}</div>
      </section>
      ${follow()}${foot()}`;
  }

  function contents() {
    return `
      <section class="page-head"><p class="kicker"><span>Book One · Vinash</span><span>${C.released} chapters</span></p><h1 class="page-title">Chapters</h1>
        <p class="page-lede">Each is titled with one Sanskrit word. A point on the wheel lights for every chapter you read.</p></section>
      <ol class="toc">${C.chapters.map((c) => `
        <li class="toc-row${DVR.isRead(c.n) ? " is-read" : ""}" data-n="${c.n}"><a href="/read/${c.n}/">
          <span class="toc-n">Chapter ${WORDS[c.n]}</span><span class="toc-t">${esc(c.title)}</span><span class="toc-d" lang="hi">${esc(c.deva)}</span>
          <span class="toc-s">${esc(c.summary)}</span><span class="toc-m">${esc(c.pov)} · ${c.minutes} min${DVR.isRead(c.n) ? " · lit" : ""}${BM[c.n] ? " · bookmarked" : ""}</span></a></li>`).join("")}
        ${C.next ? `<li class="toc-row is-locked"><span><span class="toc-n">Chapter ${WORDS[C.next.n]}</span><span class="toc-t">Sealed</span><span class="toc-s">${esc(nextLine())}</span></span></li>` : ""}
      </ol>${follow()}${foot()}`;
  }

  function reader(n) {
    const c = chap(n); if (!c) return contents();
    const prev = chap(n - 1), next = chap(n + 1);
    const newCodex = C.codex.filter((e) => e.ch === n), newWords = C.glossary.filter((g) => g.ch === n);
    return `
      <article class="chapter" data-n="${n}">
        <header class="ch-card">
          <p class="kicker"><span>Chapter ${WORDS[n]}</span><span>${esc(c.pov)}</span><span>${c.minutes} min</span></p>
          <h1 class="ch-title">${esc(c.title)}</h1>
          <p class="ch-deva" lang="sa">${esc(c.deva)}</p>
          <p class="ch-gloss">${esc(c.gloss)}</p>
          <span class="scroll-cue" aria-hidden="true">Read</span>
        </header>
        <div class="prose" id="prose">${c.html}</div>
        <footer class="ch-end" id="chEnd">
          <p class="end-mark" aria-hidden="true">✦</p>
          <p class="kicker"><span>End of Chapter ${WORDS[n]}</span><span>${esc(c.title)}</span></p>
          <div class="unlock">
            ${newCodex.length ? `<div><p class="u-k">Opened in your codex</p><ul>${newCodex.slice(0, 8).map((e) => `<li><b>${esc(e.name)}.</b> ${esc(e.text)}</li>`).join("")}</ul></div>` : ""}
            ${newWords.length ? `<div><p class="u-k">Words from this chapter</p><p class="u-words">${newWords.map((g) => esc(g.term)).join(" · ")}</p></div>` : ""}
          </div>
          <div class="ch-next">${next ? `<span class="kicker"><span>Next</span><span>Chapter ${WORDS[n + 1]}</span></span><a href="/read/${n + 1}/">${esc(next.title)}</a>` : `<span class="kicker"><span>Next</span></span><span class="fine">${esc(nextLine())}</span>`}
            ${prev ? `<a class="ch-prev" href="/read/${n - 1}/">← ${esc(prev.title)}</a>` : ""}</div>
        </footer>
      </article>${foot()}`;
  }

  function codex() {
    const r = DVR.reached(), shown = Math.min(r, C.released);
    const dial = Array.from({ length: C.released + 1 }, (_, i) => `<button type="button" data-set="${i}" aria-pressed="${i === shown}" aria-label="I have read ${i ? "up to Chapter " + WORDS[i] : "nothing yet"}" lang="hi">${DEVA(i)}</button>`).join("");
    const cards = C.cards.map((k) => {
      const facts = k.facts.filter((f) => f.ch <= shown);
      return `<article class="card"><p class="kicker"><span>${esc(k.name)}</span><span>${facts.length} of ${k.facts.length} known</span></p><h3>${esc(k.name)}</h3><p class="card-line">${esc(k.line)}</p>
        ${facts.length ? `<ul class="facts">${facts.map((f) => `<li><span>CH ${pad(f.ch)}</span>${esc(f.text)}</li>`).join("")}</ul>` : `<p class="sealed-note">Sealed until Chapter ${WORDS[k.ch]}</p>`}</article>`;
    }).join("");
    const kinds = [["person", "People"], ["place", "Places"], ["thing", "Things"], ["sign", "Signs"]];
    const groups = kinds.map(([k, label]) => {
      const items = C.codex.filter((e) => e.kind === k); if (!items.length) return "";
      return `<div><h3>${label}</h3><dl>${items.map((e) => e.ch <= shown ? `<dt>${esc(e.name)}</dt><dd>${esc(e.text)}</dd>` : `<dt class="is-sealed">Sealed · Chapter ${WORDS[e.ch]}</dt><dd class="is-sealed">Opens when you read it.</dd>`).join("")}</dl></div>`;
    }).join("");
    return `
      <section class="page-head"><p class="kicker"><span>Your codex</span><span>${shown} of ${C.released} read</span></p><h1 class="page-title">Codex</h1>
        <p class="page-lede">Everything here opens as you read: the four, the places, the signs. Reading on another device? Set where you are.</p>
        <div class="dial" role="group" aria-label="Where you are in the book"><span class="dial-k">Read up to</span>${dial}</div></section>
      <section class="cards">${cards}</section>
      <section class="section"><header class="sec-head"><p class="kicker"><span>Dwarka</span><span>Sector 12</span></p><h2>The map</h2></header><div class="map" id="map"></div></section>
      <section class="cx">${groups}</section>${foot()}`;
  }

  function story() {
    const r = DVR.reached();
    const beats = (C.premise.match(/[^.!?]+[.!?]+/g) || [C.premise]).map((s) => `<p class="beat" data-beat>${esc(s.trim())}</p>`).join("");
    return `
      <section class="page-head"><p class="kicker"><span>Summary</span></p><h1 class="page-title">The Story</h1></section>
      <section class="beats">${beats}</section>
      <section class="trilogy"><div class="book"><p class="kicker"><span>Book One</span><span>Being written</span></p><h3>Vinash <span lang="hi">विनाश</span></h3><p>The beginning of the crisis. Four people awaken under the Dwarka tear, lose people they promised to save, and learn what their power costs.</p></div>
        <div class="book later"><p class="kicker"><span>Books Two and Three</span></p><h3>Sealed</h3><p>They open when Book One ends.</p></div></section>
      <ol class="sums">${C.chapters.map((c) => `<li class="${c.n <= r ? "" : "is-veiled"}"><p class="kicker"><span>Chapter ${WORDS[c.n]}</span><span>${esc(c.pov)}</span></p><h3>${esc(c.title)} <span lang="sa">${esc(c.deva)}</span></h3><p>${c.n <= r ? esc(c.summary) : "Read Chapter " + WORDS[c.n] + " to unveil this."}</p></li>`).join("")}</ol>${foot()}`;
  }
  // the disclaimer and the author's page: their paragraphs come from tools/site_v2/disclaimer.md and author.md (already escaped by the build)
  const paras = (ps) => (ps || []).map((p) => (p.v ? `<p class="verse" lang="sa">${p.t}</p>` : p.h ? `<h2>${p.t}</h2>` : `<p>${p.t.replace("{year}", new Date().getFullYear())}</p>`)).join("");
  const disclaimer = () => `<section class="page-head"><p class="kicker"><span>Disclaimer</span></p><h1 class="page-title">A work of fiction</h1></section>
      <section class="about">${paras(C.disclaimer)}</section>${foot()}`;
  const author = () => `<section class="page-head"><p class="kicker"><span>About the author</span></p><h1 class="page-title">${esc(C.author)}</h1></section>
      <section class="about">${paras(C.authorBio) || "<p>A few words from the author are on their way.</p>"}<p>Write to hello@divyarann.com.</p></section>${foot()}`;
  const sealedPage = (kick, title, line) => `<section class="page-head sealed-page"><p class="kicker"><span>${kick}</span></p><h1 class="page-title">${title}</h1><p class="page-lede">${line}</p><p class="sealed-line">${esc(nextLine())}</p></section>${foot()}`;
  function about() {
    return `<section class="page-head"><p class="kicker"><span>About</span></p><h1 class="page-title">Divyarann</h1></section>
      <section class="about"><h2>The book</h2><p>DIVYARANN is a trilogy of Indian mythological fantasy set in modern Delhi. Book One, <em>Vinash</em>, is published here as a free web edition, one chapter at a time, while it is being written.</p>
      <h2>The author</h2><p>Written by <a href="/author/">${esc(C.author)}</a>. Write to hello@divyarann.com.</p>
      <h2>Privacy</h2><p>Your reading progress, bookmarks and settings (text size, colours, sound) are kept in your browser's local storage on this device. Nothing about your reading is sent anywhere, and the site sets no advertising or tracking cookies and runs no analytics.</p>
      <p>If you join the email list, your address is held by Kit (kit.com), the mail service that sends each new chapter. Every email has a one-click unsubscribe.</p>
      <p>The site is hosted on GitHub Pages. Its fonts come from Google Fonts and some of its code from the cdnjs and jsDelivr networks, which, like any web host, see your IP address when your browser fetches them.</p></section>${foot()}`;
  }

  // a static wheel for devices without WebGL
  function fallbackWheel() {
    const pet = "M0,-342 C 26,-318 30,-292 0,-262 C -30,-292 -26,-318 0,-342 Z", r = DVR.reached();
    let s = `<svg class="fallback-wheel" viewBox="-380 -380 760 760" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" style="color:var(--bone-2)"><circle r="360" opacity=".4"/><circle r="342"/><circle r="252"/><circle r="116"/>`;
    for (let i = 0; i < 18; i++) s += `<g transform="rotate(${i * 20})"><path d="${pet}"/><circle cy="-230" r="5" fill="${i < r ? "var(--accent)" : "none"}" stroke="${i < r ? "var(--accent)" : "currentColor"}"/></g>`;
    return s + `</svg>`;
  }

  // ---------- the map of Dwarka ----------
  function drawMap() {
    const host = $("#map"); if (!host) return;
    const r = Math.min(DVR.reached(), C.released), R = rng(12);
    let s = `<div class="map-pan"><svg viewBox="0 0 1000 620" role="img" aria-label="A drawn map of Dwarka with the places you have reached">`;
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) { const x = 70 + col * 100 + (row % 2 ? 18 : 0), y = 34 + row * 96; if (x > 900 || R() < 0.08) continue; s += `<rect class="blk" x="${x}" y="${y}" width="${78 + R() * 8}" height="${70 + R() * 6}" rx="4"/>`; }
    s += `<path class="rail" d="M 612,18 C 586,120 520,196 486,268 C 452,340 468,420 520,486 C 560,536 610,572 648,604"/>`;
    C.places.filter((p) => p.x != null).forEach((p, i) => {
      const open = p.ch <= r;
      s += `<g class="pin${open ? "" : " sealed"}" data-i="${i}" tabindex="0" role="button" aria-label="${open ? esc(p.name) : "A sealed place"}"><circle cx="${p.x}" cy="${p.y}" r="${open ? 5 : 4.5}"/>${open ? `<text x="${p.x + (p.side === "end" ? -12 : 12)}" y="${p.y + 4}" text-anchor="${p.side === "end" ? "end" : "start"}">${esc(p.name)}</text>` : ""}</g>`;
    });
    host.innerHTML = s + `</svg></div><div class="map-note" id="mapNote">${r ? "Tap a place to remember what happened there." : "Nothing on the map yet. Read Chapter One and the first places appear."}</div>`;
    const pinned = C.places.filter((p) => p.x != null);
    host.querySelectorAll(".pin").forEach((g) => { const show = () => { const p = pinned[+g.dataset.i]; $("#mapNote").innerHTML = p.ch <= r ? `<b style="color:var(--bone)">${esc(p.name)}.</b> ${esc(p.text)}` : `Sealed until Chapter ${WORDS[p.ch]}.`; sound.tick(); };
      g.addEventListener("click", show); g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } }); });
  }

  // ---------- sound: a tanpura-like drone, a near-silent reading bed, and four small cues (all opt-in) ----------
  const sound = (() => {
    let ac = null, master = null, bed = null, on = false, mode = "ambient", timer = 0, step = 0;
    function ensure() {
      if (ac) return true; const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return false;
      ac = new Ctor(); master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      bed = ac.createGain(); bed.gain.value = 0.8; const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400; bed.connect(lp); lp.connect(master); bed._lp = lp;
      const n = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = n.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { b = 0.98 * b + 0.02 * (Math.random() * 2 - 1); d[i] = b * 3; }
      const room = ac.createBufferSource(); room.buffer = n; room.loop = true; const rg = ac.createGain(); rg.gain.value = 0.05; room.connect(rg); rg.connect(master); room.start();
      return true;
    }
    function pluck(f, v) {   // one tanpura string: a buzzing saw that rings away
      const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), bp = ac.createBiquadFilter();
      o.type = "sawtooth"; o2.type = "sawtooth"; o.frequency.value = f; o2.frequency.value = f * 2.004; bp.type = "lowpass"; bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(500, t + 3.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.2);
      o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(bed); o.start(t); o2.start(t); o.stop(t + 5.4); o2.stop(t + 5.4);
    }
    const PATTERN = [98, 130.81, 130.81, 65.41];   // Pa, Sa, Sa, low Sa
    function loop() { if (!on) return; const v = mode === "reading" ? 0.018 : 0.045; pluck(PATTERN[step % 4], v); step++; timer = setTimeout(loop, step % 4 === 0 ? 1900 : 1250); }
    function blip(f, dur, v, type) { if (!on || !ac) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); }
    function whoosh(up) { if (!on || !ac) return; const t = ac.currentTime, len = 0.9, b = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = b; f.type = "bandpass"; f.Q.value = 2.5; f.frequency.setValueAtTime(up ? 300 : 2200, t); f.frequency.exponentialRampToValueAtTime(up ? 2200 : 300, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + len * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + len); s.connect(f); f.connect(g); g.connect(master); s.start(t); }
    return {
      set(v) { if (v && !ensure()) return; on = v; if (ac) { if (ac.state === "suspended") ac.resume(); master.gain.cancelScheduledValues(ac.currentTime); master.gain.linearRampToValueAtTime(v ? 0.9 : 0, ac.currentTime + 0.8); }
        clearTimeout(timer); if (v) loop(); const b = $("#sndBtn"); if (b) b.setAttribute("aria-pressed", String(v)); try { localStorage.setItem("divyarann-sound", v ? "1" : "0"); } catch (e) {} },
      get on() { return on; },
      mode(m) { mode = m; if (bed) bed._lp.frequency.linearRampToValueAtTime(m === "reading" ? 600 : 1400, ac.currentTime + 1.5); },
      tick() { blip(1760, 0.07, 0.03); }, light() { blip(880, 2.2, 0.06); blip(1320, 2.6, 0.035); blip(1760, 1.8, 0.02); }, open() { whoosh(true); }, close() { whoosh(false); },
    };
  })();

  // ---------- the tear between pages ----------
  const tearT = $("#tearT"), halves = tearT.querySelectorAll(".half"), seam = $("#tearT path");
  function shapeTear() {
    const pts = jagged([50, -2], [50, 102], 5, 0.12, rng((Math.random() * 1e6) | 0));
    const line = pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`);
    halves[0].style.clipPath = `polygon(0% 0%, ${pts.map(([x, y]) => `${(x / 50.5 * 100).toFixed(2)}% ${y.toFixed(2)}%`).join(", ")}, 0% 100%)`;
    halves[1].style.clipPath = `polygon(100% 0%, ${pts.map(([x, y]) => `${((x - 49.5) / 50.5 * 100).toFixed(2)}% ${y.toFixed(2)}%`).join(", ")}, 100% 100%)`;
    seam.setAttribute("d", "M" + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L"));
    void line;
  }
  function closeTear() {
    return new Promise((res) => {
      if (!gs || reduced()) { gs ? gs.to(view, { autoAlpha: 0, duration: 0.2, onComplete: res }) : res(); return; }
      shapeTear(); sound.close();
      gs.timeline({ onComplete: res })
        .to(halves[0], { xPercent: 0, x: 0, duration: 0.6, ease: "power3.inOut" }, 0).to(halves[1], { xPercent: 0, x: 0, duration: 0.6, ease: "power3.inOut" }, 0)
        .fromTo(tearT.querySelector("svg"), { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.4);
    });
  }
  function openTear() {
    if (!gs || reduced()) { if (gs) gs.fromTo(view, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }); return; }
    sound.open();
    gs.timeline().to(tearT.querySelector("svg"), { opacity: 0, duration: 0.5, delay: 0.1 }, 0)
      .to(halves[0], { xPercent: -101, duration: 1.0, ease: "expo.out" }, 0.08).to(halves[1], { xPercent: 101, duration: 1.0, ease: "expo.out" }, 0.08);
  }
  if (gs) { gs.set(halves[0], { xPercent: -101 }); gs.set(halves[1], { xPercent: 101 }); }

  // ---------- smooth scroll, and the frame (PERF 2) ----------
  // Lenis runs first in every frame, while style is still clean, and the page's scroll-linked work follows in one hook that reads first and writes after. Before,
  // GSAP rendered its tweens (writes), then Lenis's scrollTo and ScrollTrigger read scroll (a forced style recalc each), then three scroll listeners read and wrote
  // again. No Lenis at all on a weak device: native scrolling costs the main thread nothing.
  let lenis = null, curY = 0;
  const frameHooks = new Set();   // functions (y), run once per frame after the scroll position changed
  let scrollDirty = true, frameRaf = 0;
  function frame() { if (!scrollDirty) return; scrollDirty = false; curY = lenis ? lenis.scroll : window.scrollY; frameHooks.forEach((f) => f(curY)); }
  window.DVScroll = () => curY;   // the scroll position as of this frame, for the wheel: reading scrollY after writes forces a style recalc
  window.addEventListener("scroll", () => { scrollDirty = true; if (!gs && !frameRaf) frameRaf = requestAnimationFrame(() => { frameRaf = 0; frame(); }); }, { passive: true });
  // ScrollTrigger keeps a requestAnimationFrame loop of its own running for ever (its "rAF bug fix", for Safari's momentum scrolling): a frame at every vsync
  // whatever the page does, which also makes every running animation cost a main-thread frame per vsync. It now runs while the page is in use (any input, any
  // scrolling, including momentum) and is parked while the page rests. The callback is recognised by name; if a newer ScrollTrigger renames it, nothing changes.
  const rawRAF = window.requestAnimationFrame.bind(window); let bugFix = null, bugParked = false;
  window.requestAnimationFrame = (cb) => { if (cb && cb.name === "_rafBugFix") { bugFix = cb; if (rest.on) { bugParked = true; return 0; } } return rawRAF(cb); };
  rest.onWake = () => { if (bugParked && bugFix) { bugParked = false; rawRAF(bugFix); } };
  if (gs && ST) {
    gs.registerPlugin(ST); ST.config({ ignoreMobileResize: true }); gs.ticker.lagSmoothing(0); gs.ticker.fps(PAGE_FPS);
    if (window.Lenis && !reduceMQ.matches) { lenis = new window.Lenis({ lerp: 0.1, anchors: false }); lenis.on("scroll", ST.update); window.DVLenis = lenis; }
    gs.ticker.add((t) => { if (lenis) lenis.raf(t * 1000); frame(); }, false, true);   // prioritised: before GSAP renders this frame's tweens
  }
  // the ticker sleeps while the page rests and nothing is animating (PERF 3); it wakes on any input, and GSAP wakes it by itself when a tween is made
  function trySleep() {
    if (!gs || !rest.on || document.hidden || window.DVAsleep) return;
    if (lenis && (lenis.isScrolling || Math.abs(lenis.velocity || 0) > 0.01)) return setTimeout(trySleep, 600);
    if (window.DVGL && window.DVGL.busy && window.DVGL.busy()) return setTimeout(trySleep, 600);
    if (gs.globalTimeline.getChildren(false, true, true).some((a) => !a.paused() && a.progress() < 1)) return setTimeout(trySleep, 600);
    window.DVAsleep = true; sleepFrame = gs.ticker.frame; gs.ticker.sleep();
  }
  window.DVWake = () => { if (!window.DVAsleep) return; window.DVAsleep = false; gs.ticker.wake(); setTimeout(trySleep, 1500); };   // for the wheel, which can need a frame while the page rests

  // ---------- routing ----------
  const ROUTES = [
    [/^(home)?$/, () => ["home", home()]], [/^chapters$/, () => ["contents", contents()]], [/^ch-(\d+)$/, (m) => (chap(+m[1]) ? ["reader", reader(+m[1]), +m[1]] : ["notfound", +m[1] > C.released && +m[1] <= 26 ? unreleased(+m[1]) : notFound()])],
    [/^codex$/, () => ["codex", codex()]], [/^story$/, () => ["story", story()]],
    [/^tears$/, () => ["tears", sealedPage("Atlas", "The Seven Tears", "The sky has not opened yet. This atlas fills in as the story reaches the tears.")]],
    [/^powers$/, () => ["powers", sealedPage("Reference", "Powers", "One energy, latent in everyone, answering what a person is actually resolved to do. Nobody has awakened yet.")]],
    [/^about$/, () => ["about", about()]],
    [/^author$/, () => ["author", author()]],
    [/^disclaimer$/, () => ["disclaimer", disclaimer()]],
    [/^subscribed$/, () => ["subscribed", mailPage("Almost there", "Check your email", "A confirmation link is on its way to your inbox. Open it and each new chapter will reach you by email. If it has not arrived in a few minutes, look in Promotions or Spam.", `<a class="cta" href="/read/">Back to the chapters</a>`)]],
    [/^confirmed$/, () => ["confirmed", mailPage("You are on the list", "Welcome to Divyarann", "Each new chapter will arrive in your inbox on the day it is released.", `<a class="cta" href="/read/1/">Start at Chapter One</a><a class="cta ghost" href="/read/">All chapters</a>`)]],
    [/^notfound$/, () => ["notfound", notFound()]],
  ];
  function mailPage(kick, title, line, ctas) { return `<section class="page-head sealed-page"><p class="kicker"><span>${kick}</span></p><h1 class="page-title">${title}</h1><p class="page-lede">${line}</p><div class="cta-row">${ctas}</div></section>${foot()}`; }
  function unreleased(n) { return `<section class="page-head sealed-page"><p class="kicker"><span>Chapter ${WORDS[n] || n}</span></p><h1 class="page-title">Not out yet</h1><p class="page-lede">${esc(nextLine() || "This chapter has not been released.")}</p><div class="cta-row"><a class="cta" href="/read/">All chapters</a></div></section>${foot()}`; }
  function notFound() { return `<section class="page-head sealed-page"><p class="kicker"><span>Not found</span></p><h1 class="page-title">This page is not in the book</h1><p class="page-lede">The link may be old, or the page may not have opened yet.</p><div class="cta-row"><a class="cta" href="/">Back to the threshold</a><a class="cta ghost" href="/read/">All chapters</a></div></section>${foot()}`; }
  const TITLES = { subscribed: "Check your email · Divyarann", confirmed: "Welcome · Divyarann", notfound: "Not found · Divyarann", home: "Divyarann · Book One: Vinash", contents: "Chapters · Divyarann", codex: "Codex · Divyarann", story: "The Story · Divyarann", tears: "The Seven Tears · Divyarann", powers: "Powers · Divyarann", about: "About · Divyarann", author: "About the author · Divyarann", disclaimer: "Disclaimer · Divyarann" };
  let current = null, navId = 0, ctx = null, landing = false;
  // the page places itself (the bookmark, or the top); ScrollTrigger keeps its own copy of this setting, so it is told too
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (ST && ST.clearScrollMemory) ST.clearScrollMemory("manual");
  function routeKey() {
    const p = location.pathname.replace(/\/index\.html$/, "/").replace(/([^/])$/, "$1/"), h = (location.hash || "").replace(/^#\/?/, "");
    if (p === "/" && /^(story|tears|powers|codex|about|author|disclaimer|chapters|ch-\d+)$/.test(h)) return h;
    let m;
    if (p === "/") return "home";
    if (p === "/read/") return "chapters";
    if ((m = p.match(/^\/read\/(\d+)\/$/))) return "ch-" + m[1];
    if ((m = p.match(/^\/(codex|story|tears|powers|about|author|disclaimer|subscribed|confirmed)\/$/))) return m[1];
    return "notfound";
  }
  const PATHS = { home: "/", chapters: "/read/", codex: "/codex/", story: "/story/", tears: "/tears/", powers: "/powers/", about: "/about/", author: "/author/", disclaimer: "/disclaimer/" };
  function resolve() { const h = routeKey(); for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) return fn(m); } return ["notfound", notFound()]; }
  async function go(first) {
    const id = ++navId;
    closeMenu();
    const [name, html, n] = resolve();
    if (!first) { window.DVGL && window.DVGL.leave(name); await closeTear(); if (id !== navId) return; }
    if (ctx) ctx.revert();
    thread.clear(); { const p = $("#pop"); if (p) p.classList.remove("show"); }
    view.innerHTML = html; view.dataset.page = name;
    root.classList.toggle("on-reader", name === "reader");
    document.querySelectorAll(".menu a[data-route]").forEach((a) => a.classList.toggle("is-on", a.dataset.route === name || (name === "reader" && a.dataset.route === "contents")));
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true }); else window.scrollTo(0, 0);
    current = { name, n };
    document.title = name === "reader" ? `Chapter ${WORDS[n]}: ${chap(n) ? chap(n).title : ""} · Divyarann` : TITLES[name] || TITLES.home;
    landing = true; mount(name, n); landing = false;
    if (window.DVGL) window.DVGL.enter(name, { n, first });
    sound.mode(name === "reader" ? "reading" : "ambient");
    if (!first) { openTear(); const h1 = view.querySelector("h1"); if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); } }
    if (gs) gs.fromTo(view, { autoAlpha: 1 }, { autoAlpha: 1, duration: 0.01 });
  }
  // moving between pages without reloading: internal links push the path, the back button pops it
  function nav(path) { if (path === location.pathname + location.search) return; history.pushState(null, "", path); go(false); }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]"); if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
    const url = new URL(a.href, location.href); if (url.origin !== location.origin || /\.(xml|png|jpg|webp|txt|json)$/.test(url.pathname)) return;
    e.preventDefault(); nav(url.pathname);
  });
  window.addEventListener("popstate", () => go(false));
  window.addEventListener("hashchange", () => {   // an old #story-style link followed on an open page
    const k = routeKey(); if (location.pathname !== "/" || k === "home") return;
    history.replaceState(null, "", k.startsWith("ch-") ? "/read/" + k.slice(3) + "/" : PATHS[k] || "/"); go(false);
  });
  const legacy = routeKey(); if (location.hash && location.pathname === "/" && legacy !== "home") history.replaceState(null, "", legacy.startsWith("ch-") ? "/read/" + legacy.slice(3) + "/" : PATHS[legacy] || "/");
  window.DVRoute = { current: () => current };
  window.DVNav = nav;

  // ---------- the thread: the tear runs from the wheel's hub down the home page and the chapters hang on it. It is lit as
  //            far as the reader has read; a pulse runs down the lit part, brightening each chapter it passes, and lands on
  //            the one where they stopped. In the battle it runs red and the pulse is a drop of blood that leaves on a heartbeat ----------
  const thread = (() => {
    const NS = "http://www.w3.org/2000/svg";
    const E = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
    let on = false, pts = [], cum = [], litLen = 0, nodes = [], target = null, spark = null, tail = null, tailG = null, hubDot = null, clipRect = null, box = null;
    const BX = 150, BY = 190;   // where the spark sits inside its moving layer
    let phase = "wait", u = 0, wait = 1.2, dur = 3, drawn = true, flash = 0, torn = null, drewFor = null, tornTop = 0, acc = 0;   // tornTop: the thread's top in the document, measured at build (PERF 5)
    const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    function crack(pins, R) {   // a hairline that wanders a few pixels either side of the straight line between pins, with small side cracks
      const out = [pins[0]], br = [];
      for (let i = 1; i < pins.length; i++) {
        const [ax, ay] = pins[i - 1], [bx, by] = pins[i]; let y = ay, side = R() < 0.5 ? -1 : 1;
        for (;;) {
          y += 14 + R() * 26; if (y >= by - 10) break;
          const v = (y - ay) / Math.max(1, by - ay), p = [ax + (bx - ax) * v + side * (1.5 + R() * 4.5), y]; out.push(p);
          if (R() < 0.1) { const l = 6 + R() * 14, a = (35 + R() * 40) * Math.PI / 180; br.push([p[0], p[1], side * Math.sin(a) * l, Math.cos(a) * l]); }
          side = -side;
        }
        out.push([bx, by]);
      }
      return { pts: out, br };
    }
    function lenAtY(y) { for (let i = 1; i < pts.length; i++) if (pts[i][1] >= y) { const v = (y - pts[i - 1][1]) / Math.max(0.01, pts[i][1] - pts[i - 1][1]); return cum[i - 1] + (cum[i] - cum[i - 1]) * Math.min(1, Math.max(0, v)); } return cum[cum.length - 1]; }
    function at(s) { let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } const v = (s - cum[lo]) / Math.max(0.01, cum[hi] - cum[lo]); return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * v, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * v]; }
    function clear() { on = false; torn = null; }
    function build() {
      on = false; torn = $("#torn"); const svg = $("#thread"), sv2 = $("#threadPulse"); if (!torn || !svg || !sv2) return;
      const T = torn.getBoundingClientRect(), W = torn.clientWidth, H = Math.ceil(torn.scrollHeight); if (!H || !W) return;
      tornTop = T.top + window.pageYOffset; curY = window.pageYOffset;
      const mobile = window.innerWidth < 900;
      nodes = [...torn.querySelectorAll(".ix-row")].map((row) => { const n = row.querySelector(".ix-node"), b = n.getBoundingClientRect(); return { el: n, x: b.left + b.width / 2 - T.left, y: b.top + b.height / 2 - T.top, read: row.classList.contains("is-read") }; });
      if (!nodes.length) return;
      const wheel = torn.querySelector(".hero-wheel"), wb = wheel ? wheel.getBoundingClientRect() : null, prem = torn.querySelector(".premise");
      const x0 = mobile ? nodes[0].x : Math.round(W / 2);
      const startY = !mobile && wb && wb.height ? wb.top - T.top + wb.height / 2 + wb.height * 0.17 : (prem ? prem.getBoundingClientRect().top - T.top + 24 : 0);
      const c = crack([[x0, startY]].concat(nodes.map((n) => [n.x, n.y])), rng(11)), last = nodes[nodes.length - 1];
      c.pts.push([last.x + 1.5, last.y + 34], [last.x - 1, last.y + 86]);
      pts = c.pts; cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const readN = nodes.filter((n) => n.read); target = readN.length ? readN[readN.length - 1] : null;
      const litY = target ? target.y : nodes[0].y - 74; litLen = lenAtY(litY);
      nodes.forEach((n) => { n.s = lenAtY(n.y); });
      // the thread itself: drawn once; it never changes while the pulse runs
      svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.replaceChildren();
      const defs = E("defs", {}, svg), mask = E("mask", { id: "thHush", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H }, defs);
      E("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }, mask);
      const fin = E("linearGradient", { id: "thIn", gradientUnits: "userSpaceOnUse", x1: 0, y1: startY, x2: 0, y2: startY + 110 }, defs);
      E("stop", { offset: 0, "stop-color": "#000" }, fin); E("stop", { offset: 1, "stop-color": "#fff" }, fin);
      E("rect", { x: 0, y: startY - 2, width: W, height: 112, fill: "url(#thIn)" }, mask);
      torn.querySelectorAll("[data-hush]").forEach((n, i) => {   // the thread dims behind words so the text stays clean
        const b = n.getBoundingClientRect(); if (!b.height) return;
        const t0 = b.top - T.top - 34, t1 = b.bottom - T.top + 34, k = 34 / Math.max(80, t1 - t0);
        const g = E("linearGradient", { id: "thH" + i, gradientUnits: "userSpaceOnUse", x1: 0, y1: t0, x2: 0, y2: t1 }, defs);
        [[0, "#fff"], [k, "#262626"], [1 - k, "#262626"], [1, "#fff"]].forEach(([o, col]) => E("stop", { offset: o, "stop-color": col }, g));
        E("rect", { x: 0, y: t0, width: W, height: t1 - t0, fill: `url(#thH${i})` }, mask);
      });
      const fout = E("linearGradient", { id: "thOut", gradientUnits: "userSpaceOnUse", x1: 0, y1: last.y + 20, x2: 0, y2: last.y + 86 }, defs);
      E("stop", { offset: 0, "stop-color": "#fff" }, fout); E("stop", { offset: 1, "stop-color": "#000" }, fout);
      E("rect", { x: 0, y: last.y + 20, width: W, height: H - last.y, fill: "url(#thOut)" }, mask);
      const clip = E("clipPath", { id: "thLit", clipPathUnits: "userSpaceOnUse" }, defs);
      const idxTop = nodes[0].y - 120, firstTime = drewFor !== location.pathname && !reduced() && litY > idxTop;
      clipRect = E("rect", { x: 0, y: 0, width: W, height: firstTime ? idxTop : litY }, clip);
      const d = "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");
      const g = E("g", { mask: "url(#thHush)" }, svg);
      E("path", { d, class: "th-base" }, g);
      const lit = E("g", { "clip-path": "url(#thLit)" }, g);
      E("path", { d, class: "th-glow" }, lit); E("path", { d, class: "th-glow2" }, lit);
      if (c.br.length) E("path", { d: c.br.map((b) => `M${b[0].toFixed(1)},${b[1].toFixed(1)} l${b[2].toFixed(1)},${b[3].toFixed(1)}`).join(" "), class: "th-branch" }, lit);
      E("path", { d, class: "th-core" }, lit);
      // the pulse: a small layer moved by transform, so nothing else on the page is redrawn while it runs (only its short tail is)
      box = sv2; sv2.setAttribute("width", 300); sv2.setAttribute("height", 300); sv2.setAttribute("viewBox", "0 0 300 300"); sv2.replaceChildren(); sv2.style.opacity = 0;
      const d2 = E("defs", {}, sv2), rg = E("radialGradient", { id: "thGlow" }, d2);
      [[0, 0.95], [0.3, 0.45], [1, 0]].forEach(([o, a]) => E("stop", { offset: o, style: `stop-color: var(--accent); stop-opacity: ${a}` }, rg));
      tailG = E("linearGradient", { id: "thTail", gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 0, y2: 1 }, d2);
      E("stop", { offset: 0, style: "stop-color: var(--accent); stop-opacity: 0" }, tailG); E("stop", { offset: 1, style: "stop-color: var(--bone); stop-opacity: 0.95" }, tailG);
      hubDot = torn.querySelector(".th-hub") || torn.insertBefore(Object.assign(document.createElement("span"), { className: "th-hub" }), sv2);
      hubDot.style.left = (pts[0][0] - 34).toFixed(1) + "px"; hubDot.style.top = (pts[0][1] - 34).toFixed(1) + "px"; hubDot.style.opacity = 0; flash = 0;
      tail = E("polyline", { class: "th-tail", stroke: "url(#thTail)", points: "" }, sv2);
      spark = E("g", { class: "th-spark", transform: `translate(${BX},${BY})` }, sv2);
      E("circle", { r: 22, fill: "url(#thGlow)" }, spark); E("circle", { r: 2.6, class: "th-dot" }, spark); E("path", { d: "M0,-6.5 C2.2,-2.5 3.6,0 3.6,2.2 A3.6,3.6 0 0 1 -3.6,2.2 C-3.6,0 -2.2,-2.5 0,-6.5 Z", class: "th-drop" }, spark);
      on = true; phase = "wait"; wait = 0.9; u = 0;
      // the first time the reader reaches the chapters, the lit thread draws itself down to where they stopped
      drawn = !firstTime;
      if (firstTime) {
        const list = torn.querySelector(".ix"), io = new IntersectionObserver((es) => { if (!es.some((e) => e.isIntersecting || e.boundingClientRect.top < 0)) return; io.disconnect();   // reached, or already scrolled past
          const o = { h: idxTop }; drewFor = location.pathname;
          if (gs) gs.to(o, { h: litY, duration: 1.8, ease: "power2.inOut", onUpdate: () => clipRect && clipRect.setAttribute("height", o.h.toFixed(1)), onComplete: () => { drawn = true; } });
          else { clipRect.setAttribute("height", litY); drawn = true; } }, { rootMargin: "0px 0px -25% 0px" });
        if (list) io.observe(list);
      }
    }
    function tick(dt) {
      if (!on || !drawn || reduced() || document.hidden || !torn || !torn.isConnected) return;
      if (rest.on) { if (phase === "run") { phase = "wait"; wait = 0.8; box.style.opacity = 0; } return; }   // PERF 5: the page is resting: the pulse waits
      acc += dt; if (acc < 0.032) return; dt = acc; acc = 0;   // PERF 5: a slow glow does not need more than 30 frames a second
      const rak = root.getAttribute("data-rakta") === "on";
      if (flash > 0) { flash *= Math.pow(0.02, dt); if (flash < 0.004) flash = 0; hubDot.style.opacity = flash.toFixed(3); }
      if (phase === "wait") {
        wait -= dt; if (wait > 0) return;
        if (rak && ((performance.now() / 1000) % 1.15) / 1.15 > 0.1) return;   // in the battle the drop leaves on a beat
        phase = "run"; u = 0; dur = Math.min(4.4, Math.max(1.7, litLen / 330)); flash = 1; nodes.forEach((n) => { n.hit = false; });
      }
      u = Math.min(1, u + dt / dur); const s = litLen * easeIO(u), p = at(s);
      const vy = tornTop - curY + p[1];   // PERF 5: from the measured top and the frame's scroll position; it used to read layout on every frame
      nodes.forEach((n) => { if (!n.hit && n.read && n !== target && n.s <= s) { n.hit = true; n.el.classList.remove("ping"); void n.el.offsetWidth; n.el.classList.add("ping"); } });
      if (vy > -200 && vy < window.innerHeight + 200) {
        const a = Math.min(1, u * 8) * (u > 0.95 ? (1 - u) / 0.05 : 1), tl = Math.min(130, s), ox = p[0] - BX, oy = p[1] - BY;
        box.style.transform = `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0)`; box.style.opacity = a.toFixed(3);
        const q = []; for (let i = 0; i <= 8; i++) q.push(at(s - tl + tl * i / 8));
        tail.setAttribute("points", q.map((v) => (v[0] - ox).toFixed(1) + "," + (v[1] - oy).toFixed(1)).join(" "));
        tailG.setAttribute("x1", (q[0][0] - ox).toFixed(1)); tailG.setAttribute("y1", (q[0][1] - oy).toFixed(1)); tailG.setAttribute("x2", BX); tailG.setAttribute("y2", BY);
      } else box.style.opacity = 0;
      if (u >= 1) {
        phase = "wait"; wait = rak ? 1.6 : 2.6; box.style.opacity = 0;
        const land = target || nodes[0]; land.el.classList.remove("land"); void land.el.offsetWidth; land.el.classList.add("land");
      }
    }
    let rt = 0; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (torn && torn.isConnected) build(); }, 220); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (torn && torn.isConnected) build(); });
    if (gs) gs.ticker.add((t, dms) => tick(Math.min(dms, 50) / 1000));
    return { build, clear };
  })();

  // ---------- what each page does once mounted ----------
  function mount(name, n) {
    if (gs) ctx = gs.context(() => {
      // reveals: section heads and rows rise in as they arrive
      let k = 0;
      view.querySelectorAll(".ix-row").forEach((row) => {
        if (plain()) return;
        const st = { trigger: row, start: "top 94%", once: true };
        gs.from(row.querySelector(".ix-l"), { x: window.innerWidth < 900 ? 0 : -34, y: window.innerWidth < 900 ? 18 : 0, autoAlpha: 0, duration: 1.0, ease: "power3.out", scrollTrigger: st });
        gs.from(row.querySelector(".ix-r"), { x: window.innerWidth < 900 ? 0 : 34, y: window.innerWidth < 900 ? 18 : 0, autoAlpha: 0, duration: 1.0, ease: "power3.out", delay: 0.06, scrollTrigger: st });
        gs.from(row.querySelector(".ix-node"), { scale: 0.4, autoAlpha: 0, duration: 0.8, ease: "power3.out", scrollTrigger: st });
      });
      view.querySelectorAll(".sec-head h2, .page-title, .page-lede, .toc-row, .four-card, .card, .book, .sums li").forEach((el) => {
        if (plain()) return;
        if (el.getBoundingClientRect().top < window.innerHeight) gs.from(el, { y: 40, autoAlpha: 0, duration: 1.0, ease: "power3.out", delay: 0.15 + 0.07 * k++ });
        else gs.from(el, { y: 40, autoAlpha: 0, duration: 1.0, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 96%", once: true } });
      });
      // the premise arrives one line at a time
      view.querySelectorAll("[data-lines]").forEach((p) => {
        if (plain()) return;
        const words = p.textContent.split(" "); p.innerHTML = words.map((w) => `<span class="wd" style="display:inline-block">${esc(w)}</span>`).join(" ");
        gs.from(p.querySelectorAll(".wd"), { y: "0.6em", autoAlpha: 0, duration: 0.9, ease: "power3.out", stagger: 0.025, scrollTrigger: { trigger: p, start: "top 80%", once: true } });
      });
      view.querySelectorAll("[data-beat]").forEach((b) => { if (!plain()) gs.from(b, { autoAlpha: 0.08, y: 24, duration: 1, ease: "power2.out", scrollTrigger: { trigger: b, start: "top 70%", end: "top 30%", scrub: 0.6 } }); });
      // the wheel moves with the home page's sections
      if (name === "home" && ST) view.querySelectorAll("[data-scene]").forEach((sec) => ST.create({ trigger: sec, start: "top 55%", end: "bottom 45%", onToggle: (self) => { if (self.isActive && window.DVGL) window.DVGL.sub(sec.dataset.scene); } }));
    }, view);
    // chapter rows light their point on the wheel
    view.querySelectorAll(".ix-row[data-n], .toc-row[data-n]").forEach((row) => {
      row.addEventListener("pointerenter", () => { window.dispatchEvent(new CustomEvent("dvr:hoverch", { detail: +row.dataset.n })); sound.tick(); });
      row.addEventListener("pointerleave", () => window.dispatchEvent(new CustomEvent("dvr:hoverch", { detail: 0 })));
    });
    view.querySelectorAll(".follow-form").forEach((f) => f.addEventListener("submit", () => { const b = f.querySelector("button"); if (b) b.textContent = "Sending"; }));
    if (name === "reader") mountReader(n);
    if (name === "home") { requestAnimationFrame(() => thread.build()); setTimeout(() => thread.build(), 1500); }
    if (name === "codex") { drawMap(); view.querySelectorAll(".dial button").forEach((b) => b.addEventListener("click", () => { DVR.setReached(+b.dataset.set); sound.light(); rerender(); })); }
    armSafety(); watchAmbient();
  }
  // PERF 4: the page's endless decorative loops (the scroll cue, the next chapter's ring) only run while their element is on screen
  const ambientIO = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("is-off", !e.isIntersecting))) : null;
  function watchAmbient() { if (!ambientIO) return; ambientIO.disconnect(); view.querySelectorAll(".scroll-cue, .is-next .ix-node").forEach((e) => ambientIO.observe(e)); }
  // the bar steps aside while reading downward and returns the moment the reader scrolls back up (PERF 2: a frame hook, not its own scroll listener)
  let lastY = 0;
  frameHooks.add((y) => { root.classList.toggle("bar-solid", y > 40); if (Math.abs(y - lastY) > 6) { root.classList.toggle("bar-away", y > lastY && y > 280); lastY = y; } });
  // a safety net: nothing stays invisible if an observer never fires (no scroll on a short page, a paused tab). It is only needed just after a page is made (PERF 4)
  let safetyT = 0;
  function armSafety() {
    clearInterval(safetyT); let k = 0;
    safetyT = setInterval(() => { if (!gs || ++k > 6) { clearInterval(safetyT); return; } view.querySelectorAll(".page-title, .page-lede, .sec-head h2").forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0 && +getComputedStyle(el).opacity < 0.05) gs.to(el, { autoAlpha: 1, y: 0, duration: 0.6 }); }); }, 1500);
  }
  function rerender() { const y = window.scrollY; const [name, html, n] = resolve(); if (ctx) ctx.revert(); view.innerHTML = html; mount(name, n); if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); if (ST) ST.refresh(); }

  // ---------- reading ----------
  const tearline = $("#tearline");
  // the reading line: a hairline crack that wanders a few units either side of the middle of its 16-unit column (a jagged
  // line's first bend could swing far outside the column, which cut the line off in the middle)
  const tlPts = (() => { const R = rng(5), out = [[8, 0]]; let y = 0, side = 1; while (y < 1000) { y = Math.min(1000, y + 12 + R() * 22); out.push([8 + side * (0.8 + R() * 3.2) * (R() < 0.12 ? 1.5 : 1), y]); side = -side; } return out; })();
  const tlD = "M" + tlPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  tearline.querySelectorAll("path").forEach((p) => p.setAttribute("d", tlD));
  // lit by a clip in the line's own units, so it always stops exactly at the reading position; a point of light rides on it
  const tlLit = tearline.querySelector(".lit"), SVGNS = "http://www.w3.org/2000/svg";
  const tlDefs = document.createElementNS(SVGNS, "defs"), tlClip = document.createElementNS(SVGNS, "clipPath"), tlRect = document.createElementNS(SVGNS, "rect");
  tlClip.id = "tlClip"; tlClip.setAttribute("clipPathUnits", "userSpaceOnUse"); [["x", -24], ["y", -2], ["width", 64], ["height", 0]].forEach(([k, v]) => tlRect.setAttribute(k, v));
  tlClip.appendChild(tlRect); tlDefs.appendChild(tlClip); tearline.insertBefore(tlDefs, tearline.firstChild); tlLit.setAttribute("clip-path", "url(#tlClip)");
  const tlTip = document.createElement("span"); tlTip.className = "tearline-tip"; tlTip.setAttribute("aria-hidden", "true"); document.body.appendChild(tlTip);
  const tlX = (y) => { for (let i = 1; i < tlPts.length; i++) if (tlPts[i][1] >= y) { const v = (y - tlPts[i - 1][1]) / Math.max(0.01, tlPts[i][1] - tlPts[i - 1][1]); return tlPts[i - 1][0] + (tlPts[i][0] - tlPts[i - 1][0]) * v; } return 8; };
  const tlNotch = document.createElement("button"); tlNotch.type = "button"; tlNotch.className = "tearline-mark"; tlNotch.title = "Back to your bookmark"; tlNotch.setAttribute("aria-label", "Back to your bookmark"); document.body.appendChild(tlNotch);
  // PERF 6: the line's box and the prose's position are measured when the page is laid out (mount, resize, fonts, text size, a bookmark change), not on every
  // scroll event; the per-frame work is arithmetic and a few writes. It used to write the clip, then read the line's rect and the mark's (forced layouts).
  let tlG = { x: 0, y: 0, w: 16, h: 0 };
  function tlMeasure() { const b = tearline.getBoundingClientRect(); tlG = { x: b.left, y: b.top, w: b.width, h: b.height }; }
  function tlSet(p, pm) {
    tlRect.setAttribute("height", (p * 1000 + 2).toFixed(1));
    const px = (q) => tlG.x + tlG.w / 2 + (tlX(q * 1000) - 8) * (tlG.w / 16);
    tlTip.style.transform = `translate(${px(p).toFixed(1)}px, ${(tlG.y + p * tlG.h).toFixed(1)}px)`;
    tlTip.classList.toggle("show", p > 0.002 && p < 0.998);
    const on = pm >= 0; tlNotch.classList.toggle("show", on);
    if (on) tlNotch.style.transform = `translate(${px(pm).toFixed(1)}px, ${(tlG.y + pm * tlG.h).toFixed(1)}px)`;
  }
  window.addEventListener("resize", () => { if (typeof readerScroll === "function") readerScroll(); });
  let readerScroll = null, readerHook = null, popY = 0;
  window.addEventListener("scroll", () => { const p = $("#pop"); if (p && p.classList.contains("show") && Math.abs(window.scrollY - popY) > 40) p.classList.remove("show"); }, { passive: true });

  // ---------- the bookmark: one word in each chapter. Held for a moment on a phone, or double-clicked on a computer, it lights
  //            (violet in Akash, a reddish gold in Grahan); the chapter reopens at it, and the same gesture puts it out ----------
  const bookmark = (() => {
    const WORD = /[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu, HOLD = 1000, WAIT = 150, coarse = window.matchMedia("(hover: none) and (pointer: coarse)");
    let prose = null, n = 0, mark = null, kind = "mouse", press = null, swallow = false, hinted = false;
    try { hinted = !!localStorage.getItem("divyarann-bmhint"); } catch (e) {}
    const glow = document.createElement("span"); glow.className = "bm-charge"; glow.setAttribute("aria-hidden", "true"); document.body.appendChild(glow);
    const live = () => !!prose && prose.isConnected;
    const texts = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
    const blockOf = (node) => { let el = node && (node.nodeType === 1 ? node : node.parentNode); while (el && el.parentNode !== prose) el = el.parentNode; return el; };
    const span = (h) => { const r = document.createRange(); r.setStart(h[0], h[1]); r.setEnd(h[0], h[2]); return r; };
    // the word under a point: every word of the paragraph there is measured, and the nearest within reach of the finger wins
    function hitAt(x, y, reach) {
      if (!live()) return null;
      const el = document.elementFromPoint(x, y), block = el && el !== prose && prose.contains(el) ? blockOf(el) : null;
      if (!block || block.classList.contains("scene-break")) return null;
      const r = document.createRange(); let best = null, bd = reach + 0.01;
      for (const t of texts(block)) {
        r.selectNodeContents(t); const tb = r.getBoundingClientRect(); if (y < tb.top - reach || y > tb.bottom + reach) continue;
        WORD.lastIndex = 0; let m;
        while ((m = WORD.exec(t.data))) {
          r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
          for (const q of r.getClientRects()) { const d = Math.hypot(Math.max(q.left - x, 0, x - q.right), Math.max(q.top - y, 0, y - q.bottom)); if (d < bd) { bd = d; best = [t, m.index, m.index + m[0].length]; } }
        }
      }
      return best;
    }
    const offsetIn = (block, t, a) => { let k = 0; for (const u of texts(block)) { if (u === t) return k + a; k += u.data.length; } return -1; };
    function locate(b) {
      const bl = prose.children;
      if (bl[b.p]) { let k = 0; for (const t of texts(bl[b.p])) { if (b.o < k + t.data.length) { const a = b.o - k; if (t.data.substr(a, b.w.length) === b.w) return [t, a, a + b.w.length]; break; } k += t.data.length; } }
      // the chapter was revised since: the same word nearest its old place, in its paragraph or the ones round it
      for (const d of [0, 1, -1, 2, -2, 3, -3]) {
        const block = bl[b.p + d]; if (!block) continue; let best = null, k = 0;
        for (const t of texts(block)) { WORD.lastIndex = 0; let m; while ((m = WORD.exec(t.data))) if (m[0] === b.w) { const dist = Math.abs(k + m.index - b.o); if (!best || dist < best[3]) best = [t, m.index, m.index + m[0].length, dist]; } k += t.data.length; }
        if (best) return best.slice(0, 3);
      }
      return null;
    }
    function light(h, cls) { const m = document.createElement("mark"); m.className = "bm" + (cls ? " " + cls : ""); span(h).surroundContents(m); return m; }
    function douse(m) { m.classList.remove("bm-in", "bm-flare"); m.classList.add("bm-out"); setTimeout(() => { const p = m.parentNode; if (!p) return; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); }, reduced() ? 0 : 700); }
    function flare() { if (!mark) return; mark.classList.remove("bm-in", "bm-flare"); void mark.offsetWidth; mark.classList.add("bm-flare"); }
    function toggle(h) {
      if (mark && mark.contains(h[0])) { douse(mark); mark = null; delete BM[n]; bmSave(); toast("Bookmark removed"); }
      else {
        const block = blockOf(h[0]), b = { p: [...prose.children].indexOf(block), o: offsetIn(block, h[0], h[1]), w: h[0].data.slice(h[1], h[2]), t: Date.now() };
        if (mark) douse(mark);
        mark = light(h, "bm-in"); BM[n] = b; bmSave(); toast("Bookmarked · the chapter reopens here");
      }
      sound.tick(); if (readerScroll) readerScroll();
    }
    // where the word sits, so the page can be placed with it a little above the middle of the screen
    const yFor = (el) => { const r = el.getBoundingClientRect(); return Math.max(0, window.scrollY + r.top + r.height / 2 - window.innerHeight * 0.45); };
    // phones: hold a word; a light gathers on it for a second, and a move or a scroll lets it go
    function charge(h, off) {
      const b = span(h).getBoundingClientRect(), px = 12, py = 8;
      Object.assign(glow.style, { left: (b.left - px) + "px", top: (b.top - py) + "px", width: (b.width + px * 2) + "px", height: (b.height + py * 2) + "px" });
      glow.classList.toggle("off", off); glow.classList.remove("go"); void glow.offsetWidth; glow.classList.add("go");
    }
    function cancel() { if (!press) return; clearTimeout(press.t0); clearTimeout(press.t1); press = null; glow.classList.remove("go"); }
    // the hold follows touch events, not pointer events: a browser that starts its own long-press handling cancels the
    // pointer but keeps sending touches. Samsung phones also report their screens as touchpads, so "(hover: none)" never
    // matches there: a finger on the page is what turns off text selection in the chapter (.dv-touch)
    document.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") { kind = "mouse"; swallow = false; cancel(); } }, { passive: true });
    document.addEventListener("touchstart", (e) => {
      kind = "touch"; swallow = false; cancel(); root.classList.add("dv-touch");
      const tc = e.touches[0];
      if (e.touches.length !== 1 || !live() || !prose.contains(e.target)) return;
      const h = hitAt(tc.clientX, tc.clientY, 10); if (!h) return;
      const p = press = { x: tc.clientX, y: tc.clientY, at: performance.now() };
      p.t0 = setTimeout(() => charge(h, !!(mark && mark.contains(h[0]))), WAIT);
      p.t1 = setTimeout(() => commit(p), HOLD);
    }, { passive: true });
    function commit(p) {
      if (press !== p) return; cancel();
      const h2 = hitAt(p.x, p.y, 10); if (!h2) return;
      swallow = true; try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(12); } catch (err) {}
      toggle(h2);
    }
    document.addEventListener("touchmove", (e) => { const tc = e.touches[0]; if (press && (e.touches.length > 1 || !tc || Math.hypot(tc.clientX - press.x, tc.clientY - press.y) > 14)) cancel(); }, { passive: true });
    document.addEventListener("touchend", cancel, { passive: true });
    // a browser that claims a still long press for itself cancels the touch: past half the hold, that counts as the hold
    document.addEventListener("touchcancel", () => { if (press && performance.now() - press.at >= 450) commit(press); else cancel(); }, { passive: true });
    window.addEventListener("scroll", cancel, { passive: true });
    // the tap that ends a hold is not also a tap on the word (a glossary note); a long press opens no menu and selects nothing
    document.addEventListener("click", (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
    document.addEventListener("contextmenu", (e) => { if (kind !== "mouse" && live() && prose.contains(e.target)) e.preventDefault(); });
    document.addEventListener("selectstart", (e) => { if (kind === "touch" && live() && prose.contains(e.target.nodeType === 1 ? e.target : e.target.parentNode)) e.preventDefault(); });
    // computers: a double-click, without the browser selecting the word first
    document.addEventListener("mousedown", (e) => { if (e.detail > 1 && live() && prose.contains(e.target)) e.preventDefault(); });
    document.addEventListener("dblclick", (e) => {
      if (kind !== "mouse" || !live() || !prose.contains(e.target)) return;
      const h = hitAt(e.clientX, e.clientY, 2); if (!h) return;
      e.preventDefault(); const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges();
      const pop = $("#pop"); if (pop) pop.classList.remove("show");
      toggle(h);
    });
    tlNotch.addEventListener("click", () => {
      if (!mark || !mark.isConnected) return; const y = yFor(mark);
      if (lenis) lenis.scrollTo(y, { duration: 1.3 }); else window.scrollTo({ top: y, behavior: reduced() ? "auto" : "smooth" });
      setTimeout(flare, reduced() ? 0 : 1100);
    });
    function mount(el, chN, land) {
      cancel(); prose = el; n = chN; mark = null;
      const b = BM[n], h = b ? locate(b) : null;
      if (h) mark = light(h);
      if (!b || !land) return;
      const target = mark || prose.children[b.p]; if (!target) return;
      // reopening the chapter: straight to the bookmark once the type has settled, then the word lights as the page appears
      const jump = () => {
        if (!target.isConnected) return; const y = yFor(target);
        if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y);
        if (readerScroll) readerScroll();
        const greet = () => { if (!target.isConnected) return; flare(); toast("Back at your bookmark"); };
        if (root.classList.contains("is-intro")) { const mo = new MutationObserver(() => { if (!root.classList.contains("is-intro")) { mo.disconnect(); setTimeout(greet, 450); } }); mo.observe(root, { attributes: true, attributeFilter: ["class"] }); }
        else setTimeout(greet, 700);
      };
      // after a laid-out frame, or a moment later in a tab opened behind the current one (which draws no frames)
      let once = false; const run = () => { if (!once) { once = true; jump(); } };
      (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => { requestAnimationFrame(() => requestAnimationFrame(run)); setTimeout(run, 160); });
    }
    // where the bookmark lies along the chapter, 0 to 1 (or -1), for the mark on the reading line
    const at = (r) => { if (!mark || !mark.isConnected || !r.height) return -1; const m = mark.getBoundingClientRect(); return Math.min(1, Math.max(0, (m.top + m.height / 2 - r.top) / r.height)); };
    // told once, when they first start reading a chapter
    function hint() { if (hinted) return; hinted = true; try { localStorage.setItem("divyarann-bmhint", "1"); } catch (e) {} setTimeout(() => { if (!Object.keys(BM).length) toast(coarse.matches || root.classList.contains("dv-touch") ? "Hold a word to leave a bookmark" : "Double-click a word to leave a bookmark", 4200); }, 600); }
    return { mount, at, hint };
  })();

  function mountReader(n) {
    const prose = $("#prose"), end = $("#chEnd");
    bookmark.mount(prose, n, landing);
    let pg = { top: 0, h: 1, pm: -1 };
    const onScroll = (y) => { if (!prose || !prose.isConnected) return; if (y == null) y = window.pageYOffset; const p = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - (pg.top - y)) / pg.h)); tlSet(p, pg.pm); if (p > 0.04) bookmark.hint(); };
    const measure = () => { if (!prose || !prose.isConnected) return; tlMeasure(); const r = prose.getBoundingClientRect(); pg = { top: r.top + window.pageYOffset, h: Math.max(1, r.height), pm: bookmark.at(r) }; onScroll(); };
    if (readerHook) frameHooks.delete(readerHook); readerHook = onScroll; frameHooks.add(onScroll);
    readerScroll = measure; measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (prose.isConnected) measure(); else ro.disconnect(); }); ro.observe(prose); }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); if (DVR.markRead(n)) ritual(n); } }), { rootMargin: "0px 0px -30% 0px" });
    io.observe(end);
    // word help
    const pop = $("#pop"), gl = Object.fromEntries(C.glossary.map((g) => [g.id, g]));
    prose.addEventListener("click", (e) => { const w = e.target.closest(".w"); if (!w) { pop.classList.remove("show"); return; } const g = gl[w.dataset.g]; if (!g) return; const r = w.getBoundingClientRect();
      pop.innerHTML = `<b>${esc(g.term)}</b>${esc(g.def)}`; pop.style.left = Math.min(window.innerWidth - 316, Math.max(12, r.left)) + "px"; pop.style.top = (r.bottom + 10) + "px"; pop.classList.add("show"); popY = window.scrollY; sound.tick(); });
  }
  function ritual(n) { sound.light(); toast(`Chapter ${WORDS[n]} · a point is lit`); if (window.DVGL) window.DVGL.light(n); }
  let rs = 20; try { rs = +localStorage.getItem("divyarann-size") || 20; } catch (e) {} root.style.setProperty("--rs", rs + "px");
  const setRs = (v) => { rs = Math.max(16, Math.min(26, v)); root.style.setProperty("--rs", rs + "px"); try { localStorage.setItem("divyarann-size", rs); } catch (e) {} if (ST) ST.refresh(); if (readerScroll) readerScroll(); };
  $("#aMinus").addEventListener("click", () => setRs(rs - 1)); $("#aPlus").addEventListener("click", () => setRs(rs + 1));

  // ---------- small things ----------
  function toast(m, ms) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), ms || 2600); }
  window.DVToast = toast;
  const menuBtn = $("#menuBtn");
  function closeMenu() { root.classList.remove("menu-open"); menuBtn.setAttribute("aria-expanded", "false"); $("#menu").setAttribute("aria-hidden", "true"); $("#menu").inert = true; if (lenis) lenis.start(); }
  menuBtn.addEventListener("click", () => { const open = !root.classList.contains("menu-open"); root.classList.toggle("menu-open", open); menuBtn.setAttribute("aria-expanded", String(open)); $("#menu").setAttribute("aria-hidden", String(!open)); $("#menu").inert = !open; sound.tick(); if (lenis) open ? lenis.stop() : lenis.start(); if (window.DVGL) window.DVGL.menu(open); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.querySelectorAll(".pal button").forEach((b) => b.addEventListener("click", () => {
    const p = b.dataset.p; if ((root.getAttribute("data-palette") || "akash") === p) return;
    if (window.DVGL) window.DVGL.eclipse();
    setTimeout(() => { if (p === "grahan") root.setAttribute("data-palette", "grahan"); else root.removeAttribute("data-palette"); }, 350);
    document.querySelectorAll(".pal button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); try { localStorage.setItem("divyarann-palette", p); } catch (e) {} sound.tick();
  }));
  if (root.getAttribute("data-palette") === "grahan") document.querySelectorAll(".pal button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.p === "grahan")));
  $("#sndBtn").addEventListener("click", () => sound.set(!sound.on));

  // ---------- phones: the book fills the screen. A browser grants full screen only from a tap, so the first tap asks for
  //            it, and so does every tap after the reader leaves it. iPhones give pages no full screen: added to the Home
  //            Screen, the site opens as an app without the browser's bars (the manifest), and they are told so once ----------
  (() => {
    const phone = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 600;
    const app = (window.matchMedia && window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches) || navigator.standalone === true;
    if (!phone || app) return;
    const req = root.requestFullscreen || root.webkitRequestFullscreen, on = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (req && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
      let asking = false;
      const ask = () => {
        if (asking || on() || (navigator.userActivation && !navigator.userActivation.isActive)) return;
        asking = true;
        try { const p = req.call(root, { navigationUI: "hide" }); if (p && p.then) p.then(() => { asking = false; }, () => { asking = false; }); else asking = false; } catch (e) { asking = false; }
      };
      document.addEventListener("touchend", ask, { passive: true }); document.addEventListener("click", ask, { passive: true });
      return;
    }
    if (!/iP(hone|od)/.test(navigator.userAgent)) return;
    let told = false; try { told = !!localStorage.getItem("divyarann-fshint"); } catch (e) {}
    if (told) return;
    const tell = () => { try { localStorage.setItem("divyarann-fshint", "1"); } catch (e) {} setTimeout(() => toast("Full screen: Share, then Add to Home Screen", 5200), 3500); };
    if (!root.classList.contains("is-intro")) tell();
    else { const mo = new MutationObserver(() => { if (!root.classList.contains("is-intro")) { mo.disconnect(); tell(); } }); mo.observe(root, { attributes: true, attributeFilter: ["class"] }); }
  })();

  // ---------- the threshold: the first visit is an opening act, a return is a glance ----------
  const intro = $("#intro"), hold = $("#hold"), holdBtn = $("#holdBtn"), fg = holdBtn.querySelector(".fg");
  const iPts = jagged([20, 0], [20, 1000], 6, 0.1, rng(3)), iPath = intro.querySelector(".intro-line path");
  iPath.setAttribute("d", "M" + iPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L"));
  let iLen = 1000; try { iLen = iPath.getTotalLength(); } catch (e) {}
  iPath.style.strokeDasharray = iLen; iPath.style.strokeDashoffset = iLen;
  let entered = false;
  function enter(withSound) {
    if (entered) return; entered = true;
    try { localStorage.setItem("divyarann-seen", "1"); } catch (e) {}
    if (withSound) sound.set(true);
    if (window.DVGL) window.DVGL.open();
    const done = () => { root.classList.remove("is-intro"); root.classList.add("entered"); intro.remove(); if (ST) ST.refresh(); };
    if (gs && !reduced()) gs.timeline({ onComplete: done }).to(hold, { autoAlpha: 0, duration: 0.4 }, 0).to(intro.querySelectorAll(".intro-count, .intro-word"), { autoAlpha: 0, duration: 0.6 }, 0).to(iPath, { opacity: 0, duration: 0.8 }, 0.2).add(() => { root.classList.remove("is-intro"); root.classList.add("entered"); }, 0.35);
    else done();
  }
  function runIntro() {
    const returning = root.classList.contains("returning"), n = DVR.reached();
    $("#introLabel").textContent = "of 18 lit";
    if (window.DVGL) window.DVGL.intro(returning);
    if (!gs || reduced()) { $("#introNum").textContent = pad(n); if (returning) setTimeout(() => enter(false), 300); else hold.classList.add("ready"); return; }
    // the count keeps its element: a reader who enters before it has finished removes the threshold, and looking the element up again then threw on every frame
    // until the count ended, which stopped every later ticker listener (the wheel's wipe stood still for a third of a second)
    const num = { v: 0 }, numEl = $("#introNum");
    const tl = gs.timeline();
    tl.to(iPath, { strokeDashoffset: 0, duration: returning ? 0.7 : 1.6, ease: "power2.inOut" }, returning ? 0 : 0.3)
      .to(num, { v: n, duration: returning ? 0.6 : 1.8, ease: "power2.out", onUpdate: () => { numEl.textContent = pad(Math.round(num.v)); } }, returning ? 0.1 : 0.8);
    if (returning) tl.add(() => enter(false), 1.3);
    else tl.add(() => hold.classList.add("ready"), 3.2);
  }
  let holdT = null;
  const startHold = (e) => { e.preventDefault(); if (!gs) { enter(true); return; } holdT = gs.to(fg, { strokeDashoffset: 0, duration: 0.9, ease: "power1.in", onComplete: () => enter(true) }); };
  const stopHold = () => { if (holdT && !entered) { holdT.kill(); gs.to(fg, { strokeDashoffset: 264, duration: 0.4 }); } };
  holdBtn.addEventListener("pointerdown", startHold); ["pointerup", "pointerleave", "pointercancel"].forEach((t) => holdBtn.addEventListener(t, stopHold));
  holdBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") enter(true); });
  $("#holdSkip").addEventListener("click", () => enter(false));

  if (/[?&]perf=1/.test(location.search)) {
    const pv = document.createElement("pre"); pv.className = "perf-hud"; document.body.appendChild(pv);
    setInterval(() => { const P = window.DVPerf; if (!P) return;
      pv.textContent = `${P.fps} fps   ${P.hz || "?"} Hz   ${P.late}% late${P.calm ? "   resting" : ""}\nlevel ${P.lv} of 3   resolution ${Math.round(P.q * 100)}%   ${P.w}x${P.h}\n${(P.gpu || "unknown GPU").replace(/^ANGLE \(|\(0x[0-9A-F]+\)| Direct3D.*$/gi, "")}`; }, 500);
  }
  // ---------- start ----------
  updateCount();
  go(true);
  runIntro();
  setTimeout(() => { if (!window.__sceneReady) root.classList.add("no-webgl"); }, 5000);   // the sky would not open: the page is complete without it
})();
