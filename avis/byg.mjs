// Bygger avisen (forside, en side pr. sag, udvalgs- og bydelssider, sitemap)
// ud fra data/*.json. Kør: npm run byg
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { EMNER, emnerFor, deltagere, stemmetal, indstillingPunkter, videreTil, afstemninger, hoeringsfrist, iHoering, forklar } from "./beriget.mjs";
import { bygDelebilleder } from "./delebilleder.mjs";
import { sagensVej, vejBoks, bygPartier, bygHoeringer, bygKalendere, bygFeeds, kalenderLink, feedLink } from "./ekstra.mjs";

const ROD = join(import.meta.dirname, "..");
const SITE_URL = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
const IDAG = process.env.IDAG || new Date().toISOString().slice(0, 10);

// Logoet lægges direkte i hver side som et SVG-symbol, så det ikke afhænger af en separat billedfil
// (Simplys bot-beskyttelse kan blokere billedfiler for nogle browsere).
const LOGO_SVG = await readFile(join(ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8");
const LOGO_VB = LOGO_SVG.match(/viewBox="([^"]+)"/)[1];
const LOGO_SYMBOL = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="logo" viewBox="${LOGO_VB}">${
  LOGO_SVG.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "").replace(/<title>[\s\S]*?<\/title>/, "")}</symbol></svg>`;
const logo = (w, h) => `<svg viewBox="${LOGO_VB}" width="${w}" height="${h}" role="img" aria-label="Sagsvagt"><use href="#logo"/></svg>`;

// ---------- Hjælpere ----------
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
  .normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const DAGE = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const d = (iso) => new Date(iso + "T12:00:00Z");
const datoTekst = (iso) => `${d(iso).getUTCDate()}. ${MDR[d(iso).getUTCMonth()]} ${d(iso).getUTCFullYear()}`;
const kortDato = (iso) => `${d(iso).getUTCDate()}. ${MDR[d(iso).getUTCMonth()]}`;
const ugedag = (iso) => DAGE[d(iso).getUTCDay()];
function ugenr(iso) {
  const t = d(iso); const dag = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dag + 3);
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}
const afsnitTilHtml = (tekst) => tekst.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
// Forkorter til hele sætninger. Den første sætning må gerne være lidt længere end max, hellere end at blive klippet over.
// En sætning slutter ved . ? ! efterfulgt af stort bogstav (så "jf." og "bl.a." ikke tæller).
const saetninger = (t, max) => {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const slut = [...s.matchAll(/[.?!](?=\s+[A-ZÆØÅ"”]|$)/g)].map((m) => m.index + 1);
  const inden = slut.filter((i) => i <= max).pop();
  if (inden && inden > max * 0.4) return s.slice(0, inden);
  if (slut[0] && slut[0] <= max * 1.6) return s.slice(0, slut[0]);
  return s.slice(0, max).replace(/\s+\S*$/, "") + " …";
};
// Fjerner den indledning, der står i næsten alle resuméer ("Borgerrepræsentationen skal tage stilling til …"),
// fordi udvalget allerede står over overskriften.
const reRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const renDek = (t, udvalg) => {
  const ud = t.replace(new RegExp(`^(?:${reRe(udvalg)}|Udvalget|Lokaludvalget|Borgerrepræsentationen|Økonomiudvalget)\\s+(?:skal|bedes)\\s+(?:tage stilling til|orienteres om)\\s+(?![,]?\\s*(?:om|hvorvidt|hvordan)\\b)`, "i"), "")
    .replace(/^Det foreslås,?\s*•?\s*at\s+/i, "");
  return ud === t ? t : ud.replace(/^./, (c) => c.toUpperCase());
};

// ---------- Udvælgelse ----------
const STOEJ = /^(godkendelse af (dagsorden|referat)|referat og godkendelse|eventuelt|evt\.?$|meddelelser|orientering$|orientering fra|sager til orientering|kommende sager|næste møde|åben spørgetid|borgernes tid|aflæggerbordet|beslutning på fortrolige|fremlæggermappe|rokering i udvalg|borgerbesøg|spørgetid|underskrift)/i;
// Rutinesager publiceres, men kommer ikke på forsiden
const RUTINE = /(forretningsorden|regnskab|økonomi efter budget|bydelspulje|puljeansøgning|status på bydelsplan|mødekalender)|^(henvendelser|henvendelse til|puljeansøgning|ansøgninger til|beslutning om (pulje)?ansøgning|anerkendelsespris|punkter til dagsorden|mødeplan|ændring af forretningsorden|forretningsorden|.*studietur|regnskab|anden regnskabsprognose|aflæggelse af|årsplan|udpegning af|valg af|godkendelse af referat|tredje sag om bevillings|teknisk tilpasning)/i;
const renTitel = (t) => t.replace(/^[A-ZÆØÅ]-sag:\s*/, "").replace(/^[A-ZÆØÅ]\.\s+/, "")
  .replace(/^Beslutning(:| vedr\.?)\s+/i, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
const erLokaludvalg = (u) => /Lokaludvalg$/.test(u);
const bydel = (u) => u.replace(/\s*Lokaludvalg$/, "").replace(/^Christianshavns$/, "Christianshavn");
const VAEGT = { "Borgerrepræsentationen": 3, "Økonomiudvalget": 3, "Rådet for Visuel Kunst": 0 };

// Kommunens sager slutter med underskrifter ("Mikkel Boje / Janus Rønholt Hansen"), som hænger fast i det sidste afsnit.
// De fjernes, så de ikke ender i "Næste skridt" o.l. Et afsnit regnes for underskrift, hvis det kun er navne med stort.
const NAVN = /^[\s/]*[A-ZÆØÅ][a-zæøåéü.-]*(?:[\s/]+[A-ZÆØÅ][a-zæøåéü.-]*){1,9}[\s/]*$/;
function udenUnderskrift(t) {
  const dele = t.split(/\n\s*\n/);
  while (dele.length && NAVN.test(dele.at(-1).trim()) && dele.at(-1).length < 90) dele.pop();
  return dele.join("\n\n").trim();
}

function berig(s) {
  s.afsnit = s.afsnit.map((a) => (/beslutning/i.test(a.titel) ? a : { ...a, tekst: udenUnderskrift(a.tekst) }));
  const titel = renTitel(s.titel);
  const find = (re) => s.afsnit.find((a) => re.test(a.titel));
  const resume = find(/^Resumé$/) || find(/^Problemstilling/) || find(/^Indstilling/) || s.afsnit[0];
  const besl = find(/beslutning/i);
  let beslutning = besl ? besl.tekst.replace(/^[^\n]*beslutning[^\n]*den \d+\.? \w+ \d{4}\s*/i, "").trim() : "";
  // Selve udfaldet: "Indstillingen blev godkendt med 37 stemmer mod 12" e.l.
  const UDFALD = "godkendt|vedtaget|anbefalet|tiltrådt|forkastet|nedstemt|udsat|oversendt|taget til efterretning|tilbagesendt|standset|trukket|drøftet";
  // (?<![a-zæøå]) sikrer, at "Ændringsforslaget blev forkastet" ikke læses som "Forslaget blev forkastet"
  const hoved = new RegExp(`(?<![a-zæøå])(Indstillingen|Den således ændrede indstilling|Medlemsforslaget|Forslaget|Sagen)\\b[^.\\n]*\\b(${UDFALD})\\b[^.\\n]*\\.`, "gi");
  const andet = new RegExp(`[^.:”"\\n]*\\b(blev|er|var)\\b[^.\\n]{0,60}\\b(${UDFALD})\\b[^.\\n]*\\.`, "gi");
  // Afstemninger om ændringsforslag kommer ofte før selve afgørelsen og springes over
  const m = [...beslutning.matchAll(hoved)][0] || [...beslutning.matchAll(andet)].find((x) => !/ændringsforslag/i.test(x[0]));
  const udfaldTekst = m ? m[0].trim().replace(/^./, (c) => c.toUpperCase()) : "";
  // Partiernes stemmer står lige efter afgørelsen: "For: Ø, F og A\nImod: Å" eller "For stemte: …\nImod stemte: …"
  const hovedAfst = m ? afstemninger(beslutning).find((a) => a.om && m[0].includes(a.om.slice(0, 40))) : null;
  const navne = (l) => l.map((x) => x.b || x.navn).join(", ");
  const stemmer = hovedAfst && (hovedAfst.for.length || hovedAfst.imod.length)
    ? { for: navne(hovedAfst.for), imod: navne(hovedAfst.imod), undlod: navne(hovedAfst.undlod) } : null;
  const fremtid = s.dato >= IDAG;
  const status = s.type === "referat" && beslutning ? "besluttet" : fremtid ? "kommer" : "behandlet";
  const laengde = s.afsnit.reduce((n, a) => n + a.tekst.length, 0);
  const vaegt = VAEGT[s.udvalg] ?? (/musikudvalg|Rådet for|kunst|legat/i.test(s.udvalg) ? 0 : erLokaludvalg(s.udvalg) ? 1 : 2);
  const alder = Math.max(0, (d(IDAG) - d(s.dato)) / 864e5);
  const rutine = RUTINE.test(titel);
  const score = vaegt * 10 + Math.min(laengde / 800, 8) + (beslutning ? 3 : 0) - alder * 0.6 - (rutine ? 25 : 0);
  const dek = resume ? saetninger(renDek(resume.tekst.replace(/^Indstilling[^\n]*\n*/i, "").trim(), s.udvalg), 300) : "";
  const indst = find(/^Indstilling/)?.tekst || "";
  const videre = find(/^Videre proces/i);
  return {
    ...s, titel, beslutning, udfald: udfaldTekst, stemmer, status, laengde, vaegt, score, rutine, dek,
    // Stemmetallet hentes fra selve afgørelsen; tidligere afstemninger i referatet kan være om ændringsforslag
    tal: status === "besluttet" && /stemmer mod/i.test(udfaldTekst) ? stemmetal(beslutning.slice(m.index)) : null,
    emner: emnerFor(`${titel} ${dek}`), emnerTitel: emnerFor(titel),
    punkter: indstillingPunkter(indst), videre: videreTil(indst), naeste: videre ? saetninger(videre.tekst, 260) : "",
    afstemninger: s.type === "referat" ? afstemninger(beslutning) : [],
    frist: hoeringsfrist(s.afsnit.map((a) => a.tekst).join("\n")), hoering: iHoering(`${indst}\n${videre?.tekst || ""}\n${beslutning}`),
    url: `sag/${slug(s.id)}.html`,
    udvalgUrl: `${erLokaludvalg(s.udvalg) ? "bydel" : "udvalg"}/${slug(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}.html`,
  };
}
const publicerbar = (s) => !STOEJ.test(renTitel(s.titel)) && !/fortrolig/i.test(s.titel) && s.afsnit.reduce((n, a) => n + a.tekst.length, 0) > 250;

// ---------- Skabeloner ----------
function side({ titel, beskrivelse, sti, rod, indhold, aktiv = "", ogType = "website", ogBillede = "" }) {
  const canonical = SITE_URL + sti;
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beskrivelse)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0E0F14">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beskrivelse)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}${ogBillede || "assets/og-billede.png"}">${ogBillede ? `
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">` : ""}
<meta property="og:locale" content="da_DK">
<link rel="icon" href="${rod}favicon.ico" sizes="48x48">
<link rel="icon" href="${rod}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rod}apple-touch-icon.png">
<link rel="manifest" href="${rod}site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rod}assets/avis.css">
<link rel="alternate" type="application/rss+xml" title="Sagsvagt: København" href="${SITE_URL}feed/alle.xml">
</head>
<body>
${LOGO_SYMBOL}
<header class="masthead">
  <div class="wrap">
    <div class="mh-row">
      <a class="mh-logo" href="${rod}index.html" aria-label="Sagsvagt, til forsiden">${logo(168, 52)}</a>
      ${aktiv === "forside"
        ? `<p class="mh-edition"><b>${esc(ugedag(IDAG).replace(/^./, (c) => c.toUpperCase()))} ${datoTekst(IDAG)}</b><br>Uge ${ugenr(IDAG)}. Nyt fra byråd, udvalg og lokaludvalg</p>`
        : `<p class="mh-edition">Nyt fra byråd, udvalg og lokaludvalg</p>`}
    </div>
    <nav class="mh-nav" aria-label="Hovedmenu">
      <a href="${rod}index.html"${aktiv === "forside" ? ' aria-current="page"' : ""}>Forside</a>
      <a href="${rod}emne/"${aktiv === "emne" ? ' aria-current="page"' : ""}>Emner</a>
      <a href="${rod}bydel/"${aktiv === "bydel" ? ' aria-current="page"' : ""}>Bydele</a>
      <a href="${rod}moeder.html"${aktiv === "moeder" ? ' aria-current="page"' : ""}>Møder</a>
      <a href="${rod}soeg.html"${aktiv === "soeg" ? ' aria-current="page"' : ""}>Søg</a>
      <details class="mere"><summary${["br", "udvalg", "hoeringer", "partier", "om"].includes(aktiv) ? ' aria-current="page"' : ""}>Mere</summary><div>
        <a href="${rod}udvalg/borgerrepraesentationen.html">Borgerrepræsentationen</a>
        <a href="${rod}udvalg/">Alle udvalg</a>
        <a href="${rod}hoeringer.html">Høringer</a>
        <a href="${rod}partier.html">Sådan stemmer partierne</a>
        <a href="${rod}om.html">Om Sagsvagt</a>
      </div></details>
      <a class="cta" href="${rod}vagt.html">Få dine sager på mail</a>
    </nav>
  </div>
</header>
<main>
${indhold}
</main>
<footer class="foot">
  <div class="wrap">
    ${logo(110, 34)}
    <span>Sagsvagt bygger på kommunernes offentlige dagsordener og referater. Læs altid den originale sag. <a href="${rod}om.html">Om Sagsvagt</a> · <a href="${rod}privatliv.html">Privatliv</a><br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S</span>
  </div>
</footer>
</body>
</html>
`;
}

const kicker = (s, rod, medUdvalg = true) => {
  const st = s.status === "besluttet" ? `<span class="status besluttet">Besluttet ${kortDato(s.dato)}</span>`
    : s.status === "kommer" ? `<span class="status kommer">På dagsordenen ${kortDato(s.dato)}</span>`
    : `<span class="status">Behandlet ${kortDato(s.dato)}</span>`;
  const hvor = erLokaludvalg(s.udvalg) ? `${bydel(s.udvalg)} Lokaludvalg` : s.udvalg;
  return `<p class="kicker">${st}${medUdvalg ? `, <a href="${rod}${s.udvalgUrl}">${esc(hvor)}</a>` : ""}</p>`;
};
const hvorNavn = (u) => (erLokaludvalg(u) ? `${bydel(u)} Lokaludvalg` : u);
const stor = (t) => t.replace(/^./, (c) => c.toUpperCase());
const emneLinks = (s, rod) => s.emner.length
  ? `<p class="emner">${s.emner.map((id) => `<a class="emne-tag ${EMNER[id].f}" href="${rod}emne/${id}.html">${esc(EMNER[id].navn)}</a>`).join("")}</p>` : "";

// Afstemning: bjælke med stemmetal og partierne med navn. Alle partier vises ens (partineutralt).
const bogstaver = (tekst) => deltagere(tekst).map((p) => (p.b ? `<abbr title="${esc(p.navn)}">${esc(p.b)}</abbr>` : esc(p.navn))).join(", ");
const partiListe = (tekst) => deltagere(tekst).map((p) => `<span class="parti">${p.b ? `<b>${esc(p.b)}</b> ` : ""}${esc(p.navn)}</span>`).join("");
function afstemning(s, kompakt = false) {
  const t = s.tal, st = s.stemmer;
  if (!t && !st) return "";
  const bjaelke = t && t.for + t.imod + (t.undlod || 0) > 0
    ? `<div class="afst-bar" role="img" aria-label="${t.for} for, ${t.imod} imod${t.undlod ? `, ${t.undlod} undlod` : ""}"><span class="for" style="flex:${t.for}"></span><span class="imod" style="flex:${t.imod}"></span>${t.undlod ? `<span class="undl" style="flex:${t.undlod}"></span>` : ""}</div>`
      + `<p class="afst-tal"><span><b>${t.for}</b> for</span><span><b>${t.imod}</b> imod</span>${t.undlod != null ? `<span><b>${t.undlod}</b> undlod</span>` : ""}</p>` : "";
  if (kompakt) return `<div class="afst kompakt">${bjaelke}${st ? `<p class="afst-bogst">For: ${bogstaver(st.for)}<br>Imod: ${bogstaver(st.imod)}</p>` : ""}</div>`;
  return `<div class="afst">${bjaelke}${st ? `<dl class="afst-p"><div><dt>For</dt><dd>${partiListe(st.for)}</dd></div><div><dt>Imod</dt><dd>${partiListe(st.imod)}</dd></div>${st.undlod ? `<div><dt>Undlod</dt><dd>${partiListe(st.undlod)}</dd></div>` : ""}</dl>` : ""}</div>`;
}

// Kort fortalt: forslaget, hvem der beslutter, hvornår, status og næste skridt, øverst på sagen
function kortFortalt(s) {
  const r = [];
  if (s.punkter.length) r.push(["Forslaget", `<ul>${s.punkter.slice(0, 3).map((p) => `<li>${esc(saetninger(p, 240))}</li>`).join("")}</ul>${s.punkter.length > 3 ? `<p class="kf-mere">Og ${s.punkter.length - 3} punkter mere i indstillingen herunder.</p>` : ""}`]);
  r.push(["Hvem", `${esc(hvorNavn(s.udvalg))}${s.videre ? `<span class="kf-videre">Går videre til ${esc(s.videre)}</span>` : ""}`]);
  r.push(["Hvornår", `${stor(ugedag(s.dato))} ${datoTekst(s.dato)}`]);
  r.push(["Status", s.status === "besluttet" ? `<b class="status besluttet">Besluttet.</b> ${esc(s.udfald || saetninger(s.beslutning, 220))}`
    : s.status === "kommer" ? `<b class="status kommer">På dagsordenen.</b> Sagen behandles på mødet.` : `<b class="status">Behandlet.</b> Referatet med beslutningen er ikke offentliggjort endnu.`]);
  if (s.naeste) r.push(["Næste skridt", esc(s.naeste)]);
  return `<section class="kf" aria-labelledby="kf-h"><h2 id="kf-h">Kort fortalt</h2><dl>${r.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>${s.status === "besluttet" ? afstemning(s) : ""}</section>`;
}

const beslutningsboks = (s) => s.status === "besluttet"
  ? `<div class="decision"><b>Beslutning</b>${esc(s.udfald || saetninger(s.beslutning, 260))}${afstemning(s, true)}</div>`
  : s.status === "kommer" ? `<div class="decision kommer"><b>Til beslutning ${ugedag(s.dato)} ${datoTekst(s.dato)}</b>${esc(saetninger((s.afsnit.find((a) => /^Indstilling/.test(a.titel))?.tekst || "Sagen er på dagsordenen.").replace(/^[^\n]*indstiller[^\n]*\n*/i, ""), 220))}</div>` : "";

const vagtBoks = (rod) => `<aside class="paa-mail">
  <h2 class="rubrik">Sagsvagt på mail</h2>
  <p>Hver mandag de sager, der handler om dine emner, fra cykelstier til lokalplaner. Gratis, mens vi tester.</p>
  <a href="${rod}vagt.html">Skriv dig op →</a>
</aside>`;
// Én linje pr. sag: hvor, overskrift og dato
const notits = (s, rod = "", medDato = true) => `<li><span class="nh-hvor">${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg.replace(/udvalget$/, "udvalget"))}</span> <a href="${rod}${s.url}">${esc(s.titel)}</a>${medDato ? ` <span class="nh-dato">${kortDato(s.dato)}</span>` : ""}</li>`;

// Redaktionen: din leder, dine overskrifter og ugens tophistorie (avis/redaktion.json, redigeres med avis/redaktion.html)
async function laesRedaktion() {
  try { return JSON.parse(await readFile(join(ROD, "avis", "redaktion.json"), "utf8")); } catch { return {}; }
}

// ---------- Sider ----------
async function main() {
  const filer = (await readdir(join(ROD, "data"))).filter((f) => f.endsWith(".json"));
  const alle = [];
  for (const f of filer) alle.push(...Object.values(JSON.parse(await readFile(join(ROD, "data", f), "utf8")).sager));
  const red = await laesRedaktion();
  const sager = alle.filter(publicerbar).map(berig).map((s) => {
    const r = red.sager?.[s.id];
    return r?.overskrift ? { ...s, kommunensTitel: s.titel, titel: r.overskrift.trim(), dek: (r.underrubrik || s.dek).trim() } : s;
  }).sort((a, b) => b.dato.localeCompare(a.dato) || a.nr - b.nr);
  console.log(`${alle.length} punkter, ${sager.length} publiceres`);

  const H = { ROD, IDAG, SITE_URL, esc, side, kicker, emneLinks, hvorNavn, stor, kortDato, datoTekst, ugedag, slug, saetninger, erLokaludvalg, bydel };
  for (const dir of ["sag", "udvalg", "bydel", "emne"]) { await rm(join(ROD, dir), { recursive: true, force: true }); await mkdir(join(ROD, dir), { recursive: true }); }

  // Forside
  const afholdt = sager.filter((s) => s.status !== "kommer");
  const nyheder = afholdt.filter((s) => s.vaegt > 0 && !s.rutine).sort((a, b) => b.score - a.score);
  // Højst `max` historier fra samme udvalg, så forsiden ikke kun er ét udvalg
  const spred = (liste, n, max) => {
    const talt = {}; const ud = [];
    for (const s of liste) { if (ud.length >= n) break; if ((talt[s.udvalg] = (talt[s.udvalg] || 0) + 1) <= max) ud.push(s); }
    return ud;
  };
  // Tophistorien vælger redaktionen, ellers den vigtigste sag
  const top = sager.find((s) => s.id === red.tophistorie) || nyheder[0];
  const anden = spred(nyheder.filter((s) => s !== top && !erLokaludvalg(s.udvalg)), 9, 2);
  const mellem = anden.slice(0, 3);
  const brugt = new Set([top, ...anden]);
  const bydele = spred(nyheder.filter((s) => erLokaludvalg(s.udvalg) && !brugt.has(s)), 6, 2);
  bydele.forEach((s) => brugt.add(s));
  const kommende = spred(sager.filter((s) => s.status === "kommer" && s.vaegt > 0 && !s.rutine).sort((a, b) => a.dato.localeCompare(b.dato) || b.score - a.score), 7, 2);
  const kortNyt = [...anden.slice(3), ...afholdt.filter((s) => !brugt.has(s) && s.vaegt > 0 && !s.rutine).slice(0, 10)];
  // Lederen vises i ti dage efter, den er skrevet
  const leder = red.leder?.tekst?.trim() && Math.abs(d(IDAG) - d(red.leder.dato || IDAG)) / 864e5 <= 10 ? red.leder : null;
  const kalender = {}; for (const s of kommende) (kalender[s.dato] ||= []).push(s);

  const forside = `<div class="wrap">
  ${leder ? `<section class="leder" aria-labelledby="leder-h">
    <p class="rubrik">Leder</p>
    <div><h2 id="leder-h">${esc(leder.overskrift || "Ugens overblik")}</h2>${afsnitTilHtml(leder.tekst.trim())}<p class="byline">${esc(leder.navn || "")}${leder.titel ? `, ${esc(leder.titel)}` : ""}</p></div>
  </section>` : ""}
  <div class="front">
    <div>
      <article class="lead">
        ${kicker(top, "")}
        <h1 class="hl"><a href="${top.url}">${esc(top.titel)}</a></h1>
        ${top.dek ? `<p class="dek anslag">${esc(saetninger(top.dek, 320))}</p>` : ""}
        ${top.status === "besluttet" && top.udfald ? `<p class="udfald">${esc(top.udfald)}</p>` : top.status === "kommer" ? `<p class="udfald kommer">Til beslutning ${ugedag(top.dato)} ${datoTekst(top.dato)}.</p>` : ""}
      </article>
      <div class="mellem">
        ${mellem.map((s) => `<article>${kicker(s, "")}<h2 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 190))}</p>` : ""}</article>`).join("\n        ")}
      </div>
      <section class="kortnyt" aria-labelledby="h-kort">
        <h2 id="h-kort" class="rubrik">Kort nyt</h2>
        <ul>${kortNyt.map((s) => notits(s)).join("")}</ul>
      </section>
    </div>
    <div class="rail">
      ${vagtBoks("")}
      <section aria-labelledby="h-bydele">
        <h2 id="h-bydele" class="rubrik">Fra bydelene <a href="bydel/">Alle bydele</a></h2>
        <ul class="notitser">${bydele.map((s) => notits(s)).join("")}</ul>
      </section>
      <section aria-labelledby="h-kommer">
        <h2 id="h-kommer" class="rubrik">Kalender <a href="moeder.html">Alle møder</a></h2>
        ${Object.entries(kalender).map(([dag, l]) => {
          // Ét møde pr. udvalg: udvalget står én gang, punkterne under
          const pr = {}; for (const s of l) (pr[s.udvalg] ||= []).push(s);
          return `<p class="kal-dag">${esc(stor(ugedag(dag)))} ${kortDato(dag)}</p>${Object.entries(pr).map(([u, ps]) => `<p class="kal-moede">${esc(hvorNavn(u))}</p><ul class="notitser kal">${ps.map((s) => `<li><a href="${s.url}">${esc(s.titel)}</a></li>`).join("")}</ul>`).join("")}`;
        }).join("")}
      </section>
    </div>
  </div>
</div>`;
  await writeFile(join(ROD, "index.html"), side({
    titel: "Sagsvagt – nyt fra byråd og udvalg i København",
    beskrivelse: "Det, politikerne i Københavns Kommune har besluttet og skal tage stilling til. Fra Borgerrepræsentationen, udvalgene og lokaludvalgene, hentet fra de officielle referater.",
    sti: "index.html", rod: "", indhold: forside, aktiv: "forside",
  }));

  // Sagssider
  const prUdvalg = new Map();
  for (const s of sager) { if (!prUdvalg.has(s.udvalg)) prUdvalg.set(s.udvalg, []); prUdvalg.get(s.udvalg).push(s); }
  const vej = sagensVej(sager);
  const delebilleder = await bygDelebilleder(sager, H);
  await rm(join(ROD, "assets", "sager"), { recursive: true, force: true }); await mkdir(join(ROD, "assets", "sager"), { recursive: true });
  for (const s of sager) {
    const krop = s.afsnit.filter((a) => a.titel !== "Resumé" && !/beslutning/i.test(a.titel));
    const relateret = prUdvalg.get(s.udvalg).filter((x) => x !== s).slice(0, 5);
    const jsonld = { "@context": "https://schema.org", "@type": "Article", headline: s.titel.slice(0, 110), datePublished: s.dato, inLanguage: "da", isBasedOn: s.kilde, publisher: { "@type": "Organization", name: "Sagsvagt" } };
    const artikel = `<article>
      <header>
        ${kicker(s, "../")}
        <h1 class="hl">${esc(s.titel)}</h1>
        ${s.dek ? `<p class="dek">${esc(s.dek)}</p>` : ""}
        ${s.kommunensTitel ? `<p class="kommunens-titel">Kommunens titel: ${esc(s.kommunensTitel)}</p>` : ""}
        ${emneLinks(s, "../")}
      </header>
      <div class="body">
        ${kortFortalt(s)}
        ${vejBoks(s, vej, H)}
        ${forklar(krop.map((a) => `<h2>${esc(a.titel)}</h2>\n${afsnitTilHtml(a.tekst)}`).join("\n") + (s.status === "besluttet" ? `<h2>Beslutning</h2>\n${afsnitTilHtml(s.beslutning)}` : ""), esc)}
        ${s.bilag.length ? `<h2>Bilag</h2><ul class="files">${s.bilag.map((b) => `<li>${b.url ? `<a href="${esc(b.url)}" rel="nofollow">${esc(b.navn)}</a>` : esc(b.navn)}</li>`).join("")}</ul>` : ""}
        <p class="source">Kilde: ${esc(s.kommune)}s Kommune, ${esc(s.udvalg)}, ${s.type === "referat" ? "referat" : "dagsorden"} fra mødet ${ugedag(s.dato)} ${datoTekst(s.dato)}, punkt ${s.nr}. <a href="${esc(s.kilde)}" rel="nofollow">Læs den originale sag hos kommunen</a>.</p>
      </div>
    </article>`;
    // Samme artikel som fragment, så Min avis kan vise hele sagen (sag/ og min/ ligger begge ét niveau nede)
    await writeFile(join(ROD, "assets", "sager", s.url.slice(4)), artikel);
    const indhold = `<div class="wrap">
  <div class="article">
    ${artikel}
    <aside class="side">
      ${vagtBoks("../")}
      ${relateret.length ? `<h2 class="rubrik">Mere fra ${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}</h2>${relateret.map((x) => `<article class="mini">${kicker(x, "../", false)}<h3 class="hl"><a href="../${x.url}">${esc(x.titel)}</a></h3></article>`).join("")}` : ""}
    </aside>
  </div>
</div>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`;
    await writeFile(join(ROD, s.url), side({
      titel: `${s.titel} – Sagsvagt`, beskrivelse: s.dek || `${s.udvalg}, ${datoTekst(s.dato)}`,
      sti: s.url, rod: "../", indhold, ogType: "article", ogBillede: delebilleder.get(s.id),
    }));
  }

  // Udvalgs- og bydelssider
  const liste = (s, medUdvalg = false) => `<article>${kicker(s, "../", medUdvalg)}<h2 class="hl"><a href="../${s.url}">${esc(s.titel)}</a></h2><p class="dek">${esc(saetninger(s.dek, 200))}</p></article>`;
  const udvalg = [...prUdvalg.keys()].filter((u) => !erLokaludvalg(u)).sort((a, b) => (VAEGT[b] ?? 2) - (VAEGT[a] ?? 2) || a.localeCompare(b, "da"));
  const lokal = [...prUdvalg.keys()].filter(erLokaludvalg).sort((a, b) => a.localeCompare(b, "da"));
  for (const u of [...udvalg, ...lokal]) {
    const lu = erLokaludvalg(u); const navn = lu ? bydel(u) : u;
    const sti = `${lu ? "bydel" : "udvalg"}/${slug(navn)}.html`;
    await writeFile(join(ROD, sti), side({
      titel: `${lu ? `${navn}: Nyt fra lokaludvalget` : navn} – Sagsvagt`,
      beskrivelse: `Sager og beslutninger fra ${lu ? `${navn} Lokaludvalg` : `${navn} i Københavns Kommune`}, hentet fra de officielle dagsordener og referater.`,
      sti, rod: "../", aktiv: u === "Borgerrepræsentationen" ? "br" : lu ? "bydel" : "udvalg",
      indhold: `<div class="wrap"><div class="listing"><h1>${esc(lu ? `${navn}` : navn)}</h1><p class="intro">${lu ? `Sager fra ${esc(navn)} Lokaludvalg i Københavns Kommune.` : `Sager fra ${esc(navn)} i Københavns Kommune.`}</p><p class="abonner"><a href="${kalenderLink(u, "../", H)}">Føj møderne til din kalender</a> · <a href="${feedLink(u, "../", H)}">RSS</a></p>${prUdvalg.get(u).map((s) => liste(s)).join("\n")}</div></div>`,
    }));
  }
  const oversigt = (titel, intro, navne, mappe, aktiv) => side({
    titel: `${titel} – Sagsvagt`, beskrivelse: intro, sti: `${mappe}/`, rod: "../", aktiv,
    indhold: `<div class="wrap"><div class="listing"><h1>${titel}</h1><p class="intro">${intro}</p><ul class="chips">${navne.map((u) => `<li><a href="${slug(mappe === "bydel" ? bydel(u) : u)}.html">${esc(mappe === "bydel" ? bydel(u) : u)} <span style="opacity:.6">(${prUdvalg.get(u).length})</span></a></li>`).join("")}</ul></div></div>`,
  });
  await writeFile(join(ROD, "udvalg", "index.html"), oversigt("Udvalg i Københavns Kommune", "Borgerrepræsentationen og de stående udvalg.", udvalg, "udvalg", "udvalg"));
  await writeFile(join(ROD, "bydel", "index.html"), oversigt("Bydele i København", "Hver bydel har et lokaludvalg, som behandler sager om byrum, trafik, puljer og høringer i lokalområdet.", lokal, "bydel", "bydel"));

  // Emnesider
  const prEmne = Object.fromEntries(Object.keys(EMNER).map((id) => [id, sager.filter((s) => s.emner.includes(id) && !s.rutine)]));
  const emneChips = (aktivt) => `<ul class="chips">${Object.entries(EMNER).map(([id, e]) => `<li><a href="${id}.html"${id === aktivt ? ' aria-current="page"' : ""}>${esc(e.navn)} <span style="opacity:.6">(${prEmne[id].length})</span></a></li>`).join("")}</ul>`;
  for (const [id, e] of Object.entries(EMNER)) {
    await writeFile(join(ROD, "emne", `${id}.html`), side({
      titel: `${e.navn} – Sagsvagt`, beskrivelse: `Sager om ${e.navn.toLowerCase()} fra byråd, udvalg og lokaludvalg i København.`,
      sti: `emne/${id}.html`, rod: "../", aktiv: "emne",
      indhold: `<div class="wrap"><div class="listing"><p class="kicker"><a href="./">Alle emner</a></p><h1>${esc(e.navn)}</h1><p class="intro">${prEmne[id].length} sager fra Borgerrepræsentationen, udvalgene og lokaludvalgene i København, nyeste først.</p><p class="abonner"><a href="../feed/emne-${id}.xml">RSS for ${esc(e.navn.toLowerCase())}</a></p>${emneChips(id)}${prEmne[id].map((s) => liste(s, true)).join("\n")}</div></div>`,
    }));
  }
  await writeFile(join(ROD, "emne", "index.html"), side({
    titel: "Emner – Sagsvagt", beskrivelse: "Find sagerne fra Københavns byråd, udvalg og lokaludvalg efter emne.", sti: "emne/", rod: "../", aktiv: "emne",
    // Som sektionerne i en avis: hvert emne med sine seneste sager
    indhold: `<div class="wrap"><div class="emne-oversigt"><h1>Emner</h1><p class="intro">Sagerne fra Borgerrepræsentationen, udvalgene og lokaludvalgene, sorteret efter emne. En sag kan handle om flere emner.</p>
<div class="emne-gitter">${Object.entries(EMNER).map(([id, e]) => `<section aria-labelledby="em-${id}"><h2 id="em-${id}" class="rubrik"><a href="${id}.html" class="emne-navn">${esc(e.navn)}</a> <a href="${id}.html">${prEmne[id].length} sager</a></h2><ul class="notitser">${prEmne[id].slice(0, 4).map((s) => notits(s, "../")).join("")}</ul></section>`).join("")}</div></div></div>`,
  }));

  // Møder: ét møde er et udvalg på en dato. Antallet af punkter tæller hele dagsordenen,
  // listen viser de sager, vi bringer. Dagsordenen hos kommunen er sagens adresse uden "/punkt-N".
  const moeder = new Map();
  for (const s of alle) {
    const k = `${s.dato}|${s.udvalg}`;
    if (!moeder.has(k)) moeder.set(k, { dato: s.dato, udvalg: s.udvalg, url: s.kilde.replace(/\/punkt-[^/]+$/, ""), antal: 0, referat: false, sager: [] });
    const m = moeder.get(k); m.antal++; if (s.type === "referat") m.referat = true;
  }
  for (const s of sager) moeder.get(`${s.dato}|${s.udvalg}`)?.sager.push(s);
  for (const m of moeder.values()) m.sager.sort((a, b) => (a.rutine - b.rutine) || a.nr - b.nr);
  const udvalgUrl = (u) => `${erLokaludvalg(u) ? "bydel" : "udvalg"}/${slug(erLokaludvalg(u) ? bydel(u) : u)}.html`;
  const kommendeMoeder = [...moeder.values()].filter((m) => m.dato >= IDAG).sort((a, b) => a.dato.localeCompare(b.dato) || a.udvalg.localeCompare(b.udvalg, "da"));
  const senesteMoeder = [...moeder.values()].filter((m) => m.dato < IDAG && (d(IDAG) - d(m.dato)) / 864e5 <= 21).sort((a, b) => b.dato.localeCompare(a.dato) || a.udvalg.localeCompare(b.udvalg, "da"));
  const moedeKort = (m) => {
    const vis = m.sager.filter((s) => !s.rutine).slice(0, 6), rutine = m.sager.filter((s) => s.rutine).length, flere = m.sager.length - vis.length - rutine;
    const nBesl = m.sager.filter((s) => s.status === "besluttet").length;
    const meta = m.dato >= IDAG ? `${m.antal} ${m.antal === 1 ? "punkt" : "punkter"} på dagsordenen`
      : m.referat ? `Referat offentliggjort${nBesl ? ` · ${nBesl} ${nBesl === 1 ? "beslutning" : "beslutninger"}` : ""}` : "Referatet er ikke offentliggjort endnu";
    return `<article class="moede">
  <p class="moede-dato" aria-hidden="true"><b>${d(m.dato).getUTCDate()}</b><span>${MDR[d(m.dato).getUTCMonth()].slice(0, 3)}.</span><span>${ugedag(m.dato).slice(0, 3)}.</span></p>
  <div>
    <h3><a href="${udvalgUrl(m.udvalg)}">${esc(hvorNavn(m.udvalg))}</a></h3>
    <p class="moede-meta">${stor(ugedag(m.dato))} ${datoTekst(m.dato)} · ${meta} · <a href="${esc(m.url)}" rel="nofollow">${m.referat ? "Referatet" : "Dagsordenen"} hos kommunen</a></p>
    ${vis.length ? `<ul class="punkter">${vis.map((s) => `<li><a href="${s.url}">${esc(s.titel)}</a>${s.status === "besluttet" && s.udfald ? `<span class="punkt-udfald">${esc(s.udfald)}</span>` : ""}${emneLinks(s, "")}</li>`).join("")}</ul>` : ""}
    ${flere || rutine ? `<p class="moede-mere">${[flere && `${flere} ${flere === 1 ? "sag" : "sager"} mere`, rutine && `${rutine} ${rutine === 1 ? "rutinesag" : "rutinesager"}`].filter(Boolean).join(" og ")}. <a href="${udvalgUrl(m.udvalg)}">Se alle sager fra ${esc(hvorNavn(m.udvalg))}</a></p>` : ""}
  </div>
</article>`;
  };
  await writeFile(join(ROD, "moeder.html"), side({
    titel: "Møder – Sagsvagt", beskrivelse: "Kommende og seneste møder i Borgerrepræsentationen, udvalgene og lokaludvalgene i København, med punkterne på dagsordenen.",
    sti: "moeder.html", rod: "", aktiv: "moeder",
    indhold: `<div class="wrap"><div class="listing moeder">
  <h1>Møder</h1>
  <p class="intro">Kommunen offentliggør dagsordenen omkring en uge før mødet. Her ser du de møder, hvor dagsordenen er ude, og de seneste møders beslutninger.</p>
  <p class="abonner"><a href="kalender/alle.ics">Føj alle møder til din kalender</a>. Under hvert udvalg kan du nøjes med dets egne møder.</p>
  <h2 class="sec-h">Kommende møder</h2>
  ${kommendeMoeder.length ? kommendeMoeder.map(moedeKort).join("\n") : `<p class="intro">Der er ingen offentliggjorte dagsordener til kommende møder lige nu.</p>`}
  <h2 class="sec-h" style="margin-top:40px">Seneste møder</h2>
  ${senesteMoeder.map(moedeKort).join("\n")}
</div></div>`,
  }));

  // Søgning: søger i assets/sager.json i browseren
  await writeFile(join(ROD, "soeg.html"), side({
    titel: "Søg i sagerne – Sagsvagt", beskrivelse: "Søg i alle sager fra Københavns byråd, udvalg og lokaludvalg.", sti: "soeg.html", rod: "", aktiv: "soeg",
    indhold: `<div class="wrap"><div class="listing soeg-side">
  <h1>Søg i sagerne</h1>
  <p class="intro">Søg i overskrifter, resuméer og udvalg i alle ${sager.length.toLocaleString("da-DK")} sager.</p>
  <form class="soeg-felt" role="search" onsubmit="return false"><input type="search" id="q" placeholder="fx Lersøparken, cykelsti eller budget" aria-label="Søg i sagerne" autocomplete="off"></form>
  <ul class="chips" id="emnefilter"><li><a href="#" data-emne="" aria-current="page">Alle emner</a></li>${Object.entries(EMNER).map(([id, e]) => `<li><a href="#" data-emne="${id}">${esc(e.navn)}</a></li>`).join("")}</ul>
  <p class="intro" id="antal" aria-live="polite"></p>
  <div id="resultater"></div>
</div></div>
<script>
(function () {
  var q = document.getElementById("q"), ud = document.getElementById("resultater"), antal = document.getElementById("antal"), emne = "", data = null;
  var esc = function (s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var dato = function (iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("da-DK", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }); };
  var status = function (s) { return s.st === "besluttet" ? '<span class="status besluttet">Besluttet ' + dato(s.dato) + "</span>" : s.st === "kommer" ? '<span class="status kommer">På dagsordenen ' + dato(s.dato) + "</span>" : '<span class="status">Behandlet ' + dato(s.dato) + "</span>"; };
  function vis() {
    if (!data) return;
    var ord = q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    if (!ord.length && !emne) { antal.textContent = ""; ud.innerHTML = ""; return; }
    var hits = data.sager.filter(function (s) {
      if (emne && s.e.indexOf(emne) < 0) return false;
      var t = (s.t + " " + s.d + " " + s.x + " " + s.u).toLowerCase();
      return ord.every(function (o) { return t.indexOf(o) >= 0; });
    });
    antal.textContent = hits.length ? hits.length.toLocaleString("da-DK") + (hits.length === 1 ? " sag" : " sager") + (hits.length > 60 ? ". Viser de 60 nyeste." : "") : "Ingen sager matcher søgningen.";
    ud.innerHTML = hits.slice(0, 60).map(function (s) {
      return '<article><p class="kicker">' + status(s) + ", " + esc(s.u) + '</p><h2 class="hl"><a href="' + esc(s.url) + '">' + esc(s.t) + '</a></h2><p class="dek">' + esc(s.d.length > 200 ? s.d.slice(0, 200).replace(/\\s+\\S*$/, "") + " …" : s.d) + "</p>"
        + (s.e.length ? '<p class="emner">' + s.e.map(function (id) { var e = data.emner[id]; return '<a class="emne-tag ' + e.f + '" href="emne/' + id + '.html">' + esc(e.navn) + "</a>"; }).join("") + "</p>" : "") + "</article>";
    }).join("");
  }
  var t0; q.addEventListener("input", function () { clearTimeout(t0); t0 = setTimeout(vis, 120); });
  document.getElementById("emnefilter").addEventListener("click", function (e) {
    var a = e.target.closest("a[data-emne]"); if (!a) return; e.preventDefault(); emne = a.getAttribute("data-emne");
    document.querySelectorAll("#emnefilter a").forEach(function (x) { x.toggleAttribute("aria-current", x === a); if (x === a) x.setAttribute("aria-current", "page"); }); vis();
  });
  var start = new URLSearchParams(location.search).get("q"); if (start) q.value = start;
  fetch("assets/sager.json").then(function (r) { return r.json(); }).then(function (d) { data = d; vis(); })
    .catch(function () { antal.textContent = "Søgningen kunne ikke hentes lige nu."; });
  q.focus();
})();
</script>`,
  }));

  // Partier, høringer, kalendere og RSS (avis/ekstra.mjs)
  await bygPartier(sager, H);
  await bygHoeringer(sager, H);
  await bygKalendere([...moeder.values()], H);
  await bygFeeds(sager, H);

  // Om-side
  await writeFile(join(ROD, "om.html"), side({
    titel: "Om Sagsvagt", beskrivelse: "Sagsvagt gør det let at følge med i, hvad politikerne i din kommune beslutter.", sti: "om.html", rod: "", aktiv: "om",
    indhold: `<div class="wrap"><div class="listing prose"><h1 style="font-family:var(--sans)">Om Sagsvagt</h1>
<p>Sagsvagt gør det let at følge med i, hvad politikerne i din kommune beslutter. Hver dag læser vi de dagsordener og referater, kommunen selv offentliggør, og samler sagerne ét sted, så du ikke skal lede i udvalgenes dokumenter.</p>
<h2>Hvor kommer sagerne fra?</h2>
<p>Alt på Sagsvagt kommer fra kommunernes offentligt tilgængelige dagsordener og referater. Vi starter med Københavns Kommune, Borgerrepræsentationen, udvalgene og de 12 lokaludvalg, og udvider til flere kommuner i hovedstadsområdet. Hver sag linker til den originale side hos kommunen.</p>
<h2>Hvad er "Besluttet" og "På dagsordenen"?</h2>
<p>"Besluttet" betyder, at referatet fra mødet er offentliggjort, og at vi viser udvalgets beslutning. "På dagsordenen" betyder, at sagen skal behandles på et kommende møde.</p>
<h2>Fejl og rettelser</h2>
<p>Overskrifter og uddrag er taget fra kommunens egne dokumenter. Ser du en fejl, eller er en sag gengivet forkert, så skriv til os, så retter vi det hurtigst muligt. Læs altid den originale sag, før du handler på den.</p>
<h2>Kontakt</h2>
<p><a href="mailto:mansa@sagsvagt.dk">mansa@sagsvagt.dk</a></p>
</div></div>`,
  }));

  // Data til søgningen og Min avis (min/index.html, lukket indtil login): en kompakt udgave af alle publicerede sager.
  // e er sagens emner, et emnerne i overskriften, x en kort tekst fra sagen til søgning.
  await writeFile(join(ROD, "assets", "sager.json"), JSON.stringify({
    opdateret: IDAG,
    emner: Object.fromEntries(Object.entries(EMNER).map(([id, e]) => [id, { navn: e.navn, f: e.f }])),
    moeder: [...kommendeMoeder, ...senesteMoeder].map((m) => ({ dato: m.dato, u: m.udvalg, url: m.url, n: m.antal, referat: m.referat })),
    sager: sager.map((s) => ({
      id: s.id, t: s.titel, kt: s.kommunensTitel, d: s.dek, u: s.udvalg, dato: s.dato, st: s.status, ud: s.udfald, sm: s.stemmer, tal: s.tal,
      e: s.emner, et: s.emnerTitel, url: s.url, k: s.kilde, v: s.vaegt, r: s.rutine ? 1 : 0, x: saetninger(s.afsnit.map((a) => a.tekst).join(" "), 600),
    })),
  }));

  // Sitemap og robots
  const urls = ["", "index.html", "om.html", "soeg.html", "moeder.html", "partier.html", "hoeringer.html", "udvalg/", "bydel/", "emne/", ...Object.keys(EMNER).map((id) => `emne/${id}.html`), ...[...udvalg].map((u) => `udvalg/${slug(u)}.html`), ...lokal.map((u) => `bydel/${slug(bydel(u))}.html`), ...sager.map((s) => s.url)];
  await writeFile(join(ROD, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(ROD, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
  console.log(`Byggede forside, ${sager.length} sager, ${udvalg.length} udvalg, ${lokal.length} bydele, ${Object.keys(EMNER).length} emner`);
}

main().catch((e) => { console.error(e); process.exit(1); });
