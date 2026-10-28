// Sektionerne Emner, Udvalg, Møder og Søg for de andre kommuner (fx Viborg), bygget som Københavns, så der er
// så lidt forskel på kommunerne som muligt. Siderne ligger under kommune/<navn>/. Søgesiden (soegIndhold) bruges
// også af København, så søgningen er den samme overalt og man kan skifte kommune i den.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { findSteder, bygSteder } from "./steder.mjs";
import { bygPartier, bygHoeringer } from "./ekstra.mjs";

// Steder og byer/bydele i en kommunes sager, ud fra stednavnene i avis/steder/<kommune>.json (hent-steder-kommuner.mjs).
// Byer tæller fra første sag (de svarer til Københavns bydele); gader og pladser fra to sager, som i København.
export async function findKommuneSteder(k, egne, ROD) {
  let d = { byer: [], navne: [] };
  try { d = JSON.parse(await readFile(join(ROD, "avis", "steder", `${k.slug}.json`), "utf8")); } catch {}
  const steder = await findSteder(egne, ROD, { navne: d.navne });
  const byer = await findSteder(egne, ROD, { navne: d.byer, min: 1 });
  return { prSted: steder.prSted, stederFor: steder.stederFor, prBy: byer.prSted, byFor: byer.stederFor };
}

const escJs = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Søgesiden. rod: vej til sidens rod. data: adressen på sagerne (JSON). valg: [{ navn, href }] for kommunevælgeren,
// href fra roden. aktiv: den valgte kommune. emner: { id: { navn } }.
export function soegIndhold({ rod, data, antal, valg, aktiv, emner }) {
  const vaelger = valg.length > 1 ? `<label class="soeg-kommune"><span>Kommune</span><select id="kommune-valg" aria-label="Vælg kommune">${valg.map((v) => `<option value="${escJs(rod + v.href)}"${v.navn === aktiv ? " selected" : ""}>${escJs(v.navn)}</option>`).join("")}</select></label>` : "";
  return `<div class="wrap"><div class="listing soeg-side">
  <h1>Søg i sagerne</h1>
  <p class="intro">Søg i overskrifter, resuméer og udvalg i alle ${antal.toLocaleString("da-DK")} sager fra ${escJs(aktiv)}.</p>
  <form class="soeg-felt" role="search" onsubmit="return false"><input type="search" id="q" placeholder="fx cykelsti, skole eller budget" aria-label="Søg i sagerne" autocomplete="off">${vaelger}</form>
  <ul class="chips" id="emnefilter" aria-label="Vis kun ét emne"><li><button type="button" data-emne="" aria-pressed="true">Alle emner</button></li>${Object.entries(emner).map(([id, e]) => `<li><button type="button" data-emne="${id}" aria-pressed="false">${escJs(e.navn)}</button></li>`).join("")}</ul>
  <p class="intro" id="antal" aria-live="polite"></p>
  <div id="resultater"></div>
</div></div>
<style>
  .soeg-felt { display: flex; flex-wrap: wrap; gap: 0 12px; align-items: flex-start; }
  .soeg-felt input { flex: 1 1 260px; }
  .soeg-kommune { display: flex; align-items: center; gap: 10px; font-size: var(--sekundaer); font-weight: 600; margin-bottom: 16px; }
  /* Samme udseende som søgefeltet */
  .soeg-kommune select { min-height: 52px; padding: 0 40px 0 16px; border: 0; box-shadow: inset 0 0 0 1.5px var(--felt-kant); border-radius: var(--r-felt); background: var(--kalk-lys) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%230E0F14' stroke-width='1.6'/%3E%3C/svg%3E") no-repeat right 16px center; appearance: none; font: 500 var(--broed) var(--sans); color: var(--nat); cursor: pointer; }
  .soeg-kommune select:focus { outline: 3px solid var(--skifer); outline-offset: 2px; box-shadow: inset 0 0 0 2px var(--indigo); }
</style>
<script>
(function () {
  var ROD = ${JSON.stringify(rod)};
  var q = document.getElementById("q"), ud = document.getElementById("resultater"), antal = document.getElementById("antal"), emne = "", data = null;
  var esc = function (s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var dato = function (iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("da-DK", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }); };
  var status = function (s) { return s.st === "besluttet" ? '<span class="status besluttet">Besluttet ' + dato(s.dato) + "</span>" : s.st === "kommer" ? '<span class="status kommer">På dagsordenen ' + dato(s.dato) + "</span>" : '<span class="status">Behandlet ' + dato(s.dato) + "</span>"; };
  // Skriver man, før sagerne er hentet, står der tre sager i skeletform, til de er der
  var SKELET = Array(3).fill('<article aria-hidden="true"><span class="skelet skelet-linje" style="width: 30%"></span><span class="skelet" style="height: 24px; margin: 8px 0"></span><span class="skelet skelet-linje"></span><span class="skelet skelet-linje" style="width: 70%"></span></article>').join("");
  function vis() {
    if (!data) { if (q.value.trim() || emne) { antal.textContent = "Henter sagerne …"; ud.innerHTML = SKELET; } return; }
    var ord = q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    if (!ord.length && !emne) { antal.textContent = ""; ud.innerHTML = ""; return; }
    var hits = data.sager.filter(function (s) {
      if (emne && s.e.indexOf(emne) < 0) return false;
      var t = (s.t + " " + s.d + " " + s.x + " " + s.u).toLowerCase();
      return ord.every(function (o) { return t.indexOf(o) >= 0; });
    });
    antal.textContent = hits.length ? hits.length.toLocaleString("da-DK") + (hits.length === 1 ? " sag" : " sager") + (hits.length > 60 ? ". Viser de 60 nyeste." : "") : "Ingen sager matcher søgningen.";
    ud.innerHTML = hits.slice(0, 60).map(function (s) {
      return '<article><p class="kicker">' + status(s) + ", " + esc(s.u) + '</p><h2 class="hl"><a href="' + esc(ROD + s.url) + '">' + esc(s.t) + '</a></h2><p class="dek">' + esc(s.d.length > 200 ? s.d.slice(0, 200).replace(/\\s+\\S*$/, "") + " …" : s.d) + "</p>"
        + (s.e.length ? '<p class="emner">' + s.e.map(function (id) { var e = data.emner[id]; return '<a class="emne-tag ' + e.f + '" href="emne/' + id + '.html">' + esc(e.navn) + "</a>"; }).join("") + "</p>" : "") + "</article>";
    }).join("");
  }
  var t0; q.addEventListener("input", function () { clearTimeout(t0); t0 = setTimeout(vis, 120); });
  function vaelgEmne(b) { document.querySelectorAll("#emnefilter button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); }
  document.getElementById("emnefilter").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-emne]"); if (!b) return; emne = b.getAttribute("data-emne"); vaelgEmne(b); vis();
  });
  // Skift kommune, og tag søgeordet og emnet med
  var kv = document.getElementById("kommune-valg");
  if (kv) kv.addEventListener("change", function () {
    var p = new URLSearchParams(); if (q.value.trim()) p.set("q", q.value.trim()); if (emne) p.set("emne", emne);
    location.href = kv.value + (p.toString() ? "?" + p : "");
  });
  var u = new URLSearchParams(location.search);
  if (u.get("q")) q.value = u.get("q");
  if (u.get("emne")) { var eb = document.querySelector('#emnefilter button[data-emne="' + u.get("emne").replace(/[^a-z0-9-]/g, "") + '"]'); if (eb) { emne = eb.getAttribute("data-emne"); vaelgEmne(eb); } }
  fetch(${JSON.stringify(data)}).then(function (r) { return r.json(); }).then(function (d) { data = d; vis(); })
    .catch(function () { antal.textContent = "Søgningen kunne ikke hentes lige nu."; });
  q.focus();
})();
</script>`;
}

// Kompakt udgave af sagerne til søgningen (samme felter, som søgningen bruger i Københavns assets/sager.json)
export const soegData = (sager, EMNER, saetninger) => ({
  emner: Object.fromEntries(Object.entries(EMNER).map(([id, e]) => [id, { navn: e.navn, f: e.f }])),
  sager: sager.map((s) => ({ id: s.id, t: s.titel, d: s.dek, u: s.udvalg, dato: s.dato, st: s.status, e: s.emner, url: s.url, x: saetninger(s.afsnit.map((a) => a.tekst).join(" "), 600) })),
});

// Emner, Udvalg, Møder og Søg for én kommune. k: kommunen fra kommuner.json. egne: kommunens publicerede sager.
// raa: alle kommunens punkter (også dem, vi ikke bringer), så møderne viser hele dagsordenens længde.
// valg: kommunevælgeren til søgningen. Returnerer stierne til sitemappet.
// Samme sag behandles ofte i flere udvalg efter hinanden; i oversigter står den kun én gang (den nyeste)
export const unikTitel = (l) => { const set = new Set(); return l.filter((s) => { const t = s.titel.toLowerCase(); if (set.has(t)) return false; set.add(t); return true; }); };

export async function bygUdgave(k, egne, raa, valg, h, ks, top) {
  const { ROD, IDAG, esc, side, kicker, notits, saetninger, stor, ugedag, datoTekst, slug, EMNER, MDR, d } = h;
  const R = `kommune/${k.slug}`, stier = [];
  await mkdir(join(ROD, R, "emne"), { recursive: true });
  const skriv = async (sti, s) => { stier.push(sti.replace(/index\.html$/, "")); await writeFile(join(ROD, sti), side({ ...s, sti: sti.replace(/index\.html$/, ""), kommune: k })); };
  const liste = (s, rod, medUdvalg = false) => `<article>${kicker(s, rod, medUdvalg)}<h2 class="hl"><a href="${rod}${s.url}">${esc(s.titel)}</a></h2><p class="dek">${esc(saetninger(s.dek, 200))}</p></article>`;
  const udvalgUrl = (u) => `${slug(u)}.html`; // fra kommune/<navn>/

  // Emner: oversigt med hvert emnes seneste sager, og en side pr. emne
  const prEmne = Object.fromEntries(Object.keys(EMNER).map((id) => [id, egne.filter((s) => s.emner.includes(id) && !s.rutine)]));
  const emneChips = (aktivt) => `<ul class="chips">${Object.entries(EMNER).map(([id, e]) => `<li><a href="${id}.html"${id === aktivt ? ' aria-current="page"' : ""}>${esc(e.navn)} <span style="opacity:.6">(${prEmne[id].length})</span></a></li>`).join("")}</ul>`;
  for (const [id, e] of Object.entries(EMNER)) {
    await skriv(`${R}/emne/${id}.html`, {
      titel: `${e.navn}, ${k.navn} – Sagsvagt`, beskrivelse: `Sager om ${e.navn.toLowerCase()} fra byrådet og udvalgene i ${k.kommune}.`, rod: "../../../", aktiv: "k-emne",
      indhold: `<div class="wrap"><div class="listing"><p class="kicker"><a href="./">Alle emner</a></p><h1>${esc(e.navn)}</h1><p class="intro">${prEmne[id].length} sager fra byrådet og udvalgene i ${esc(k.kommune)}, nyeste først.</p>${emneChips(id)}${prEmne[id].length ? prEmne[id].map((s) => liste(s, "../../../", true)).join("\n") : `<p class="intro">Der er ingen sager om ${esc(e.navn.toLowerCase())} fra de seneste måneder.</p>`}</div></div>`,
    });
  }
  await skriv(`${R}/emne/index.html`, {
    titel: `Emner, ${k.navn} – Sagsvagt`, beskrivelse: `Find sagerne fra byrådet og udvalgene i ${k.kommune} efter emne.`, rod: "../../../", aktiv: "k-emne",
    indhold: `<div class="wrap"><div class="emne-oversigt"><h1>Emner</h1><p class="intro">Sagerne fra byrådet og udvalgene i ${esc(k.kommune)}, sorteret efter emne. En sag kan handle om flere emner.</p>
<div class="emne-gitter">${Object.entries(EMNER).map(([id, e]) => `<section aria-labelledby="em-${id}"><h2 id="em-${id}" class="rubrik"><a href="${id}.html" class="emne-navn">${esc(e.navn)}</a> <a href="${id}.html">${prEmne[id].length} sager</a></h2><ul class="notitser">${unikTitel(prEmne[id]).slice(0, 4).map((s) => notits(s, "../../../")).join("")}</ul></section>`).join("")}</div></div></div>`,
  });

  // Udvalg: oversigt som Københavns udvalg/ (udvalgssiderne selv bygges i kommuner.mjs)
  const prUdvalg = {}; for (const s of egne) (prUdvalg[s.udvalg] ||= []).push(s);
  const udvalg = Object.keys(prUdvalg).sort((a, b) => Math.max(...prUdvalg[b].map((s) => s.vaegt)) - Math.max(...prUdvalg[a].map((s) => s.vaegt)) || a.localeCompare(b, "da"));
  await skriv(`${R}/udvalg.html`, {
    titel: `Udvalg i ${k.kommune} – Sagsvagt`, beskrivelse: `Byrådet og udvalgene i ${k.kommune}.`, rod: "../../", aktiv: "k-udvalg",
    indhold: `<div class="wrap"><div class="listing"><h1>Udvalg i ${esc(k.kommune)}</h1><p class="intro">Byrådet, de stående udvalg og rådene. Tallet er antallet af sager fra de seneste måneder.</p><ul class="chips">${udvalg.map((u) => `<li><a href="${udvalgUrl(u)}">${esc(u)} <span style="opacity:.6">(${prUdvalg[u].length})</span></a></li>`).join("")}</ul></div></div>`,
  });

  // Møder: ét møde er et udvalg på en dato, som på Københavns moeder.html
  const moeder = new Map();
  for (const s of raa) {
    const key = `${s.dato}|${s.udvalg}`;
    if (!moeder.has(key)) moeder.set(key, { dato: s.dato, udvalg: s.udvalg, url: s.kilde.replace(/\/punkt-[^/]+$/, ""), antal: 0, referat: false, sager: [] });
    const m = moeder.get(key); m.antal++; if (s.type === "referat") m.referat = true;
  }
  for (const s of egne) moeder.get(`${s.dato}|${s.udvalg}`)?.sager.push(s);
  for (const m of moeder.values()) m.sager.sort((a, b) => (a.rutine - b.rutine) || a.nr - b.nr);
  const kommende = [...moeder.values()].filter((m) => m.dato >= IDAG).sort((a, b) => a.dato.localeCompare(b.dato) || a.udvalg.localeCompare(b.udvalg, "da"));
  const seneste = [...moeder.values()].filter((m) => m.dato < IDAG && (d(IDAG) - d(m.dato)) / 864e5 <= 21).sort((a, b) => b.dato.localeCompare(a.dato) || a.udvalg.localeCompare(b.udvalg, "da"));
  const moedeKort = (m) => {
    const vis = m.sager.filter((s) => !s.rutine).slice(0, 6), rutine = m.sager.filter((s) => s.rutine).length, flere = m.sager.length - vis.length - rutine;
    const nBesl = m.sager.filter((s) => s.status === "besluttet").length;
    const meta = m.dato >= IDAG ? `${m.antal} ${m.antal === 1 ? "punkt" : "punkter"} på dagsordenen`
      : m.referat ? `Referat offentliggjort${nBesl ? ` · ${nBesl} ${nBesl === 1 ? "beslutning" : "beslutninger"}` : ""}` : "Referatet er ikke offentliggjort endnu";
    return `<article class="moede">
  <p class="moede-dato" aria-hidden="true"><b>${d(m.dato).getUTCDate()}</b><span>${MDR[d(m.dato).getUTCMonth()].slice(0, 3)}.</span><span>${ugedag(m.dato).slice(0, 3)}.</span></p>
  <div>
    <h3>${prUdvalg[m.udvalg] ? `<a href="${udvalgUrl(m.udvalg)}">${esc(m.udvalg)}</a>` : esc(m.udvalg)}</h3>
    <p class="moede-meta">${stor(ugedag(m.dato))} ${datoTekst(m.dato)} · ${meta} · <a href="${esc(m.url)}" rel="nofollow">${m.referat ? "Referatet" : "Dagsordenen"} hos kommunen</a></p>
    ${vis.length ? `<ul class="punkter">${vis.map((s) => `<li><a href="../../${s.url}">${esc(s.titel)}</a>${s.status === "besluttet" && s.udfald ? `<span class="punkt-udfald">${esc(s.udfald)}</span>` : ""}${h.emneLinks(s, "../../")}</li>`).join("")}</ul>` : ""}
    ${flere || rutine ? `<p class="moede-mere">${[flere && `${flere} ${flere === 1 ? "sag" : "sager"} mere`, rutine && `${rutine} ${rutine === 1 ? "rutinesag" : "rutinesager"}`].filter(Boolean).join(" og ")}. <a href="${udvalgUrl(m.udvalg)}">Se alle sager fra ${esc(m.udvalg)}</a></p>` : ""}
  </div>
</article>`;
  };
  await skriv(`${R}/moeder.html`, {
    titel: `Møder, ${k.navn} – Sagsvagt`, beskrivelse: `Kommende og seneste møder i byrådet og udvalgene i ${k.kommune}, med punkterne på dagsordenen.`, rod: "../../", aktiv: "k-moeder",
    indhold: `<div class="wrap"><div class="listing moeder">
  <h1>Møder</h1>
  <p class="intro">Kommunen offentliggør dagsordenen omkring en uge før mødet. Her ser du de møder i ${esc(k.kommune)}, hvor dagsordenen er ude, og de seneste møders beslutninger.</p>
  <h2 class="sec-h">Kommende møder</h2>
  ${kommende.length ? kommende.map(moedeKort).join("\n") : `<p class="intro">Der er ingen offentliggjorte dagsordener til kommende møder lige nu.</p>`}
  <h2 class="sec-h" style="margin-top:40px">Seneste møder</h2>
  ${seneste.length ? seneste.map(moedeKort).join("\n") : `<p class="intro">Ingen møder de seneste tre uger.</p>`}
</div></div>`,
  });

  // Bydele (byer og bydele i kommunen) og Steder (gader, pladser, parker), bygget som Københavns stedsider
  stier.push(...await bygSteder(ks.prBy, h, {
    mappe: `${R}/bydel`, kommune: k, hvor: k.kommune, aktiv: "k-bydel", fra: "bydel", hvem: "byrådet og udvalgene", titel: "Bydele", alle: "Alle bydele",
    indexTitel: `Bydele i ${k.kommune} – Sagsvagt`, indexBeskrivelse: `Byer og bydele i ${k.kommune} og de politiske sager, der handler om dem.`,
    indexIntro: `Byerne og bydelene i ${k.kommune}, som politikerne har haft på dagsordenen. Find din by, og se, hvad der er besluttet.`,
  }));
  stier.push(...await bygSteder(ks.prSted, h, {
    mappe: `${R}/sted`, kommune: k, hvor: k.kommune, aktiv: "k-sted", hvem: "byrådet og udvalgene",
    indexTitel: `Steder i ${k.kommune} – Sagsvagt`, indexBeskrivelse: `Gader, pladser, parker og skoler i ${k.kommune} og de politiske sager, der handler om dem.`,
    indexIntro: `Gader, pladser, parker og skoler, som politikerne i ${k.kommune} har haft på dagsordenen flere gange. Find din gade, og se, hvad der er besluttet.`,
  }));

  // Høringer og Sådan stemmer partierne, som i København
  await bygHoeringer(egne, h, { sti: `${R}/hoeringer.html`, rod: "../../", kommune: k, hvor: k.kommune, aktiv: "k-hoeringer", web: k.web });
  stier.push(`${R}/hoeringer.html`);
  const partier = await bygPartier(egne, h, { sti: `${R}/partier.html`, rod: "../../", kommune: k, hvor: k.kommune, top: top || "Byrådet", aktiv: "k-partier" });
  if (partier === false) await skriv(`${R}/partier.html`, {
    titel: `Sådan stemmer partierne, ${k.navn} – Sagsvagt`, beskrivelse: `Hvordan partierne i ${k.kommune} stemmer.`, rod: "../../", aktiv: "k-partier",
    indhold: `<div class="wrap"><div class="listing"><h1>Sådan stemmer partierne</h1><p class="intro">Referaterne fra ${esc(k.kommune)} skriver endnu ikke partiernes stemmer på en måde, vi kan tælle sammen. Når de gør, kan du her se, hvor ofte partierne stemmer for og imod, og hvem der oftest stemmer ens.</p><p class="intro">Se i stedet beslutningerne i de enkelte sager under <a href="moeder.html">Møder</a>.</p></div></div>`,
  });
  else stier.push(`${R}/partier.html`);

  // Søg
  // Samme fil bruges af Min avis, så den får de felter, Københavns assets/sager.json har: udfald, stemmer,
  // emner i titlen, kilden hos kommunen, vægt, rutine og møderne (kommende og de seneste tre uger)
  const data = soegData(egne, EMNER, saetninger);
  data.sager = data.sager.map((x, i) => { const s = egne[i]; return { ...x, ud: s.udfald || "", kb: s.kortBesl || undefined, sm: s.stemmer, tal: s.tal, et: s.emnerTitel, k: s.kilde, v: s.vaegt, r: s.rutine ? 1 : 0, b: h.billedeFil?.(s) }; });
  data.moeder = [...kommende, ...seneste].map((m) => ({ dato: m.dato, u: m.udvalg, url: m.url, n: m.antal, referat: m.referat }));
  await writeFile(join(ROD, R, "sager.json"), JSON.stringify(data));
  await skriv(`${R}/soeg.html`, {
    titel: `Søg i sagerne, ${k.navn} – Sagsvagt`, beskrivelse: `Søg i alle sager fra byrådet og udvalgene i ${k.kommune}.`, rod: "../../", aktiv: "k-soeg",
    indhold: soegIndhold({ rod: "../../", data: "sager.json", antal: egne.length, valg, aktiv: k.navn, emner: EMNER }),
  });
  return stier;
}
