// En side for hver af Danmarks 98 kommuner (kommune/<navn>.html) og en oversigt (kommune/index.html).
// København er åben med rigtige sager; de andre kommuner er "på vej" og samler tilmeldinger, så vi kan se,
// hvor Sagsvagt skal åbne næste gang. Listen over kommuner (navn, region, kommunekode og hjemmeside) ligger i
// avis/kommuner.json og er hentet fra Wikidata. byg.mjs kalder bygKommuner().
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bygUdgave } from "./udgave.mjs";

const REGIONER = ["Hovedstaden", "Sjælland", "Syddanmark", "Midtjylland", "Nordjylland"];

// sager: Københavns sager. andre: sager fra de andre kommuner, vi henter (data/<kommune>.json). En kommune er
// "åben", når vi har sager fra den; så viser dens side sagerne i stedet for en tilmelding til ventelisten.
export async function bygKommuner({ sager, andre = [], alle = [], soegValg = [], KSTED = new Map(), TOPRAAD = new Map() }, h) {
  const { ROD, esc, side, kortDato, erLokaludvalg, bydel } = h;
  const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "kommuner.json"), "utf8"));
  const prKommune = {}; for (const s of andre) (prKommune[s.kommune] ||= []).push(s);
  const AABNE = new Set(["koebenhavn", ...kommuner.filter((k) => prKommune[k.navn]?.length).map((k) => k.slug)]);
  await rm(join(ROD, "kommune"), { recursive: true, force: true });
  await mkdir(join(ROD, "kommune"), { recursive: true });
  // Min avis lader brugeren vælge mellem de åbne kommuner (København først, resten alfabetisk)
  await writeFile(join(ROD, "kommune", "aabne.json"), JSON.stringify(kommuner.filter((k) => AABNE.has(k.slug))
    .sort((a, b) => (a.slug === "koebenhavn" ? -1 : b.slug === "koebenhavn" ? 1 : a.navn.localeCompare(b.navn, "da"))).map(({ navn, slug }) => ({ navn, slug }))));

  const domaene = (web) => web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const tilmeld = (k) => `../vagt.html?kommune=${encodeURIComponent(k.navn)}&amp;fra=kommune-${k.slug}#tilmeld`;
  // København går direkte til avisens forside, ligesom de andre åbne kommuner går direkte til deres egen avis
  const kHref = (k) => (k.slug === "koebenhavn" ? "../index.html" : `${k.slug}.html`);
  const chips = (liste) => `<ul class="chips">${liste.map((k) => `<li><a href="${kHref(k)}">${esc(k.navn)}${AABNE.has(k.slug) ? ' <span class="aaben">åben</span>' : ""}</a></li>`).join("")}</ul>`;
  // De nyeste vigtige sager fra København som eksempel på, hvad man får
  const eksempler = sager.filter((s) => s.status !== "kommer" && s.vaegt >= 2 && !s.rutine).slice(0, 4);
  const eksempel = `<ul class="notitser">${eksempler.map((s) => `<li><span class="nh-hvor">${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}</span> <a href="../${s.url}">${esc(s.titel)}</a> <span class="nh-dato">${kortDato(s.dato)}</span></li>`).join("")}</ul>`;
  const stil = `<style>
  .kommune-side .kicker a { color: inherit; }
  .kommune-tilmeld { background: var(--moedet); color: var(--kalk); border-radius: 12px; padding: 24px 26px; margin: 26px 0 34px; display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; }
  .kommune-tilmeld p { margin: 0; max-width: 34em; }
  .kommune-tilmeld b { display: block; font-size: 1.125rem; margin-bottom: 4px; }
  .kommune-tilmeld .btn { white-space: nowrap; }
  .kommune-side h2 { font-size: 1.25rem; margin: 34px 0 10px; }
  .kommune-side .punkter { margin: 0; padding-left: 20px; display: grid; gap: 6px; max-width: 46em; }
  .chips .aaben { font-size: .72rem; font-weight: 700; background: var(--vin); color: var(--kalk); border-radius: 6px; padding: 2px 6px; margin-left: 4px; }
  .region-h { font-size: 1.125rem; margin: 30px 0 10px; }
</style>`;

  // Avis for en åben kommune med egne sager, bygget som Københavns forside: tophistorie, tre historier, Kort nyt
  // og en højrespalte med tilmelding, udvalgene og kalenderen. Hvert udvalg får sin egen side under kommune/<navn>/.
  const { kicker, saetninger, ugedag, datoTekst, stor, slug, vagtBoks, notits } = h;
  const kommuneSider = [];
  const spred = (liste, n, max) => { const talt = {}; const ud = []; for (const s of liste) { if (ud.length >= n) break; if ((talt[s.udvalg] = (talt[s.udvalg] || 0) + 1) <= max) ud.push(s); } return ud; };
  const egenSide = async (k, egne) => {
    const afholdt = egne.filter((s) => s.status !== "kommer");
    // Samme sag behandles ofte først i et udvalg og så i byrådet; på forsiden står den kun én gang (den vigtigste)
    const set = new Set(), unik = (l) => l.filter((s) => { const t = s.titel.toLowerCase(); if (set.has(t)) return false; set.add(t); return true; });
    const nyheder = unik(afholdt.filter((s) => s.vaegt > 0 && !s.rutine).sort((a, b) => b.score - a.score));
    const top = nyheder[0] || afholdt[0] || egne[0];
    const anden = spred(nyheder.filter((s) => s !== top), 9, 2);
    const mellem = anden.slice(0, 3);
    const brugt = new Set([top, ...anden]);
    const kortNyt = [...anden.slice(3), ...nyheder.filter((s) => !brugt.has(s)).sort((a, b) => b.dato.localeCompare(a.dato)).slice(0, 10)];
    const kommende = spred(egne.filter((s) => s.status === "kommer" && !s.rutine).sort((a, b) => a.dato.localeCompare(b.dato) || b.score - a.score), 8, 3);
    const kalender = {}; for (const s of kommende) (kalender[s.dato] ||= []).push(s);
    const prUdvalg = {}; for (const s of egne) (prUdvalg[s.udvalg] ||= []).push(s);
    const udvalg = Object.keys(prUdvalg).sort((a, b) => Math.max(...prUdvalg[b].map((s) => s.vaegt)) - Math.max(...prUdvalg[a].map((s) => s.vaegt)) || a.localeCompare(b, "da"));
    const R = "../";

    // Udvalgssider: kommune/<kommune>/<udvalg>.html, som Københavns udvalgssider
    await mkdir(join(ROD, "kommune", k.slug), { recursive: true });
    for (const u of udvalg) {
      const sti = `kommune/${k.slug}/${slug(u)}.html`;
      kommuneSider.push(sti);
      await writeFile(join(ROD, sti), side({
        titel: `${u}, ${k.kommune} – Sagsvagt`, beskrivelse: `Sager og beslutninger fra ${u} i ${k.kommune}, hentet fra kommunens dagsordener og referater.`,
        sti, rod: "../../", aktiv: "k-udvalg", kommune: k,
        indhold: `<div class="wrap"><div class="listing"><p class="kicker"><a href="../${k.slug}.html">${esc(k.navn)}</a></p><h1>${esc(u)}</h1>${prUdvalg[u].sort((a, b) => b.dato.localeCompare(a.dato) || a.nr - b.nr).map((s) => `<article>${kicker(s, "../../", false)}<h2 class="hl"><a href="../../${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 200))}</p>` : ""}</article>`).join("\n")}</div></div>`,
      }));
    }

    return `<div class="wrap">
  <div class="front">
    <div>
      <article class="lead">
        ${kicker(top, R)}
        <h1 class="hl"><a href="${R}${top.url}">${esc(top.titel)}</a></h1>
        ${top.dek ? `<p class="dek anslag">${esc(saetninger(top.dek, 320))}</p>` : ""}
        ${top.status === "besluttet" && top.udfald ? `<p class="udfald">${esc(top.udfald)}</p>` : top.status === "kommer" ? `<p class="udfald kommer">Til beslutning ${ugedag(top.dato)} ${datoTekst(top.dato)}.</p>` : ""}
      </article>
      <div class="mellem">
        ${mellem.map((s) => `<article>${kicker(s, R)}<h2 class="hl"><a href="${R}${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 190))}</p>` : ""}</article>`).join("\n        ")}
      </div>
      <section class="kortnyt" aria-labelledby="h-kort">
        <h2 id="h-kort" class="rubrik">Kort nyt</h2>
        <ul>${kortNyt.map((s) => notits(s, R)).join("")}</ul>
      </section>
    </div>
    <div class="rail">
      ${vagtBoks(R, `kommune-${k.slug}`, k.navn)}
      <section aria-labelledby="h-udvalg">
        <h2 id="h-udvalg" class="rubrik">Udvalg <a href="${k.slug}/udvalg.html">Alle udvalg</a></h2>
        <ul class="notitser">${udvalg.map((u) => `<li><a href="${k.slug}/${slug(u)}.html">${esc(u)}</a> <span class="nh-dato">${prUdvalg[u].length} sager</span></li>`).join("")}</ul>
      </section>
      ${kommende.length ? `<section aria-labelledby="h-kommer">
        <h2 id="h-kommer" class="rubrik">Kalender <a href="${k.slug}/moeder.html">Alle møder</a></h2>
        ${Object.entries(kalender).map(([dag, l]) => {
          const pr = {}; for (const s of l) (pr[s.udvalg] ||= []).push(s);
          return `<p class="kal-dag">${esc(stor(ugedag(dag)))} ${kortDato(dag)}</p>${Object.entries(pr).map(([u, ps]) => `<p class="kal-moede">${esc(u)}</p><ul class="notitser kal">${ps.map((s) => `<li><a href="${R}${s.url}">${esc(s.titel)}</a></li>`).join("")}</ul>`).join("")}`;
        }).join("")}
      </section>` : ""}
    </div>
  </div>
  <p class="kilde-note">Sagsvagt læser dagsordener og referater fra byrådet og udvalgene i ${esc(k.kommune)}. ${esc(k.navn)} er ny på Sagsvagt, så vi viser de møder, kommunen har udgivet de seneste to måneder. Hver sag linker til kommunens eget dokument. <a href="./">Andre kommuner</a></p>
</div>
<style>.kilde-note { margin: 40px 0 56px; padding-top: 16px; border-top: 1px solid var(--rule); font-size: var(--sekundaer); color: var(--muted); max-width: 52em; }</style>`;
  };

  for (const k of kommuner) {
    const aaben = AABNE.has(k.slug), egne = prKommune[k.navn] || [];
    const naboer = kommuner.filter((x) => x.region === k.region && x !== k).sort((a, b) => a.navn.localeCompare(b.navn, "da"));
    // Emner, Udvalg, Møder og Søg som i København (avis/udgave.mjs)
    if (egne.length) kommuneSider.push(...await bygUdgave(k, egne, alle.filter((s) => s.kommune === k.navn), soegValg, h, KSTED.get(k.navn) || { prSted: new Map(), prBy: new Map() }, TOPRAAD.get(k.navn)));
    // kommune/koebenhavn.html er kun en henvisning til avisens forside (for gamle links)
    if (k.slug === "koebenhavn") {
      await writeFile(join(ROD, "kommune", "koebenhavn.html"), `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Sagsvagt i København</title><link rel="canonical" href="${h.SITE_URL}index.html"><meta http-equiv="refresh" content="0; url=../index.html"><meta name="robots" content="noindex"></head><body><p><a href="../index.html">Gå til Sagsvagt i København</a></p></body></html>`);
      continue;
    }
    const indhold = egne.length ? await egenSide(k, egne)
      : `<div class="wrap"><div class="listing kommune-side">
  <p class="kicker"><a href="./">Alle kommuner</a> · Region ${esc(k.region)}</p>
  <h1>Sagsvagt i ${esc(k.navn)}</h1>
  <p class="intro">Sagsvagt læser dagsordener og referater fra byråd og udvalg og sender dig de sager, der handler om det, du følger. Vi er startet i København og åbner kommune for kommune, der hvor flest skriver sig op.</p>
  <div class="kommune-tilmeld"><p><b>Skriv dig op til ${esc(k.navn)}</b>Det er gratis. Du får besked, når Sagsvagt åbner i ${esc(k.kommune)}, og hver tilmelding rykker ${esc(k.navn)} op i køen.</p><a class="btn" href="${tilmeld(k)}">Skriv mig op</a></div>
  <h2>Det får du, når ${esc(k.navn)} åbner</h2>
  <ul class="punkter">
    <li>Én mail hver mandag med de sager fra byrådet og udvalgene i ${esc(k.navn)}, der handler om dine emner, fx skoler, trafik, lokalplaner eller budget.</li>
    <li>Et kort resumé af hver sag: hvad der skal besluttes, hvornår og hvad politikerne besluttede.</li>
    <li>Et link til kommunens eget dokument, så du altid kan læse hele sagen.</li>
  </ul>
  <h2>Se, hvordan det ser ud i København</h2>
  <p>Sagsvagt kører allerede i København. Her er nogle af de seneste beslutninger:</p>
  ${eksempel}
  <p><a href="../index.html">Se Sagsvagt i København</a></p>
  <h2>Indtil da</h2>
  <p>${esc(k.kommune)} lægger selv dagsordener og referater ud på <a href="${esc(k.web)}" rel="nofollow">${esc(domaene(k.web))}</a>.</p>
  <h2>Andre kommuner i Region ${esc(k.region)}</h2>
  ${chips(naboer)}
</div></div>${stil}`;
    await writeFile(join(ROD, "kommune", `${k.slug}.html`), side({
      titel: aaben ? `Sagsvagt i ${k.navn}: nyt fra byråd og udvalg – Sagsvagt` : `Følg byrådet i ${k.navn} – Sagsvagt`,
      beskrivelse: aaben
        ? `Det, politikerne i ${k.kommune} har besluttet og skal tage stilling til, fra byråd, udvalg og lokaludvalg.`
        : `Få besked, når byrådet og udvalgene i ${k.kommune} tager dit emne op. Skriv dig op, så åbner Sagsvagt i ${k.navn}.`,
      sti: `kommune/${k.slug}.html`, rod: "../", aktiv: egne.length ? "k-forside" : "kommune", indhold, kommune: egne.length ? k : null,
    }));
  }

  // "København, Albertslund, … og Viborg": København først, så de andre åbne kommuner alfabetisk
  const aabneNavne = ["København", ...kommuner.filter((k) => AABNE.has(k.slug) && k.slug !== "koebenhavn").map((k) => k.navn).sort((a, b) => a.localeCompare(b, "da"))];
  const aabneTekst = aabneNavne.length > 1 ? `${aabneNavne.slice(0, -1).join(", ")} og ${aabneNavne.at(-1)}` : aabneNavne[0];
  await writeFile(join(ROD, "kommune", "index.html"), side({
    titel: "Sagsvagt i alle kommuner – Sagsvagt",
    beskrivelse: `Følg byrådet i din kommune. Sagsvagt er åben i ${aabneTekst} og åbner kommune for kommune, der hvor flest skriver sig op.`,
    sti: "kommune/", rod: "../", aktiv: "kommune",
    indhold: `<div class="wrap"><div class="listing kommune-side">
  <h1>Sagsvagt i din kommune</h1>
  <p class="intro">Sagsvagt er åben i ${esc(aabneTekst)}. Vi åbner kommune for kommune, der hvor flest skriver sig op. Find din kommune, og skriv dig op, så får du besked, når den er klar.</p>
  <label class="k-soeg"><span>Find din kommune</span><input type="search" id="k-soeg" placeholder="Skriv fx Aarhus eller Køge" autocomplete="off"></label>
  <p class="k-ingen" id="k-ingen" hidden>Ingen kommuner passer. Tjek stavemåden.</p>
  ${REGIONER.map((r) => `<section class="region"><h2 class="region-h">Region ${r}</h2>${chips(kommuner.filter((k) => k.region === r).sort((a, b) => a.navn.localeCompare(b.navn, "da")))}</section>`).join("\n  ")}
</div></div>${stil}
<style>
  .k-soeg { display: block; max-width: 420px; margin: 22px 0 8px; }
  .k-soeg span { display: block; font-size: .8125rem; font-weight: 700; margin-bottom: 6px; }
  .k-soeg input { width: 100%; font: inherit; font-size: 1.0625rem; padding: 12px 14px; border: 2px solid var(--nat); border-radius: 8px; background: var(--kalk-lys); color: var(--nat); }
  .k-ingen { color: var(--muted); }
  .region[hidden], .region li[hidden], .k-ingen[hidden] { display: none; }
</style>
<script>
  // Filtrér kommunerne, mens man skriver; Enter går til den første, der passer
  (function () {
    var felt = document.getElementById("k-soeg"), links = [].slice.call(document.querySelectorAll(".region .chips a"));
    var norm = function (s) { return s.toLowerCase().replace(/aa/g, "å").replace(/\\s+kommune$/, "").trim(); };
    function filtrer() {
      var v = norm(felt.value), nogen = false;
      links.forEach(function (a) { var ok = !v || norm(a.firstChild.textContent).indexOf(v) === 0 || norm(a.firstChild.textContent).indexOf("-" + v) > -1; a.parentNode.hidden = !ok; nogen = nogen || ok; });
      [].forEach.call(document.querySelectorAll(".region"), function (r) { r.hidden = !r.querySelector("li:not([hidden])"); });
      document.getElementById("k-ingen").hidden = nogen;
    }
    felt.addEventListener("input", filtrer);
    felt.addEventListener("keydown", function (e) { if (e.key === "Enter") { var f = links.find(function (a) { return !a.parentNode.hidden; }); if (f) location.href = f.href; } });
  })();
</script>`,
  }));
  return { kommuner, kommuneSider };
}
