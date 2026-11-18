// Nær dig: det, der sker omkring en adresse i København, til radaren under "Mine sager" i Min avis.
// Skriver assets/naerhed.json med tre slags punkter, hver med koordinater:
//   1. Byggesager: Klima-, Miljø- og Teknikudvalgets "Oversigt over naboorienteringer og lokalplandispensationer"
//      (bilag til næsten hvert møde, hentet via data/kk.json). Én post pr. sagsnummer med adresse, lokalplan, indhold og frist.
//   2. Høringer: alle høringer på Bliv Hørt (blivhoert.kk.dk/api/hearing, åbent JSON). Lokalplaner får et sted ud fra titlen.
//   3. Nyheder: TV2 Kosmopols RSS (København). Kun overskrift, medie, dato og link gemmes, ligesom i avis/medier.mjs, og
//      kun når artiklen nævner en gade eller et sted i København (avis/steder-kk.json).
// Adresser og steder slås op i OpenStreetMap (Nominatim) højst én gang i sekundet og huskes i data/geokode.json.
// PDF'erne læses med pdftotext (poppler-utils). Fejler en kilde, skrives de andre alligevel.
//   node avis/naerhed.mjs              (alt)
//   GEOKODE_MAKS=0 node avis/naerhed.mjs   (ingen nye opslag)
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ROD = join(import.meta.dirname, "..");
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";
const PDFTOTEXT = process.env.PDFTOTEXT || "pdftotext";
const GEOKODE_MAKS = Number(process.env.GEOKODE_MAKS ?? 250);
const IDAG = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const laesJson = async (f, std) => { try { return JSON.parse(await readFile(join(ROD, f), "utf8")); } catch { return std; } };
const dage = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const isoAf = (t) => { const m = (t || "").match(/(\d{1,2})\.\s*([a-zæøå]+)\s+(\d{4})/i); const i = m ? MDR.indexOf(m[2].toLowerCase()) : -1; return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
const dmy = (t) => t.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
const kort = (t, n = 300) => { t = (t || "").replace(/\s+/g, " ").trim(); if (t.length <= n) return t; const s = t.slice(0, n); const p = s.lastIndexOf(". "); return (p > n * 0.5 ? s.slice(0, p + 1) : s.replace(/\s+\S*$/, "") + " …"); };

async function hent(url, som = "text") {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "da" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return som === "json" ? res.json() : som === "buffer" ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// ---------- Geokodning (OpenStreetMap Nominatim, inden for København og Frederiksberg) ----------
const GEO_FIL = "data/geokode.json";
const GEO = await laesJson(GEO_FIL, {});
let opslag = 0;
const KK_BOKS = "12.40,55.74,12.70,55.60"; // vest, nord, øst, syd
export async function geokod(q) {
  const k = q.toLowerCase();
  if (k in GEO) return GEO[k];
  if (opslag >= GEOKODE_MAKS) return undefined; // prøves igen næste gang
  opslag++;
  await sleep(1100);
  try {
    const l = await hent(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=dk&limit=1&bounded=1&viewbox=${KK_BOKS}&q=${encodeURIComponent(q + ", København")}`, "json");
    GEO[k] = l[0] ? { lat: +(+l[0].lat).toFixed(5), lon: +(+l[0].lon).toFixed(5) } : null;
  } catch (e) { console.warn("Geokodning:", e.message); return undefined; }
  return GEO[k];
}
// Adresser som "Refshalevej 159U-Z og 161A-Y", "Parken på Per Henrik Lings Allé 2", "Hf. Birkevang 4": prøv fra det mest præcise
export async function findSted(adresse) {
  const foerste = adresse.split(/\s+og\s+|,\s*|\s+\/\s+/)[0].trim();
  const fors = [
    foerste.replace(/(\d+)[A-ZÆØÅ]?\s*-\s*\d*[A-ZÆØÅ]?\b/i, "$1"),
    /\s+på\s+/.test(foerste) ? foerste.split(/\s+på\s+/).pop() : null,
    foerste.replace(/^Hf\.?\s+/i, "Haveforeningen "),
    foerste.replace(/\s+\d.*$/, ""),
  ].filter((x, i, a) => x && x.length > 2 && a.indexOf(x) === i);
  for (const q of fors) { const g = await geokod(q); if (g) return { ...g, praecis: q === fors[0] && /\d/.test(q) }; if (g === undefined) return undefined; }
  return null;
}

// ---------- 1. Byggesager fra udvalgets oversigter ----------
const SEKTIONER = [[/^Nye naboorienteringer$/i, "naboorientering"], [/^Naboorienteringer under sagsbehandling$/i, "behandles"], [/^Meddelte lokalplandispensationer$/i, "dispensation"]];
export function parseOversigt(tekst) {
  const linjer = tekst.replace(/\f/g, "\n").split("\n");
  const ud = []; let sektion = null, cur = null;
  const luk = () => { if (cur) ud.push(cur); cur = null; };
  for (const raa of linjer) {
    const t = raa.trim();
    const sek = SEKTIONER.find(([rx]) => rx.test(t));
    if (sek) { luk(); sektion = sek[1]; continue; }
    if (/^\d+\/\d+$/.test(t)) continue; // sidetal
    const hoved = raa.match(/^(.{0,26}?)\s{2,}(\S.*?)\s+\((S\d{4}-\d+)\)\s*$/);
    if (hoved && sektion) { luk(); cur = { sektion, adresse: hoved[2].trim(), sagsnr: hoved[3], venstre: [hoved[1].trim()], hoejre: [] }; continue; }
    if (!cur) continue;
    const m = raa.match(/^(\S.*?)\s{2,}(\S.*)$/);
    if (m && m[1].length <= 26) { cur.venstre.push(m[1].trim()); cur.hoejre.push(m[2].trim()); }
    else if (/^\s{8,}\S/.test(raa)) cur.hoejre.push(t);
    else if (t && t.length <= 26) cur.venstre.push(t);
    else cur.hoejre.push(t);
  }
  luk();
  return ud.map((c) => {
    // Orddeling over linjeskift samles ("Tilladel-" + "sen"), afsnit bevares
    const krop = c.hoejre.join("\n").replace(/([a-zæøå])-\n([a-zæøå])/g, "$1$2").replace(/\n(?!\n)/g, " ").replace(/ {2,}/g, " ");
    const venstre = c.venstre.join(" ").replace(/-\s+/g, "-");
    const datoer = [...venstre.matchAll(/(\d{2}-\d{2}-\d{4})/g)].map((m) => dmy(m[1]));
    const indhold = (krop.match(/Dispensationens indhold\s*(.*?)(?=\s(?:En tilladelse forudsætter|Tilladelsen forudsætter|Forvaltningens vurdering|Status:|Klima-, Miljø- og Teknikudvalget vil)|$)/s) || [])[1];
    const status = (krop.match(/(Status:.*?\.|Forvaltningen har fortsat sagsbehandlingen.*?\.)(?=\s+[A-ZÆØÅ]|\s*$)/s) || [])[1];
    return {
      sagsnr: c.sagsnr, adresse: c.adresse.replace(/\s+/g, " "), sektion: c.sektion,
      lokalplan: ((krop.match(/Lokalplan(?:er)?:\s*(.+?)(?=\s+(?:Frist:|Dispensationens indhold|Forvaltningen|Status:)|\s*$)/s) || [])[1] || "").replace(/[’'”"]/g, "'").replace(/\s*'\.?$/, "'").trim(),
      indhold: kort(indhold, 320),
      frist: isoAf((krop.match(/Frist:\s*([^-–]+?\d{4})/) || [])[1]),
      periode: c.sektion === "dispensation" ? null : datoer.slice(0, 2),
      dispensationsdato: c.sektion === "dispensation" ? datoer[0] || null : null,
      hoeringssvar: +((venstre.match(/(\d+)\s*høringssvar/) || [])[1] || 0) || null,
      status: status ? status.replace(/^Status:\s*/, "") : null,
    };
  });
}

async function pdfTekst(url) {
  const fil = join(tmpdir(), `naerhed-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(fil, await hent(url, "buffer"));
  try { const { stdout } = await promisify(execFile)(PDFTOTEXT, ["-layout", fil, "-"], { maxBuffer: 64 * 1024 * 1024 }); return stdout; }
  finally { await rm(fil, { force: true }); }
}

async function byggesager() {
  const BS_FIL = "data/byggesager.json";
  const db = await laesJson(BS_FIL, { pdfer: {}, sager: {} });
  const kk = await laesJson("data/kk.json", { sager: {} });
  const oversigter = [];
  for (const s of Object.values(kk.sager)) for (const b of s.bilag || [])
    if (/oversigt over naboorienteringer/i.test(b.navn || "") && b.url && /^https:\/\/www\.kk\.dk\/.+\.pdf$/i.test(b.url)) oversigter.push({ dato: s.dato, url: b.url, sag: s.id });
  oversigter.sort((a, b) => a.dato.localeCompare(b.dato));
  let nye = 0;
  for (const o of oversigter) {
    if (db.pdfer[o.url]) continue;
    try {
      await sleep(800);
      const sager = parseOversigt(await pdfTekst(o.url));
      for (const x of sager) {
        const f = db.sager[x.sagsnr];
        // Senere oversigter vinder (status ændrer sig), men felter, der mangler i den nye, beholdes
        const ny = { ...(f || {}), ...Object.fromEntries(Object.entries(x).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))) };
        ny.foerst = f?.foerst && f.foerst < o.dato ? f.foerst : o.dato;
        if (!f || o.dato >= (f.senest || "")) { ny.senest = o.dato; ny.sektion = x.sektion; ny.kilde = o.url; ny.moede = o.sag; }
        db.sager[x.sagsnr] = ny;
      }
      db.pdfer[o.url] = { dato: o.dato, sager: sager.length };
      nye++;
      console.log(`Byggesager: ${o.dato} ${sager.length} sager`);
    } catch (e) { console.warn("Byggesager:", o.url, e.message); }
  }
  for (const x of Object.values(db.sager)) if (!x.sted || x.sted === "ukendt") {
    const g = await findSted(x.adresse);
    if (g !== undefined) x.sted = g || "ukendt";
  }
  await writeFile(join(ROD, BS_FIL), JSON.stringify(db, null, 1));
  console.log(`Byggesager: ${nye} nye oversigter, ${Object.keys(db.sager).length} sager i alt`);
  const STATUS = { naboorientering: "I naboorientering", behandles: "Under sagsbehandling", dispensation: "Dispensation givet" };
  return Object.entries(db.sager)
    .filter(([, x]) => x.sted && x.sted !== "ukendt" && dage(x.senest, IDAG) <= 365)
    .map(([nr, x]) => ({
      id: nr, adresse: x.adresse, lat: x.sted.lat, lon: x.sted.lon, praecis: !!x.sted.praecis,
      status: x.sektion === "naboorientering" && x.frist && x.frist < IDAG ? STATUS.behandles : STATUS[x.sektion],
      lokalplan: x.lokalplan || null, indhold: x.indhold || null, frist: x.frist || null,
      dato: x.dispensationsdato || x.periode?.[0] || x.foerst, hoeringssvar: x.hoeringssvar || null, kilde: x.kilde,
    }))
    .sort((a, b) => b.dato.localeCompare(a.dato));
}

// ---------- 2. Høringer fra Bliv Hørt ----------
// "Tillæg 4 til Ny Ellebjerg-området – forslag til lokalplan" → "Ny Ellebjerg", "Lokalplan Middelgrundsvej 3 - Forslag til lokalplan" → "Middelgrundsvej 3"
export const stedIHoering = (titel) => titel.replace(/\s+[-–]\s+.*$/, "").replace(/["“”'’]/g, "").replace(/^revideret\s+/i, "").replace(/\s+m\.?\s?m\.?$/i, "")
  .replace(/^(forslag til\s+)?(tillæg\s+(nr\.?\s*)?\d+\s+(til\s+)?)?(forslag til\s+)?(lokalplan(en)?|lp|kommuneplantillæg)?\s*(nr\.?\s*)?(\d+\s+)?/i, "")
  .replace(/\s+(fornyet|supplerende)\s+høring.*$/i, "").replace(/-?området$/i, "").replace(/\s+(II|III|IV|nord|syd|øst|vest)$/i, "").trim();
async function hoeringer() {
  const d = await hent("https://blivhoert.kk.dk/api/hearing?include=Contents,Contents.ContentType&PageIndex=1&PageSize=500", "json");
  const inc = new Map((d.included || []).map((i) => [`${i.type}|${i.id}`, i]));
  const by = new Map((await hent("https://blivhoert.kk.dk/api/cityArea", "json")).data.map((c) => [c.id, c.attributes.name]));
  const typer = new Map((d.included || []).filter((i) => i.type === "hearingType").map((i) => [i.id, i.attributes.name]));
  const ud = [];
  for (const h of d.data) {
    const a = h.attributes, rel = h.relationships;
    const status = rel.hearingStatus?.data?.id; // 3 kommende, 4 aktiv, 5 afventer konklusion, 6 konkluderet
    if (!a.deadline || dage(a.deadline.slice(0, 10), IDAG) > 120) continue;
    const felt = (id) => (rel.contents?.data || []).map((c) => inc.get(`content|${c.id}`)).find((x) => x?.relationships?.field?.data?.id === id && x.attributes.textContent)?.attributes.textContent || "";
    const titel = felt("1").replace(/\s+/g, " ").trim();
    if (!titel) continue;
    const type = typer.get(rel.hearingType?.data?.id) || "";
    const bydel = by.get(rel.cityArea?.data?.id) || null;
    // Lokalplaner har stedet i titlen; andre høringer får et sted, hvis titlen eller resuméet nævner en gade eller et sted
    let sted = null;
    if (/lokalplan|kommuneplantillæg|\blp\b/i.test(`${type} ${titel}`)) {
      const navn = stedIHoering(titel);
      if (navn.length > 2) { const g = await findSted(navn); if (g) sted = g; }
    }
    if (!sted && bydel !== "Hele byen") {
      const navn = findStedINyhed(`${titel}. ${felt("4")}`, await stedNavne());
      if (navn) { const g = await geokod(navn); if (g) sted = g; }
    }
    ud.push({
      id: h.id, titel, resume: kort(felt("4"), 240), type, bydel,
      start: a.startDate?.slice(0, 10) || null, frist: a.deadline.slice(0, 10), aaben: status === "3" || status === "4",
      svar: a.commentAmount || 0, url: `https://blivhoert.kk.dk/hearing/${h.id}`, ...(sted ? { lat: sted.lat, lon: sted.lon } : {}),
    });
  }
  console.log(`Høringer: ${ud.length} (${ud.filter((x) => x.lat).length} med sted, ${ud.filter((x) => x.aaben).length} åbne)`);
  return ud.sort((a, b) => b.frist.localeCompare(a.frist));
}

// ---------- 3. Lokale nyheder (TV2 Kosmopol) ----------
const STOP = new Set(["københavn", "danmark", "frederiksberg", "sjælland", "amager", "valby", "vanløse", "nørrebro", "østerbro", "vesterbro", "indre by", "christianshavn", "bispebjerg", "brønshøj", "husum", "sydhavn", "nordhavn", "ørestad", "hovedstaden", "rådhuset", "byretten"]);
export function findStedINyhed(tekst, navne) {
  const t = ` ${tekst.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")} `;
  let bedst = null;
  for (const n of navne) {
    if (n.length < 6 || STOP.has(n.toLowerCase()) || !/^[A-ZÆØÅ]/.test(n)) continue;
    const i = t.indexOf(n);
    if (i < 0 || /[\p{L}\p{N}]/u.test(t[i - 1]) || /[\p{L}\p{N}]/u.test(t[i + n.length]) && !/^s\b/.test(t.slice(i + n.length))) continue;
    if (!bedst || n.length > bedst.length) bedst = n;
  }
  return bedst;
}
let NAVNE;
const stedNavne = async () => (NAVNE ||= (await laesJson("avis/steder-kk.json", { navne: [] })).navne || []);
async function nyheder() {
  const NY_FIL = "data/nyheder-kk.json";
  const db = await laesJson(NY_FIL, { artikler: {} });
  const navne = await stedNavne();
  const xml = await hent("https://www.tv2kosmopol.dk/rss");
  const tag = (it, n) => ((it.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const link = tag(it, "link"), titel = tag(it, "title");
    if (!link || db.artikler[link] || !/\/(koebenhavn|frederiksberg)\//.test(link)) continue;
    const navn = findStedINyhed(`${titel} ${tag(it, "description")}`, navne);
    const dato = new Date(tag(it, "pubDate"));
    db.artikler[link] = { medie: "TV2 Kosmopol", titel, dato: isNaN(dato) ? IDAG : dato.toISOString().slice(0, 10), sted: navn || null };
  }
  for (const [link, a] of Object.entries(db.artikler)) {
    if (dage(a.dato, IDAG) > 120) { delete db.artikler[link]; continue; }
    if (a.sted && a.lat == null && a.ingenSted !== true) { const g = await geokod(a.sted); if (g) { a.lat = g.lat; a.lon = g.lon; } else if (g === null) a.ingenSted = true; }
  }
  await writeFile(join(ROD, NY_FIL), JSON.stringify(db, null, 1));
  const ud = Object.entries(db.artikler).filter(([, a]) => a.lat != null).map(([url, a]) => ({ titel: a.titel, url, medie: a.medie, dato: a.dato, sted: a.sted, lat: a.lat, lon: a.lon }));
  console.log(`Nyheder: ${Object.keys(db.artikler).length} gemt, ${ud.length} med sted`);
  return ud.sort((a, b) => b.dato.localeCompare(a.dato));
}

// ---------- Kør ----------
async function main() {
  const gammel = await laesJson("assets/naerhed.json", {});
  const proev = async (navn, f) => { try { return await f(); } catch (e) { console.warn(`${navn} fejlede:`, e.message); return gammel[navn] || []; } };
  const ud = { opdateret: new Date().toISOString(), byggesager: await proev("byggesager", byggesager), hoeringer: await proev("hoeringer", hoeringer), nyheder: await proev("nyheder", nyheder) };
  await writeFile(join(ROD, GEO_FIL), JSON.stringify(GEO, null, 1));
  await mkdir(join(ROD, "assets"), { recursive: true });
  await writeFile(join(ROD, "assets", "naerhed.json"), JSON.stringify(ud));
  console.log(`assets/naerhed.json: ${ud.byggesager.length} byggesager, ${ud.hoeringer.length} høringer, ${ud.nyheder.length} nyheder (${opslag} nye stedopslag)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
