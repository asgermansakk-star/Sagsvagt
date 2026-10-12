// Henter dagsordener og referater fra kommuner, der bruger FirstAgenda Publication (dagsordener.<kommune>.dk),
// og gemmer hvert dagsordenspunkt i data/<kommune>.json i samme format som data/kk.json.
//
// Vi holder os til det, robots.txt tillader: sitemappet (/sitemap.xml og /Sitemap/ForCommittee) og PDF'en for
// hele mødet (/pdf/GetDagsorden/<id>). FirstAgendas JSON-API (/api) er frabedt for robotter og bruges IKKE.
// Teksten læses ud af PDF'en med pdftotext (poppler-utils). Én forespørgsel ad gangen med pause imellem.
//
// Kør: node avis/hent-firstagenda.mjs            (alle aktive kommuner i avis/firstagenda.json)
//      node avis/hent-firstagenda.mjs viborg     (kun én)
// Miljø: DAGE (hvor langt tilbage første gang, standard 75), PAUSE_MS (standard 1500), PDFTOTEXT (sti til programmet)
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ROD = join(import.meta.dirname, "..");
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";
const PAUSE_MS = Number(process.env.PAUSE_MS || 1500);
const DAGE = Number(process.env.DAGE || 75);
const PDFTOTEXT = process.env.PDFTOTEXT || "pdftotext";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- Hentning med anonym cookie ----------
// FirstAgenda sender første besøg via /Home/AnonymousAuthentication, som sætter en anonym cookie (ikke et login).
export function klient(base) {
  const cookies = new Map();
  async function hent(sti, { binaer = false, forsoeg = 0 } = {}) {
    let url = new URL(sti, base).href;
    for (let hop = 0; hop < 8; hop++) {
      await sleep(PAUSE_MS);
      const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "da", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
      for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).href; continue; }
      if (!res.ok) {
        if (res.status >= 500 && forsoeg < 2) { await sleep(5000); return hent(sti, { binaer, forsoeg: forsoeg + 1 }); }
        throw new Error(`${res.status} ${url}`);
      }
      return binaer ? Buffer.from(await res.arrayBuffer()) : res.text();
    }
    throw new Error(`For mange omdirigeringer: ${url}`);
  }
  return hent;
}

// ---------- PDF → tekst → punkter ----------
export async function pdfTilTekst(buf) {
  const fil = join(tmpdir(), `sagsvagt-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(fil, buf);
  try { return (await promisify(execFile)(PDFTOTEXT, ["-enc", "UTF-8", "-nopgbrk", fil, "-"], { maxBuffer: 64 * 1024 * 1024 })).stdout; }
  finally { await rm(fil, { force: true }); }
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const udenPeriode = (u) => u.replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*$/, "").trim();
const norm = (u) => udenPeriode(u).toUpperCase().replace(/\s+/g, " ");
const dato = (d, m, y) => `${y}-${m}-${d}`;
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const datoTekst = (iso) => `${+iso.slice(8)}. ${MDR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

// Tabeller bliver til linjer med tal; dem springer vi over i den løbende tekst
const tabellinje = (l) => { const b = (l.match(/[a-zæøåA-ZÆØÅ]/g) || []).length; return l.trim().length > 0 && b / l.trim().length < 0.35; };
const renTekst = (t) => t.split("\n").filter((l) => !tabellinje(l)).join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function parsePdf(tekst, kendteUdvalg = new Map()) {
  const t = tekst.replace(/\r/g, "").replace(/\f/g, "\n");
  // Datoen kan mangle en bindestreg ("2210-2026", "17-092026"), så de er valgfrie
  const hoved = t.match(/^\s*(DAGSORDEN|REFERAT)\s+(.+?)\s+d\.\s*(\d{2})-?(\d{2})-?(\d{4})/m);
  if (!hoved) throw new Error("Kan ikke læse mødets overskrift");
  const type = hoved[1] === "REFERAT" ? "referat" : "dagsorden";
  const udvalg = udenPeriode(hoved[2]);
  const moededato = dato(hoved[3], hoved[4], hoved[5]);
  kendteUdvalg.set(norm(udvalg), udvalg);

  // Indholdsfortegnelsen: "Titel.......... 3 Titel........ 9" (kan stå på én eller flere linjer)
  const iIndhold = t.indexOf("Indholdsfortegnelse");
  if (iIndhold < 0) throw new Error("Ingen indholdsfortegnelse");
  const reIndhold = /(\S[^\n]*?)\s*\.{4,}\s*(\d+)\s*/gy;
  reIndhold.lastIndex = iIndhold + "Indholdsfortegnelse".length;
  while (/\s/.test(t[reIndhold.lastIndex])) reIndhold.lastIndex++;
  const titler = []; let m;
  while ((m = reIndhold.exec(t))) titler.push(m[1].trim());
  let markoer = reIndhold.lastIndex;

  // Find hvert punkt i rækkefølge; lange titler kan være brudt over flere linjer i selve teksten
  const fund = [];
  for (const titel of titler) {
    const re = new RegExp(`(^|\\n)${titel.split(/\s+/).map(reEsc).join("\\s+")}\\s*\\n`, "g");
    re.lastIndex = markoer;
    const f = re.exec(t);
    if (!f) continue;
    fund.push({ titel, idx: f.index, start: f.index + f[0].length });
    markoer = f.index + f[0].length;
  }

  const MARK = /(RESUME|INDSTILLING|SAGSFREMSTILLING|BESLUTNING I (.+?) DEN (\d{2})-(\d{2})-(\d{4})|(?<=^|\n)Sagsfremstilling(?=\s)|(?<=\n)Bilag(?=\n))/g;
  const punkter = [];
  fund.forEach((p, i) => {
    if (/^(Lukket\b|Underskriftsark)/i.test(p.titel)) return;
    const krop = t.slice(p.start, i + 1 < fund.length ? fund[i + 1].idx : t.length);
    const dele = [...krop.matchAll(MARK)];
    const afsnit = [];
    dele.forEach((d, j) => {
      const tekst = renTekst(krop.slice(d.index + d[0].length, j + 1 < dele.length ? dele[j + 1].index : krop.length));
      if (!tekst) return;
      if (d[2]) {
        // Beslutninger: dette møde → "Beslutning"; tidligere udvalg → "Behandling i …" (ikke ordet beslutning,
        // så avisen ikke forveksler dem med mødets egen afgørelse)
        const navn = kendteUdvalg.get(norm(d[2])) || udenPeriode(d[2]).charAt(0) + udenPeriode(d[2]).slice(1).toLowerCase();
        const dd = dato(d[3], d[4], d[5]);
        if (norm(d[2]) === norm(udvalg)) afsnit.push({ titel: "Beslutning", tekst });
        else afsnit.push({ titel: `Behandling i ${navn} ${datoTekst(dd)}`, tekst });
      } else {
        const navn = { RESUME: "Resumé", INDSTILLING: "Indstilling", SAGSFREMSTILLING: "Sagsfremstilling", Sagsfremstilling: "Sagsfremstilling", Bilag: "Bilag" }[d[1]];
        afsnit.push({ titel: navn, tekst });
      }
    });
    if (!dele.length && renTekst(krop)) afsnit.push({ titel: "Sagsfremstilling", tekst: renTekst(krop) });
    const bilagAfsnit = afsnit.find((a) => a.titel === "Bilag");
    punkter.push({
      nr: i + 1, titel: p.titel.replace(/\s+/g, " "),
      afsnit: afsnit.filter((a) => a !== bilagAfsnit),
      bilag: bilagAfsnit ? bilagAfsnit.tekst.split("\n").map((l) => l.trim()).filter(Boolean).map((navn) => ({ navn, url: null })) : [],
    });
  });
  return { type, udvalg, dato: moededato, punkter };
}

// ---------- Én kommune ----------
async function hentKommune(k) {
  const DATA = join(ROD, "data", `${k.slug}.json`);
  const gemt = await readFile(DATA, "utf8").then(JSON.parse).catch(() => ({ dokumenter: {}, sager: {} }));
  const hent = klient(k.base);
  const fra = new Date(Date.now() - DAGE * 864e5).toISOString().slice(0, 10);

  // Sitemap: et indeks med ét sitemap pr. udvalg; hvert møde står som /vis?id=<id> med lastmod (udgivelsesdato)
  const indeks = await hent("/sitemap.xml");
  const udvalgSitemaps = [...indeks.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1].replace(/&amp;/g, "&"));
  // Gamle udvalg (fx fra tidligere valgperioder) har ingen møder det seneste år; dem tjekker vi kun én gang om måneden
  const idag = new Date().toISOString().slice(0, 10);
  const etAar = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), enMaaned = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  gemt.sitemaps ||= {};
  const dok = new Map();
  for (const u of udvalgSitemaps) {
    const sm = gemt.sitemaps[u];
    if (sm && sm.senest < etAar && sm.tjekket > enMaaned) continue;
    const xml = await hent(u);
    let senest = "";
    for (const x of xml.matchAll(/<url>\s*<loc>[^<]*\/vis\?id=([0-9a-f-]{36})<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/gi)) {
      const lm = x[2].slice(0, 10);
      if (lm > senest) senest = lm;
      if (lm >= fra) dok.set(x[1], lm);
    }
    gemt.sitemaps[u] = { senest, tjekket: idag };
  }
  const nye = [...dok].filter(([id, lastmod]) => gemt.dokumenter[id]?.lastmod !== lastmod);
  console.log(`${k.kommune}: ${udvalgSitemaps.length} udvalg, ${dok.size} møder siden ${fra}, ${nye.length} nye eller ændrede`);

  const kendte = new Map(Object.values(gemt.dokumenter).filter((d) => d.udvalg).map((d) => [norm(d.udvalg), d.udvalg]));
  let antal = 0;
  for (const [id, lastmod] of nye) {
    try {
      const pdf = await hent(`/pdf/GetDagsorden/${id}`, { binaer: true });
      const m = parsePdf(await pdfTilTekst(pdf), kendte);
      gemt.dokumenter[id] = { lastmod, type: m.type, udvalg: m.udvalg, dato: m.dato, punkter: m.punkter.length };
      for (const p of m.punkter) {
        const sid = `${k.slug}-${m.dato}-${slug(m.udvalg)}-${p.nr}`;
        // Et referat erstatter dagsordenen for samme punkt, men aldrig omvendt
        if (gemt.sager[sid]?.type === "referat" && m.type === "dagsorden") continue;
        gemt.sager[sid] = {
          id: sid, kommune: k.kommune, udvalg: m.udvalg, dato: m.dato, type: m.type, nr: p.nr,
          kilde: `${k.base}/vis?id=${id}`, hentet: new Date().toISOString(), titel: p.titel, afsnit: p.afsnit, bilag: p.bilag,
        };
        antal++;
      }
      console.log(`  ${m.dato} ${m.udvalg} (${m.type}): ${m.punkter.length} punkter`);
    } catch (e) {
      console.warn(`  Sprang over ${id}: ${e.message}`);
    }
  }
  // Udvalgsnavne i "Behandling i …" står med versaler i PDF'en; brug stavningen fra udvalgets egne møder, når vi kender den
  for (const s of Object.values(gemt.sager)) for (const a of s.afsnit) {
    const b = a.titel.match(/^Behandling i (.+?) (\d+\. \S+ \d{4})$/);
    if (b && kendte.has(norm(b[1]))) a.titel = `Behandling i ${kendte.get(norm(b[1]))} ${b[2]}`;
  }
  gemt.opdateret = new Date().toISOString();
  gemt.kommune = k.kommune;
  await mkdir(join(ROD, "data"), { recursive: true });
  await writeFile(DATA, JSON.stringify(gemt, null, 1));
  console.log(`${k.kommune}: ${antal} punkter gemt, ${Object.keys(gemt.sager).length} i alt`);
}

// Køres som script (ikke når parsePdf importeres i en test)
if (process.argv[1]?.endsWith("hent-firstagenda.mjs")) {
  const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "firstagenda.json"), "utf8"))
    .filter((k) => k.aktiv && (!process.argv[2] || k.slug === process.argv[2]));
  for (const k of kommuner) {
    try { await hentKommune(k); } catch (e) { console.error(`${k.kommune}: ${e.message}`); process.exitCode = 1; }
  }
}
