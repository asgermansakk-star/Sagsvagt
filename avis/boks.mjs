// Boksen til andres hjemmesider: en lille side med de nyeste sager fra en bydel, et emne eller et udvalg,
// som lokaludvalg, foreninger og politikere kan sætte ind på deres egen side med en <iframe>.
// byg.mjs kalder bygBokse(), så boksene bygges sammen med avisen og altid viser de nyeste sager.
//
// Boksene hentes fra GitHub Pages (BOKS_URL), ikke fra sagsvagt.dk: Simplys bot-beskyttelse viser en
// "Checking your browser"-side, der kræver en cookie, og Safari blokerer cookies i en iframe på en anden side.
// Alle links i boksen går til sagsvagt.dk. Siden boks.html på sagsvagt.dk laver koden, man kopierer.
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EMNER } from "./beriget.mjs";

const BOKS_URL = (process.env.BOKS_URL || "https://asgermansakk-star.github.io/Sagsvagt/").replace(/\/?$/, "/");
const MAKS = 8; // så mange sager ligger i hver boks; ?antal= viser færre

export async function bygBokse({ sager, udvalg, lokal, prUdvalg, prEmne }, h) {
  const { ROD, SITE_URL, esc, side, kortDato, slug, erLokaludvalg, bydel } = h;
  const logoSvg = (await readFile(join(ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8"))
    .replace(/<\?xml[^>]*>/, "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<svg /, '<svg class="logo" aria-label="Sagsvagt" role="img" ');
  await rm(join(ROD, "boks"), { recursive: true, force: true });
  for (const m of ["bydel", "emne", "udvalg"]) await mkdir(join(ROD, "boks", m), { recursive: true });

  // Alle bokse: sti, overskrift, navn til menuen, sager og det emne, tilmeldingen udfyldes med
  // Orienteringspunkter ("Orientering om procesplan …") springes over, når der er nok rigtige sager
  const ORIENT = /^(orientering|meddelelse)/i;
  const vigtige = (l) => { const r = l.filter((s) => !s.rutine), u = r.filter((s) => !ORIENT.test(s.titel)); return (u.length >= 4 ? u : r).slice(0, MAKS); };
  // Hele København: højst to sager fra hvert udvalg, så ét stort møde ikke fylder hele boksen
  const blandet = (l) => { const talt = {}; return l.filter((s) => !s.rutine && (talt[s.udvalg] = (talt[s.udvalg] || 0) + 1) <= 2).slice(0, MAKS); };
  const bokse = [
    { sti: "boks/alle.html", gruppe: "København", navn: "Hele København", titel: "Seneste fra Københavns Kommune", emne: "",
      sager: blandet(sager.filter((s) => s.vaegt >= 2)) },
    ...lokal.map((u) => ({ sti: `boks/bydel/${slug(bydel(u))}.html`, gruppe: "Bydele", navn: bydel(u), titel: `Seneste fra ${bydel(u)} Lokaludvalg`, emne: bydel(u), sager: vigtige(prUdvalg.get(u)) })),
    ...Object.entries(EMNER).map(([id, e]) => ({ sti: `boks/emne/${id}.html`, gruppe: "Emner", navn: e.navn, titel: `Seneste om ${e.navn.toLowerCase()}`, emne: e.navn, sager: vigtige(prEmne[id]) })),
    ...udvalg.map((u) => ({ sti: `boks/udvalg/${slug(u)}.html`, gruppe: "Udvalg", navn: u, titel: `Seneste fra ${u}`, emne: "", sager: vigtige(prUdvalg.get(u)) })),
  ].filter((b) => b.sager.length);

  for (const b of bokse) {
    const fra = `boks-${b.sti.replace(/^boks\/|\.html$/g, "").replace(/\//g, "-")}`;
    const tilmeld = `${SITE_URL}vagt.html?fra=${fra}${b.emne ? `&amp;emne=${encodeURIComponent(b.emne)}` : ""}#tilmeld`;
    const punkt = (s) => {
      const st = s.status === "kommer" ? ["kommer", "På dagsordenen"] : s.status === "besluttet" ? ["besluttet", "Besluttet"] : ["", "Behandlet"];
      const hvor = b.gruppe === "Bydele" ? "" : ` · ${esc(erLokaludvalg(s.udvalg) ? `${bydel(s.udvalg)} Lokaludvalg` : s.udvalg)}`;
      return `<li><p class="m"><span class="st ${st[0]}">${st[1]}</span> ${kortDato(s.dato)}${hvor}</p><a href="${SITE_URL}${s.url}?fra=${fra}">${esc(s.titel)}</a></li>`;
    };
    await writeFile(join(ROD, b.sti), `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(b.titel)} – Sagsvagt</title>
<meta name="robots" content="noindex">
<base target="_blank">
<link rel="stylesheet" href="${"../".repeat(b.sti.split("/").length - 1)}assets/fonts/montserrat.css">
<style>
  :root { --nat: #0E0F14; --kalk: #E6DFD3; --kalk-lys: #EEE8DE; --rule: #CFC6B8; --muted: #56535A; --vin: #8A2430; --indigo: #28377A;
    --moedet: radial-gradient(80% 160% at 0% 0%, #5D6BA8 0%, #28377A 22%, #0C1430 48%, transparent 72%), radial-gradient(70% 160% at 100% 100%, #B04A50 0%, #8A2430 22%, #3E0E14 50%, transparent 75%), #0E0F14;
    --bg: var(--kalk-lys); --tekst: var(--nat); --streg: var(--rule); --svag: var(--muted); }
  .moerk { --bg: #17181F; --tekst: var(--kalk); --streg: rgba(230,223,211,.16); --svag: rgba(230,223,211,.66); }
  * { box-sizing: border-box; }
  /* Boksen fylder den højde, iframen får: listen tager pladsen i midten, og knappen står altid nederst */
  html, body { margin: 0; height: 100%; background: transparent; }
  body { font: 500 15px/1.4 Montserrat, system-ui, sans-serif; color: var(--tekst); -webkit-font-smoothing: antialiased; }
  .b { background: var(--bg); border: 1px solid var(--streg); border-radius: 12px; overflow: hidden; height: 100%; display: flex; flex-direction: column; }
  header, footer { flex: none; }
  ol { flex: 1; min-height: 0; overflow: hidden; }
  header { background: var(--moedet); color: var(--kalk); padding: 14px 18px 14px; }
  header a { color: inherit; display: inline-block; line-height: 0; }
  .logo { height: 30px; width: auto; margin-left: -6px; }
  h1 { margin: 8px 0 0; font-size: 17px; font-weight: 700; line-height: 1.25; letter-spacing: -.01em; }
  ol { list-style: none; margin: 0; padding: 4px 18px; }
  li { padding: 11px 0; border-top: 1px solid var(--streg); }
  li:first-child { border-top: 0; }
  li[hidden] { display: none; }
  .m { margin: 0 0 3px; font-size: 12px; color: var(--svag); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { font-weight: 700; color: var(--tekst); }
  .st.kommer { color: var(--indigo); } .moerk .st.kommer { color: #B7BBD8; }
  .st.besluttet { color: var(--vin); } .moerk .st.besluttet { color: #DCA9A5; }
  li a { color: var(--tekst); text-decoration: none; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  li a:hover { text-decoration: underline; text-underline-offset: 3px; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 18px 14px; border-top: 1px solid var(--streg); font-size: 12px; color: var(--svag); }
  .cta { background: var(--nat); color: var(--kalk); text-decoration: none; font-weight: 700; font-size: 13px; padding: 9px 14px; border-radius: 8px; }
  .moerk .cta { background: var(--kalk); color: var(--nat); }
  .cta:hover { opacity: .9; }
</style>
</head>
<body>
<div class="b">
  <header><a href="${SITE_URL}?fra=${fra}" aria-label="Sagsvagt">${logoSvg}</a><h1>${esc(b.titel)}</h1></header>
  <ol>${b.sager.map(punkt).join("")}</ol>
  <footer><a class="cta" href="${tilmeld}">Få dem på mail hver mandag</a><span>Fra kommunens dagsordener</span></footer>
</div>
<script>
  // Viser så mange hele sager, der er plads til i iframens højde (højst ?antal=), så ingen bliver klippet over.
  // ?tema=moerk giver mørk baggrund.
  (function () {
    var q = new URLSearchParams(location.search), n = parseInt(q.get("antal"), 10) || 99;
    if (q.get("tema") === "moerk") document.body.className = "moerk";
    var ol = document.querySelector("ol"), alle = [].slice.call(ol.children);
    function tilpas() {
      alle.forEach(function (li, i) { li.hidden = i >= n; });
      for (var i = Math.min(n, alle.length) - 1; i > 0 && ol.scrollHeight > ol.clientHeight + 1; i--) alle[i].hidden = true;
    }
    tilpas(); addEventListener("resize", tilpas);
    if (document.fonts) document.fonts.ready.then(tilpas);
  })();
</script>
</body>
</html>
`);
  }

  // Siden, hvor man vælger sin boks og kopierer koden
  const grupper = ["København", "Bydele", "Emner", "Udvalg"];
  const valg = grupper.map((g) => `<optgroup label="${g}">${bokse.filter((b) => b.gruppe === g).map((b) => `<option value="${b.sti}" data-titel="${esc(b.titel)}">${esc(b.navn)}</option>`).join("")}</optgroup>`).join("");
  await writeFile(join(ROD, "boks.html"), side({
    titel: "Sæt Sagsvagt på din hjemmeside – Sagsvagt",
    beskrivelse: "Vis de nyeste sager fra din bydel, dit udvalg eller dit emne på din egen hjemmeside. Gratis, og den opdaterer sig selv.",
    sti: "boks.html", rod: "", aktiv: "om",
    indhold: `<div class="wrap"><div class="listing boks-side">
  <h1>Sæt Sagsvagt på din hjemmeside</h1>
  <p class="intro">Vis de nyeste sager fra din bydel, dit udvalg eller dit emne på din egen hjemmeside. Boksen opdaterer sig selv hver dag, når kommunen lægger nye dagsordener og referater ud. Den er gratis og bruger hverken cookies eller sporing.</p>
  <p class="intro">Til lokaludvalg, foreninger, politikere, lokalaviser og alle andre, der vil vise, hvad der sker i kommunen.</p>
  <div class="boks-gitter">
    <form class="boks-valg" onsubmit="return false">
      <label for="bv-hvad">Hvad skal boksen vise?</label>
      <select id="bv-hvad">${valg}</select>
      <label for="bv-hoejde">Størrelse</label>
      <select id="bv-hoejde"><option value="440">Lille (2–3 sager)</option><option value="580" selected>Mellem (3–5 sager)</option><option value="820">Stor (6–8 sager)</option></select>
      <label for="bv-tema">Udseende</label>
      <select id="bv-tema"><option value="">Lyst</option><option value="moerk">Mørkt</option></select>
      <label for="bv-kode">Kopiér koden, og indsæt den på din side</label>
      <textarea id="bv-kode" readonly rows="6"></textarea>
      <button type="button" id="bv-kopier" class="btn">Kopiér koden</button>
      <p class="boks-note" id="bv-status" role="status"></p>
      <p class="boks-note">I WordPress indsætter du koden i en blok af typen "Brugerdefineret HTML". På andre platforme hedder det typisk "HTML", "Indlejr" eller "Embed".</p>
    </form>
    <div class="boks-vis"><p class="boks-note">Sådan ser den ud</p><iframe id="bv-vis" title="Eksempel på boksen" loading="lazy"></iframe></div>
  </div>
</div></div>
<style>
  .boks-gitter { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: 40px; align-items: start; margin-top: 28px; }
  .boks-valg { display: grid; gap: 6px; }
  .boks-valg label { font-size: .8125rem; font-weight: 700; margin-top: 10px; }
  .boks-valg select, .boks-valg textarea { font: inherit; font-size: .9375rem; padding: 10px 12px; border: 1.5px solid var(--rule); border-radius: 8px; background: var(--kalk-lys); color: var(--nat); width: 100%; }
  .boks-valg textarea { font: 500 .8125rem/1.5 ui-monospace, Consolas, monospace; resize: vertical; }
  .boks-valg .btn { justify-self: start; margin-top: 10px; border: 0; cursor: pointer; background: var(--nat); color: var(--kalk); }
  .boks-note { font-size: .8125rem; color: var(--muted); margin: 6px 0 0; }
  .boks-vis iframe { width: 100%; border: 0; display: block; margin-top: 8px; }
  @media (max-width: 860px) { .boks-gitter { grid-template-columns: 1fr; } }
</style>
<script>
(function () {
  // Boksen viser selv så mange sager, der er plads til i den valgte højde
  var BOKS = ${JSON.stringify(BOKS_URL)};
  var $ = function (s) { return document.querySelector(s); };
  function opdater() {
    var o = $("#bv-hvad").selectedOptions[0], h = $("#bv-hoejde").value, tema = $("#bv-tema").value;
    var q = tema ? "?tema=" + tema : "";
    // Eksemplet her hentes fra sagsvagt.dk selv; koden peger på kopien uden bot-beskyttelse, så den virker på andre sider
    $("#bv-vis").src = o.value + q; $("#bv-vis").style.height = h + "px";
    $("#bv-kode").value = '<iframe src="' + BOKS + o.value + q + '" title="' + o.dataset.titel + ' – Sagsvagt" style="width:100%;max-width:440px;height:' + h + 'px;border:0" loading="lazy"></iframe>';
    $("#bv-status").textContent = "";
  }
  ["#bv-hvad", "#bv-hoejde", "#bv-tema"].forEach(function (s) { $(s).addEventListener("change", opdater); });
  $("#bv-kopier").addEventListener("click", function () {
    var k = $("#bv-kode"); k.select();
    (navigator.clipboard ? navigator.clipboard.writeText(k.value) : Promise.reject()).catch(function () { document.execCommand("copy"); })
      .then(function () { $("#bv-status").textContent = "Koden er kopieret."; });
  });
  opdater();
})();
</script>`,
  }));
  return bokse.length;
}
