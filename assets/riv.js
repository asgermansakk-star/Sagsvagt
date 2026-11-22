// Riv op (Asger 21/11-2026): et kornet papir med logoet rives over fra toppen og ned, og avisen bagved kommer frem.
// Bruges to steder:
//   1. Som loadingskærm, første gang man åbner siden i en session (og hver gang webappen startes). Papiret står i
//      avishovedet som <div class="riv" id="riv">; et lille script før det skjuler det med det samme, hvis det er vist
//      før i sessionen. Uden JavaScript skjuler CSS'en det selv efter få sekunder, så siden aldrig bliver låst.
//   2. Når man skriver sig op (vagt.html): svRiv.forbered() i trykket, så må lyden spille, og svRiv.riv() når
//      tilmeldingen er gået igennem.
// Lyden laves i koden (ingen lydfil): bløde klik fra fibre, der knækker i små ryk, en dæmpet krop og et lille sus.
// Lydreglen fra 19/11 gælder: lyd kun efter et tryk og aldrig, hvis den er slået fra under Konto ("sv-lyd").
// Ved "reducer bevægelse" toner papiret bare ud.
(function () {
  "use strict";
  var RO = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ctx = null;

  // ---------- lyd ----------
  function rivLyd(sr, varighed) {
    var laengde = Math.round(sr * (varighed + 0.8)), klik = new Float32Array(laengde), ud = new Float32Array(laengde);
    var tilf = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20261121);
    var stoej = function () { return tilf() * 2 - 1; };
    var fart = function (t) { if (t < 0) return 0; if (t > varighed) return Math.exp(-(t - varighed) / 0.06); return Math.pow(2, 6 * (t / varighed - 1)); };
    function bp(x, fc, q) {
      var w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
      var b0 = al / a0, b2 = -al / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0, x1 = 0, x2 = 0, y1 = 0, y2 = 0, y = new Float32Array(x.length);
      for (var i = 0; i < x.length; i++) { var v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
      return y;
    }
    var fase = 0, i, j;
    for (i = 0; i < laengde; i++) {   // fibrene: bløde klik i ryk, 14–44 ryk i sekundet efter revnens fart
      var f = fart(i / sr); if (f < 0.002) continue;
      fase += (14 + 30 * f) / sr;
      var ryk = Math.pow(Math.max(0, Math.sin(Math.PI * (fase % 1))), 3);
      if (tilf() < (300 + 4200 * f) * (0.15 + 0.85 * ryk) / sr) {
        var styrke = (0.4 + 0.6 * tilf()) * (0.2 + 0.8 * f), fortegn = tilf() < .5 ? -1 : 1, n = Math.round(sr * (0.0003 + tilf() * 0.0006));
        for (var k = 0; k < n && i + k < laengde; k++) klik[i + k] += fortegn * styrke * 0.5 * (1 - Math.cos(2 * Math.PI * k / n));
      }
    }
    var r1 = bp(klik, 900, 1.2), r2 = bp(klik, 2200, 1.8), r3 = bp(klik, 4200, 1.6), lt = 0, alt = Math.exp(-2 * Math.PI * 3500 / sr);
    for (j = 0; j < laengde; j++) { lt = alt * lt + (1 - alt) * (r1[j] * 0.9 + r2[j] * 0.8 + r3[j] * 0.12); ud[j] = lt * 1.3; }
    var lp = 0, al2 = Math.exp(-2 * Math.PI * 650 / sr); fase = 0;
    for (j = 0; j < laengde; j++) {   // kroppen: dæmpet, lav støj i samme ryk
      var f2 = fart(j / sr); fase += (14 + 30 * f2) / sr;
      lp = al2 * lp + (1 - al2) * stoej(); ud[j] += lp * 0.7 * f2 * (0.55 + 0.45 * Math.pow(Math.max(0, Math.sin(Math.PI * (fase % 1))), 2));
    }
    var s0 = varighed - 0.03, s1 = varighed + 0.55, sus = new Float32Array(laengde);
    for (j = Math.round(s0 * sr); j < Math.min(laengde, Math.round(s1 * sr)); j++) sus[j] = stoej() * Math.sin(Math.PI * (j / sr - s0) / (s1 - s0));
    var susF = bp(sus, 900, 0.9);
    for (j = 0; j < laengde; j++) ud[j] += susF[j] * 0.08;
    var hp = 0, forrige = 0, ah = Math.exp(-2 * Math.PI * 160 / sr), top = 0;
    for (j = 0; j < laengde; j++) { var v = ud[j]; hp = ah * (hp + v - forrige); forrige = v; ud[j] = hp; top = Math.max(top, Math.abs(hp)); }
    for (j = 0; j < laengde; j++) ud[j] = Math.tanh(ud[j] / (top || 1) * 1.6) / Math.tanh(1.6) * 0.27;
    for (j = 0; j < sr * 0.01; j++) { ud[j] *= j / (sr * 0.01); ud[laengde - 1 - j] *= j / (sr * 0.01); }
    return ud;
  }
  function lydTil() { try { return localStorage.getItem("sv-lyd") !== "fra"; } catch (e) { return true; } }
  function forbered() {   // kaldes i et tryk, så browseren tillader lyden bagefter
    if (!lydTil() || ctx) return;
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { ctx = new AC(); if (ctx.state === "suspended") ctx.resume(); } } catch (e) { ctx = null; }
  }
  function spil(varighed) {
    if (!ctx || ctx.state !== "running" || !lydTil()) return;
    try {
      var d = rivLyd(ctx.sampleRate, varighed), buf = ctx.createBuffer(1, d.length, ctx.sampleRate), k = ctx.createBufferSource(), g = ctx.createGain();
      buf.getChannelData(0).set(d); k.buffer = buf; g.gain.value = 0.14; k.connect(g).connect(ctx.destination); k.start();
    } catch (e) {}
  }

  // ---------- papiret ----------
  function lavPapir(logo) {
    var r = document.createElement("div"), h = '<div class="riv-h"><img src="' + logo + '" alt="" width="330" height="103"></div>';
    r.className = "riv"; r.setAttribute("aria-hidden", "true");
    r.innerHTML = '<div class="riv-h riv-hel"><img src="' + logo + '" alt="" width="330" height="103"></div><div class="riv-del riv-v">' + h + '</div><div class="riv-del riv-h2">' + h + "</div>";
    document.body.appendChild(r);
    return r;
  }
  function riv(r, opt) {
    opt = opt || {};
    if (!r || r.dataset.rives) return; r.dataset.rives = "1";
    if (RO) { r.classList.add("riv-ud"); setTimeout(function () { r.remove(); }, 400); return; }
    var pts = [], n = 46, x, i;
    for (i = 0; i <= n; i++) {   // revnen: en ujævn lodret linje med små tænder
      var y = i * 100 / n; x = 50 + Math.sin(i * .55) * 2.2 + (Math.random() - .5) * 3.2;
      pts.push([x, y]); if (i < n) pts.push([x + (Math.random() - .5) * 1.6, y + 50 / n]);
    }
    var halve = r.querySelectorAll(".riv-del .riv-h"), hel = r.querySelector(".riv-hel");
    function tegn(front, bredde) {   // kanterne glider kun fra hinanden over revnens spids; under den er papiret helt
      var v = [], h = [];
      for (var k = 0; k < pts.length; k++) {
        var q = pts[k], o = bredde * Math.pow(Math.max(0, front * 100 - q[1]) / 100, .8);
        v.push((q[0] - o).toFixed(2) + "% " + q[1].toFixed(2) + "%"); h.push((q[0] + o).toFixed(2) + "% " + q[1].toFixed(2) + "%");
      }
      halve[0].style.clipPath = "polygon(0 0," + v.join(",") + ",0 100%)";
      halve[1].style.clipPath = "polygon(" + h.join(",") + ",100% 100%,100% 0)";
      hel.style.clipPath = "inset(" + Math.min(100, front * 100).toFixed(2) + "% 0 0 0)";
    }
    tegn(0, 0);
    var farver = ["#8A2430", "#B04A50", "#DCA9A5", "#28377A", "#5D6BA8", "#B7BBD8", "#E6DFD3"], bidder = [];
    for (var j = 0; j < 22; j++) {   // små stykker papir, der løsner sig, når revnen når dem, og daler blødt ned
      var el = document.createElement("i"), q = pts[Math.floor(Math.random() * pts.length)], side = Math.random() < .5 ? -1 : 1;
      el.className = "riv-bid";
      el.style.cssText = "--s:" + (5 + Math.pow(Math.random(), 1.6) * 16).toFixed(1) + "px;--f:" + farver[j % farver.length] + ";--k:polygon(" +
        [0, 1, 2, 3, 4].map(function (k) { var a = k / 5 * 6.283 + Math.random() * .5; return (50 + Math.cos(a) * (32 + Math.random() * 18)).toFixed(1) + "% " + (50 + Math.sin(a) * (32 + Math.random() * 18)).toFixed(1) + "%"; }).join(",") + ")";
      r.appendChild(el);
      bidder.push({ el: el, x: q[0], y: q[1], t0: -1, vx: side * (25 + Math.random() * 70), vy: -(15 + Math.random() * 45), rot: Math.random() * 360, vr: side * (60 + Math.random() * 160), fase: Math.random() * 6.28, liv: 1.3 + Math.random() * .6 });
    }
    function partikler(nu, front) {
      var W = innerWidth, H = innerHeight, levende = false;
      for (var k = 0; k < bidder.length; k++) {
        var b = bidder[k];
        if (b.t0 < 0) { if (front * 100 >= b.y) b.t0 = nu; else { levende = true; continue; } }
        var t = (nu - b.t0) / 1000; if (t > b.liv) { b.el.style.opacity = 0; continue; }
        levende = true;
        var px = b.x / 100 * W + b.vx * t * (1 - t * .25) + Math.sin(t * 5 + b.fase) * 7 * t, py = b.y / 100 * H + b.vy * t + 380 * t * t;
        b.el.style.opacity = (Math.min(1, t / .12) * Math.min(1, (b.liv - t) / .4)).toFixed(3);
        b.el.style.transform = "translate3d(" + px.toFixed(1) + "px," + py.toFixed(1) + "px,0) rotate(" + (b.rot + b.vr * t).toFixed(1) + "deg)";
      }
      return levende;
    }
    var VARIGHED = 1500;   // revnen starter langsomt og bliver eksponentielt hurtigere
    if (opt.lyd) spil(VARIGHED / 1000);
    r.classList.add("rives");
    var t0 = performance.now(), aaben = false, slut = 0;
    (function trin(nu) {
      var t = Math.min(1, Math.max(0, (nu - t0) / VARIGHED)), e = (Math.pow(2, 6 * t) - 1) / 63;
      if (!aaben) tegn(e * 1.05, 4 + 10 * e);
      var levende = partikler(nu, e * 1.05);
      if (t >= 1 && !aaben) { aaben = true; slut = nu + 1100; r.classList.add("aaben"); }
      if (!aaben || levende || nu < slut) requestAnimationFrame(trin); else { r.remove(); if (opt.faerdig) opt.faerdig(); }
    })(t0);
  }

  // ---------- 1. loadingskærmen ----------
  var load = document.getElementById("riv");
  if (load) {
    if (document.documentElement.classList.contains("riv-set")) load.remove();
    else {
      try { sessionStorage.setItem("sv-riv", "1"); } catch (e) {}
      var aabnet = false, aabn = function () {
        if (aabnet) return; aabnet = true;
        // papiret og logoet står mindst 0,7 sekund, før det rives; lyden kommer kun med, hvis browseren allerede må spille
        setTimeout(function () { if (navigator.userActivation && navigator.userActivation.hasBeenActive) forbered(); riv(load, { lyd: true }); }, Math.max(0, 700 - performance.now()));
      };
      if (document.readyState === "complete") aabn(); else addEventListener("load", aabn);
      setTimeout(aabn, 2500);
    }
  }

  // ---------- 2. til tilmeldingen ----------
  window.svRiv = {
    forbered: forbered,
    // Dækker siden med papiret og river det op efter et kort øjeblik (fx når tilmeldingen er gået igennem)
    riv: function (opt) {
      opt = opt || {};
      var logo = opt.logo || (document.querySelector('link[rel="stylesheet"][href*="avis.css"]') || { href: "/assets/avis.css" }).href.replace(/avis\.css.*$/, "sagsvagt-vandret-kalk.svg");
      var r = lavPapir(logo);
      setTimeout(function () { riv(r, { lyd: true, faerdig: opt.faerdig }); }, opt.vent == null ? 350 : opt.vent);
      return r;
    },
  };
})();
