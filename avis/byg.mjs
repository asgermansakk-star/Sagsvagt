// Bygger avisen (forside, en side pr. sag, udvalgs- og bydelssider, sitemap)
// ud fra data/*.json. Kør: npm run byg
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { EMNER, emnerFor, deltagere, stemmetal, indstillingPunkter, videreTil, afstemninger, hoeringsfrist, iHoering, forklar } from "./beriget.mjs";
import { bygDelebilleder } from "./delebilleder.mjs";
import { bygPlankort, plankortFigur } from "./plankort.mjs";
import { bygStedkort, stedkortFigur } from "./stedkort.mjs";
import { emneBillede, emneId } from "./emnebilleder.mjs";
import { stemmeGrafik, stemmeMini } from "./stemmegrafik.mjs";
import { hoeringsMaerke, laesLaeserfotos, laeserfotoFigur, sendFotoLink, fotoSideIndhold, bygLuftfotos, luftfotoFigur, bygGadefotos, gadefotoFigur } from "./grafik.mjs";
import { findSteder, stedLinks, bygSteder, delRad, DEL_SCRIPT } from "./steder.mjs";
import { bygBokse } from "./boks.mjs";
import { bygKommuner } from "./kommuner.mjs";
import { soegIndhold, unikTitel, findKommuneSteder } from "./udgave.mjs";
import { laesForenklet, forenkletBoks } from "./forenklet.mjs";
import { laesPerspektiv, perspektivBokse } from "./perspektiv.mjs";
import { sagensVej, vejBoks, bygPartier, bygHoeringer, bygKalendere, bygFeeds, kalenderLink, feedLink } from "./ekstra.mjs";

const ROD = join(import.meta.dirname, "..");
const SITE_URL = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
const IDAG = process.env.IDAG || new Date().toISOString().slice(0, 10);

// Logoet lægges direkte i hver side som et SVG-symbol, så det ikke afhænger af en separat billedfil
// (Simplys bot-beskyttelse kan blokere billedfiler for nogle browsere).
const LOGO_SVG = await readFile(join(ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8");
// Andre kommuner end København (data/<kommune>.json, hentet med hent-firstagenda.mjs) får sagssider og en side under
// kommune/, men indgår ikke i Københavns forside, udvalg, bydele, emner, Min avis eller boksene.
const KOMMUNE = Object.fromEntries(JSON.parse(await readFile(join(ROD, "avis", "kommuner.json"), "utf8")).map((k) => [k.navn, k]));
const erKK = (s) => !s.kommune || s.kommune === "København";
const kommunensNavn = (s) => KOMMUNE[s.kommune]?.kommune || `${s.kommune}s Kommune`;
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
const renTitel = (t) => t.replace(/^§\s*12\s*[-–]\s*/, "").replace(/^[A-ZÆØÅ]-sag:\s*/, "").replace(/^[A-ZÆØÅ]\.\s+/, "")
  // Andre kommuners udvalgsvej foran titlen ("PBU/ØU/KB - Beslutning om …", "B-sag - …") er intern; den skæres fra
  .replace(/^[A-ZÆØÅ]{1,6}(?:\/[A-ZÆØÅ]{1,6})+\s*[-–]\s*/, "").replace(/^[A-ZÆØÅ]-sag\s*[-–]\s*/, "").replace(/^Beslutning om\s+/i, "")
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
  let m = [...beslutning.matchAll(hoved)][0] || [...beslutning.matchAll(andet)].find((x) => !/ændringsforslag/i.test(x[0]));
  // Andre kommuner skriver beslutninger anderledes, fx flere afstemninger efter hinanden ("Forslaget er dermed
  // forkastet" om et ændringsforslag, derefter budgettet). Der viser vi kun et kort udfald, når der er præcis én
  // afstemning og ingen ændringsforslag; ellers vises beslutningens egen tekst.
  if (!erKK(s) && ([...beslutning.matchAll(hoved)].length + [...beslutning.matchAll(andet)].length !== 1 || /ændringsforslag/i.test(beslutning))) m = null;
  // Andre kommuner skriver stemmerne lige før afgørelsen på samme linje ("(A), (B) og Helge Bo Jensen (Ø) Den samlede
  // indstilling blev godkendt."); navne og partibogstaver foran selve afgørelsen skæres fra
  // PDF-afkrydsningen "X Supplerende sagsfremstilling x" (også "… X X" og uden X) kan også stå foran
  const udenStemmer = (t) => t.replace(/(?:\b[xX]\s+)*Supplerende sagsfremstilling(?:\s+[xX]\b)*\s*/g, "").replace(/^(?:[^().]*\([A-ZÆØÅ]{1,2}\)[,\s]*(?:og\s+)?)+/, "");
  const udfaldTekst = m ? udenStemmer(m[0].trim()).replace(/^./, (c) => c.toUpperCase()) : "";
  // Uden et klart udfald: den sidste sætning, der siger, hvad der blev besluttet ("Godkendte indstillingen."). Den første
  // er tit et ændringsforslag eller et mindretal ("(Ø) kunne ikke godkende"), så dem springer vi over.
  const sidsteUdfald = (t) => t.replace(/(?:\b[xX]\s+)*Supplerende sagsfremstilling(?:\s+[xX]\b)*\s*/g, "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)
    .map((x) => udenStemmer(x).trim()).filter((x) => x.length < 260 && /\b(godkend|vedt[ao]g|anbefal|tiltr[åa]d|forkast|nedstem|oversend|taget til efterretning|besluttede)/i.test(x)
      && !/ændringsforslag|^\(|kunne ikke|stemte (imod|for)|undlod/i.test(x)).at(-1)?.replace(/^./, (c) => c.toUpperCase()) || "";
  // Partiernes stemmer står lige efter afgørelsen: "For: Ø, F og A\nImod: Å" eller "For stemte: …\nImod stemte: …"
  const hovedAfst = m ? afstemninger(beslutning).find((a) => a.om && m[0].includes(a.om.slice(0, 40))) : null;
  const navne = (l) => l.map((x) => x.b || x.navn).join(", ");
  const stemmer = hovedAfst && (hovedAfst.for.length || hovedAfst.imod.length)
    ? { for: navne(hovedAfst.for), imod: navne(hovedAfst.imod), undlod: navne(hovedAfst.undlod) } : null;
  const fremtid = s.dato >= IDAG;
  const status = s.type === "referat" && beslutning ? "besluttet" : fremtid ? "kommer" : "behandlet";
  const laengde = s.afsnit.reduce((n, a) => n + a.tekst.length, 0);
  const vaegt = !erKK(s)
    ? (/^(Byrådet|Kommunalbestyrelsen|Økonomi)/i.test(s.udvalg) ? 3 : /(råd|rådet|nævn)$/i.test(s.udvalg) ? 1 : 2)
    : VAEGT[s.udvalg] ?? (/musikudvalg|Rådet for|kunst|legat/i.test(s.udvalg) ? 0 : erLokaludvalg(s.udvalg) ? 1 : 2);
  const alder = Math.max(0, (d(IDAG) - d(s.dato)) / 864e5);
  const rutine = RUTINE.test(titel);
  const score = vaegt * 10 + Math.min(laengde / 800, 8) + (beslutning ? 3 : 0) - alder * 0.6 - (rutine ? 25 : 0);
  const dek = resume ? saetninger(renDek(resume.tekst.replace(/^Indstilling[^\n]*\n*/i, "").trim(), s.udvalg), 300) : "";
  const indst = find(/^Indstilling/)?.tekst || "";
  const videre = find(/^Videre proces/i);
  return {
    ...s, titel, beslutning, udfald: udfaldTekst, stemmer, status, laengde, vaegt, score, rutine, dek,
    // Kort beslutning til mails og Min avis, når der ikke er et klart udfald (mest andre kommuner)
    kortBesl: status === "besluttet" && !udfaldTekst ? udenStemmer(sidsteUdfald(beslutning) || kortBeslutning(beslutning, 180)).replace(/^./, (c) => c.toUpperCase()) : "",
    // Stemmetallet hentes fra selve afgørelsen; tidligere afstemninger i referatet kan være om ændringsforslag
    tal: status === "besluttet" && /stemmer mod/i.test(udfaldTekst) ? stemmetal(beslutning.slice(m.index)) : null,
    emner: emnerFor(`${titel} ${dek}`), emnerTitel: emnerFor(titel),
    punkter: indstillingPunkter(indst), videre: videreTil(indst), naeste: videre ? saetninger(videre.tekst, 260) : "",
    afstemninger: s.type === "referat" ? afstemninger(beslutning) : [],
    frist: hoeringsfrist(s.afsnit.map((a) => a.tekst).join("\n")), hoering: iHoering(`${indst}\n${videre?.tekst || ""}\n${beslutning}`),
    url: `sag/${slug(s.id)}.html`,
    udvalgUrl: !erKK(s) ? `kommune/${KOMMUNE[s.kommune]?.slug || slug(s.kommune)}/${slug(s.udvalg)}.html`
      : `${erLokaludvalg(s.udvalg) ? "bydel" : "udvalg"}/${slug(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}.html`,
  };
}
const publicerbar = (s) => !STOEJ.test(renTitel(s.titel)) && !/fortrolig/i.test(s.titel) && s.afsnit.reduce((n, a) => n + a.tekst.length, 0) > 250;

// ---------- Skabeloner ----------
// Menuen på Københavns sider
// Menuen som data, så computerens menu og telefonens tab-bjælke altid har de samme punkter.
// hoved: punkterne i menuen ({ href, navn, id, ikon }). mere: punkterne under "Mere".
// TOPRAAD: kommunens øverste råd ("Byrådet" eller "Kommunalbestyrelsen"), der står, hvor København har Borgerrepræsentationen.
const TOPRAAD = new Map();
// De åbne kommuner udover København ({ navn, slug }), til kommunevælgeren i avishovedet
const UDGAVER = [];
// Få punkter: Forside, Emner, Møder og Søg; resten under "Mere". Kommunen skiftes i avishovedet.
const menuData = (rod, k) => {
  if (!k) return {
    hoved: [
      { href: `${rod}index.html`, navn: "Forside", id: "forside", ikon: "hjem" },
      { href: `${rod}emne/`, navn: "Emner", id: "emne", ikon: "emner" },
      { href: `${rod}moeder.html`, navn: "Møder", id: "moeder", ikon: "kalender" },
      { href: `${rod}soeg.html`, navn: "Søg", id: "soeg", ikon: "soeg" },
    ],
    mere: [
      { href: `${rod}ugen.html`, navn: "Ugens sager", id: "ugen" },
      { href: `${rod}bydel/`, navn: "Bydele", id: "bydel" },
      { href: `${rod}udvalg/borgerrepraesentationen.html`, navn: "Borgerrepræsentationen", id: "br" },
      { href: `${rod}udvalg/`, navn: "Alle udvalg", id: "udvalg" },
      { href: `${rod}sted/`, navn: "Steder", id: "sted" },
      { href: `${rod}hoeringer.html`, navn: "Høringer", id: "hoeringer" },
      { href: `${rod}partier.html`, navn: "Sådan stemmer partierne", id: "partier" },
      { href: `${rod}om.html`, navn: "Om Sagsvagt", id: "om" },
    ],
  };
  const r = `${rod}kommune/${k.slug}`, top = TOPRAAD.get(k.navn);
  return {
    hoved: [
      { href: `${r}.html`, navn: "Forside", id: "k-forside", ikon: "hjem" },
      { href: `${r}/emne/`, navn: "Emner", id: "k-emne", ikon: "emner" },
      { href: `${r}/moeder.html`, navn: "Møder", id: "k-moeder", ikon: "kalender" },
      { href: `${r}/soeg.html`, navn: "Søg", id: "k-soeg", ikon: "soeg" },
    ],
    mere: [
      { href: `${r}/bydel/`, navn: "Bydele", id: "k-bydel" },
      ...(top ? [{ href: `${r}/${slug(top)}.html`, navn: top, id: "k-top" }] : []),
      { href: `${r}/udvalg.html`, navn: "Alle udvalg", id: "k-udvalg" },
      { href: `${r}/sted/`, navn: "Steder", id: "k-sted" },
      { href: `${r}/hoeringer.html`, navn: "Høringer", id: "k-hoeringer" },
      { href: `${r}/partier.html`, navn: "Sådan stemmer partierne", id: "k-partier" },
      { href: `${rod}om.html`, navn: "Om Sagsvagt", id: "om" },
    ],
  };
};
const cur = (on) => (on ? ' aria-current="page"' : "");
// Computerens menu: alle hovedpunkter og "Mere" som rullemenu
const menu = (rod, aktiv, k) => {
  const { hoved, mere } = menuData(rod, k);
  return `
      ${hoved.map((m) => `<a href="${m.href}"${cur(aktiv === m.id)}>${esc(m.navn)}</a>`).join("\n      ")}
      <details class="mere"><summary${cur(mere.some((m) => m.id === aktiv))}>Mere</summary><div>
        ${mere.map((m) => `<a href="${m.href}"${cur(aktiv === m.id)}>${esc(m.navn)}</a>`).join("\n        ")}
      </div></details>`;
};
// Telefonens tab-bjælke i bunden: de fire vigtigste og "Mere" med resten, som i Min avis
const IKON = {
  hjem: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  emner: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  soeg: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  ugen: '<rect x="5" y="8" width="14" height="12" rx="2"/><path d="M7.5 5h9"/>',
  kalender: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  sted: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  mere: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
};
const ikon = (n) => `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${IKON[n]}</svg>`;
// Kommunevælgeren: siden har kun København, den aktuelle kommune og "Alle kommuner". Resten af de åbne kommuner hentes
// fra kommune/aabne.json, første gang vælgeren åbnes (se side()), så en ny kommune ikke ændrer alle ~17.000 sider.
// data-kommune bruges til at huske valget.
const kommuneValg = (rod, k) => [{ navn: "København", slug: "koebenhavn" }, ...(k && k.slug !== "koebenhavn" ? [k] : [])].map((u) =>
  `<a href="${rod}${u.slug === "koebenhavn" ? "index.html" : `kommune/${u.slug}.html`}" data-kommune="${u.slug}"${cur((k?.slug || "koebenhavn") === u.slug)}>${esc(u.navn)}</a>`)
  .join("") + `<a href="${rod}kommune/" data-alle>Alle kommuner</a>`;
const tabBjaelke = (rod, aktiv, k) => {
  const { hoved, mere } = menuData(rod, k);
  // Telefonen: Forside, Emner, Søg, kommunen og Mere (Møder ligger under Mere)
  const faner = ["hjem", "emner", "soeg"].map((i) => hoved.find((m) => m.ikon === i));
  const iMere = [...hoved.filter((m) => !faner.includes(m)), ...mere];
  return `<nav class="tabbar" aria-label="Sektioner">
  ${faner.map((m) => `<a href="${m.href}"${cur(aktiv === m.id)}>${ikon(m.ikon)}<span>${esc(m.navn)}</span></a>`).join("\n  ")}
  <details class="tab-mere"><summary${cur(aktiv === "kommune")}>${ikon("sted")}<span>${esc(k?.navn || "København")}</span></summary><div>
    <p class="tab-titel">Skift kommune</p>${kommuneValg(rod, k)}
  </div></details>
  <details class="tab-mere"><summary${cur(iMere.some((m) => m.id === aktiv))}>${ikon("mere")}<span>Mere</span></summary><div>
    ${iMere.map((m) => `<a href="${m.href}"${cur(aktiv === m.id)}>${esc(m.navn)}</a>`).join("\n    ")}
  </div></details>
</nav>`;
};

function side({ titel, beskrivelse, sti, rod, indhold, aktiv = "", ogType = "website", ogBillede = "", kommune = null }) {
  const canonical = SITE_URL + sti;
  const udgave = kommune?.navn || "";
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beskrivelse)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0E0F14">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beskrivelse)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}${ogBillede || "assets/og-billede.png"}">
<meta property="og:image:width" content="${ogBillede ? 1200 : 1920}">
<meta property="og:image:height" content="${ogBillede ? 630 : 1080}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:locale" content="da_DK">
<link rel="icon" href="${rod}favicon.ico" sizes="48x48">
<link rel="icon" href="${rod}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rod}apple-touch-icon.png">
<link rel="manifest" href="${rod}site.webmanifest">
<link rel="stylesheet" href="${rod}assets/fonts/montserrat.css">
<link rel="stylesheet" href="${rod}assets/avis.css">
<link rel="stylesheet" href="${rod}assets/grafik.css">
<script>try{var f=new URLSearchParams(location.search).get("fra"),r=document.referrer&&new URL(document.referrer).hostname;if(!sessionStorage.getItem("svKilde")&&(f||r&&r!==location.hostname))sessionStorage.setItem("svKilde",(f||r).slice(0,60))}catch(e){}</script>
<script>try{if(!/^(localhost|127[.])/.test(location.hostname)&&navigator.doNotTrack!=="1")fetch("/api/besoeg.php",{method:"POST",keepalive:true,headers:{"Content-Type":"text/plain"},body:JSON.stringify({s:location.pathname,k:sessionStorage.getItem("svKilde")||""})})}catch(e){}</script>
<link rel="alternate" type="application/rss+xml" title="Sagsvagt: København" href="${SITE_URL}feed/alle.xml">
</head>
<body>
${LOGO_SYMBOL}
<!-- Avishovedet i to etager (som en trykt avis): logo og udgave øverst, sektionerne centreret på en række for sig -->
<header class="masthead to">
  <div class="wrap mh-top">
    <a class="mh-logo" href="${rod}${kommune ? `kommune/${kommune.slug}.html` : "index.html"}" aria-label="Sagsvagt, til forsiden">${logo(196, 60)}</a>
    <details class="mh-edition mere mh-kommune"><summary><b>${esc(udgave || "København")}</b><br>${aktiv === "forside"
      ? `${esc(ugedag(IDAG).replace(/^./, (c) => c.toUpperCase()))} ${datoTekst(IDAG)}` : "Skift kommune"}</summary><div>${kommuneValg(rod, kommune)}</div></details>
    <div class="mh-handling">
      <a class="mh-cta" href="${rod}vagt.html?fra=avis#tilmeld">Skriv dig op</a>
      <a class="mh-ikon" href="${rod}min/"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.3-3.2 4-4.9 7.2-4.9s5.9 1.7 7.2 4.9"/><circle cx="12" cy="12" r="10.2"/></svg><span>Log ind</span></a>
    </div>
  </div>
  <nav class="mh-nav" aria-label="Hovedmenu"><div class="wrap">${menu(rod, aktiv, kommune)}
  </div></nav>
</header>
${tabBjaelke(rod, aktiv, kommune)}
<main>
${indhold}
</main>
<footer class="foot">
  <div class="wrap">
    ${logo(110, 34)}
    <span>Sagsvagt bygger på kommunernes offentlige dagsordener og referater. Læs altid den originale sag. <a href="${rod}om.html">Om Sagsvagt</a> · <a href="${rod}boks.html">Sæt Sagsvagt på din hjemmeside</a> · <a href="${rod}privatliv.html">Privatliv</a><br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S</span>
  </div>
</footer>
<script>/* "Mere" (menu og tab-bjælke) lukker ved klik udenfor, på et punkt eller med Escape */
document.addEventListener("click",function(e){document.querySelectorAll("details.mere[open],details.tab-mere[open]").forEach(function(d){if(!d.contains(e.target)||e.target===d||e.target.closest("div a"))d.open=false})});
document.addEventListener("keydown",function(e){if(e.key==="Escape")document.querySelectorAll("details.mere[open],details.tab-mere[open]").forEach(function(d){d.open=false;d.querySelector("summary").focus()})});
/* Kommunevælgeren henter de åbne kommuner fra kommune/aabne.json første gang, den åbnes (toggle bobler ikke, derfor capture) */
document.addEventListener("toggle",function(e){var d=e.target,a=d.open&&!d.dataset.hentet&&d.querySelector&&d.querySelector("a[data-alle]");if(!a)return;d.dataset.hentet=1;var rod=a.getAttribute("href").slice(0,-8),nu=d.querySelector("a[data-kommune][aria-current]");nu=nu&&nu.dataset.kommune;fetch(rod+"kommune/aabne.json").then(function(r){return r.json()}).then(function(l){d.querySelectorAll("a[data-kommune]").forEach(function(x){x.remove()});l.forEach(function(u){var x=document.createElement("a");x.href=rod+(u.slug==="koebenhavn"?"index.html":"kommune/"+u.slug+".html");x.dataset.kommune=u.slug;x.textContent=u.navn;if(u.slug===nu)x.setAttribute("aria-current","page");a.parentNode.insertBefore(x,a)})}).catch(function(){d.dataset.hentet=""})},true);
/* Husk kommunen (valgt i kommunevælgeren eller åbnet på dens forside); Københavns forside viser så vejen dertil */
try{var K="svKommune";document.addEventListener("click",function(e){var a=e.target.closest("a[data-kommune]");if(a)localStorage.setItem(K,JSON.stringify({s:a.dataset.kommune,n:a.textContent}))});${aktiv === "k-forside" ? `
localStorage.setItem(K,${JSON.stringify(JSON.stringify({ s: kommune.slug, n: kommune.navn }))});` : ""}${aktiv === "forside" ? `
var v=JSON.parse(localStorage.getItem(K)||"null");if(v&&/^[a-z-]+$/.test(v.s)&&v.s!=="koebenhavn"){var p=document.createElement("p"),l=document.createElement("a");p.className="wrap din-kommune";l.href="kommune/"+v.s+".html";l.textContent="Gå til din kommune: "+v.n;p.appendChild(l);document.querySelector("main").prepend(p)}` : ""}}catch(e){}</script>
</body>
</html>
`;
}

const kicker = (s, rod, medUdvalg = true) => {
  const st = s.status === "besluttet" ? `<span class="status besluttet">Besluttet ${kortDato(s.dato)}</span>`
    : s.status === "kommer" ? `<span class="status kommer">På dagsordenen ${kortDato(s.dato)}</span>`
    : `<span class="status">Behandlet ${kortDato(s.dato)}</span>`;
  const hvor = !erKK(s) ? `${s.udvalg}, ${s.kommune}` : erLokaludvalg(s.udvalg) ? `${bydel(s.udvalg)} Lokaludvalg` : s.udvalg;
  return `<p class="kicker">${st}${medUdvalg ? `, <a href="${rod}${s.udvalgUrl}">${esc(hvor)}</a>` : ""}${hoeringsMaerke(s, IDAG)}</p>`;
};
const hvorNavn = (u) => (erLokaludvalg(u) ? `${bydel(u)} Lokaludvalg` : u);
const stor = (t) => t.replace(/^./, (c) => c.toUpperCase());
// Emnet linker til emnesiden i sagens egen kommune (København: emne/, fx Viborg: kommune/viborg/emne/)
const emneSti = (s) => (erKK(s) ? "emne/" : `kommune/${KOMMUNE[s.kommune]?.slug || slug(s.kommune)}/emne/`);
const emneLinks = (s, rod) => s.emner.length
  ? `<p class="emner">${s.emner.map((id) => `<a class="emne-tag ${EMNER[id].f}" href="${rod}${emneSti(s)}${id}.html">${esc(EMNER[id].navn)}</a>`).join("")}</p>` : "";

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
  r.push(["Hvem", `${esc(erKK(s) ? hvorNavn(s.udvalg) : `${s.udvalg}, ${kommunensNavn(s)}`)}${s.videre ? `<span class="kf-videre">Går videre til ${esc(s.videre)}</span>` : ""}`]);
  r.push(["Hvornår", `${stor(ugedag(s.dato))} ${datoTekst(s.dato)}`]);
  r.push(["Status", s.status === "besluttet" ? `<b class="status besluttet">Besluttet.</b> ${esc(s.udfald || kortBeslutning(s.beslutning))}${helBeslutning(s, s.udfald || kortBeslutning(s.beslutning))}`
    : s.status === "kommer" ? `<b class="status kommer">På dagsordenen.</b> Sagen behandles på mødet.` : `<b class="status">Behandlet.</b> Referatet med beslutningen er ikke offentliggjort endnu.`]);
  if (s.naeste) r.push(["Næste skridt", esc(s.naeste)]);
  return `<section class="kf" aria-labelledby="kf-h"><h2 id="kf-h">Kort fortalt</h2><dl>${r.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>${s.status === "besluttet" ? afstemning(s) : ""}</section>`;
}

// Beslutningen i kort form, når der ikke er et klart udfald ("Indstillingen blev godkendt …"). Lokaludvalg skriver ofte
// først, hvem der forlod mødet, og bagefter lange navnelister; noterne springes over, og listerne bliver til tal.
const PROCEDURE = /forlader mødet|forlod mødet|forlader lokalet|deltog ikke|deltager ikke|var fraværende|er fraværende|inhabil|ankom|kom til mødet|deltog fra|deltog under/i;
const LISTE = /^(?:følgende stemte for|for stemte|stemte for|for|imod stemte|stemte imod|imod|undlader|undlod(?: at stemme)?|hverken for eller imod)\s*:\s*/i;
function kortBeslutning(t, max = 520) {
  const tal = { for: new Set(), imod: new Set(), undlod: new Set() };
  const lister = { for: 0, imod: 0, undlod: 0 }; // flere lister af samme slags = flere afstemninger, så tæller vi ikke
  let liste = null;
  const linjer = [];
  for (const l of t.split("\n").map((x) => x.trim())) {
    const m = l.match(LISTE);
    if (m) {
      liste = /imod/i.test(m[0]) && !/hverken/i.test(m[0]) ? "imod" : /undl|hverken/i.test(m[0]) ? "undlod" : "for";
      lister[liste]++;
      const rest = l.slice(m[0].length);
      if (rest) rest.split(/,|\sog\s/).map((x) => x.trim()).filter(Boolean).forEach((n) => tal[liste].add(n));
      continue;
    }
    // Navne, der fortsætter listen på de næste linjer ("Shayan Shojaei, Helga Mark, …")
    if (liste && l && /^[A-ZÆØÅ][^.:!?]*$/.test(l) && l.includes(",")) { l.split(",").map((x) => x.trim()).filter(Boolean).forEach((n) => tal[liste].add(n)); continue; }
    if (!l) { liste = null; linjer.push(""); continue; }
    liste = null;
    // Mødenoter som "Fraværende: Henrik Hertz (C)" eller "Afbud: …" er ikke en del af beslutningen
    if (/^(?:fraværende|afbud|ikke til stede)\b[^:]{0,30}:/i.test(l)) continue;
    // Sætning for sætning, for beslutningen og noten kan stå på samme linje ("Tiltrådte indstillingen. X deltog ikke.")
    const ren = l.split(/(?<=[.!?])\s+/).filter((x) => !(PROCEDURE.test(x) && x.length < 200)).join(" ");
    if (ren) linjer.push(ren);
  }
  // Partiforkortelser ("For: A, B, Ø") er ikke navnelister; dem viser afstemningen i forvejen
  const navne = (s) => [...s].filter((n) => n.length > 3);
  const n = { for: navne(tal.for).length, imod: navne(tal.imod).length, undlod: navne(tal.undlod).length };
  const tekst = saetninger(linjer.join("\n").replace(/\n{2,}/g, "\n").trim(), max).replace(/([^.!?…:”"])$/, "$1.");
  // Står stemmetallet allerede i teksten ("6 for, 1 imod", "med 10 stemmer mod 1"), tæller vi ikke selv
  const optalt = n.for + n.imod + n.undlod > 2 && Math.max(...Object.values(lister)) === 1 && !/\d+\s+(for|imod|stemmer)\b/i.test(tekst)
    ? ` ${n.for} stemte for, ${n.imod} imod${n.undlod ? ` og ${n.undlod} undlod at stemme` : ""}.` : "";
  return (tekst + optalt).trim();
}
// Link til hele beslutningen længere nede, når kortformen ikke har det hele med
// Jakob fra Amager Vest troede, at teksten var skåret af ved en fejl, så linket siger nu, at den er forkortet
// Et link til et afsnit i den sammenfoldede sagstekst ("Læs hele beslutningen") folder den ud først
const AABN_SCRIPT = `<script>function aabnSag(){var e=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1))),d=e&&e.closest("details");if(d&&!d.open){d.open=true;e.scrollIntoView()}}addEventListener("hashchange",aabnSag);aabnSag()</script>`;
const helBeslutning = (s, vist) => s.beslutning.replace(/\s+/g, " ").length > vist.length + 40 ? `<span class="kf-forkortet">Beslutningen er forkortet her. <a class="kf-mere-link" href="#beslutning">Læs hele beslutningen</a></span>` : "";

const beslutningsboks = (s) => s.status === "besluttet"
  ? `<div class="decision"><b>Beslutning</b>${esc(s.udfald || kortBeslutning(s.beslutning, 360))}${afstemning(s, true)}</div>`
  : s.status === "kommer" ? `<div class="decision kommer"><b>Til beslutning ${ugedag(s.dato)} ${datoTekst(s.dato)}</b>${esc(saetninger((s.afsnit.find((a) => /^Indstilling/.test(a.titel))?.tekst || "Sagen er på dagsordenen.").replace(/^[^\n]*indstiller[^\n]*\n*/i, ""), 220))}</div>` : "";

const vagtBoks = (rod, fra = "avis", kommune = "København") => `<aside class="paa-mail">
  <h2 class="rubrik">Politik, der rammer dig, hver mandag</h2>
  <p>Vælg det, du går op i, fx boliger, cykler eller natteliv. Så sender vi dig de sager, politikerne har på bordet, forklaret så det giver mening. Det er gratis, og vi søger testere.</p>
  <a href="${rod}vagt.html?fra=${fra}${kommune !== "København" ? `&amp;kommune=${encodeURIComponent(kommune)}` : ""}#tilmeld">Skriv dig op</a>
</aside>`;
// "Hvad kan du gøre?": kun det, sagen og reglerne dækker. Byrådets møder er offentlige (styrelseslovens § 10),
// udvalgenes er lukkede (§ 20). Høringsfristen står i sagen. Uden noget at gøre vises boksen ikke.
// Nogle kommuner sætter navnet foran ("Herning Byråd", "Odense Byråd")
const BYRAAD = /^(Borgerrepræsentationen|Kommunalbestyrelsen|Byrådet)$|Byråd$/i;
function hvadKanDuGoere(s) {
  const web = KOMMUNE[s.kommune || "København"]?.web || "https://www.kk.dk/";
  const kort = (u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const lnk = (u) => `<a href="${esc(u)}" rel="nofollow">${esc(kort(u))}</a>`;
  const hoering = erKK(s) ? "https://blivhoert.kk.dk" : web;
  const naar = `${ugedag(s.dato)} ${datoTekst(s.dato)}`;
  // Ældre sager er sandsynligvis afgjort videre oppe eller færdighørt, så dér lover vi ikke noget
  const siden = (Date.parse(IDAG) - Date.parse(s.dato)) / 864e5, forkastet = /forkast|afvist|ikke godkendt/i.test(s.udfald || "");
  const r = [];
  // "Alle kan svare" kun, når sagen selv siger offentlig høring; mange høringer er kun for bestemte parter (fx skolebestyrelser)
  const offentlig = /offentlig\s+høring/i.test(s.afsnit.map((a) => a.tekst).join(" "));
  if (s.frist && s.frist >= IDAG) r.push(offentlig
    ? ["Svar i høringen", `Alle kan sende et høringssvar, før forslaget bliver endeligt vedtaget. Fristen er ${ugedag(s.frist)} ${datoTekst(s.frist)}, og du svarer på ${lnk(hoering)}.`]
    : ["Høringsfrist", `Sagen nævner en høringsfrist ${ugedag(s.frist)} ${datoTekst(s.frist)}. Læs i sagen, hvem høringen er for.`]);
  else if (s.hoering && offentlig && !s.frist && siden <= 60 && !forkastet) r.push(["Hold øje med høringen", `Forslaget lægger op til en offentlig høring. Når den åbner, kan alle sende et høringssvar på ${lnk(hoering)}.`]);
  if (s.status === "kommer") {
    if (BYRAAD.test(s.udvalg)) r.push(["Sid med til mødet", `Byrådets møder er offentlige, så du kan selv sidde med, når sagen behandles ${naar}.`]);
    else if (erLokaludvalg(s.udvalg)) r.push(["Mød op", `Lokaludvalgets møder er som regel åbne for alle i bydelen. Sagen behandles ${naar}.`]);
    else r.push(["Skriv til politikerne", `Udvalgets møder er lukkede, men du kan skrive til medlemmerne før mødet ${naar}. Du finder dem på ${lnk(web)}.`]);
  } else if (s.videre && !BYRAAD.test(s.udvalg) && siden <= 30 && !forkastet) {
    r.push(["Sagen er ikke slut", `Den skal videre til ${esc(s.videre)}. Indtil den er afgjort, kan du skrive til politikerne. Du finder dem på ${lnk(web)}.`]);
  }
  if (!r.length) return "";
  return `<section class="kf goer" aria-labelledby="goer-h"><h2 id="goer-h">Hvad kan du gøre?</h2><dl>${r.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></section>`;
}

// Under sagen: tilbyd at følge netop sagens emne eller bydel. Linket udfylder emnet i tilmeldingen.
const testerBoks = (s) => {
  const hvad = erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.emner.length ? EMNER[s.emner[0]].navn : "";
  const om = erLokaludvalg(s.udvalg) ? `sager fra ${esc(hvad)}` : hvad ? `sager om ${esc(hvad.toLowerCase())}` : "sager som denne";
  return `<aside class="paa-mail tester">
  <h2 class="rubrik">Få ${om} hver mandag</h2>
  <p>Vi læser alle dagsordener, så du ikke skal. Hver mandag får du de sager, der handler om det, du følger. Det er gratis, og vi søger testere i hele Danmark.</p>
  <a href="../vagt.html?fra=sag${hvad ? `&amp;emne=${encodeURIComponent(hvad)}` : ""}${erKK(s) ? "" : `&amp;kommune=${encodeURIComponent(s.kommune)}`}#tilmeld">Skriv dig op</a>
</aside>`;
};
// Én linje pr. sag: hvor, overskrift og dato
const notits = (s, rod = "", medDato = true) => `<li><span class="nh-hvor">${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg.replace(/udvalget$/, "udvalget"))}</span> <a href="${rod}${s.url}">${esc(s.titel)}</a>${medDato ? ` <span class="nh-dato">${kortDato(s.dato)}</span>` : ""}</li>`;

// Redaktionen: din leder, dine overskrifter og ugens tophistorie (avis/redaktion.json, redigeres med avis/redaktion.html)
async function laesRedaktion() {
  try { return JSON.parse(await readFile(join(ROD, "avis", "redaktion.json"), "utf8")); } catch { return {}; }
}

// FirstAgenda-PDF'er (fx Herning) har afdelingernes fordelingsliste og sagsbehandleren midt i teksten:
// "Kommunikation\n\nDIR\n\nBFU …\n\nX\n\nSagsbehandler: Navn\nØvrige sagsbehandlere: …". Den skæres fra.
const FORDELING = /(?:Kommunikation\s+)?(?:(?<=^|\s)[A-ZÆØÅ]{2,4}\s+){3,}(?:X\s+)*Sagsbehandler:[^\n]*?(?:\n|(?=Øvrige sagsbehandlere:))\s*(?:Øvrige sagsbehandlere:\s*)?/g;
export const udenFordeling = (t = "") => t.replace(FORDELING, "\n").trim();

// Kommunernes interne mærker i titlen: punktnummer (kun når hele kommunen nummererer), Høje-Taastrups "I - "/"A - "
// og " - ØU", Lyngby-Taarbæks "(Beslutning)" og en dato til sidst ("- 2026-10-01")
// Titler med versaler (Guldborgsunds "BESLUTNINGSSAG: …") skrives med små bogstaver; ord, der står med stort
// begyndelsesbogstav i sagens egen tekst (stednavne, firmaer), beholder det.
const VERSALSAG = /^(?:BESLUTNINGSSAG|ORIENTERINGSSAG|DRØFTELSESSAG|TEMASAG)\s*:\s*/;
function udenVersaler(t, tekst = "") {
  if (t.length < 12 || t !== t.toUpperCase() || !/[A-ZÆØÅ]{4}/.test(t)) return t;
  // Ord fra sagens tekst: står ordet nogensinde med lille, er det et almindeligt ord; ellers beholdes stavningen
  const smaa = new Set(), store = new Map(), versal = new Set();
  for (const o of tekst.match(/[A-Za-zÆØÅæøåé]+(?:-[A-Za-zÆØÅæøåé]+)*/g) || []) {
    if (o === o.toLowerCase()) smaa.add(o);
    else if (o === o.toUpperCase() && o.length > 1) versal.add(o);
    else store.set(o.toUpperCase(), o);
  }
  const u = t.replace(VERSALSAG, "").split(/(\s+)/).map((o) => {
    if (/^\s+$/.test(o) || !/[A-ZÆØÅ]/.test(o)) return o;
    const ren = o.replace(/[^A-ZÆØÅÉ-]/g, ""), lille = ren.toLowerCase();
    if (versal.has(ren) && ren.length > 1 && !smaa.has(lille)) return o; // forkortelser, der også står med versaler i teksten
    if (store.has(ren) && !smaa.has(lille)) return o.replace(ren, store.get(ren));
    return o.toLowerCase();
  }).join("");
  return u.replace(/^./, (c) => c.toUpperCase());
}

export const kommuneTitel = (t, nummereret, tekst) => {
  let u = udenVersaler(nummereret ? t.replace(/^\d+\.\s+/, "") : t, tekst);
  u = u.replace(/^[A-ZÆØÅ]\s+[-–]\s+/, "").replace(/^(?:Beslutningssag|Orienteringssag|Drøftelsessag|Temasag)\s*:\s*/i, "").replace(/^Beslutning\s*[-–;:]\s+/, "")
    .replace(/\s*\((?:Beslutning|Orientering|Drøftelse|Godkendelse|Indstilling)\)\s*$/i, "")
    .replace(/\s+[-–]\s+(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s*$/, "")
    .replace(/\s+[-–]\s+(?:ØU|TU|KB|BR|PMU|ISU|ÆSU|FKU|SBU|BMU|ByR|KMU|BU|SU|EU|AU)\s*$/, "");
  return u.trim() || t;
};

// ---------- Sider ----------
async function main() {
  const filer = (await readdir(join(ROD, "data"))).filter((f) => f.endsWith(".json"));
  const alle = [];
  for (const f of filer) {
    // data/ har også andre filer end kommunernes sager (fx udbud.json og erhverv-foerst-set.json); de springes over
    const indhold = JSON.parse(await readFile(join(ROD, "data", f), "utf8"));
    if (!indhold.sager) continue;
    const sg = Object.values(indhold.sager);
    // Nogle kommuner nummererer alle punkter i titlen ("4. Beslutning - …", Hvidovre og Høje-Taastrup). Kun når
    // næsten alle titler i kommunen har nummer, skæres det fra; ellers ville "2. behandling af budget" miste sit tal.
    const nummereret = f !== "kk.json" && sg.filter((s) => /^\d+\.\s/.test(s.titel)).length > 0.8 * sg.length;
    alle.push(...(f === "kk.json" ? sg : sg.map((s) => ({ ...s, titel: kommuneTitel(s.titel, nummereret, (s.afsnit || []).map((a) => a.tekst).join("\n")), afsnit: (s.afsnit || []).map((a) => ({ ...a, tekst: udenFordeling(a.tekst) })) }))));
  }
  const red = await laesRedaktion();
  const FORENKLET = await laesForenklet(); // "Forklar sagen enkelt" (avis/forenklet.mjs)
  const PERSPEKTIV = await laesPerspektiv(); // "Hvad betyder det for dig?" og "For og imod" (avis/perspektiv.mjs)
  const alleSager = alle.filter(publicerbar).map(berig).map((s) => {
    const r = red.sager?.[s.id];
    return r?.overskrift ? { ...s, kommunensTitel: s.titel, titel: r.overskrift.trim(), dek: (r.underrubrik || s.dek).trim() } : s;
  }).sort((a, b) => b.dato.localeCompare(a.dato) || a.nr - b.nr);
  // Københavns avis bygges af Københavns sager; de andre kommuner får sagssider og deres egen kommuneside
  const sager = alleSager.filter(erKK), andre = alleSager.filter((s) => !erKK(s));
  // De andre kommuner: øverste råd (til menuen) og steder og byer i sagerne (til sagssiderne og kommune/<navn>/sted/ og bydel/)
  const KSTED = new Map();
  for (const navn of new Set(andre.map((s) => s.kommune))) {
    const egne = andre.filter((s) => s.kommune === navn);
    const top = [...new Set(egne.map((s) => s.udvalg))].find((u) => BYRAAD.test(u));
    if (top) TOPRAAD.set(navn, top);
    if (KOMMUNE[navn]) UDGAVER.push(KOMMUNE[navn]);
    if (KOMMUNE[navn]) KSTED.set(navn, await findKommuneSteder(KOMMUNE[navn], egne, ROD));
  }
  UDGAVER.sort((a, b) => a.navn.localeCompare(b.navn, "da"));
  console.log(`${alle.length} punkter, ${sager.length} publiceres i København${andre.length ? `, ${andre.length} i andre kommuner` : ""}`);

  const H = { ROD, IDAG, SITE_URL, esc, side, kicker, emneLinks, hvorNavn, stor, kortDato, datoTekst, ugedag, slug, saetninger, erLokaludvalg, bydel, vagtBoks, notits, EMNER, MDR, d };
  const { prSted, stederFor } = await findSteder(sager, ROD); // gader, pladser og parker (avis/steder.mjs)
  // Grafik: plankort (lokalplaner), stedkort (gader og steder), luftfoto og gadefoto (kun med nøgler), godkendte læserfotos.
  // Øverst på sagen står plankortet, ellers stedkortet, ellers emnets illustration (assets/emner/).
  const plankort = await bygPlankort(alleSager, H, KOMMUNE);
  const stedKort = await bygStedkort(alleSager, H, KOMMUNE, (s) => (erKK(s) ? stederFor(s) : KSTED.get(s.kommune)?.stederFor(s) || []));
  // Plankort eller stedkort til Min avis (b i sager.json); uden et kort bruger Min avis emnets tegning
  H.billedeFil = (s) => plankort.get(s.id)?.fil || stedKort.get(s.id)?.fil || undefined;
  const luftfotos = await bygLuftfotos(plankort, H), gadefotos = await bygGadefotos(stedKort, H), laeserfotos = await laesLaeserfotos(ROD);
  const billedeSti = (s) => plankort.get(s.id)?.fil || stedKort.get(s.id)?.fil || `assets/emner/${emneId(s)}.svg`;
  const topBillede = (s, rod) => plankortFigur(s, plankort, rod, esc) || stedkortFigur(s, stedKort, rod, esc) || `<figure class="emne-figur">${emneBillede(s, rod, { lazy: false })}</figure>`;
  const flereBilleder = (s, rod) => luftfotoFigur(s, luftfotos, rod, esc) + gadefotoFigur(s, gadefotos, rod, esc) + laeserfotoFigur(s, laeserfotos, rod, esc)
    + (stedKort.get(s.id)?.sted || plankort.get(s.id) ? sendFotoLink(s, stedKort.get(s.id)?.sted || plankort.get(s.id)?.plannavn, rod, esc) : "");
  const lilleBillede = (s, rod) => `<a class="kort-billede" href="${rod}${s.url}" tabindex="-1" aria-hidden="true"><img class="emnebillede lille" src="${rod}${billedeSti(s)}" alt="" loading="lazy"></a>`;
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
  // Samme sag behandles ofte i flere udvalg; på forsiden står hver overskrift kun én gang
  const tt = (s) => s.titel.toLowerCase();
  const anden = spred(unikTitel(nyheder.filter((s) => s !== top && tt(s) !== tt(top) && !erLokaludvalg(s.udvalg))), 9, 2);
  const mellem = anden.slice(0, 3);
  const brugt = new Set([top, ...anden]);
  const bydele = spred(nyheder.filter((s) => erLokaludvalg(s.udvalg) && !brugt.has(s)), 6, 2);
  bydele.forEach((s) => brugt.add(s));
  const kommende = spred(sager.filter((s) => s.status === "kommer" && s.vaegt > 0 && !s.rutine).sort((a, b) => a.dato.localeCompare(b.dato) || b.score - a.score), 7, 2);
  const brugteTitler = new Set([...brugt].map(tt));
  const kortNyt = [...anden.slice(3), ...unikTitel(afholdt.filter((s) => !brugt.has(s) && !brugteTitler.has(tt(s)) && s.vaegt > 0 && !s.rutine)).slice(0, 10)];
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
        <a class="lead-billede" href="${top.url}" tabindex="-1" aria-hidden="true"><img class="emnebillede" src="${billedeSti(top)}" alt=""></a>
        ${kicker(top, "")}
        <h1 class="hl"><a href="${top.url}">${esc(top.titel)}</a></h1>
        ${top.dek ? `<p class="dek anslag">${esc(saetninger(top.dek, 320))}</p>` : ""}
        ${top.status === "besluttet" && top.udfald ? `<p class="udfald">${esc(top.udfald)}</p>` : top.status === "kommer" ? `<p class="udfald kommer">Til beslutning ${ugedag(top.dato)} ${datoTekst(top.dato)}.</p>` : ""}
      </article>
      <div class="mellem">
        ${mellem.map((s) => `<article class="med-billede">${lilleBillede(s, "")}<div>${kicker(s, "")}<h2 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 190))}</p>` : ""}${stemmeMini(s, esc)}</div></article>`).join("\n        ")}
      </div>
      <section class="kortnyt" aria-labelledby="h-kort">
        <h2 id="h-kort" class="rubrik">Kort nyt</h2>
        <ul>${kortNyt.map((s) => notits(s)).join("")}</ul>
      </section>
    </div>
    <div class="rail">
      ${vagtBoks("")}
      <section aria-labelledby="h-bydele">
        <a class="kort-link" href="kort.html"><img src="assets/emner/generel.svg" alt=""><span>Se sagerne på et kort<br><b>Hvad sker der i din gade?</b></span></a>
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
  const delebilleder = await bygDelebilleder(sager, H, billedeSti);
  await rm(join(ROD, "assets", "sager"), { recursive: true, force: true }); await mkdir(join(ROD, "assets", "sager"), { recursive: true });
  // "Mere fra …" under sagen: samme udvalg i samme kommune
  const prKommuneUdvalg = new Map();
  for (const s of alleSager) { const k = `${s.kommune}|${s.udvalg}`; if (!prKommuneUdvalg.has(k)) prKommuneUdvalg.set(k, []); prKommuneUdvalg.get(k).push(s); }
  for (const s of alleSager) {
    const krop = s.afsnit.filter((a) => a.titel !== "Resumé" && !/beslutning/i.test(a.titel));
    const relateret = prKommuneUdvalg.get(`${s.kommune}|${s.udvalg}`).filter((x) => x !== s).slice(0, 5);
    const jsonld = { "@context": "https://schema.org", "@type": "Article", headline: s.titel.slice(0, 110), datePublished: s.dato, inLanguage: "da", isBasedOn: s.kilde, publisher: { "@type": "Organization", name: "Sagsvagt" } };
    const artikel = `<article>
      <header>
        ${kicker(s, "../")}
        <h1 class="hl">${esc(s.titel)}</h1>
        ${s.dek ? `<p class="dek">${esc(s.dek)}</p>` : ""}
        ${s.kommunensTitel ? `<p class="kommunens-titel">Kommunens titel: ${esc(s.kommunensTitel)}</p>` : ""}
        ${emneLinks(s, "../")}
        ${erKK(s) ? stedLinks(stederFor(s), "../", H) : (() => { const ks = KSTED.get(s.kommune), m = `kommune/${KOMMUNE[s.kommune]?.slug}/`; return ks ? stedLinks(ks.byFor(s), "../", H, `${m}bydel/`, "Bydele i sagen:") + stedLinks(ks.stederFor(s), "../", H, `${m}sted/`) : ""; })()}
        ${topBillede(s, "../")}
        ${flereBilleder(s, "../")}
        <!--del-->
        ${forenkletBoks(s, FORENKLET, esc)}
      </header>
      <div class="body">
        ${forklar(kortFortalt(s), esc, 3)}
        ${stemmeGrafik(s, esc)}
        ${perspektivBokse(s, PERSPEKTIV, esc)}
        ${hvadKanDuGoere(s)}
        ${vejBoks(s, vej, H)}
      <!--tester-->
        <details class="hel-sag">
          <summary>Læs hele sagen <span>Kommunens egen tekst</span></summary>
        ${forklar(krop.map((a) => `<h2>${esc(a.titel)}</h2>\n${afsnitTilHtml(a.tekst)}`).join("\n") + (s.status === "besluttet" ? `<h2 id="beslutning">Beslutning</h2>\n${afsnitTilHtml(s.beslutning)}` : ""), esc)}
        ${s.bilag.length ? `<h2>Bilag</h2><ul class="files">${s.bilag.map((b) => `<li>${b.url ? `<a href="${esc(b.url)}" rel="nofollow">${esc(b.navn)}</a>` : esc(b.navn)}</li>`).join("")}</ul>` : ""}
        </details>
        <p class="source">Kilde: ${esc(kommunensNavn(s))}, ${esc(s.udvalg)}, ${s.type === "referat" ? "referat" : "dagsorden"} fra mødet ${ugedag(s.dato)} ${datoTekst(s.dato)}, punkt ${s.nr}. <a href="${esc(s.kilde)}" rel="nofollow">Læs den originale sag hos kommunen</a>.</p>
      </div>
    </article>`;
    // Samme artikel som fragment, så Min avis kan vise hele sagen (sag/ og min/ ligger begge ét niveau nede)
    await writeFile(join(ROD, "assets", "sager", s.url.slice(4)), artikel.replace("<!--tester-->", "").replace("<!--del-->", ""));
    const indhold = `<div class="wrap">
  <div class="article">
    ${artikel.replace("<!--tester-->", testerBoks(s)).replace("<!--del-->", delRad(SITE_URL + s.url, s.titel))}
    <aside class="side">
      ${vagtBoks("../", "sag", erKK(s) ? "København" : s.kommune)}
      ${relateret.length ? `<h2 class="rubrik">Mere fra ${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}</h2>${relateret.map((x) => `<article class="mini">${kicker(x, "../", false)}<h3 class="hl"><a href="../${x.url}">${esc(x.titel)}</a></h3></article>`).join("")}` : ""}
    </aside>
  </div>
</div>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>${DEL_SCRIPT}${AABN_SCRIPT}`;
    await writeFile(join(ROD, s.url), side({
      titel: `${s.titel} – Sagsvagt`, beskrivelse: s.dek || `${s.udvalg}, ${datoTekst(s.dato)}`,
      sti: s.url, rod: "../", indhold, ogType: "article", ogBillede: delebilleder.get(s.id), kommune: erKK(s) ? null : KOMMUNE[s.kommune],
    }));
  }

  // Udvalgs- og bydelssider
  const liste = (s, medUdvalg = false) => `<article class="med-billede">${lilleBillede(s, "../")}<div>${kicker(s, "../", medUdvalg)}<h2 class="hl"><a href="../${s.url}">${esc(s.titel)}</a></h2><p class="dek">${esc(saetninger(s.dek, 200))}</p>${stemmeMini(s, esc)}</div></article>`;
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
<div class="emne-gitter">${Object.entries(EMNER).map(([id, e]) => `<section aria-labelledby="em-${id}"><h2 id="em-${id}" class="rubrik"><a href="${id}.html" class="emne-navn">${esc(e.navn)}</a> <a href="${id}.html">${prEmne[id].length} sager</a></h2><ul class="notitser">${unikTitel(prEmne[id]).slice(0, 4).map((s) => notits(s, "../")).join("")}</ul></section>`).join("")}</div></div></div>`,
  }));

  // Møder: ét møde er et udvalg på en dato. Antallet af punkter tæller hele dagsordenen,
  // listen viser de sager, vi bringer. Dagsordenen hos kommunen er sagens adresse uden "/punkt-N".
  const moeder = new Map();
  for (const s of alle) {
    if (!erKK(s)) continue; // mødeoversigten, kalenderne og Min avis er Københavns
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

  // Søgning: søger i assets/sager.json i browseren. Samme søgeside som de andre kommuner (avis/udgave.mjs),
  // med en vælger, så man kan skifte til en anden kommunes sager.
  const udgaver = [...new Set(andre.map((s) => s.kommune))].map((n) => KOMMUNE[n]).filter(Boolean).sort((a, b) => a.navn.localeCompare(b.navn, "da"));
  const soegValg = [{ navn: "København", href: "soeg.html" }, ...udgaver.map((k) => ({ navn: k.navn, href: `kommune/${k.slug}/soeg.html` }))];
  await writeFile(join(ROD, "soeg.html"), side({
    titel: "Søg i sagerne – Sagsvagt", beskrivelse: "Søg i alle sager fra Københavns byråd, udvalg og lokaludvalg.", sti: "soeg.html", rod: "", aktiv: "soeg",
    indhold: soegIndhold({ rod: "", data: "assets/sager.json", antal: sager.length, valg: soegValg, aktiv: "København", emner: EMNER }),
  }));

  // Partier, høringer, kalendere og RSS (avis/ekstra.mjs)
  await bygPartier(sager, H);
  await bygHoeringer(sager, H);
  await bygKalendere([...moeder.values()], H);
  await bygFeeds(sager, H);

  // 404: vises af serveren for ukendte adresser (ErrorDocument i .htaccess). Links fra roden, fordi siden kan vises på enhver sti.
  await writeFile(join(ROD, "404.html"), side({
    titel: "Siden findes ikke – Sagsvagt", beskrivelse: "Siden findes ikke på Sagsvagt.", sti: "404.html", rod: "/",
    indhold: `<div class="wrap"><div class="listing prose" style="padding:48px 0 64px">
  <p class="kicker"><span class="status">Fejl 404</span></p>
  <h1 style="font-family:var(--sans)">Siden findes ikke</h1>
  <p class="intro">Adressen er forkert, eller sagen er flyttet. Kommunerne lægger nogle gange en sag om, så den får en ny adresse.</p>
  <ul class="chips" style="margin-top:20px">
    <li><a href="/index.html">Til forsiden</a></li>
    <li><a href="/kommune/">Find din kommune</a></li>
    <li><a href="/soeg.html">Søg i sagerne</a></li>
  </ul>
</div></div>`,
  }));

  // Om-side (med de åbne kommuner: "Albertslund, Brønderslev … og Viborg")
  const aabneNavne = udgaver.map((k) => k.navn);
  const aabneTekst = aabneNavne.length > 1 ? `${aabneNavne.slice(0, -1).join(", ")} og ${aabneNavne.at(-1)}` : aabneNavne[0] || "flere kommuner";
  // Kort over sagerne: Københavns sager fra de sidste 120 dage med et sted, som nåle (kort.html + assets/kort-sager.json)
  const paaKort = sager.filter((s) => stedKort.get(s.id)?.lat != null && (d(IDAG) - d(s.dato)) / 864e5 <= 120)
    .map((s) => { const k = stedKort.get(s.id); return { lat: +k.lat.toFixed(5), lon: +k.lon.toFixed(5), sted: k.sted, titel: s.titel, url: s.url, dato: s.dato, status: s.status, hvor: hvorNavn(s.udvalg), emne: emneId(s) }; });
  await writeFile(join(ROD, "assets", "kort-sager.json"), JSON.stringify(paaKort));
  await writeFile(join(ROD, "kort.html"), side({
    titel: "Kort over sagerne i København – Sagsvagt", beskrivelse: "Se på kortet, hvad politikerne i København beslutter om din gade, skole og park.", sti: "kort.html", rod: "",
    indhold: `<div class="wrap">
  <h1 class="hl kort-h">Hvad sker der i din gade?</h1>
  <p class="dek">${paaKort.length} sager fra de sidste fire måneder, der nævner en gade, en plads, en skole eller en park. Tryk på en nål for at læse sagen.</p>
  <div id="sagskort" class="sagskort" role="region" aria-label="Kort over sagerne"></div>
  <p class="lille">Kort: © <a href="https://www.openstreetmap.org/copyright" rel="nofollow">OpenStreetMap</a>-bidragydere. Stedet er fundet ud fra sagens tekst og kan være upræcist.</p>
</div>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>(function(){var k=L.map("sagskort",{scrollWheelZoom:false}).setView([55.676,12.568],12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(k);
function e(t){return String(t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
fetch("assets/kort-sager.json").then(function(r){return r.json()}).then(function(l){var g=[];l.forEach(function(s){
var m=L.circleMarker([s.lat,s.lon],{radius:8,weight:2,color:"#fff",fillColor:s.status==="kommer"?"#28377A":"#8A2430",fillOpacity:.9}).addTo(k);
m.bindPopup('<p class="kort-pop-sted">'+e(s.sted)+" · "+e(s.hvor)+'</p><a href="'+e(s.url)+'">'+e(s.titel)+"</a>");g.push([s.lat,s.lon])});
if(g.length)k.fitBounds(g,{padding:[24,24],maxZoom:14})})})();</script>`,
  }));
  // Stilarterne til grafikken ligger i avis/stil/*.css og samles i assets/grafik.css
  const stilFiler = (await readdir(join(ROD, "avis", "stil"))).filter((f) => f.endsWith(".css")).sort();
  await writeFile(join(ROD, "assets", "grafik.css"), (await Promise.all(stilFiler.map((f) => readFile(join(ROD, "avis", "stil", f), "utf8")))).join("\n"));
  await writeFile(join(ROD, "foto.html"), side({
    titel: "Send et billede – Sagsvagt", beskrivelse: "Send et billede fra et sted, politikerne beslutter noget om. Vi viser det med dit navn.", sti: "foto.html", rod: "", indhold: fotoSideIndhold(esc),
  }));
  await writeFile(join(ROD, "om.html"), side({
    titel: "Om Sagsvagt", beskrivelse: "Sagsvagt gør det let at følge med i, hvad politikerne i din kommune beslutter.", sti: "om.html", rod: "", aktiv: "om",
    indhold: `<div class="wrap"><div class="listing prose"><h1 style="font-family:var(--sans)">Om Sagsvagt</h1>
<p>Sagsvagt er en gratis lokalavis for hele Danmark. Vi gør det let at følge med i, hvad politikerne i din kommune beslutter. Hver dag læser vi de dagsordener og referater, kommunen selv offentliggør, og samler sagerne ét sted, så du ikke skal lede i udvalgenes dokumenter.</p>
<h2>Hvor kommer sagerne fra?</h2>
<p>Alt på Sagsvagt kommer fra kommunernes offentligt tilgængelige dagsordener og referater. Vi er startet i Københavns Kommune med Borgerrepræsentationen, udvalgene og de 12 lokaludvalg og har åbnet ${aabneTekst}. Flere kommuner følger efter, hvor flest skriver sig op. <a href="kommune/">Find din kommune</a>. Hver sag linker til den originale side hos kommunen.</p>
<h2>Hvordan bliver teksterne lavet?</h2>
<p>Overskrifter, resuméer, indstillinger og beslutninger er kommunens egen tekst, som vi henter automatisk fra dagsordener og referater og sætter op, så de er lette at læse. "Kort fortalt" samler de samme oplysninger. Teksten under "Forklar sagen enkelt" er skrevet med hjælp fra AI og er mærket sådan. Læs altid den originale sag hos kommunen, før du handler på den.</p>
<h2>Hvem står bag?</h2>
<p>Sagsvagt drives af Asger Christian Mansa (CVR 46841514). Sagsvagt er partineutral: alle partier vises ens og efter de samme regler, sagerne udvælges efter emne og ikke efter parti, og vi skriver ikke holdninger ind i sagerne. Debatindlæg bringes under skribentens eget navn.</p>
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
      id: s.id, t: s.titel, kt: s.kommunensTitel, d: s.dek, u: s.udvalg, dato: s.dato, st: s.status, ud: s.udfald, kb: s.kortBesl || undefined, sm: s.stemmer, tal: s.tal,
      e: s.emner, et: s.emnerTitel, url: s.url, k: s.kilde, v: s.vaegt, r: s.rutine ? 1 : 0, b: H.billedeFil(s), x: saetninger(s.afsnit.map((a) => a.tekst).join(" "), 600),
    })),
  }));

  // Bokse til andres hjemmesider og siden boks.html, hvor man henter koden (avis/boks.mjs)
  const antalBokse = await bygBokse({ sager, udvalg, lokal, prUdvalg, prEmne }, H);
  // En side for hver af de 98 kommuner (avis/kommuner.mjs)
  const { kommuner, kommuneSider } = await bygKommuner({ sager, andre, alle, soegValg, KSTED, TOPRAAD }, H);

  // Sitemap og robots
  const stedUrls = await bygSteder(prSted, H);
  console.log(`${stedUrls.length - 1} stedsider`);
  const urls = [...stedUrls, "", "index.html", "om.html", "boks.html", "soeg.html", "moeder.html", "partier.html", "hoeringer.html", "udvalg/", "bydel/", "emne/", ...Object.keys(EMNER).map((id) => `emne/${id}.html`), ...[...udvalg].map((u) => `udvalg/${slug(u)}.html`), ...lokal.map((u) => `bydel/${slug(bydel(u))}.html`), "kommune/", ...kommuner.filter((k) => k.slug !== "koebenhavn").map((k) => `kommune/${k.slug}.html`), ...kommuneSider, ...alleSager.map((s) => s.url)];
  await writeFile(join(ROD, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(ROD, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
  console.log(`Byggede forside, ${sager.length} sager, ${udvalg.length} udvalg, ${lokal.length} bydele, ${Object.keys(EMNER).length} emner, ${antalBokse} bokse`);
}

main().catch((e) => { console.error(e); process.exit(1); });
