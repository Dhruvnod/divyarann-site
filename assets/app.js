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
  const reduced = () => reduceMQ.matches || root.classList.contains("dv-still");
  const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen"];
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
  function updateCount() { const n = DVR.reached(); const el = $("#litCount b"); if (el) el.textContent = pad(n); }
  window.addEventListener("dvr:progress", updateCount);

  // ---------- pages ----------
  const chap = (n) => C.chapters.find((c) => c.n === n);
  const nextLine = () => (C.next ? (C.next.date ? `Chapter ${WORDS[C.next.n]} arrives ${C.next.date}.` : `Chapter ${WORDS[C.next.n]} is on its way.`) : "");
  const foot = () => `<footer class="foot"><div class="foot-in"><p>© ${new Date().getFullYear()} ${esc(C.author)}. All rights reserved.</p>
      <p>Divyarann is a work of fiction. This is the draft web edition of Book One: chapters may be revised, and this edition may be withdrawn when the book is published. Please share the link rather than reposting chapters elsewhere.</p>
      <p class="foot-links"><a href="/about/">About and privacy</a><a href="mailto:hello@divyarann.com">hello@divyarann.com</a>${C.instagram ? `<a href="${esc(C.instagram)}" rel="noopener">Instagram</a>` : ""}<a href="/feed.xml">RSS</a></p></div></footer>`;
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
        <div class="cta-row" data-hush><a class="cta" href="/read/${begin}/">${r === 0 ? "Begin · Chapter One" : r >= C.released ? "Read again · Chapter One" : "Continue · Chapter " + WORDS[begin]}</a><a class="cta ghost" href="/read/">All chapters</a></div>
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
          <span class="toc-s">${esc(c.summary)}</span><span class="toc-m">${esc(c.pov)} · ${c.minutes} min${DVR.isRead(c.n) ? " · lit" : ""}</span></a></li>`).join("")}
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
      </article>`;
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
  const sealedPage = (kick, title, line) => `<section class="page-head sealed-page"><p class="kicker"><span>${kick}</span></p><h1 class="page-title">${title}</h1><p class="page-lede">${line}</p><p class="sealed-line">${esc(nextLine())}</p></section>${foot()}`;
  function about() {
    return `<section class="page-head"><p class="kicker"><span>About</span></p><h1 class="page-title">Divyarann</h1></section>
      <section class="about"><h2>The book</h2><p>DIVYARANN is a trilogy of Indian mythological fantasy set in modern Delhi. Book One, <em>Vinash</em>, is published here as a free web edition, one chapter at a time, while it is being written.</p>
      <h2>The author</h2><p>Written by ${esc(C.author)}. Write to hello@divyarann.com.</p>
      <h2>Privacy</h2><p>Your reading progress stays on your device. The site sets no advertising or tracking cookies.</p></section>${foot()}`;
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
    let s = `<svg viewBox="0 0 1000 620" role="img" aria-label="A drawn map of Dwarka with the places you have reached">`;
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) { const x = 70 + col * 100 + (row % 2 ? 18 : 0), y = 34 + row * 96; if (x > 900 || R() < 0.08) continue; s += `<rect class="blk" x="${x}" y="${y}" width="${78 + R() * 8}" height="${70 + R() * 6}" rx="4"/>`; }
    s += `<path class="rail" d="M 612,18 C 586,120 520,196 486,268 C 452,340 468,420 520,486 C 560,536 610,572 648,604"/>`;
    C.places.filter((p) => p.x != null).forEach((p, i) => {
      const open = p.ch <= r;
      s += `<g class="pin${open ? "" : " sealed"}" data-i="${i}" tabindex="0" role="button" aria-label="${open ? esc(p.name) : "A sealed place"}"><circle cx="${p.x}" cy="${p.y}" r="${open ? 5 : 4.5}"/>${open ? `<text x="${p.x + (p.side === "end" ? -12 : 12)}" y="${p.y + 4}" text-anchor="${p.side === "end" ? "end" : "start"}">${esc(p.name)}</text>` : ""}</g>`;
    });
    host.innerHTML = s + `</svg><div class="map-note" id="mapNote">${r ? "Tap a place to remember what happened there." : "Nothing on the map yet. Read Chapter One and the first places appear."}</div>`;
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

  // ---------- smooth scroll ----------
  let lenis = null;
  if (gs && ST) {
    gs.registerPlugin(ST); ST.config({ ignoreMobileResize: true });
    if (window.Lenis && !reduceMQ.matches) { lenis = new window.Lenis({ lerp: 0.1, anchors: false }); lenis.on("scroll", ST.update); gs.ticker.add((t) => lenis.raf(t * 1000)); gs.ticker.lagSmoothing(0); window.DVLenis = lenis; }
  }

  // ---------- routing ----------
  const ROUTES = [
    [/^(home)?$/, () => ["home", home()]], [/^chapters$/, () => ["contents", contents()]], [/^ch-(\d+)$/, (m) => ["reader", reader(+m[1]), +m[1]]],
    [/^codex$/, () => ["codex", codex()]], [/^story$/, () => ["story", story()]],
    [/^tears$/, () => ["tears", sealedPage("Atlas", "The Seven Tears", "The sky has not opened yet. This atlas fills in as the story reaches the tears.")]],
    [/^powers$/, () => ["powers", sealedPage("Reference", "Powers", "One energy, latent in everyone, answering what a person is actually resolved to do. Nobody has awakened yet.")]],
    [/^about$/, () => ["about", about()]],
    [/^subscribed$/, () => ["subscribed", mailPage("Almost there", "Check your email", "A confirmation link is on its way to your inbox. Open it and each new chapter will reach you by email. If it has not arrived in a few minutes, look in Promotions or Spam.", `<a class="cta" href="/read/">Back to the chapters</a>`)]],
    [/^confirmed$/, () => ["confirmed", mailPage("You are on the list", "Welcome to Divyarann", "Each new chapter will arrive in your inbox on the day it is released.", `<a class="cta" href="/read/1/">Start at Chapter One</a><a class="cta ghost" href="/read/">All chapters</a>`)]],
    [/^notfound$/, () => ["notfound", notFound()]],
  ];
  function mailPage(kick, title, line, ctas) { return `<section class="page-head sealed-page"><p class="kicker"><span>${kick}</span></p><h1 class="page-title">${title}</h1><p class="page-lede">${line}</p><div class="cta-row">${ctas}</div></section>${foot()}`; }
  function notFound() { return `<section class="page-head sealed-page"><p class="kicker"><span>Not found</span></p><h1 class="page-title">This page is not in the book</h1><p class="page-lede">The link may be old, or the page may not have opened yet.</p><div class="cta-row"><a class="cta" href="/">Back to the threshold</a><a class="cta ghost" href="/read/">All chapters</a></div></section>${foot()}`; }
  const TITLES = { subscribed: "Check your email · Divyarann", confirmed: "Welcome · Divyarann", notfound: "Not found · Divyarann", home: "Divyarann · Book One: Vinash", contents: "Chapters · Divyarann", codex: "Codex · Divyarann", story: "The Story · Divyarann", tears: "The Seven Tears · Divyarann", powers: "Powers · Divyarann", about: "About · Divyarann" };
  let current = null, navId = 0, ctx = null;
  function routeKey() {
    const p = location.pathname.replace(/\/index\.html$/, "/").replace(/([^/])$/, "$1/"), h = (location.hash || "").replace(/^#\/?/, "");
    if (p === "/" && /^(story|tears|powers|codex|about|chapters|ch-\d+)$/.test(h)) return h;
    let m;
    if (p === "/") return "home";
    if (p === "/read/") return "chapters";
    if ((m = p.match(/^\/read\/(\d+)\/$/))) return "ch-" + m[1];
    if ((m = p.match(/^\/(codex|story|tears|powers|about|subscribed|confirmed)\/$/))) return m[1];
    return "notfound";
  }
  const PATHS = { home: "/", chapters: "/read/", codex: "/codex/", story: "/story/", tears: "/tears/", powers: "/powers/", about: "/about/" };
  function resolve() { const h = routeKey(); for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) return fn(m); } return ["notfound", notFound()]; }
  async function go(first) {
    const id = ++navId;
    closeMenu();
    const [name, html, n] = resolve();
    if (!first) { window.DVGL && window.DVGL.leave(name); await closeTear(); if (id !== navId) return; }
    if (ctx) ctx.revert();
    thread.clear();
    view.innerHTML = html; view.dataset.page = name;
    root.classList.toggle("on-reader", name === "reader");
    document.querySelectorAll(".menu a[data-route]").forEach((a) => a.classList.toggle("is-on", a.dataset.route === name || (name === "reader" && a.dataset.route === "contents")));
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true }); else window.scrollTo(0, 0);
    current = { name, n };
    document.title = name === "reader" ? `Chapter ${WORDS[n]}: ${chap(n) ? chap(n).title : ""} · Divyarann` : TITLES[name] || TITLES.home;
    mount(name, n);
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
    let on = false, pts = [], cum = [], litLen = 0, nodes = [], target = null, spark = null, tail = null, tailG = null, hubDot = null, clipRect = null;
    let phase = "wait", u = 0, wait = 1.2, dur = 3, drawn = true, flash = 0, torn = null, drewFor = null;
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
      // the pulse, in its own layer so the thread is never redrawn
      sv2.setAttribute("width", W); sv2.setAttribute("height", H); sv2.setAttribute("viewBox", `0 0 ${W} ${H}`); sv2.replaceChildren();
      const d2 = E("defs", {}, sv2), rg = E("radialGradient", { id: "thGlow" }, d2);
      [[0, 0.95], [0.3, 0.45], [1, 0]].forEach(([o, a]) => E("stop", { offset: o, style: `stop-color: var(--accent); stop-opacity: ${a}` }, rg));
      tailG = E("linearGradient", { id: "thTail", gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 0, y2: 1 }, d2);
      E("stop", { offset: 0, style: "stop-color: var(--accent); stop-opacity: 0" }, tailG); E("stop", { offset: 1, style: "stop-color: var(--bone); stop-opacity: 0.95" }, tailG);
      hubDot = E("circle", { cx: pts[0][0], cy: pts[0][1], r: 34, fill: "url(#thGlow)", opacity: 0 }, sv2);
      tail = E("polyline", { class: "th-tail", stroke: "url(#thTail)", points: "" }, sv2);
      spark = E("g", { class: "th-spark", opacity: 0 }, sv2);
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
      const rak = root.getAttribute("data-rakta") === "on";
      flash *= Math.pow(0.02, dt); hubDot.setAttribute("opacity", flash.toFixed(3));
      if (phase === "wait") {
        wait -= dt; if (wait > 0) return;
        if (rak && ((performance.now() / 1000) % 1.15) / 1.15 > 0.1) return;   // in the battle the drop leaves on a beat
        phase = "run"; u = 0; dur = Math.min(4.4, Math.max(1.7, litLen / 330)); flash = 1; nodes.forEach((n) => { n.hit = false; });
      }
      u = Math.min(1, u + dt / dur); const s = litLen * easeIO(u), p = at(s);
      const T = torn.getBoundingClientRect(), vy = T.top + p[1];
      nodes.forEach((n) => { if (!n.hit && n.read && n !== target && n.s <= s) { n.hit = true; n.el.classList.remove("ping"); void n.el.offsetWidth; n.el.classList.add("ping"); } });
      if (vy > -200 && vy < window.innerHeight + 200) {
        const a = Math.min(1, u * 8) * (u > 0.95 ? (1 - u) / 0.05 : 1), tl = Math.min(130, s);
        spark.setAttribute("transform", `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`); spark.setAttribute("opacity", a.toFixed(3));
        const q = []; for (let i = 0; i <= 8; i++) q.push(at(s - tl + tl * i / 8)); tail.setAttribute("points", q.map((v) => v[0].toFixed(1) + "," + v[1].toFixed(1)).join(" ")); tail.setAttribute("opacity", a.toFixed(3));
        tailG.setAttribute("x1", q[0][0].toFixed(1)); tailG.setAttribute("y1", q[0][1].toFixed(1)); tailG.setAttribute("x2", p[0].toFixed(1)); tailG.setAttribute("y2", p[1].toFixed(1));
      } else { spark.setAttribute("opacity", 0); tail.setAttribute("opacity", 0); }
      if (u >= 1) {
        phase = "wait"; wait = rak ? 1.6 : 2.6; spark.setAttribute("opacity", 0); tail.setAttribute("opacity", 0);
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
        if (reduced()) return;
        const st = { trigger: row, start: "top 94%", once: true };
        gs.from(row.querySelector(".ix-l"), { x: window.innerWidth < 900 ? 0 : -34, y: window.innerWidth < 900 ? 18 : 0, autoAlpha: 0, duration: 1.0, ease: "power3.out", scrollTrigger: st });
        gs.from(row.querySelector(".ix-r"), { x: window.innerWidth < 900 ? 0 : 34, y: window.innerWidth < 900 ? 18 : 0, autoAlpha: 0, duration: 1.0, ease: "power3.out", delay: 0.06, scrollTrigger: st });
        gs.from(row.querySelector(".ix-node"), { scale: 0.4, autoAlpha: 0, duration: 0.8, ease: "power3.out", scrollTrigger: st });
      });
      view.querySelectorAll(".sec-head h2, .page-title, .page-lede, .toc-row, .four-card, .card, .book, .sums li").forEach((el) => {
        if (reduced()) return;
        if (el.getBoundingClientRect().top < window.innerHeight) gs.from(el, { y: 40, autoAlpha: 0, duration: 1.0, ease: "power3.out", delay: 0.15 + 0.07 * k++ });
        else gs.from(el, { y: 40, autoAlpha: 0, duration: 1.0, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 96%", once: true } });
      });
      // the premise arrives one line at a time
      view.querySelectorAll("[data-lines]").forEach((p) => {
        if (reduced()) return;
        const words = p.textContent.split(" "); p.innerHTML = words.map((w) => `<span class="wd" style="display:inline-block">${esc(w)}</span>`).join(" ");
        gs.from(p.querySelectorAll(".wd"), { y: "0.6em", autoAlpha: 0, duration: 0.9, ease: "power3.out", stagger: 0.025, scrollTrigger: { trigger: p, start: "top 80%", once: true } });
      });
      view.querySelectorAll("[data-beat]").forEach((b) => { if (!reduced()) gs.from(b, { autoAlpha: 0.08, y: 24, duration: 1, ease: "power2.out", scrollTrigger: { trigger: b, start: "top 70%", end: "top 30%", scrub: 0.6 } }); });
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
  }
  // the bar steps aside while reading downward and returns the moment the reader scrolls back up
  let lastY = 0;
  window.addEventListener("scroll", () => { const y = window.scrollY; root.classList.toggle("bar-solid", y > 40); if (Math.abs(y - lastY) > 6) { root.classList.toggle("bar-away", y > lastY && y > 280); lastY = y; } }, { passive: true });
  // a safety net: nothing stays invisible if an observer never fires (no scroll on a short page, a paused tab)
  setInterval(() => { if (!gs) return; view.querySelectorAll(".page-title, .page-lede, .sec-head h2").forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0 && +getComputedStyle(el).opacity < 0.05) gs.to(el, { autoAlpha: 1, y: 0, duration: 0.6 }); }); }, 1500);
  function rerender() { const y = window.scrollY; const [name, html, n] = resolve(); if (ctx) ctx.revert(); view.innerHTML = html; mount(name, n); if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); if (ST) ST.refresh(); }

  // ---------- reading ----------
  const tearline = $("#tearline");
  const tlPts = jagged([8, 0], [8, 1000], 6, 0.08, rng(5));
  const tlD = "M" + tlPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  tearline.querySelectorAll("path").forEach((p) => p.setAttribute("d", tlD));
  const tlLit = tearline.querySelector(".lit"); let tlLen = 1000;
  try { tlLen = tlLit.getTotalLength(); } catch (e) {}
  tlLit.style.strokeDasharray = tlLen; tlLit.style.strokeDashoffset = tlLen;
  let readerScroll = null;
  function mountReader(n) {
    const prose = $("#prose"), end = $("#chEnd");
    const onScroll = () => { if (!prose || !prose.isConnected) return; const r = prose.getBoundingClientRect(), h = window.innerHeight; const p = Math.min(1, Math.max(0, (h * 0.6 - r.top) / r.height)); tlLit.style.strokeDashoffset = tlLen * (1 - p); };
    if (readerScroll) window.removeEventListener("scroll", readerScroll); readerScroll = onScroll; window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); if (DVR.markRead(n)) ritual(n); } }), { rootMargin: "0px 0px -30% 0px" });
    io.observe(end);
    // word help
    const pop = $("#pop"), gl = Object.fromEntries(C.glossary.map((g) => [g.id, g]));
    prose.addEventListener("click", (e) => { const w = e.target.closest(".w"); if (!w) { pop.classList.remove("show"); return; } const g = gl[w.dataset.g]; if (!g) return; const r = w.getBoundingClientRect();
      pop.innerHTML = `<b>${esc(g.term)}</b>${esc(g.def)}`; pop.style.left = Math.min(window.innerWidth - 316, Math.max(12, r.left)) + "px"; pop.style.top = (r.bottom + 10) + "px"; pop.classList.add("show"); sound.tick(); });
    window.addEventListener("scroll", () => pop.classList.remove("show"), { passive: true, once: true });
  }
  function ritual(n) { sound.light(); toast(`Chapter ${WORDS[n]} · a point is lit`); if (window.DVGL) window.DVGL.light(n); }
  let rs = 20; try { rs = +localStorage.getItem("divyarann-size") || 20; } catch (e) {} root.style.setProperty("--rs", rs + "px");
  const setRs = (v) => { rs = Math.max(16, Math.min(26, v)); root.style.setProperty("--rs", rs + "px"); try { localStorage.setItem("divyarann-size", rs); } catch (e) {} if (ST) ST.refresh(); };
  $("#aMinus").addEventListener("click", () => setRs(rs - 1)); $("#aPlus").addEventListener("click", () => setRs(rs + 1));

  // ---------- small things ----------
  function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }
  window.DVToast = toast;
  const menuBtn = $("#menuBtn");
  function closeMenu() { root.classList.remove("menu-open"); menuBtn.setAttribute("aria-expanded", "false"); $("#menu").setAttribute("aria-hidden", "true"); if (lenis) lenis.start(); }
  menuBtn.addEventListener("click", () => { const open = !root.classList.contains("menu-open"); root.classList.toggle("menu-open", open); menuBtn.setAttribute("aria-expanded", String(open)); $("#menu").setAttribute("aria-hidden", String(!open)); sound.tick(); if (lenis) open ? lenis.stop() : lenis.start(); if (window.DVGL) window.DVGL.menu(open); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.querySelectorAll(".pal button").forEach((b) => b.addEventListener("click", () => {
    const p = b.dataset.p; if ((root.getAttribute("data-palette") || "akash") === p) return;
    if (window.DVGL) window.DVGL.eclipse();
    setTimeout(() => { if (p === "grahan") root.setAttribute("data-palette", "grahan"); else root.removeAttribute("data-palette"); }, 350);
    document.querySelectorAll(".pal button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); try { localStorage.setItem("divyarann-palette", p); } catch (e) {} sound.tick();
  }));
  if (root.getAttribute("data-palette") === "grahan") document.querySelectorAll(".pal button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.p === "grahan")));
  $("#sndBtn").addEventListener("click", () => sound.set(!sound.on));

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
    const num = { v: 0 };
    const tl = gs.timeline();
    tl.to(iPath, { strokeDashoffset: 0, duration: returning ? 0.7 : 1.6, ease: "power2.inOut" }, returning ? 0 : 0.3)
      .to(num, { v: n, duration: returning ? 0.6 : 1.8, ease: "power2.out", onUpdate: () => { $("#introNum").textContent = pad(Math.round(num.v)); } }, returning ? 0.1 : 0.8);
    if (returning) tl.add(() => enter(false), 1.3);
    else tl.add(() => hold.classList.add("ready"), 3.2);
  }
  let holdT = null;
  const startHold = (e) => { e.preventDefault(); if (!gs) { enter(true); return; } holdT = gs.to(fg, { strokeDashoffset: 0, duration: 0.9, ease: "power1.in", onComplete: () => enter(true) }); };
  const stopHold = () => { if (holdT && !entered) { holdT.kill(); gs.to(fg, { strokeDashoffset: 264, duration: 0.4 }); } };
  holdBtn.addEventListener("pointerdown", startHold); ["pointerup", "pointerleave", "pointercancel"].forEach((t) => holdBtn.addEventListener(t, stopHold));
  holdBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") enter(true); });
  $("#holdSkip").addEventListener("click", () => enter(false));

  // ---------- start ----------
  updateCount();
  go(true);
  runIntro();
  setTimeout(() => { if (!window.__sceneReady) root.classList.add("no-webgl"); }, 5000);   // the sky would not open: the page is complete without it
})();
