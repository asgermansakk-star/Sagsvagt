// Tipliste til redaktioner: ugens sager fra én kommune, sorteret efter hvor meget historie der er i dem, med grunden og et
// spørgsmål at stille. Til lokale medier, der vil følge byrådet uden at læse alle dagsordener (fx Folketidende i Guldborgsund).
// Bygget af sager.json, som avisen allerede laver, og helt uden AI: hver tip siger, hvorfor den er med.
//
// Kør:  node avis/tipliste.mjs guldborgsund                       de seneste 14 dage og kommende møder
//       node avis/tipliste.mjs guldborgsund --dage 7 --til "Folketidende"
//       node avis/tipliste.mjs guldborgsund --mail                også som mail (…-mail.html og …-mail.txt) til redaktionen
//       node avis/tipliste.mjs --indeks                           tipsene i alle åbne kommuner til tipalarmen (api/_tips.json)
//
// Tipalarmen (api/_tips.php) sender redaktionerne en mail, så snart robotten har lagt nye sager op. Robotten vurderer
// sagerne her (grunde, spørgsmål og point), fordi den har den fulde sagstekst og stederne; serveren finder, hvad der er nyt.
//
// Listen er til redaktionen og må ikke ligge offentligt: den skrives til plan/tipliste/ (plan/ uploades ikke).
// Billeder og links peger på sagsvagt.dk, så filen kan sendes som den er. Bilag gengives ikke (ophavsretsloven § 9);
// vi refererer kort og linker til kommunens eget dokument. Partier fremhæves ikke, kun at der var uenighed.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hoeringsfrist, iHoering } from "./beriget.mjs";
import { MAILFARVER as C, MAILSKRIFT as S, MAILBILLEDER as MAIL, moerk, mailTop } from "../assets/mandagsmail.js";

const ROD = join(import.meta.dirname, "..");
const SITE = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
const UD = join(ROD, "plan", "tipliste");
const IDAG = new Date().toISOString().slice(0, 10);
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const dato = (d) => { const [, m, dg] = d.split("-"); return `${Number(dg)}. ${MDR[m - 1]}`; };
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const minus = (d, dage) => new Date(Date.parse(d) - dage * 864e5).toISOString().slice(0, 10);
const uge = (d) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };

// ---------- Hvorfor er det et tip? ----------
// Hver grund giver point og et spørgsmål, journalisten kan stille. Grundene står på tippet, så redaktionen selv kan vurdere.
// Ordene er valgt ud fra, hvad lokalaviser typisk skriver om: ændringer, folk mærker, penge, høringer og uenighed.
const MAERKES = /lukning|lukke[sr]?\b|nedlægge|nedlæggelse|ikke genopslå|genopslås ikke|omlægning|besparelse|spare\b|sparer|reduktion|nedskæring|tilpasning af (serviceniveau|budget)|flytning af|flyttes|sammenlægning|takststigning|forhøjelse af|stigning i|ventetid|venteliste|klage|ekspropriation|nedrivning|nedrives|opsigelse|udlicitering|konkurrenceudsættelse|ny model|ressourcetildeling|hjemløse|solcellepark|solpark|vindmølle|biogasanlæg|kystsikring|højvand|oversvømmelse|klimatilpasning|skole(lukning|struktur)|daginstitution|plejecenter|busrute|buslinje/i;
const UENIG = /stemte imod|stemmer imod|kunne ikke (godkende|anbefale|tiltræde)|tog forbehold|mindretal|protokolbemærkning|ønskede sagen|begærede sagen|udsat|sendt tilbage|tilbagesendt|forkastet|nedstemt/i;
const RUTINE_EKSTRA = /^besøg (hos|af|på)|^orientering(ssag)?:? ?$|mødeplan|mødekalender|udpegning af|valg af (formand|næstformand)|^godkendelse af dagsorden|^meddelelser/i;

// Største beløb i teksten: "1.272.000 kr." → 1272000, "14,8 mio. kr." → 14800000
function stoersteBeloeb(tekst) {
  let max = 0;
  for (const m of tekst.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*(mia\.?|milliard(?:er)?|mio\.?|million(?:er)?|kr\.|kroner)/gi)) {
    const n = Number(m[1].replace(/\./g, "").replace(",", ".")) * (/^mia|^milliard/i.test(m[2]) ? 1e9 : /^mio|^million/i.test(m[2]) ? 1e6 : 1);
    if (n > max && n < 1e11) max = n;
  }
  return max >= 100000 ? max : 0;
}
const kroner = (n) => n >= 1e9 ? `${(n / 1e9).toLocaleString("da-DK", { maximumFractionDigits: 1 })} mia. kr.`
  : n >= 1e6 ? `${(n / 1e6).toLocaleString("da-DK", { maximumFractionDigits: 1 })} mio. kr.` : `${Math.round(n).toLocaleString("da-DK")} kr.`;

// Byer og bydele i teksten (avis/steder/<kommune>.json). Længste navn først, så "Nykøbing Falster" ikke også bliver "Falster".
function findByer(tekst, byer) {
  const fundet = [];
  for (const by of byer) {
    const re = new RegExp(`(?<![\\p{L}])${by.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
    if (re.test(tekst) && !fundet.some((f) => f.includes(by))) fundet.push(by);
  }
  return fundet;
}

// fuld: hele sagsteksten fra data/<kommune>.json, når den findes (sager.json har kun de første 600 tegn)
function vurder(s, byer, fuld = "") {
  // Ord og steder læses kun i titel og resumé: den fulde tekst har faste afsnit (klagevejledning, rådhusets adresse)
  const kortTekst = `${s.t} ${s.kt || ""} ${s.d || ""} ${s.x || ""}`, tekst = `${kortTekst} ${fuld}`;
  const udfald = `${s.ud || ""} ${s.kb || ""}`;
  const grunde = [];
  if (s.sm?.imod || s.tal || UENIG.test(udfald)) grunde.push({ id: "uenig", navn: "Uenighed", p: 5, tekst: s.tal ? `Afstemning: ${s.tal}` : "Politikerne var ikke enige", spm: "Hvem var imod, og hvad ville de i stedet?" });
  // Mange kommuner har en fast overskrift "Høring" i hver sag, så kun konkrete ord tæller. En frist, der er passeret,
  // betyder, at høringen er overstået.
  const frist = hoeringsfrist(tekst);
  if (frist && frist >= IDAG) grunde.push({ id: "hoering", navn: "Høring", p: 4, tekst: `Høringsfrist ${dato(frist)}`, spm: "Hvem bliver berørt, og ved de, at de kan svare?", frist });
  else {
    // "Har været i høring" vinder over "sendt i høring", som ofte står i sagens historie
    const efter = { id: "efterhoering", navn: "Efter høring", p: 2, tekst: "Har været i høring, og høringssvarene ligger i sagen", spm: "Hvad sagde høringssvarene, og blev der lyttet?" };
    if (/har været i (offentlig )?høring|hvidbog/i.test(tekst)) grunde.push(efter);
    else if (iHoering(tekst)) grunde.push({ id: "hoering", navn: "Høring", p: 4, tekst: "Skal i høring", spm: "Hvem bliver berørt, og ved de, at de kan svare?" });
    else if (/høringssvar(ene)? fra|indkomne høringssvar/i.test(tekst)) grunde.push(efter);
  }
  const beloeb = stoersteBeloeb(tekst);
  if (beloeb) grunde.push({ id: "penge", navn: "Penge", p: beloeb >= 1e6 ? 4 : 2, tekst: `Største beløb i sagen: ${kroner(beloeb)}`, spm: "Hvad får borgerne for pengene, og hvor kommer de fra?" });
  const m = kortTekst.match(MAERKES);
  if (m) grunde.push({ id: "maerkes", navn: "Kan mærkes", p: 3, tekst: `Nævner "${m[0].toLowerCase()}"`, spm: "Hvem mærker ændringen først, og er de blevet spurgt?" });
  const steder = findByer(kortTekst, byer);
  if (steder.length && steder.length <= 3) grunde.push({ id: "sted", navn: "Lokalt", p: 2, tekst: steder.join(", "), spm: `Hvad siger de lokale i ${steder[0]}?` });
  if (s.st === "kommer") grunde.push({ id: "kommer", navn: "Før mødet", p: 3, tekst: `På dagsordenen ${dato(s.dato)}`, spm: "Hvad vil udvalgsformanden foreslå, før mødet?" });
  const point = (s.v || 2) * 2 + grunde.reduce((n, g) => n + g.p, 0);
  return { s, grunde, steder, point };
}

// ---------- Data ----------
async function hentKommune(slug, navne) {
  const f = slug === "koebenhavn" ? join(ROD, "assets", "sager.json") : join(ROD, "kommune", slug, "sager.json");
  const d = JSON.parse(await readFile(f, "utf8"));
  let byer = [], fuld = {};
  try { byer = JSON.parse(await readFile(join(import.meta.dirname, "steder", `${slug}.json`), "utf8")).byer || []; } catch {}
  try {
    const r = JSON.parse(await readFile(join(ROD, "data", `${slug === "koebenhavn" ? "kk" : slug}.json`), "utf8")).sager;
    for (const x of Array.isArray(r) ? r : Object.values(r)) fuld[x.id] = (x.afsnit || []).map((a) => a.tekst).join("\n");
  } catch {}
  return { slug, navn: navne[slug] || slug, sager: d.sager, byer: byer.sort((a, b) => b.length - a.length), fuld };
}

// Samme sag behandles ofte i flere udvalg samme uge (fx "Danmarkskortet 2025"): den bedste behandling bliver tippet,
// de andre udvalg står på det
const noegle = (s) => (s.kt || s.t).toLowerCase().replace(/\s+/g, " ").replace(/^(forslag til|endelig vedtagelse af|vedtagelse af)\s+/, "").slice(0, 90);
function slaaSammen(vurderet) {
  const pr = new Map();
  for (const v of vurderet) {
    const g = pr.get(noegle(v.s));
    if (!g) { pr.set(noegle(v.s), { ...v, ogsaa: [] }); continue; }
    const [bedst, anden] = v.point > g.point || (v.point === g.point && v.s.dato > g.s.dato) ? [v, g] : [g, v];
    pr.set(noegle(v.s), { ...bedst, ogsaa: [...g.ogsaa, anden.s.u].filter((u) => u !== bedst.s.u) });
  }
  return [...pr.values()];
}

// ---------- Listen ----------
const link = (s) => SITE + s.url;
// "Droftet UDVALGTE." o.l.: rester af PDF'ens afkrydsningsfelter i den korte beslutning
const renBesl = (t = "") => t.replace(/\s*\bUDVALGTE\b\.?/g, "").replace(/^(?:Fraværende:|-\s)[^]*?(?=\b(Godkendt|Godkender|Taget|Drøftet|Anbefalet|Tiltrådt|Oversendt|Udvalget|Byrådet)\b)/, "").trim();
const kort = (t = "", n = 300) => t.length > n ? `${t.slice(0, n - 3).replace(/\s\S*$/, "")} …` : t;

const SPM = ["uenig", "hoering", "kommer", "maerkes", "sted", "efterhoering", "penge"];
function tipKort(v, nr) {
  const s = v.s;
  return `<article class="tip">
  <div class="nr">${nr}</div>
  <div>
    <p class="kicker">${v.grunde.map((g) => `<span class="g g-${g.id}">${esc(g.navn)}</span>`).join(" ")}</p>
    <h3><a href="${esc(link(s))}">${esc(s.kt || s.t)}</a></h3>
    <p class="meta">${esc(s.u)} · ${s.st === "kommer" ? "møde" : "behandlet"} ${dato(s.dato)}${renBesl(s.kb) && s.st !== "kommer" ? ` · ${esc(kort(renBesl(s.kb), 110))}` : ""}${v.ogsaa?.length ? ` · også i ${esc(v.ogsaa.join(" og "))}` : ""}</p>
    ${s.d ? `<p class="dek">${esc(kort(s.d))}</p>` : ""}
    <ul class="hvorfor">${v.grunde.map((g) => `<li><b>${esc(g.navn)}:</b> ${esc(g.tekst)}</li>`).join("")}</ul>
    <p class="spm"><b>Spørg:</b> ${esc([...v.grunde].sort((a, b) => SPM.indexOf(a.id) - SPM.indexOf(b.id)).slice(0, 2).map((g) => g.spm).join(" "))}</p>
    <p class="kilder"><a href="${esc(link(s))}">Sagen på Sagsvagt</a>${s.k ? ` · <a href="${esc(s.k)}" rel="nofollow">Kommunens dokument</a>` : ""}</p>
  </div>
</article>`;
}
const linje = (v) => `<li><span class="d">${dato(v.s.dato)}</span> <a href="${esc(link(v.s))}">${esc(v.s.kt || v.s.t)}</a> <span class="u">${esc(v.s.u)}</span></li>`;

function listeHtml({ k, til, fra, vurderet, top }) {
  const resten = vurderet.filter((v) => !top.includes(v));
  const frister = vurderet.filter((v) => v.grunde.some((g) => g.frist && g.frist >= IDAG)).sort((a, b) => a.grunde.find((g) => g.frist).frist.localeCompare(b.grunde.find((g) => g.frist).frist));
  const kommende = vurderet.filter((v) => v.s.st === "kommer").sort((a, b) => a.s.dato.localeCompare(b.s.dato));
  // Byerne med flest sager, så lokalredaktionerne kan finde deres egne
  const prBy = new Map();
  for (const v of vurderet) for (const by of v.steder.slice(0, 3)) prBy.set(by, [...(prBy.get(by) || []), v]);
  const byer = [...prBy.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "da"));
  const antal = (id) => vurderet.filter((v) => v.grunde.some((g) => g.id === id)).length;
  const natkort = `${SITE}assets/natkort/${k.slug}.jpg`;
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Tipliste ${esc(k.navn)} uge ${uge(IDAG)} – Sagsvagt</title>
<link rel="stylesheet" href="${SITE}assets/fonts/montserrat.css">
<style>
:root{--nat:#0E0F14;--indigo:#28377A;--bordeaux:#3E0E14;--vin:#8A2430;--rubin:#B04A50;--rosen:#DCA9A5;--kalk:#E6DFD3;--kalk-lys:#EEE8DE;--kalk-mork:#D9D1C3;--rule:#CFC6B8;--muted:#56535A;--sans:Montserrat,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--kalk);color:var(--nat);font:500 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,p{margin:0}a{color:var(--indigo);text-underline-offset:3px}.wrap{max-width:920px;margin:0 auto;padding:0 24px}
.top{position:relative;color:var(--kalk);background:linear-gradient(90deg,rgba(14,15,20,.6),rgba(14,15,20,.2) 65%),linear-gradient(135deg,rgba(40,55,122,.55),rgba(14,15,20,.4) 55%,rgba(62,14,20,.6)),url("${esc(natkort)}") center/cover no-repeat,var(--nat);padding:28px 0 40px}
.top::after{content:"Kort: © OpenStreetMap-bidragydere";position:absolute;right:12px;bottom:6px;font:500 10px/1.2 var(--sans);color:rgba(230,223,211,.7)}
.brand{display:flex;justify-content:space-between;align-items:center;font:700 14px var(--sans);opacity:.9}.brand span{font:700 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--rosen)}
.top .k{margin-top:40px;font:700 12px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--rosen)}
.top h1{font:800 clamp(30px,1.4rem + 2.6vw,48px)/1.06 var(--sans);letter-spacing:-.02em;margin:8px 0 12px}
.top p.u{color:rgba(230,223,211,.85);max-width:44em}
.tal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:28px;border-top:1px solid rgba(230,223,211,.22)}
.tal div{padding:14px 0 0}.tal div+div{border-left:1px solid rgba(230,223,211,.22);padding-left:16px}
.tal b{display:block;font:800 34px/1 var(--sans)}.tal span{display:block;margin-top:6px;font-size:12.5px;color:rgba(230,223,211,.78)}
main{padding:40px 0 64px}.note{font-size:13px;color:var(--muted);border-left:3px solid var(--rubin);padding:4px 0 4px 12px;margin-bottom:32px}
.boks{background:var(--kalk-lys);border:1px solid var(--rule);border-radius:16px;padding:20px 22px;margin-bottom:28px}
.boks h2{font:800 18px var(--sans);margin-bottom:10px}.boks ul{margin:0;padding-left:18px}.boks li{margin:6px 0}
h2.sek{font:800 24px/1.2 var(--sans);border-bottom:2px solid var(--nat);padding-bottom:10px;margin:44px 0 6px}h2.sek span{font:700 14px var(--sans);color:var(--muted);margin-left:6px}
.tip{display:grid;grid-template-columns:48px minmax(0,1fr);gap:16px;padding:22px 0;border-bottom:1px solid var(--rule)}
.nr{font:800 32px/1 var(--sans);color:var(--vin)}
.kicker{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.g{font:700 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:5px 8px;border-radius:99px;background:var(--kalk-mork);color:var(--nat)}
.g-uenig,.g-maerkes{background:var(--vin);color:var(--kalk)}.g-hoering,.g-kommer{background:var(--indigo);color:var(--kalk)}
.tip h3{font:700 19px/1.3 var(--sans);margin-bottom:4px}.tip h3 a{color:var(--nat);text-decoration:none}.tip h3 a:hover{text-decoration:underline}
.meta{font-size:13px;color:var(--muted)}.dek{font-size:14.5px;margin-top:8px}
.hvorfor{margin:10px 0 0;padding:0;list-style:none;font-size:13.5px}.hvorfor li{margin:2px 0}
.spm{margin-top:10px;font-size:14.5px;background:var(--kalk-lys);border-left:3px solid var(--indigo);padding:8px 12px;border-radius:0 8px 8px 0}
.kilder{font:600 13px var(--sans);margin-top:10px}
.liste{list-style:none;margin:0;padding:0}.liste li{padding:9px 0;border-bottom:1px solid var(--rule);font-size:15px}
.liste .d{display:inline-block;min-width:92px;font:700 13px var(--sans);color:var(--muted)}.liste .u{font-size:12.5px;color:var(--muted)}
.byer{columns:2;column-gap:32px}.by{break-inside:avoid;margin-bottom:18px}.by h3{font:800 15px var(--sans);margin-bottom:4px}.by ul{margin:0;padding-left:18px;font-size:14px}
footer{background:var(--nat);color:rgba(230,223,211,.72);font-size:13px;padding:28px 0}
@media (max-width:640px){.tal{grid-template-columns:1fr 1fr;gap:14px 0}.tal div:nth-child(3){border-left:0;padding-left:0}.tip{grid-template-columns:1fr;gap:4px}.byer{columns:1}.liste .d{display:block}}
@media print{.top{background:var(--nat)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.tip,.by{break-inside:avoid}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="brand"><span>Sagsvagt${til ? ` · til ${esc(til)}` : ""}</span>Uge ${uge(IDAG)} · ${esc(dato(IDAG))} ${IDAG.slice(0, 4)}</div>
  <p class="k">Tipliste til redaktionen</p>
  <h1>Byrådssagerne i ${esc(k.navn)}</h1>
  <p class="u">${vurderet.length} sager fra ${esc(dato(fra))} til i dag${kommende.length ? " og kommende møder" : ""}. De ${top.length} med mest historie i står først, med grunden og et spørgsmål at stille.</p>
  <div class="tal">
    <div><b>${vurderet.length}</b><span>sager i perioden</span></div>
    <div><b>${antal("hoering")}</b><span>i høring</span></div>
    <div><b>${antal("penge")}</b><span>med beløb over 100.000 kr.</span></div>
    ${antal("uenig") ? `<div><b>${antal("uenig")}</b><span>med uenighed</span></div>` : `<div><b>${byer.length}</b><span>byer nævnt</span></div>`}
  </div>
</div></header>
<main><div class="wrap">
  <p class="note">Til redaktionen og efter aftale. Ikke til offentliggørelse. Sagerne er fundet automatisk i ${esc(k.navn)} Kommunes egne dagsordener og referater; tal, datoer og navne står i kommunens dokument, som hver sag linker til. Grundene er Sagsvagts læsning af teksten, ikke en vurdering af, hvad der er en historie. Bilag er ikke gengivet.</p>
  ${frister.length ? `<section class="boks"><h2>Høringsfrister</h2><ul>${frister.map((v) => `<li><b>${dato(v.grunde.find((g) => g.frist).frist)}</b> · <a href="${esc(link(v.s))}">${esc(v.s.kt || v.s.t)}</a></li>`).join("")}</ul></section>` : ""}
  ${kommende.length ? `<section class="boks"><h2>På kommende møder</h2><ul>${kommende.slice(0, 12).map((v) => `<li><b>${dato(v.s.dato)}</b> · ${esc(v.s.u)}: <a href="${esc(link(v.s))}">${esc(v.s.kt || v.s.t)}</a></li>`).join("")}</ul></section>` : ""}
  <h2 class="sek">Ugens tips <span>${top.length}</span></h2>
  ${top.map((v, i) => tipKort(v, i + 1)).join("\n") || "<p>Ingen sager i perioden.</p>"}
  ${byer.length ? `<h2 class="sek">By for by</h2><div class="byer">${byer.map(([by, l]) => `<div class="by"><h3>${esc(by)}</h3><ul>${l.map((v) => `<li><a href="${esc(link(v.s))}">${esc(v.s.kt || v.s.t)}</a></li>`).join("")}</ul></div>`).join("")}</div>` : ""}
  ${resten.length ? `<h2 class="sek">Resten af sagerne <span>${resten.length}</span></h2><ul class="liste">${resten.sort((a, b) => b.s.dato.localeCompare(a.s.dato) || b.point - a.point).map(linje).join("")}</ul>` : ""}
</div></main>
<footer><div class="wrap">Sagsvagt · CVR 46841514 · mansa@sagsvagt.dk · sagsvagt.dk · Kilde: ${esc(k.navn)} Kommune, dagsordener og referater fra ${esc(dato(fra))} og kommende møder.</div></footer>
</body>
</html>`;
}

// ---------- Mailen ----------
// Samme tipliste som mail til redaktionen i mandagsmailens form (assets/mandagsmail.js): logo og uge øverst, lyngbølgen,
// tipsene som lyse kort og rosenbølgen i bunden. Tabeller og inline-stilarter, så den ser ens ud i Outlook, Gmail og Apple Mail;
// moerk() giver farverne til mørk tilstand. Tipsene står venstrestillet, fordi de skal læses og ikke bare skimmes.
const PILLE = { uenig: [C.vin, C.kalk], maerkes: [C.vin, C.kalk], hoering: [C.indigo, C.kalk], kommer: [C.indigo, C.kalk] };
function listeMail({ k, til, fra, vurderet, top }) {
  const nr = uge(IDAG);
  const frister = vurderet.filter((v) => v.grunde.some((g) => g.frist && g.frist >= IDAG)).sort((a, b) => a.grunde.find((g) => g.frist).frist.localeCompare(b.grunde.find((g) => g.frist).frist));
  const kommende = vurderet.filter((v) => v.s.st === "kommer").sort((a, b) => a.s.dato.localeCompare(b.s.dato));
  const emne = `Tipliste uge ${nr}: ${top.length} ${top.length === 1 ? "tip" : "tips"} fra ${k.navn}`;
  const pil = (href, t) => `<a href="${esc(href)}" style="font:700 14px/1.4 ${S};color:${C.indigo};text-decoration:none;">${t} ›</a>`;
  const h2 = (t) => `<tr><td align="center" style="padding:34px 28px 8px;"><h2 style="margin:0;font:800 22px/1.25 ${S};color:${C.nat};">${esc(t)}</h2></td></tr>`;
  // En kort liste (frister, møder) på et lyst kort: datoen fed, derefter sagen
  const liste = (l, dag) => `<tr><td style="padding:10px 22px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.kalkLys};border-radius:16px;"><tr><td style="padding:14px 22px;">`
    + l.map((v, i) => `<p style="margin:0;padding:10px 0;${i ? `border-top:1px solid ${C.rule};` : ""}font:15px/1.45 ${S};color:${C.brod};"><b style="color:${C.nat};">${esc(dato(dag(v)))}</b> · <a href="${esc(link(v.s))}" style="color:${C.nat};text-decoration:none;font-weight:600;">${esc(v.s.kt || v.s.t)}</a></p>`).join("")
    + `</td></tr></table></td></tr>`;
  const tip = (v, i) => {
    const s = v.s;
    const piller = v.grunde.map((g) => { const [bg, fg] = PILLE[g.id] || [C.rule, C.nat]; return `<span style="display:inline-block;margin:0 4px 6px 0;padding:4px 9px;border-radius:99px;background:${bg};color:${fg};font:700 11px/1.2 ${S};letter-spacing:.06em;text-transform:uppercase;">${esc(g.navn)}</span>`; }).join("");
    const besl = renBesl(s.kb);
    const meta = `${s.u} · ${s.st === "kommer" ? "møde" : "behandlet"} ${dato(s.dato)}${besl && s.st !== "kommer" ? ` · ${kort(besl, 110)}` : ""}${v.ogsaa?.length ? ` · også i ${v.ogsaa.join(" og ")}` : ""}`;
    const spm = [...v.grunde].sort((a, b) => SPM.indexOf(a.id) - SPM.indexOf(b.id)).slice(0, 2).map((g) => g.spm).join(" ");
    return `<tr><td style="padding:10px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.kalkLys};border-radius:16px;"><tr><td style="padding:22px 24px 24px;">
  <p style="margin:0 0 8px;font:800 13px/1.4 ${S};color:${C.vin};">Tip ${i + 1}</p>
  <p style="margin:0 0 4px;">${piller}</p>
  <a href="${esc(link(s))}" style="font:800 20px/1.3 ${S};color:${C.nat};text-decoration:none;">${esc(s.kt || s.t)}</a>
  <p style="margin:6px 0 0;font:600 12px/1.45 ${S};color:${C.muted};">${esc(meta)}</p>
  ${s.d ? `<p style="margin:10px 0 0;font:15px/1.55 ${S};color:${C.brod};">${esc(kort(s.d))}</p>` : ""}
  <p style="margin:10px 0 0;font:14px/1.6 ${S};color:${C.brod};">${v.grunde.map((g) => `<b style="color:${C.nat};">${esc(g.navn)}:</b> ${esc(g.tekst)}`).join("<br>")}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;"><tr><td style="padding:10px 14px;border-radius:10px;background:${C.lyng};font:15px/1.5 ${S};color:${C.blaek};"><b>Spørg:</b> ${esc(spm)}</td></tr></table>
  <p style="margin:14px 0 0;">${pil(link(s), "Sagen på Sagsvagt")}</p>
  ${s.k ? `<p style="margin:6px 0 0;">${pil(s.k, "Kommunens dokument")}</p>` : ""}
</td></tr></table></td></tr>`;
  };
  const andre = vurderet.length - top.length;
  const kommuneSide = k.slug === "koebenhavn" ? SITE : `${SITE}kommune/${k.slug}/`;
  const link2 = (href, t) => `<a href="${esc(href)}" style="display:inline-block;padding:12px 9px;line-height:20px;font-weight:600;color:${C.indigo};">${t}</a>`;
  const html = mailTop({ emne, preheader: top[0] ? `${top[0].s.kt || top[0].s.t}${top.length > 1 ? ` og ${top.length - 1} tips mere` : ""}.` : `Ingen tips fra ${k.navn} i denne uge.`, uge: nr, idag: IDAG, logo: `${MAIL}logo.png` })
    + `<tr><td align="center" style="padding:12px 28px 0;">
  <h1 style="margin:0;font:800 34px/1.12 ${S};color:${C.nat};">${top.length} ${top.length === 1 ? "tip" : "tips"} fra<br>${esc(k.navn)}.</h1>
  <p style="margin:14px 0 0;font:600 13px/1.5 ${S};color:${C.muted};">${vurderet.length} sager fra ${esc(dato(fra))} til i dag${til ? ` · Til ${esc(til)}` : ""}</p>
</td></tr>
<tr><td style="padding:22px 0 0;font-size:0;line-height:0;"><img src="${MAIL}boelge-lyng.png" width="600" height="70" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>
`
    + (top.length ? h2("Ugens tips") + top.map(tip).join("\n") : `<tr><td align="center" style="padding:24px 36px;font:16px/1.55 ${S};color:${C.brod};">Ingen sager med en tydelig grund i perioden.</td></tr>`)
    + (frister.length ? h2("Høringsfrister") + liste(frister.slice(0, 10), (v) => v.grunde.find((g) => g.frist).frist) : "")
    + (kommende.length ? h2("På kommende møder") + liste(kommende.slice(0, 10), (v) => v.s.dato) : "")
    + (andre > 0 ? `<tr><td align="center" style="padding:22px 28px 0;font:14px/1.55 ${S};color:${C.brod};">Og ${andre} andre sager i perioden. ${pil(kommuneSide, `Se ${k.navn} på Sagsvagt`)}</td></tr>` : "")
    + `<tr><td style="padding:34px 0 0;font-size:0;line-height:0;"><img src="${MAIL}boelge-rosen.png" width="600" height="70" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>
<tr><td align="center" style="padding:18px 32px 30px;font:12px/1.6 ${S};color:${C.muted};">
  <img src="${MAIL}symbol.png" width="23" height="28" alt="" style="display:block;border:0;margin:0 auto 14px;">
  Til redaktionen og efter aftale. Ikke til offentliggørelse. Sagerne er fundet automatisk i ${esc(k.navn)} Kommunes egne dagsordener og referater; tal, datoer og navne står i kommunens dokument. Grundene er Sagsvagts læsning af teksten, ikke en vurdering af, hvad der er en historie. Bilag er ikke gengivet.<br>
  ${link2(`mailto:mansa@sagsvagt.dk?subject=${encodeURIComponent(`Tiplisten for ${k.navn}`)}`, "Skriv til os")}${link2(`mailto:mansa@sagsvagt.dk?subject=${encodeURIComponent(`Stop tiplisten for ${k.navn}`)}`, "Stop tiplisten")}${link2(`${SITE}privatliv.html`, "Privatliv")}
  <br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const tekst = `Tipliste uge ${nr} · ${k.navn}${til ? ` · til ${til}` : ""}\n${vurderet.length} sager fra ${dato(fra)} til i dag.\n\nUGENS TIPS\n\n`
    + top.map((v, i) => `${i + 1}. ${v.s.kt || v.s.t}\n   ${v.s.u} · ${v.s.st === "kommer" ? "møde" : "behandlet"} ${dato(v.s.dato)}\n   ${v.grunde.map((g) => `${g.navn}: ${g.tekst}`).join(" · ")}\n   Spørg: ${[...v.grunde].sort((a, b) => SPM.indexOf(a.id) - SPM.indexOf(b.id)).slice(0, 2).map((g) => g.spm).join(" ")}\n   ${link(v.s)}`).join("\n\n")
    + (frister.length ? `\n\nHØRINGSFRISTER\n${frister.slice(0, 10).map((v) => `- ${dato(v.grunde.find((g) => g.frist).frist)}: ${v.s.kt || v.s.t}\n  ${link(v.s)}`).join("\n")}` : "")
    + (kommende.length ? `\n\nPÅ KOMMENDE MØDER\n${kommende.slice(0, 10).map((v) => `- ${dato(v.s.dato)}, ${v.s.u}: ${v.s.kt || v.s.t}\n  ${link(v.s)}`).join("\n")}` : "")
    + `\n\n--\nTil redaktionen og efter aftale. Ikke til offentliggørelse. Kilde: ${k.navn} Kommunes dagsordener og referater.\nStop tiplisten eller skriv til os: mansa@sagsvagt.dk\nSagsvagt · CVR 46841514\n`;
  return { emne, html: moerk(html), tekst };
}

// Tipsene i alle åbne kommuner: kun sager med mindst én grund, de seneste 14 dage og kommende møder. Sagens titel, dato
// og link står i kommunens sager.json på siden; her står kun det, serveren ikke selv kan regne ud.
async function indeks() {
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const navne = Object.fromEntries(aabne.map((x) => [x.slug, x.navn]));
  const kommuner = {};
  let n = 0;
  for (const { slug } of aabne) {
    let k;
    try { k = await hentKommune(slug, navne); } catch { continue; }
    const fra = minus(IDAG, 14);
    const tips = slaaSammen(k.sager
      .filter((s) => (s.st === "kommer" && s.dato >= IDAG) || (s.st !== "kommer" && s.dato >= fra && s.dato <= IDAG))
      .filter((s) => !s.r && !RUTINE_EKSTRA.test(s.t))
      .map((s) => vurder(s, k.byer, k.fuld[s.id])))
      .filter((v) => v.grunde.length)
      .map((v) => ({ id: v.s.id, p: v.point, g: v.grunde.map(({ id, navn, tekst }) => ({ id, navn, tekst })),
        spm: [...v.grunde].sort((a, b) => SPM.indexOf(a.id) - SPM.indexOf(b.id)).slice(0, 2).map((g) => g.spm).join(" "), ogsaa: v.ogsaa }));
    kommuner[slug] = { navn: k.navn, tips };
    n += tips.length;
  }
  await writeFile(join(ROD, "api", "_tips.json"), JSON.stringify({ genereret: new Date().toISOString(), kommuner }));
  console.log(`api/_tips.json: ${n} tips i ${Object.keys(kommuner).length} kommuner`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--indeks")) return indeks();
  const valg = (navn, std) => { const i = args.indexOf(navn); return i >= 0 ? args.splice(i, 2)[1] : std; };
  const dage = Number(valg("--dage", 14)), til = valg("--til", ""), antalTop = Number(valg("--antal", 8));
  const slugs = args.filter((a) => !a.startsWith("--"));
  if (!slugs.length) throw new Error("brug: node avis/tipliste.mjs <kommune> [--dage 14] [--til \"Redaktion\"] [--antal 8]");
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const navne = Object.fromEntries(aabne.map((x) => [x.slug, x.navn]));
  const ukendte = slugs.filter((s) => !navne[s]);
  if (ukendte.length) throw new Error(`ukendte eller lukkede kommuner: ${ukendte.join(", ")}`);
  await mkdir(UD, { recursive: true });
  for (const slug of slugs) {
    const k = await hentKommune(slug, navne);
    const fra = minus(IDAG, dage);
    const vurderet = slaaSammen(k.sager
      .filter((s) => (s.st === "kommer" && s.dato >= IDAG) || (s.st !== "kommer" && s.dato >= fra && s.dato <= IDAG))
      .filter((s) => !s.r && !RUTINE_EKSTRA.test(s.t))
      .map((s) => vurder(s, k.byer, k.fuld[s.id])));
    const top = [...vurderet].filter((v) => v.grunde.length).sort((a, b) => b.point - a.point || b.s.dato.localeCompare(a.s.dato)).slice(0, antalTop);
    const fil = `tipliste-${slug}-${IDAG}.html`;
    await writeFile(join(UD, fil), listeHtml({ k, til, fra, vurderet, top }));
    if (args.includes("--mail")) {
      const m = listeMail({ k, til, fra, vurderet, top });
      await writeFile(join(UD, fil.replace(".html", "-mail.html")), m.html);
      await writeFile(join(UD, fil.replace(".html", "-mail.txt")), `Emne: ${m.emne}\n\n${m.tekst}`);
    }
    const nyeste = k.sager.reduce((m, s) => s.st !== "kommer" && s.dato > m ? s.dato : m, "");
    console.log(`${fil}: ${vurderet.length} sager, ${top.length} tips (nyeste referat ${nyeste})`);
  }
}

export { vurder };
if (import.meta.filename === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
