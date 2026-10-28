// Sagsvagt Erhverv: rapporter med tidlige signaler om byggeri, planer, grunde, infrastruktur og energi fra kommunernes egne
// dagsordener og referater. Én rapport pr. kunde (eller pr. kommune til demo), bygget af sager.json, som avisen allerede laver.
//
// Kør:  node avis/signaler.mjs                         alle rapporter i plan/erhverv/kunder.json
//       node avis/signaler.mjs koebenhavn vejle greve  én demorapport pr. kommune (tidlige signaler)
//       node avis/signaler.mjs --energi aabenraa vejen én energiradar for de kommuner
//       node avis/signaler.mjs --eksempel vejle          den offentlige eksempelrapport til erhverv.html (erhverv/eksempel.html)
//       node avis/signaler.mjs --indeks                  signalindekset for alle åbne kommuner til kundernes rapportside og
//                                                        erhvervsmailen (api/_erhverv-signaler.json, se api/_erhverv.php)
//
// Rapporterne er til kunderne og må ikke ligge offentligt: de skrives til plan/erhverv/rapporter/ (plan/ uploades ikke).
// Billeder og links peger på sagsvagt.dk, så rapporten kan sendes som én fil. Bilag gengives ikke (ophavsretsloven § 9);
// vi refererer kort og linker til kommunens eget dokument. Partier og stemmer fremhæves ikke, kun udfaldet.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const SITE = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
let UD = join(ROD, "plan", "erhverv", "rapporter");
const IDAG = new Date().toISOString().slice(0, 10);
const DAGE_TILBAGE = 90;
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const dato = (d) => { const [, m, dg] = d.split("-"); return `${Number(dg)}. ${MDR[m - 1]}`; };
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dageSiden = (d) => (Date.parse(IDAG) - Date.parse(d)) / 864e5;

// ---------- Hvad er et signal? ----------
// Typerne i den rækkefølge, de står i rapporten. Første type, der passer, vinder. Ordene er valgt ud fra 21.500 sager i 82
// kommuner (okt. 2026) og en mærket stikprøve på 150 signaler (26/10, salg/kvalitet/): "Infrastruktur" kræver noget, der
// ligger i gaden (vej, sti, kryds, plads), og "Boliger og byggeri" kræver et byggeord, så de ikke bliver skraldespande for alt
// med en anlægsbevilling eller ordet "boliger". Vand og kloak er klima. \b forhindrer fx "Vindmøllevej" i at blive til energi.
const GADE = "vej|vejen|sti|stier|broen|kryds|torv|plads|pladsen|p-plads|parkering|havn|station|gade|byrum|trafiksikkerhed";
const BYGNING = "skole|børnehus|børnehave|daginstitution|vuggestue|hal\\b|hallen|plejehjem|plejecenter|bygning|rådhus|bibliotek|svømmehal|idrætsanlæg|botilbud";
const TYPER = {
  signaler: [
    { id: "plan", navn: "Byudvikling og lokalplaner", om: "Nye bydele, lokalplaner og tillæg: hvad der kan bygges, hvor, og hvornår.",
      rx: /lokalplan|kommuneplantillæg|kommuneplan\b|byplan|planforslag|helhedsplan|byudvikling|byomdannelse|udviklingsplan|masterplan|planstrategi/ },
    { id: "grund", navn: "Grunde og ejendomme", om: "Salg, køb og udbud af kommunens grunde, arealer og bygninger.",
      rx: /grundsalg|salg af (grund|areal|ejendom|bygning)|køb af (grund|areal|ejendom)|udbud af (grund|areal|ejendom)|erhvervsgrund|erhvervsjord|erhvervsareal|byggegrund|byggefelt|byggemodning|jordkøb|arealoverdragelse|mageskifte|grunde til salg|udvidelse af (bolig|erhvervs)område/ },
    { id: "energi", navn: "Klima og energi", om: "Sol, vind, varme, biogas, vand og klimatilpasning.",
      rx: /solcelle|solpark|solenergi|\bvindmølle|vindmøller|energipark|biogas|geotermi|overskudsvarme|\bptx\b|power-to-x|varmepumpe|fjernvarme|vedvarende energi|ve-anlæg|skybrud|klimatilpasning|klimasikring|stormflod|kystsikring|oversvømmelse|spildevand|regnvand|separatkloak|kloakering|vådområde|lavbund|udtagning af|udtagningsprojekt|stenrev|elkedel|batteripark/ },
    { id: "infra", navn: "Infrastruktur", om: "Veje, cykelstier, kollektiv trafik, havne og byrum.",
      rx: new RegExp(`vejanlæg|vejprojekt|\\bletbane|\\bmetro\\b|cykelsti|trafikplan|(ny|nye|anlæg af|renovering af|udskiftning af|etablering af) .{0,20}\\bbro|motorvej|rundkørsel|krydsombygning|havneudvidelse|parkeringshus|stationsområde|projektforslag (for|af|til) .{0,40}(${GADE})|(anlægsbevilling|anlægsmidler|ombygning|renovering|udvidelse|etablering|anlæg) .{0,60}(${GADE})`) },
    { id: "bolig", navn: "Boliger og byggeri", om: "Nybyggeri, almene boliger, renoveringer og byggeprojekter.",
      rx: new RegExp(`skema [abc]\\b|almene? (familie|ungdoms|senior|ældre)?boliger|(opfør|byg|etabler|nye|flere|\\d+) .{0,30}boliger|nybyggeri|byggeprojekt|\\bbyggeri\\b|opførelse af|tilbygning|udbygning af|totalentreprise|hovedentreprise|entrepriseform|licitation|udbudsform|udbudsstrategi|ungdomsbolig|seniorbolig|plejeboliger|friplejehjem|nyt plejehjem|ny (skole|daginstitution|børnehave|hal)|(anlægsbevilling|anlægsmidler|ombygning|renovering|modernisering) .{0,80}(${BYGNING})|(udvidelse|udbygning) af .{0,25}(${BYGNING})|(${BYGNING}).{0,40}(ombygning|renovering|nybyg)`) },
    { id: "anlaeg", navn: "Andre anlæg", om: "Anlægsbevillinger, renoveringer og nedrivninger, der ikke passer i de andre typer.",
      rx: /anlægsbevilling|anlægsmidler|anlægsprojekt|renovering|nedrivning|områdefornyelse|landsbyfornyelse|byfornyelse|asfalt|facade/ },
  ],
  energi: [
    { id: "sol", navn: "Sol og batterier", om: "Solparker, solceller og batterier.", rx: /solcelle|solpark|solenergi|batteripark|elkedel/ },
    { id: "vind", navn: "Vind", om: "Vindmøller og vindmølleparker.", rx: /\bvindmølle|vindmøller|kystnær vind/ },
    { id: "gas", navn: "Biogas og PtX", om: "Biogas, PtX og brint.", rx: /biogas|\bptx\b|power-to-x|brint|metanol/ },
    { id: "varme", navn: "Varme", om: "Fjernvarme, varmepumper og varmeplaner.", rx: /fjernvarme|varmepumpe|varmeplan|overskudsvarme|geotermi/ },
    { id: "plan", navn: "Energiplaner og -parker", om: "Energiparker, temaplaner og VE-anlæg i kommuneplanen.", rx: /energipark|vedvarende energi|ve-anlæg|temaplan|energiplan|energistrategi/ },
  ],
};
// Sager, der ligner, men ikke er signaler. Testes kun på titlen: resuméer nævner ofte "personale" eller "budgetopfølgning"
// i rigtige projekter. Mønstrene fra stikprøven 26/10: dispensationer til enkeltejendomme, besøg og studieture,
// bevaringsvurderinger, bevillingsteknik og politisk proces. Dispensationer blokeres, medmindre de gælder boliger
// (fx "dispensation fra lokalplan til almene ungdomsboliger"). Fra stikprøve 3 (28/10): tilskudsansøgninger,
// evalueringer, hastighedsændringer og byer, der udgår af varmeplanen.
const IKKE =/indkvartering|takst|gebyr|tilsynsrapport|ansættelse|personale|klagesag|enkeltsag|ejendomsskat|lønpolitik|budgetopfølgning|regnskab|kunstværk|\bkunst\b|skulptur|navngivning|udsmykning|dispensation.{0,80}(tilbygning|udestue|drivhus|skur\b|fladt tag|grøn rabat|terrænregulering|carport|garage)|lovliggør|afstandskrav til skel|rundvisning|studietur|inspirationstur|besøg (af|hos|på|og)|årligt dialogmøde|bevaringsværdi|^statusorientering$|^orienteringspunkter|bevillingsmæssige ændringer|sammenlægning af bevillinger|^budgetforslag |svar på forslag fra|henvendelse til partierne|^intro(duktion)? til |begrebsafklaring|brugertilfredshed|handicappris|kommunikation om|specialkørsel|kørsel af|stomi|affaldsindsamling|sagsbehandlingstid|inddragelse af omverden|høringsperioden|dialogmøde og bilaterale|plejeboliganalyse|fjernvarmeoplag|fjernvarmekommunikation|stop for konvertering|bosætningsstrategi|bosætningsindsats|kulturarv|arkitekturpris|boligsocial|social masterplan|sociale masterplan|udtrædelse|udtræden|introduktion af|brugerinddragelse|p-fond|lovforslag|udlejningsaftale|delebil|beregningsværktøj|vejnavn|kontrollør|tilskudsmodel|venteliste|lukning af|gadealtan|samværstilbud|aktivitetstilbud|musikforløb|proces og tidsplan|opstart af planstrategi|politikken\b|\bpolitik for|målsætning|omprioritering|revisionsberetning|^budget \d|byggetilladelse|enfamiliehus|dispensation(?!.{0,80}(almen|boliger|ungdomsbolig|etagebolig))|facadeskilt|ansøgning om tilskud|^evaluering af|hastighedsændring|hastighedsgrænse|udgår som|\bskilt|spørgsmål ift|borgerdrevne|opfølgningsrapport|beredskab/;

// Stadiet læses af kommunens egne ord. Rækkefølgen er projektets livsløb, så de tidligste står først i rapporten.
// "Endelig" i titlen vinder over "forslag". "Vedtaget" kræver, at udfaldet eller teksten siger det; ellers "Behandlet".
const STADIER = [
  { id: "endelig", navn: "Til endelig vedtagelse", om: "Forslaget er tilbage efter høring og skal vedtages endeligt.", rx: /endelig vedtagelse|endeligt vedtag|endelig godkendelse|\bendelig\b/ },
  { id: "ide", navn: "Idé", om: "Tidlige drøftelser, indledende høring, forundersøgelse og markedsdialog, før der ligger et forslag.",
    rx: /indledende høring|igangsætning af (lokalplan|planlægning)|igangsættelse af (lokalplan|planlægning)|forundersøgelse|markedsdialog|idéoplæg|ideoplæg|principbeslutning|principper for|drøftelse|vision|strategi|screening|igangsættelse af planlægning|planlægning for/ },
  { id: "forslag", navn: "Forslag", om: "Et konkret forslag eller projekt er til politisk behandling.", rx: /forslag til|projektforslag|planforslag|dispositionsforslag|skitseforslag|skema a\b/ },
  { id: "hoering", navn: "Høring", om: "Forslaget er i offentlig høring eller naboorientering.", rx: /offentlig høring|i høring|høringssvar|naboorientering|høring om|høring af/ },
  { id: "igang", navn: "I gang", om: "Anlæg, udbud eller byggeri er sat i gang.", rx: /anlægsbevilling|frigivelse af|udbud|licitation|byggestart|igangsætning|igangsat|påbegyndt|anlægsarbejde|kontrakt|status på|statusorientering|skema [bc]\b/ },
  { id: "vedtaget", navn: "Vedtaget", om: "Besluttet eller godkendt.", rx: /vedtog|vedtaget|besluttede|godkendt|godkendte|tiltrådt|tiltrådte|anbefalet|anbefalede/ },
  { id: "behandlet", navn: "Behandlet", om: "Behandlet på et møde, uden at referatet siger, hvad der blev besluttet.", rx: /./ },
];
const RAEKKE = ["ide", "forslag", "hoering", "endelig", "vedtaget", "igang", "behandlet"];

const EMNEBILLEDER = ["aeldre", "affald", "bolig", "budget", "byggeri", "erhverv", "klima", "kultur", "skole", "social", "trafik", "unge"];
const TYPEBILLEDE = { plan: "byggeri", grund: "byggeri", bolig: "bolig", infra: "trafik", anlaeg: "byggeri", energi: "klima", sol: "klima", vind: "klima", gas: "klima", varme: "klima" };
const billede = (s, type) => SITE + (s.b || `assets/emner/${TYPEBILLEDE[type] || [...(s.e || [])].find((e) => EMNEBILLEDER.includes(e)) || "generel"}.svg`);

// Administrative punkter (valg af medlemmer, repræsentanter, mødeplaner) nævner ofte lokalplaner uden selv at være et signal.
// "Valg af entrepriseform" og "udpegning af udviklingsområder" er derimod signaler.
const ADMIN = /valg af (medlem|repræsentant|formand|næstformand|forperson|stedfortræder|suppleant)|generel orientering|forperson|formand|repræsentant|gå-hjem|mødeplan|mødekalender|arbejdsgruppe|udpegning af (medlem|repræsentant)|kommissorium|evaluering af (processen|arbejdet)|deltagelse i|invitation|meddelelser|forespørgsel|spørgsmål til/;
function klassificer(s, segment) {
  const titel = `${s.t} ${s.kt || ""}`.toLowerCase(), tekst = `${titel} ${s.d || ""}`.toLowerCase();
  if (IKKE.test(titel) || ADMIN.test(titel)) return null;
  // Overskriften afgør typen; beskrivelsen kun, når overskriften ikke siger noget om det
  const type = TYPER[segment].find((t) => t.rx.test(titel)) || TYPER[segment].find((t) => t.rx.test(tekst));
  if (!type) return null;
  // Titlen vejer tungest: "Endelig vedtagelse af lokalplan" er til endelig vedtagelse, også hvis resuméet nævner høringen.
  // Vedtaget læses af udfaldet (ud/kb) eller teksten; kommende sager er forslag, indtil de er behandlet.
  const ord = (x) => !["vedtaget", "behandlet"].includes(x.id);
  let stadie = STADIER.find((x) => ord(x) && x.rx.test(titel)) || STADIER.find((x) => ord(x) && x.rx.test(tekst));
  if (!stadie) {
    const udfald = `${s.ud || ""} ${s.kb || ""} ${s.d || ""}`.toLowerCase();
    stadie = STADIER.find((x) => x.id === (s.st === "kommer" ? "forslag" : STADIER.find((y) => y.id === "vedtaget").rx.test(udfald) ? "vedtaget" : "behandlet"));
  }
  return { type, stadie };
}

// ---------- Data ----------
async function hentKommune(slug, navne) {
  const f = slug === "koebenhavn" ? join(ROD, "assets", "sager.json") : join(ROD, "kommune", slug, "sager.json");
  const d = JSON.parse(await readFile(f, "utf8"));
  return { slug, navn: navne[slug] || slug, sager: d.sager, moeder: d.moeder || [] };
}

// Samme sag på tværs af udvalg og møder: titlen uden "Forslag til" o.l. (også nøglen, kunderne følger en sag med)
const sagsNoegle = (s) => (s.kt || s.t).toLowerCase().replace(/\s+/g, " ").replace(/^(forslag til|endelig vedtagelse af|vedtagelse af)\s+/, "").slice(0, 90);
function signaler(k, segment) {
  const valgt = k.sager.filter((s) => (s.st === "kommer" && s.dato >= IDAG) || (s.st !== "kommer" && dageSiden(s.dato) <= DAGE_TILBAGE));
  // Samme sag behandles ofte i flere udvalg: den nyeste behandling bliver signalet, de andre står som "sagens vej"
  const prSag = new Map();
  for (const s of valgt) {
    const kl = klassificer(s, segment); if (!kl) continue;
    const noegle = sagsNoegle(s);
    const g = prSag.get(noegle) || { behandlinger: [] };
    g.behandlinger.push(s);
    if (!g.s || s.dato > g.s.dato) Object.assign(g, { s, ...kl });
    prSag.set(noegle, g);
  }
  return [...prSag.values()].map((g) => ({ ...g, behandlinger: g.behandlinger.sort((a, b) => a.dato.localeCompare(b.dato)) }));
}

// ---------- Rapporten ----------
const link = (s) => SITE + s.url;
function signalKort(g) {
  const s = g.s, kommende = s.st === "kommer";
  const tekst = s.d && s.d.length > 320 ? `${s.d.slice(0, 317).replace(/\s\S*$/, "")} …` : s.d || "";
  const vej = g.behandlinger.length > 1
    ? `<p class="vej">Sagens vej: ${g.behandlinger.map((b) => `<a href="${esc(link(b))}">${esc(b.u)} ${dato(b.dato)}</a>`).join(" → ")}</p>` : "";
  return `<article class="signal">
  <a class="sb" href="${esc(link(s))}" tabindex="-1" aria-hidden="true"><img src="${esc(billede(s, g.type.id))}" alt="" loading="lazy"></a>
  <div>
    <p class="kicker">${esc(g.type.navn)} · <span class="st st-${g.stadie.id}">${esc(g.stadie.navn)}</span>${kommende ? ` · <span class="kom">På dagsordenen ${dato(s.dato)}</span>` : ""}</p>
    <h3><a href="${esc(link(s))}">${esc(s.kt || s.t)}</a></h3>
    <p class="meta">${esc(s.u)} · ${kommende ? "møde" : "behandlet"} ${dato(s.dato)}${s.ud && !kommende ? ` · ${esc(s.ud.length > 120 ? s.ud.slice(0, 117) + " …" : s.ud)}` : ""}</p>
    ${tekst ? `<p class="dek">${esc(tekst)}</p>` : ""}
    ${vej}
    <p class="kilder"><a href="${esc(link(s))}">Læs sagen på Sagsvagt</a>${s.k ? ` · <a href="${esc(s.k)}" rel="nofollow">Kommunens dokument</a>` : ""}</p>
  </div>
</article>`;
}

function rapportHtml({ titel, undertitel, segment, kommuner, alle, eksempel }) {
  const typer = TYPER[segment];
  const antal = (f) => alle.filter(f).length;
  const kommende = alle.filter((g) => g.s.st === "kommer").sort((a, b) => a.s.dato.localeCompare(b.s.dato));
  const natkort = `${SITE}assets/natkort/${kommuner[0].slug}.jpg`;
  const sektioner = typer.map((t) => {
    const l = alle.filter((g) => g.type.id === t.id).sort((a, b) => RAEKKE.indexOf(a.stadie.id) - RAEKKE.indexOf(b.stadie.id) || b.s.dato.localeCompare(a.s.dato));
    return l.length ? `<section class="type" id="${t.id}"><div class="type-h"><h2>${esc(t.navn)} <span>${l.length}</span></h2><p>${esc(t.om)}</p></div>${l.map(signalKort).join("\n")}</section>` : "";
  }).join("\n");
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titel)} – Sagsvagt Erhverv</title>
<link rel="stylesheet" href="${SITE}assets/fonts/montserrat.css">
<style>
:root{--nat:#0E0F14;--blaek:#0C1430;--indigo:#28377A;--bordeaux:#3E0E14;--vin:#8A2430;--rubin:#B04A50;--rosen:#DCA9A5;--lyng:#B7BBD8;--kalk:#E6DFD3;--kalk-lys:#EEE8DE;--kalk-mork:#D9D1C3;--rule:#CFC6B8;--muted:#56535A;--sans:Montserrat,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--kalk);color:var(--nat);font:500 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,p{margin:0}a{color:var(--indigo);text-underline-offset:3px}.wrap{max-width:1000px;margin:0 auto;padding:0 24px}
.top{color:var(--kalk);background:linear-gradient(90deg,rgba(14,15,20,.55),rgba(14,15,20,.15) 65%),linear-gradient(135deg,rgba(40,55,122,.55),rgba(14,15,20,.4) 55%,rgba(62,14,20,.6)),url("${esc(natkort)}") center/cover no-repeat,var(--nat);padding:28px 0 40px}
.top{position:relative}.top::after{content:"Kort: © OpenStreetMap-bidragydere";position:absolute;right:12px;bottom:6px;font:500 10px/1.2 var(--sans);color:rgba(230,223,211,.7);pointer-events:none}
.brand{display:flex;justify-content:space-between;align-items:center;font:700 14px var(--sans);opacity:.9}.brand span{font:700 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--rosen)}
.top .k{margin-top:40px;font:700 12px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--rosen)}
.top h1{font:800 clamp(30px,1.4rem + 2.6vw,48px)/1.06 var(--sans);letter-spacing:-.02em;margin:8px 0 12px}
.top p.u{color:rgba(230,223,211,.85);max-width:44em}
.tal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:28px;border-top:1px solid rgba(230,223,211,.22)}
.tal div{padding:14px 0 0}.tal div+div{border-left:1px solid rgba(230,223,211,.22);padding-left:16px}
.tal b{display:block;font:800 34px/1 var(--sans)}.tal span{display:block;margin-top:6px;font-size:12.5px;color:rgba(230,223,211,.78)}
main{padding:40px 0 64px}.note{font-size:13px;color:var(--muted);border-left:3px solid var(--rubin);padding:4px 0 4px 12px;margin-bottom:32px}
.kommende{background:var(--kalk-lys);border:1px solid var(--rule);border-radius:16px;padding:20px 22px;margin-bottom:40px}
.kommende h2{font:800 18px var(--sans);margin-bottom:10px}.kommende li{margin:6px 0}.kommende ul{margin:0;padding-left:18px}
.type{margin-top:44px}.type-h{border-bottom:2px solid var(--nat);padding-bottom:10px;margin-bottom:6px}
.type-h h2{font:800 24px/1.2 var(--sans)}.type-h h2 span{font:700 14px var(--sans);color:var(--muted);margin-left:6px}.type-h p{color:var(--muted);font-size:14px;margin-top:4px}
.signal{display:grid;grid-template-columns:160px minmax(0,1fr);gap:20px;padding:20px 0;border-bottom:1px solid var(--rule)}
.sb img{display:block;width:160px;aspect-ratio:16/10;object-fit:cover;border-radius:12px;background:var(--kalk-mork)}
.kicker{font:700 11.5px/1.5 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.st{color:var(--rubin)}.st-ide,.st-forslag{color:var(--indigo)}.kom{color:var(--vin)}
.signal h3{font:700 18px/1.3 var(--sans);margin-bottom:4px}.signal h3 a{color:var(--nat);text-decoration:none}.signal h3 a:hover{text-decoration:underline}
.meta{font-size:13px;color:var(--muted)}.dek{font-size:14.5px;margin-top:8px}.vej{font-size:12.5px;color:var(--muted);margin-top:8px}.kilder{font:600 13px var(--sans);margin-top:8px}
footer{background:var(--nat);color:rgba(230,223,211,.72);font-size:13px;padding:28px 0}
@media (max-width:640px){.tal{grid-template-columns:1fr 1fr;gap:14px 0}.tal div:nth-child(3){border-left:0;padding-left:0}.signal{grid-template-columns:1fr}.sb img{width:100%}}
@media print{.top{background:var(--nat)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.signal{break-inside:avoid}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="brand"><span>Sagsvagt Erhverv</span>${esc(dato(IDAG))} ${IDAG.slice(0, 4)}</div>
  <p class="k">${segment === "energi" ? "Energiradar" : "Tidlige signaler"}</p>
  <h1>${esc(titel)}</h1>
  <p class="u">${esc(undertitel)}</p>
  <div class="tal">
    <div><b>${alle.length}</b><span>signaler i alt</span></div>
    <div><b>${antal((g) => ["ide", "forslag"].includes(g.stadie.id))}</b><span>idé eller forslag</span></div>
    <div><b>${antal((g) => g.stadie.id === "hoering")}</b><span>i høring</span></div>
    <div><b>${kommende.length}</b><span>på kommende møder</span></div>
  </div>
</div></header>
<main><div class="wrap">
  <p class="note">${eksempel ? `Eksempel på en rapport fra Sagsvagt Erhverv, bygget ${esc(dato(IDAG))} af de rigtige sager. <a href="${SITE}erhverv.html">Se produkterne og priserne</a>.` : "Til kunden og efter aftale. Ikke til offentliggørelse."} Signalerne er fundet automatisk i kommunernes egne dagsordener og referater; tal, datoer og navne står i kommunens dokument, som hvert signal linker til. Bilag er ikke gengivet. Typer og stadier er Sagsvagts læsning, ikke kommunens betegnelse.</p>
  ${kommende.length ? `<section class="kommende"><h2>På kommende møder</h2><ul>${kommende.slice(0, 12).map((g) => `<li><b>${dato(g.s.dato)}</b> · ${esc(g.s.u)}: <a href="${esc(link(g.s))}">${esc(g.s.kt || g.s.t)}</a></li>`).join("")}</ul></section>` : ""}
  ${sektioner || `<p>Ingen signaler i perioden.</p>`}
</div></main>
<footer><div class="wrap">Sagsvagt Erhverv · CVR 46841514 · mansa@sagsvagt.dk · Kilder: ${esc(kommuner.map((k) => `${k.navn} Kommune`).join(", "))}, dagsordener og referater ${DAGE_TILBAGE} dage tilbage og kommende møder.</div></footer>
</body>
</html>`;
}

async function bygRapport({ fil, titel, segment = "signaler", kommuner: slugs, eksempel = false }, navne) {
  const kommuner = await Promise.all(slugs.map((s) => hentKommune(s, navne)));
  const alle = kommuner.flatMap((k) => signaler(k, segment).map((g) => ({ ...g, kommune: k.navn })));
  const hvor = kommuner.map((k) => k.navn).join(", ").replace(/, ([^,]*)$/, " og $1");
  const undertitel = segment === "energi"
    ? `Sager om sol, vind, biogas, varme og energiplaner i ${hvor}: de seneste ${DAGE_TILBAGE} dage og kommende møder.`
    : `Sager om byudvikling, lokalplaner, grunde, byggeri og infrastruktur i ${hvor}: de seneste ${DAGE_TILBAGE} dage og kommende møder. De tidligste står først.`;
  await mkdir(UD, { recursive: true });
  await writeFile(join(UD, fil), rapportHtml({ titel: titel || hvor, undertitel, segment, kommuner, alle, eksempel }));
  return { fil, antal: alle.length };
}

// ---------- Indekset til serveren ----------
// Alle signaler fra alle åbne kommuner, begge segmenter, i én fil, som api/_erhverv.php filtrerer pr. kunde. Filen ligger i
// api/ med _ foran, så den ikke kan hentes udefra (api/.htaccess), og er i .gitignore, så den ikke kommer i det offentlige repo.
// "set" er den dag, robotten første gang så signalet (data/erhverv-foerst-set.json); den afgør, hvad der er nyt i ugens mail.
async function bygIndeks(aabne) {
  const setFil = join(ROD, "data", "erhverv-foerst-set.json");
  let set = null;
  try { set = JSON.parse(await readFile(setFil, "utf8")); } catch {}
  const foersteGang = !set; set ||= {};
  // Projektkortene (avis/erhverv-fakta.mjs) og kommunernes EU-udbud (avis/udbud.mjs), hvis de findes
  let fakta = {}, udbud = { udbud: [], grupper: [] };
  try { fakta = JSON.parse(await readFile(join(import.meta.dirname, "erhverv-fakta.json"), "utf8")); } catch {}
  try { udbud = JSON.parse(await readFile(join(ROD, "data", "udbud.json"), "utf8")); } catch {}
  let steder = {};
  try { steder = JSON.parse(await readFile(join(import.meta.dirname, "erhverv-steder.json"), "utf8")); } catch {}
  // Claude Haiku 5.5's bedømmelse af relevans 1–3 (avis/erhverv-relevans.mjs); mangler den, vises signalet som hidtil
  let relevans = {};
  try { relevans = JSON.parse(await readFile(join(import.meta.dirname, "erhverv-relevans.json"), "utf8")); } catch {}
  const signalerUd = new Map();
  for (const { slug, navn } of aabne) {
    let k; try { k = await hentKommune(slug, { [slug]: navn }); } catch { continue; }
    for (const segment of ["signaler", "energi"]) for (const g of signaler(k, segment)) {
      const s = g.s, id = s.id || s.url;
      const x = signalerUd.get(id) || {
        id, k: slug, kn: navn, t: s.kt || s.t, u: s.u, dato: s.dato, kom: s.st === "kommer" ? 1 : 0,
        d: s.d && s.d.length > 320 ? `${s.d.slice(0, 317).replace(/\s\S*$/, "")} …` : s.d || "",
        ud: s.ud && s.st !== "kommer" ? (s.ud.length > 140 ? s.ud.slice(0, 137) + " …" : s.ud) : "",
        url: s.url, kl: s.k || "", b: billede(s, g.type.id).slice(SITE.length), sd: g.stadie.id, ty: {}, n: `${slug}|${sagsNoegle(s)}`,
        vej: g.behandlinger.length > 1 ? g.behandlinger.map((b) => [b.u, b.dato, b.url]) : [],
      };
      x.ty[segment] = g.type.id;
      // Første gang filen laves, regnes alt, der allerede er behandlet, som set den dag, det blev behandlet
      set[id] ||= foersteGang && s.st !== "kommer" && s.dato < IDAG ? s.dato : IDAG;
      x.set = set[id];
      if (relevans[id]) { x.rv = relevans[id].r; x.rg = relevans[id].g; }
      if (fakta[id]) { const { lavet, ...f } = fakta[id]; x.f = f; const p = f.hvor && steder[`${slug}|${f.hvor}`]; if (p) x.geo = [p.lat, p.lon]; }
      signalerUd.set(id, x);
    }
  }
  // Signaler, der er faldet ud af vinduet, glemmes efter et halvt år
  for (const [id, d] of Object.entries(set)) if (!signalerUd.has(id) && dageSiden(d) > 180) delete set[id];
  const typer = Object.fromEntries(Object.entries(TYPER).map(([seg, l]) => [seg, l.map(({ id, navn, om }) => ({ id, navn, om }))]));
  const indeks = {
    genereret: new Date().toISOString(), dage: DAGE_TILBAGE, typer, raekke: RAEKKE,
    stadier: STADIER.map(({ id, navn, om }) => ({ id, navn, om })), kommuner: aabne.map(({ slug, navn }) => ({ slug, navn })),
    signaler: [...signalerUd.values()].sort((a, b) => b.dato.localeCompare(a.dato)),
    udbud: udbud.udbud, udbudGrupper: udbud.grupper, udbudHentet: udbud.hentet || null,
  };
  await writeFile(join(ROD, "api", "_erhverv-signaler.json"), JSON.stringify(indeks));
  await writeFile(setFil, JSON.stringify(set, null, 0).replace(/,"/g, ',\n"') + "\n");
  console.log(`Signalindeks: ${indeks.signaler.length} signaler i ${aabne.length} kommuner, ${indeks.signaler.filter((x) => x.f?.hvad).length} med projektkort, ${indeks.udbud.length} udbud`);
}

async function main() {
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const navne = Object.fromEntries(aabne.map((k) => [k.slug, k.navn]));
  if (process.argv.includes("--indeks")) return bygIndeks(aabne);
  const args = process.argv.slice(2), energi = args.includes("--energi"), eksempel = args.includes("--eksempel"), slugs = args.filter((a) => !a.startsWith("--"));
  // Eksemplet er reklame og må gerne ligge offentligt; de rigtige kunderapporter bliver i plan/
  if (eksempel) { if (slugs.length !== 1) throw new Error("--eksempel tager én kommune"); UD = join(ROD, "erhverv"); }
  let rapporter;
  if (slugs.length) {
    const ukendte = slugs.filter((s) => !navne[s]);
    if (ukendte.length) throw new Error(`ukendte eller lukkede kommuner: ${ukendte.join(", ")}`);
    rapporter = energi ? [{ fil: `energiradar-${slugs.join("-")}.html`, segment: "energi", kommuner: slugs }]
      : slugs.map((s) => ({ fil: eksempel ? "eksempel.html" : `signaler-${s}.html`, segment: "signaler", kommuner: [s], titel: navne[s], eksempel }));
  } else {
    rapporter = JSON.parse(await readFile(join(ROD, "plan", "erhverv", "kunder.json"), "utf8")).rapporter;
  }
  for (const r of rapporter) { const ud = await bygRapport(r, navne); console.log(`${ud.fil}: ${ud.antal} signaler`); }
}

// Klassifikationen kan importeres (fx til kvalitetsmåling); main kører kun, når filen startes direkte
export { klassificer, sagsNoegle, TYPER, STADIER, IKKE, ADMIN };
if (import.meta.filename === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
