// En side for hver af Danmarks 98 kommuner (kommune/<navn>.html) og en oversigt (kommune/index.html).
// København er åben med rigtige sager; de andre kommuner er "på vej" og samler tilmeldinger, så vi kan se,
// hvor Sagsvagt skal åbne næste gang. Listen over kommuner (navn, region, kommunekode og hjemmeside) ligger i
// avis/kommuner.json og er hentet fra Wikidata. byg.mjs kalder bygKommuner().
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";

export const AABNE = new Set(["koebenhavn"]); // kommuner, hvor Sagsvagt har rigtige sager
const REGIONER = ["Hovedstaden", "Sjælland", "Syddanmark", "Midtjylland", "Nordjylland"];

export async function bygKommuner({ sager }, h) {
  const { ROD, esc, side, kortDato, erLokaludvalg, bydel } = h;
  const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "kommuner.json"), "utf8"));
  await rm(join(ROD, "kommune"), { recursive: true, force: true });
  await mkdir(join(ROD, "kommune"), { recursive: true });

  const domaene = (web) => web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const tilmeld = (k) => `../vagt.html?kommune=${encodeURIComponent(k.navn)}&amp;fra=kommune-${k.slug}#tilmeld`;
  const chips = (liste, aktiv) => `<ul class="chips">${liste.map((k) => `<li><a href="${k.slug}.html"${k.slug === aktiv ? ' aria-current="page"' : ""}>${esc(k.navn)}${AABNE.has(k.slug) ? ' <span class="aaben">åben</span>' : ""}</a></li>`).join("")}</ul>`;
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

  for (const k of kommuner) {
    const aaben = AABNE.has(k.slug);
    const naboer = kommuner.filter((x) => x.region === k.region && x !== k).sort((a, b) => a.navn.localeCompare(b.navn, "da"));
    const indhold = aaben
      ? `<div class="wrap"><div class="listing kommune-side">
  <p class="kicker"><a href="./">Alle kommuner</a> · Region ${esc(k.region)}</p>
  <h1>Sagsvagt i ${esc(k.navn)}</h1>
  <p class="intro">Sagsvagt er åben i ${esc(k.navn)}. Vi læser alle dagsordener og referater fra Borgerrepræsentationen, udvalgene og de 12 lokaludvalg og skriver kort, hvad sagerne handler om, og hvad politikerne har besluttet.</p>
  <div class="kommune-tilmeld"><p><b>Få sagerne om dine emner hver mandag</b>Vi søger de første testere i ${esc(k.navn)}. Det er gratis.</p><a class="btn" href="${tilmeld(k)}">Bliv tester</a></div>
  <h2>Seneste beslutninger</h2>
  ${eksempel}
  <p><a href="../index.html">Læs hele avisen for ${esc(k.navn)} →</a></p>
  <h2>Andre kommuner i Region ${esc(k.region)}</h2>
  ${chips(naboer)}
</div></div>${stil}`
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
  <p><a href="koebenhavn.html">Se Sagsvagt i København →</a></p>
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
      sti: `kommune/${k.slug}.html`, rod: "../", aktiv: "kommune", indhold,
    }));
  }

  await writeFile(join(ROD, "kommune", "index.html"), side({
    titel: "Sagsvagt i alle kommuner – Sagsvagt",
    beskrivelse: "Følg byrådet i din kommune. Sagsvagt er åben i København og åbner kommune for kommune, der hvor flest skriver sig op.",
    sti: "kommune/", rod: "../", aktiv: "kommune",
    indhold: `<div class="wrap"><div class="listing kommune-side">
  <h1>Sagsvagt i din kommune</h1>
  <p class="intro">Sagsvagt er åben i København. Vi åbner kommune for kommune, der hvor flest skriver sig op. Find din kommune, og skriv dig op, så får du besked, når den er klar.</p>
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
  return kommuner;
}
