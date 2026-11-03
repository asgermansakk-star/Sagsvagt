// Henter dagsordener og referater fra kommuner, der bruger "Åben Dagsorden" (fx dagsorden.glostrup.dk og
// aabendagsorden.syddjurs.dk), og gemmer hvert dagsordenspunkt i data/<kommune>.json i samme format som
// hent-firstagenda.mjs. Kommunerne står i avis/firstagenda.json med "system": "aabendagsorden".
//
// Portalens robots.txt tillader alt. Vi bruger de samme to adresser som portalens egen side: mødelisten
// (/rest/meeting/search, JSON) og mødet (/fragments/meeting/<id>/view, HTML med hele teksten). Ingen PDF'er.
// Én forespørgsel ad gangen med pause imellem.
//
// Kør: node avis/hent-aabendagsorden.mjs            (alle aktive)
//      node avis/hent-aabendagsorden.mjs glostrup   (kun én)
// Miljø: DAGE (hvor langt tilbage, standard 75), PAUSE_MS (standard 1500)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";
const PAUSE_MS = Number(process.env.PAUSE_MS || 1500);
const DAGE = Number(process.env.DAGE || 75);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const datoTekst = (iso) => `${+iso.slice(8)}. ${MDR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

async function hent(url, forsoeg = 0) {
  await sleep(PAUSE_MS);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "da" } });
  if (!res.ok) {
    if (res.status >= 500 && forsoeg < 2) { await sleep(5000); return hent(url, forsoeg + 1); }
    throw new Error(`${res.status} ${url}`);
  }
  return res.text();
}

// ---------- HTML → tekst ----------
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å", eacute: "é", ndash: "–", mdash: "—", hellip: "…", bull: "•", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", shy: "" };
const afkod = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
export function tilTekst(html) {
  return afkod(html
    .replace(/<(script|style|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|ul|ol|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Udvalgsnavnet uden forkortelse og valgperiode: "Økonomiudvalget (ØK) (26-29)" → "Økonomiudvalget"
const renUdvalg = (u) => u.replace(/\s*\(\d{2}-\d{2}\)\s*$/, "").replace(/\s*\([A-ZÆØÅ]{1,6}\)\s*$/, "").trim();
const norm = (u) => renUdvalg(u).toLowerCase().replace(/\s+/g, " ");

// ---------- Ét møde ----------
// Hvert punkt er en <h3 class="agenda-item-title">Punkt 4 Titel</h3> fulgt af afsnit med en <h4>-overskrift
// (Sagsfremstilling, Indstilling, Resumé, Beslutning i … den dd-mm-åååå, Bilag).
export function parseMoede(html, udvalg, dato) {
  const dele = html.split(/<h3 class="agenda-item-title">/).slice(1);
  const punkter = [];
  for (const del of dele) {
    const t = tilTekst(del.slice(0, del.indexOf("</h3>"))).replace(/\s+/g, " ");
    const m = t.match(/^Punkt (\d+)\.?\s*(.*)$/);
    if (!m) continue;
    const afsnit = [], bilag = [];
    let resume = null;
    for (const blok of del.split(/<h4[^>]*>/).slice(1)) {
      const slut = blok.indexOf("</h4>");
      const overskrift = tilTekst(blok.slice(0, slut)).replace(/\s+/g, " ");
      const krop = blok.slice(slut + 5);
      if (/^Bilag$/i.test(overskrift)) {
        for (const a of krop.matchAll(/<a[^>]+href="([^"]*\/meeting\/attachment\/\d+)"[^>]*>\s*<span>([\s\S]*?)<\/span>/g)) bilag.push({ navn: tilTekst(a[2]), url: a[1] });
        continue;
      }
      // "fraværende:" står med lille f under beslutningen
      const tekst = tilTekst(krop).replace(/^fraværende:/im, "Fraværende:");
      if (!tekst) continue;
      // Beslutningen fra dette møde hedder "Beslutning"; tidligere udvalgs beslutninger bliver "Behandling i …"
      const b = overskrift.match(/^Beslutning(?:er)?(?: i (.+?))?(?: den (\d{2})-(\d{2})-(\d{4}))?$/i);
      let titel = overskrift;
      if (b) {
        const egen = !b[1] || norm(b[1]) === norm(udvalg) || norm(udvalg).startsWith(norm(b[1])) || norm(b[1]).startsWith(norm(udvalg));
        titel = egen ? "Beslutning" : `Behandling i ${renUdvalg(b[1])}${b[4] ? " " + datoTekst(`${b[4]}-${b[3]}-${b[2]}`) : ""}`;
      } else if (/^Resum[eé]$/i.test(overskrift)) { resume = { titel: "Resumé", tekst }; continue; }
      afsnit.push({ titel, tekst });
    }
    // Resuméet står i en sidekolonne i portalen; i Sagsvagts format står det først, ligesom i FirstAgendas PDF'er
    if (resume) afsnit.unshift(resume);
    punkter.push({ nr: +m[1], titel: m[2].trim(), afsnit, bilag });
  }
  return punkter;
}

// ---------- Én kommune ----------
async function hentKommune(k) {
  const DATA = join(ROD, "data", `${k.slug}.json`);
  const gemt = await readFile(DATA, "utf8").then(JSON.parse).catch(() => ({ dokumenter: {}, sager: {} }));
  const fra = new Date(Date.now() - DAGE * 864e5);
  const fraTekst = `${String(fra.getUTCDate()).padStart(2, "0")}/${String(fra.getUTCMonth() + 1).padStart(2, "0")}/${fra.getUTCFullYear()}`;
  const idag = new Date().toISOString().slice(0, 10);
  const enUge = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  const liste = JSON.parse(await hent(`${k.base}/rest/meeting/search?query=&fromDate=${encodeURIComponent(fraTekst)}`)).meetings || [];
  const moeder = liste.filter((m) => !m.blocked && /^(Dagsorden|Referat)$/i.test(m.status));
  // Portalen har ingen ændringsdato. Et møde hentes igen, når status eller punktlisten har ændret sig,
  // og møder fra den seneste uge hentes igen hver gang (kommunen retter ofte i dem lige efter mødet).
  const noegle = (m) => `${m.status}|${(m.agendaItems || []).join("|")}`;
  const nye = moeder.filter((m) => {
    const d = gemt.dokumenter[m.meetingId];
    return !d || d.noegle !== noegle(m) || m.date.slice(0, 10) >= enUge;
  });
  console.log(`${k.kommune}: ${moeder.length} møder siden ${fra.toISOString().slice(0, 10)}, ${nye.length} nye, ændrede eller fra den seneste uge`);

  let antal = 0;
  for (const m of nye) {
    const id = m.meetingId, dato = m.date.slice(0, 10), udvalg = renUdvalg(m.committeeGroupName || m.committeeName);
    const type = /referat/i.test(m.status) ? "referat" : "dagsorden";
    const kilde = `${k.base}/meeting/${id}`;
    try {
      const punkter = parseMoede(await hent(`${k.base}/fragments/meeting/${id}/view`), udvalg, dato);
      // Mødets gamle punkter fjernes først, så et punkt, der har skiftet nummer, ikke bliver hængende
      for (const [sid, s] of Object.entries(gemt.sager)) if (s.kilde === kilde) delete gemt.sager[sid];
      gemt.dokumenter[id] = { noegle: noegle(m), type, udvalg, dato, punkter: punkter.length, hentet: idag };
      for (const p of punkter) {
        const sid = `${k.slug}-${dato}-${slug(udvalg)}-${p.nr}`;
        gemt.sager[sid] = {
          id: sid, kommune: k.kommune, udvalg, dato, type, nr: p.nr, kilde, hentet: new Date().toISOString(),
          titel: p.titel, afsnit: p.afsnit, bilag: p.bilag.map((b) => ({ navn: b.navn, url: new URL(b.url, k.base).href })),
        };
        antal++;
      }
      console.log(`  ${dato} ${udvalg} (${type}): ${punkter.length} punkter`);
    } catch (e) {
      console.warn(`  Sprang over ${id}: ${e.message}`);
    }
  }
  gemt.opdateret = new Date().toISOString();
  gemt.kommune = k.kommune;
  await mkdir(join(ROD, "data"), { recursive: true });
  await writeFile(DATA, JSON.stringify(gemt, null, 1));
  console.log(`${k.kommune}: ${antal} punkter gemt, ${Object.keys(gemt.sager).length} i alt`);
}

if (process.argv[1]?.endsWith("hent-aabendagsorden.mjs")) {
  const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "firstagenda.json"), "utf8"))
    .filter((k) => k.system === "aabendagsorden" && k.aktiv && (!process.argv[2] || k.slug === process.argv[2]));
  // Kommunerne ligger på hver sin server, så de hentes samtidig; hver server får én forespørgsel ad gangen
  await Promise.all(kommuner.map((k) => hentKommune(k).catch((e) => { console.error(`${k.kommune}: ${e.message}`); process.exitCode = 1; })));
}
