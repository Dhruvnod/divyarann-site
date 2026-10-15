/* The drawn map of Dwarka on /codex/. Not to scale: unnumbered sector blocks, the raised Blue Line, and the places the
   story has reached for this reader. Places in chapters they have not read show as sealed marks with no name. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen"];
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { var v = attrs[k]; if (typeof v === "string" && v.indexOf("var(") === 0) e.style.setProperty(k, v); else e.setAttribute(k, v); }
    if (parent) parent.appendChild(e); return e;
  }
  function rng(seed) { return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var METRO = "M 612,18 C 586,120 520,196 486,268 C 452,340 468,420 520,486 C 560,536 610,572 648,604";

  window.DV_MAP = function (host, places, reached) {
    if (!host) return;
    host.innerHTML = "";
    var scroller = document.createElement("div"); scroller.className = "map-scroll"; host.appendChild(scroller);
    var svg = el("svg", { viewBox: "0 0 1000 620", role: "img", "aria-label": "A drawn map of Dwarka with the places of the story" }, scroller);
    var r = rng(12);
    // sector blocks: a planned city of numbered blocks (left unnumbered here)
    var blocks = el("g", { "aria-hidden": "true" }, svg);
    for (var row = 0; row < 6; row++) for (var col = 0; col < 9; col++) {
      var x = 70 + col * 100 + (row % 2 ? 18 : 0), y = 34 + row * 96;
      if (x > 900 || (col === 8 && row > 3) || r() < 0.08) continue;
      el("rect", { x: x, y: y, width: 78 + r() * 8, height: 70 + r() * 6, rx: 6, fill: "var(--night-2)", stroke: "var(--line)", "stroke-width": 1 }, blocks);
    }
    // the airport to the east, and the roads out
    el("path", { d: "M 880,330 L 990,300 L 990,520 L 900,540 Z", fill: "var(--night)", stroke: "var(--line-strong)", "stroke-dasharray": "4 5" }, blocks);
    var lab = el("text", { x: 944, y: 430, "text-anchor": "middle", "class": "map-lab" }, blocks); lab.textContent = "Airport";
    [["To Najafgarh", 18, 330, "start"], ["To Gurugram", 982, 604, "end"], ["To Dwarka Mor", 612, 14, "middle"]].forEach(function (t) {
      var tx = el("text", { x: t[1], y: t[2], "text-anchor": t[3], "class": "map-lab" }, blocks); tx.textContent = t[0];
    });
    // the Blue Line, lit once the story has noticed it
    var line = places.filter(function (p) { return p.kind === "line"; })[0], lineLit = line && line.ch <= reached;
    el("path", { d: METRO, fill: "none", stroke: lineLit ? "var(--tear)" : "var(--line-strong)", "stroke-width": lineLit ? 10 : 6, opacity: lineLit ? 0.35 : 0.6, "stroke-linecap": "round" }, svg);
    var mp = el("path", { d: METRO, fill: "none", stroke: lineLit ? "var(--tear-glow)" : "var(--muted)", "stroke-width": lineLit ? 2.4 : 1.6, "stroke-linecap": "round", "stroke-dasharray": lineLit ? "none" : "1 7" }, svg);
    var len = mp.getTotalLength ? mp.getTotalLength() : 0;
    for (var s = 1; s < 10 && len; s++) { var pt = mp.getPointAtLength(len * s / 10); el("circle", { cx: pt.x, cy: pt.y, r: 4.5, fill: "var(--night)", stroke: lineLit ? "var(--tear-glow)" : "var(--line-strong)", "stroke-width": 1.5 }, svg); }
    if (lineLit) { var bl = el("text", { x: 500, y: 236, "class": "map-lab line-lab", transform: "rotate(-52 500 236)" }, svg); bl.textContent = "Blue Line"; }

    // places
    var note = document.createElement("div"); note.className = "dv-map-note"; note.setAttribute("aria-live", "polite");
    var pinned = places.filter(function (p) { return p.x != null; }), sealedCount = 0, active = null;
    function show(p, g) {
      if (active) active.classList.remove("active"); active = g; g.classList.add("active");
      note.innerHTML = p.ch <= reached ? "<b></b><span></span>" : "<b>Sealed</b><span></span>";
      if (p.ch <= reached) { note.querySelector("b").textContent = p.name; note.querySelector("span").textContent = p.text; }
      else note.querySelector("span").textContent = "Read Chapter " + WORDS[p.ch] + " to find this place.";
    }
    pinned.forEach(function (p) {
      var open = p.ch <= reached; if (!open) sealedCount++;
      var g = el("g", { "class": "mp" + (open ? "" : " sealed"), tabindex: "0", role: "button", "aria-label": open ? p.name : "A sealed place" }, svg);
      if (open) el("circle", { cx: p.x, cy: p.y, r: 13, "class": "mp-halo" }, g);
      el("circle", { cx: p.x, cy: p.y, r: open ? 6.5 : 5, "class": "mp-dot" }, g);
      if (open) { var t = el("text", { x: p.x + (p.side === "end" ? -14 : 14), y: p.y + 4.5, "text-anchor": p.side === "end" ? "end" : "start" }, g); t.textContent = p.name; }
      g.addEventListener("click", function () { show(p, g); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(p, g); } });
    });
    host.appendChild(note);
    if (scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) * 0.38;   // open on the market
    var openCount = pinned.length - sealedCount;
    note.textContent = openCount ? "Tap a place to remember what happened there." : "Nothing on the map yet. Read Chapter One and the first places appear.";
    // elsewhere
    var away = places.filter(function (p) { return p.x == null && p.kind !== "line"; });
    var legend = document.createElement("div"); legend.className = "dv-map-legend";
    legend.innerHTML = "<span>" + openCount + " place" + (openCount === 1 ? "" : "s") + " found in Dwarka" + (sealedCount ? ", " + sealedCount + " still sealed" : "") + "</span>";
    host.appendChild(legend);
    if (away.length) {
      var list = document.createElement("div"); list.className = "dv-elsewhere";
      var h = document.createElement("p"); h.className = "k"; h.textContent = "Elsewhere"; list.appendChild(h);
      var ul = document.createElement("ul");
      away.forEach(function (p) {
        var li = document.createElement("li");
        if (p.ch <= reached) { var b = document.createElement("b"); b.textContent = p.name; li.appendChild(b); li.appendChild(document.createTextNode(" " + p.text)); }
        else { li.className = "is-sealed"; li.textContent = "Sealed until Chapter " + WORDS[p.ch] + "."; }
        ul.appendChild(li);
      });
      list.appendChild(ul); host.appendChild(list);
    }
  };
})();
