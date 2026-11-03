// Fælles for hentningerne, der læser møder som HTML (hent-aabendagsorden.mjs og hent-kommunesider.mjs):
// høflig hentning, HTML → tekst, afsnitsnavne i Sagsvagts format og lagring i data/<kommune>.json
// i samme format som hent-firstagenda.mjs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";
const PAUSE_MS = Number(process.env.PAUSE_MS || 1500);
export const DAGE = Number(process.env.DAGE || 75);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
export const datoTekst = (iso) => `${+iso.slice(8)}. ${MDR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
// "28. oktober 2026" → "2026-10-28"
export const isoDato = (d, m, y) => `${y}-${String(MDR.indexOf(m.toLowerCase()) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Én forespørgsel ad gangen pr. kommune med pause imellem; serverfejl prøves igen to gange. binaer: PDF som Buffer
export async function hent(url, { binaer = false, forsoeg = 0 } = {}) {
  await sleep(PAUSE_MS);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "da" } });
  if (!res.ok) {
    if (res.status >= 500 && forsoeg < 2) { await sleep(5000); return hent(url, { binaer, forsoeg: forsoeg + 1 }); }
    throw new Error(`${res.status} ${url}`);
  }
  return binaer ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// ---------- HTML → tekst ----------
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å", eacute: "é", ndash: "–", mdash: "—", hellip: "…", bull: "•", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", shy: "" };
export const afkod = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
export function tilTekst(html) {
  return afkod(html
    .replace(/\r/g, "")
    .replace(/<(script|style|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|ul|ol|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// Én linje (overskrifter og titler)
export const linje = (html) => tilTekst(html).replace(/\s+/g, " ").trim();

// Udvalgsnavnet uden forkortelse og valgperiode: "Økonomiudvalget (ØK) (26-29)" og "Kommunalbestyrelsen 2026-2029"
export const renUdvalg = (u) => u.replace(/\s*\(\d{2}-\d{2}\)\s*$/, "").replace(/\s*\(?\d{4}\s*[-–]\s*\d{4}\)?\s*$/, "").replace(/\s*\([A-ZÆØÅ]{1,6}\)\s*$/, "").trim();
const norm = (u) => renUdvalg(u).toLowerCase().replace(/\s+/g, " ");
export const sammeUdvalg = (a, b) => norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));

// Afsnitsnavne i Sagsvagts format: beslutningen fra dette møde ("Beslutning", "Åben beslutning") hedder "Beslutning", tidligere udvalgs beslutninger
// "Behandling i <udvalg> <dato>", og "Resume" staves "Resumé"
export function afsnitTitel(overskrift, udvalg) {
  const b = overskrift.match(/^(?:Åben )?[Bb]eslutning(?:er)?(?: i (.+?))?(?: den (\d{2})-(\d{2})-(\d{4}))?$/i);
  if (b) return !b[1] || sammeUdvalg(b[1], udvalg) ? "Beslutning" : `Behandling i ${renUdvalg(b[1])}${b[4] ? " " + datoTekst(`${b[4]}-${b[3]}-${b[2]}`) : ""}`;
  if (/^Resum[eé]$/i.test(overskrift)) return "Resumé";
  return overskrift;
}

// Afsnit og bilag fra en punkttekst, hvor hvert afsnit begynder med en overskrift (fx <h3> eller <h4>).
// Resuméet flyttes først, ligesom i FirstAgendas PDF'er.
export function afsnitFra(html, tag, udvalg, base) {
  const afsnit = [], bilag = [];
  for (const blok of html.split(new RegExp(`<${tag}[^>]*>`, "i")).slice(1)) {
    const slut = blok.search(new RegExp(`</${tag}>`, "i"));
    const overskrift = linje(blok.slice(0, slut));
    const krop = blok.slice(slut).replace(new RegExp(`^</${tag}>`, "i"), "");
    if (/^Bilag$/i.test(overskrift)) {
      for (const a of krop.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const navn = linje(a[2]);
        if (navn && !/^video/i.test(navn)) bilag.push({ navn, url: new URL(afkod(a[1]), base).href });
      }
      continue;
    }
    const tekst = tilTekst(krop).replace(/^fraværende:/im, "Fraværende:");
    if (overskrift && tekst) afsnit.push({ titel: afsnitTitel(overskrift, udvalg), tekst });
  }
  const r = afsnit.findIndex((a) => a.titel === "Resumé");
  if (r > 0) afsnit.unshift(...afsnit.splice(r, 1));
  return { afsnit, bilag };
}

// ---------- Lagring ----------
// moeder: [{ id, kilde, udvalg, dato, type, noegle }]. noegle ændrer sig, når mødet er ændret (fx dagsorden → referat).
// hentPunkter(m) giver [{ nr, titel, afsnit, bilag }] og evt. en type, der erstatter m.type.
// Et møde hentes, når nøglen er ny, og møder fra de seneste frisk dage (standard 7) hentes igen hver gang
// (kommunerne retter ofte i dem lige efter mødet, og nogle sider siger ikke, hvornår referatet er kommet).
export async function gemKommune(k, moeder, hentPunkter, { frisk = 7 } = {}) {
  const DATA = join(ROD, "data", `${k.slug}.json`);
  const gemt = await readFile(DATA, "utf8").then(JSON.parse).catch(() => ({ dokumenter: {}, sager: {} }));
  const idag = new Date().toISOString().slice(0, 10);
  const graense = new Date(Date.now() - frisk * 864e5).toISOString().slice(0, 10);
  const nye = moeder.filter((m) => gemt.dokumenter[m.id]?.noegle !== m.noegle || m.dato >= graense);
  console.log(`${k.kommune}: ${moeder.length} møder, ${nye.length} nye, ændrede eller fra den seneste uge`);
  let antal = 0;
  for (const m of nye) {
    try {
      const svar = await hentPunkter(m);
      const punkter = Array.isArray(svar) ? svar : svar.punkter;
      const type = (!Array.isArray(svar) && svar.type) || m.type;
      // Mødets gamle punkter fjernes først, så et punkt, der har skiftet nummer, ikke bliver hængende.
      // Adressen kan skifte, når dagsordenen bliver til et referat (Frederikssund), derfor også mødets id.
      for (const [sid, s] of Object.entries(gemt.sager)) if (s.kilde === m.kilde || (s.moede != null && s.moede === m.id)) delete gemt.sager[sid];
      gemt.dokumenter[m.id] = { noegle: m.noegle, type, udvalg: m.udvalg, dato: m.dato, punkter: punkter.length, hentet: idag };
      for (const p of punkter) {
        const sid = `${k.slug}-${m.dato}-${slug(m.udvalg)}-${p.nr}`;
        gemt.sager[sid] = {
          id: sid, kommune: k.kommune, udvalg: m.udvalg, dato: m.dato, type, nr: p.nr, kilde: m.kilde, moede: m.id,
          hentet: new Date().toISOString(), titel: p.titel, afsnit: p.afsnit, bilag: p.bilag,
        };
        antal++;
      }
      console.log(`  ${m.dato} ${m.udvalg} (${type}): ${punkter.length} punkter`);
    } catch (e) {
      console.warn(`  Sprang over ${m.kilde}: ${e.message}`);
    }
  }
  gemt.opdateret = new Date().toISOString();
  gemt.kommune = k.kommune;
  await mkdir(join(ROD, "data"), { recursive: true });
  await writeFile(DATA, JSON.stringify(gemt, null, 1));
  console.log(`${k.kommune}: ${antal} punkter gemt, ${Object.keys(gemt.sager).length} i alt`);
}

// Kommunerne fra avis/firstagenda.json med det givne system (evt. kun den, der er nævnt på kommandolinjen),
// hentet samtidig; hver server får stadig kun én forespørgsel ad gangen
export async function koerAlle(system, hentKommune) {
  const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "firstagenda.json"), "utf8"))
    .filter((k) => k.system === system && k.aktiv && (!process.argv[2] || k.slug === process.argv[2]));
  await Promise.all(kommuner.map((k) => hentKommune(k).catch((e) => { console.error(`${k.kommune}: ${e.message}`); process.exitCode = 1; })));
}
