// "Det skrev medierne" (8/11-2026): henter lokale mediers RSS og finder den sag, hver artikel handler om.
// Kun overskrift, medie, dato og link gemmes (som aftalen med Folketidende § 2.2: ingen tekst eller billeder).
// Robotten kører den før avis/byg.mjs, som viser artiklerne under sagen. data/medier.json samler artiklerne over tid,
// fordi feedene kun har det seneste døgn.
// Brug: node avis/medier.mjs            → henter, matcher og skriver data/medier.json og en rapport
//       node avis/medier.mjs --fil x.xml → matcher en gemt feed-fil i stedet for at hente (til test)
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROD = join(dirname(fileURLToPath(import.meta.url)), "..");
const UD = join(ROD, "data", "medier.json");

// Kommunen står i adressen: tv2east.dk/kalundborg/… (samme stavning som data/<kommune>.json)
const FEEDS = [
  { navn: "TV2 Øst", url: "https://www.tv2east.dk/rss", kommune: (link) => new URL(link).pathname.split("/")[1] },
];
// Folketidende har ingen RSS, og aftalens § 2.4 (hvordan Sagsvagt finder artiklerne) er ikke afgjort, så den er ikke med.

const STOP = new Set(("aldrig andre anden andet blev bliver blive bliver efter eller endnu flere fordi forslag foran fra første "
  + "gennem godkender hvad hvilke hvis hvor hvordan ikke inden kommer kommunen kommune kommunens kunne langt lige mange meget "
  + "mellem mere nogle noget over sagen sager samt sammen siden skal skulle stadig store under uden udvalget vedr vedrørende "
  + "være været ville årets byrådet byråd").split(" "));
const ord = (t) => (t.toLowerCase().match(/[a-zæøå]{5,}/g) || []).filter((o) => !STOP.has(o));
const tal = (t) => new Set((t.match(/\d{1,3}(?:\.\d{3})+|\d{3,}/g) || []).filter((n) => !/^20\d\d$/.test(n)));
const renTekst = (t = "") => t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const dag = (iso) => Date.parse(iso.slice(0, 10)) / 864e5;

function laesFeed(xml, feed) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const f = (k) => renTekst((it.match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)) || [])[1]);
    const link = f("link"), tid = new Date(f("pubDate"));
    if (!/^https:\/\//.test(link) || isNaN(tid)) return null;
    return { medie: feed.navn, titel: f("title"), link, dato: tid.toISOString().slice(0, 10), kommune: feed.kommune(link), tekst: f("description").slice(0, 600) };
  }).filter((a) => a?.titel);
}

// Sagerne pr. kommune med de ord, der gør dem genkendelige (ordenes vægt: sjældne ord i kommunen tæller mest)
async function laesKommune(slug) {
  let d;
  try { d = JSON.parse(await readFile(join(ROD, "data", `${slug}.json`), "utf8")); } catch { return null; }
  if (!d.sager) return null;
  const sager = Object.values(d.sager).map((s) => {
    const tekst = `${s.titel} ${(s.afsnit || []).map((a) => a.tekst).join(" ").slice(0, 1500)}`;
    return { id: s.id, titel: s.titel, dato: s.dato, ord: new Set(ord(tekst)), tal: tal(tekst) };
  });
  const df = new Map();
  for (const s of sager) for (const o of s.ord) df.set(o, (df.get(o) || 0) + 1);
  return { navn: d.kommune, sager, idf: (o) => Math.log(sager.length / (df.get(o) || 1)) };
}

// Bedste sag for en artikel: delte sjældne ord, plus et ekstra point for samme beløb eller nummer (fx 11.000 eller lokalplan 512).
// Sagen skal være fra de 120 dage før artiklen til 30 dage efter.
function match(a, k) {
  const aOrd = new Set(ord(`${a.titel} ${a.titel} ${a.tekst}`)), aTal = tal(`${a.titel} ${a.tekst}`);
  return k.sager.filter((s) => dag(s.dato) >= dag(a.dato) - 120 && dag(s.dato) <= dag(a.dato) + 30).map((s) => {
    const faelles = [...aOrd].filter((o) => s.ord.has(o));
    const score = faelles.reduce((n, o) => n + k.idf(o), 0) + [...aTal].filter((n) => s.tal.has(n)).length * 4;
    return { s, score, faelles };
  }).sort((x, y) => y.score - x.score).slice(0, 3);
}

const GRAENSE = 30; // 8/11: de to rigtige par scorede 117 og 40, de forkerte højst 24 (kun ét døgns artikler, så tjek igen)
async function main() {
  const fil = process.argv.includes("--fil") ? process.argv[process.argv.indexOf("--fil") + 1] : null;
  let gemt = { artikler: {} };
  try { gemt = JSON.parse(await readFile(UD, "utf8")); } catch {}
  const nye = [];
  for (const feed of FEEDS) {
    // Svarer et medie ikke, springes det over denne gang; de gemte artikler bliver liggende
    try {
      const svar = fil ? null : await fetch(feed.url, { headers: { "User-Agent": "Sagsvagt (sagsvagt.dk; mansa@sagsvagt.dk)" }, signal: AbortSignal.timeout(20000) });
      if (svar && !svar.ok) throw new Error(`HTTP ${svar.status}`);
      nye.push(...laesFeed(fil ? await readFile(fil, "utf8") : await svar.text(), feed));
    } catch (e) { console.log(`${feed.navn}: kunne ikke hentes (${e.message})`); }
  }
  // Artikler uden sag fra de sidste 30 dage prøves igen, for sagen kommer ofte først på dagsordenen efter artiklen.
  // Teksten er ikke gemt, så de prøves kun med overskriften.
  const idag = new Date().toISOString().slice(0, 10), nyeLinks = new Set(nye.map((a) => a.link));
  const igen = Object.entries(gemt.artikler).filter(([link, a]) => !a.sag && !nyeLinks.has(link) && dag(idag) - dag(a.dato) <= 30)
    .map(([link, a]) => ({ ...a, link, tekst: "" }));
  const kommuner = new Map(), slugs = new Set((await readdir(join(ROD, "data"))).map((f) => f.replace(/\.json$/, "")));
  let fundet = 0;
  for (const a of [...nye, ...igen]) {
    if (!slugs.has(a.kommune)) { console.log(`– ${a.medie}: ${a.titel} (ingen kommune: ${a.kommune})`); continue; }
    if (!kommuner.has(a.kommune)) kommuner.set(a.kommune, await laesKommune(a.kommune));
    const k = kommuner.get(a.kommune);
    const top = k ? match(a, k) : [];
    const bedst = top[0] && top[0].score >= GRAENSE ? top[0] : null;
    if (bedst) fundet++;
    console.log(`${bedst ? "✓" : "–"} ${a.medie}, ${k?.navn || a.kommune}: ${a.titel}`);
    for (const t of top.slice(0, bedst ? 1 : 2)) console.log(`    ${t.score.toFixed(1)}  ${t.s.dato}  ${t.s.titel.slice(0, 90)}  [${t.faelles.slice(0, 6).join(", ")}]`);
    gemt.artikler[a.link] = { medie: a.medie, titel: a.titel, dato: a.dato, kommune: a.kommune, sag: bedst?.s.id || null, score: bedst ? +bedst.score.toFixed(1) : null };
  }
  gemt.opdateret = new Date().toISOString();
  await writeFile(UD, JSON.stringify(gemt, null, 1));
  console.log(`\n${nye.length} nye og ${igen.length} prøvet igen, ${fundet} matchet med en sag. ${Object.keys(gemt.artikler).length} artikler i data/medier.json.`);
}
main();
