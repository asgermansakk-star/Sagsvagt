// Lyde i Min avis (lydsættet "Papir", valgt af Asger 19/11-2026): blødt papir og en lille stempling.
// Lydene laves i browseren med Web Audio (støj gennem et filter og korte toner), så der er ingen lydfiler og ingen licenser.
// Regler: kun når læseren selv trykker, aldrig når siden åbner, ruller eller får nye sager. Kan slås fra under Konto,
// og valget huskes på enheden (localStorage "sv-lyd").
(() => {
  let ctx = null, master = null, stoej = null;
  let til = true;
  try { til = localStorage.getItem("sv-lyd") !== "fra"; } catch {}

  function klar() {
    if (!til) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.3;
      const komp = ctx.createDynamicsCompressor(); komp.threshold.value = -18; komp.ratio.value = 3;
      master.connect(komp).connect(ctx.destination);
      stoej = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = stoej.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }
  // Kort tone med hurtigt anslag og naturlig udklingning (stemplingens dunk)
  function tone(f, { t = 0, dur = 0.1, g = 0.3, glid = 0 } = {}) {
    const s = ctx.currentTime + t, o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(f, s);
    if (glid) o.frequency.exponentialRampToValueAtTime(glid, s + dur);
    a.gain.setValueAtTime(0.0001, s); a.gain.exponentialRampToValueAtTime(g, s + 0.004);
    a.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(a).connect(master); o.start(s); o.stop(s + dur + 0.02);
  }
  // Støjpust gennem et filter (papir, fingerspids, en side der vendes)
  function pust({ t = 0, dur = 0.03, f = 2500, q = 1.2, g = 0.4, type = "bandpass", tilF = 0 } = {}) {
    const s = ctx.currentTime + t, k = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), a = ctx.createGain();
    k.buffer = stoej; fl.type = type; fl.frequency.setValueAtTime(f, s); fl.Q.value = q;
    if (tilF) fl.frequency.exponentialRampToValueAtTime(tilF, s + dur);
    a.gain.setValueAtTime(0.0001, s); a.gain.exponentialRampToValueAtTime(g, s + 0.003);
    a.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    k.connect(fl).connect(a).connect(master); k.start(s, Math.random() * 0.3); k.stop(s + dur + 0.02);
  }

  const LYDE = {
    emneTil: () => { pust({ dur: 0.028, f: 2600, g: 0.45 }); tone(190, { dur: 0.05, g: 0.18, glid: 140 }); },
    emneFra: () => pust({ dur: 0.022, f: 1500, g: 0.28 }),
    gem: () => { tone(150, { dur: 0.11, g: 0.4, glid: 70 }); pust({ dur: 0.05, f: 900, q: 0.8, g: 0.35 }); },
    fjern: () => pust({ dur: 0.04, f: 1200, q: 0.8, g: 0.22 }),
    tik: () => pust({ dur: 0.008, f: 5200, type: "highpass", q: 0.7, g: 0.22 }),
    dag: () => pust({ dur: 0.14, f: 3200, tilF: 1100, q: 0.9, g: 0.3 }),
    login: () => { pust({ dur: 0.22, f: 3600, tilF: 900, q: 0.8, g: 0.32 }); tone(130, { t: 0.16, dur: 0.14, g: 0.32, glid: 80 }); },
    fejl: () => { tone(150, { dur: 0.08, g: 0.32, glid: 110 }); tone(150, { t: 0.13, dur: 0.08, g: 0.26, glid: 110 }); },
  };

  window.svLyd = {
    spil(navn) { try { if (klar()) LYDE[navn]?.(); } catch {} },
    get til() { return til; },
    set til(v) {
      til = !!v;
      try { localStorage.setItem("sv-lyd", til ? "til" : "fra"); } catch {}
      if (!til && ctx) ctx.suspend();
    },
  };
})();
