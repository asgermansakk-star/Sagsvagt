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
// Valgperioden står forskelligt: "(2026-2029)", "2026-2029", "2026 - 2029" eller "2026 2029"
const udenPeriode = (u) => u.replace(/\s*\(?\d{4}\s*[-–]?\s*\d{4}\)?\s*$/, "").trim();
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
  // (Guldborgsund staver den "Innholdsfortegnelse")
  const mIndhold = t.match(/In[dn]holdsfortegnelse/);
  if (!mIndhold) throw new Error("Ingen indholdsfortegnelse");
  const reIndhold = /(\S[^\n]*?)\s*\.{4,}\s*(\d+)\s*/gy;
  reIndhold.lastIndex = mIndhold.index + mIndhold[0].length;
  while (/\s/.test(t[reIndhold.lastIndex])) reIndhold.lastIndex++;
  const titler = []; let m;
  while ((m = reIndhold.exec(t))) titler.push({ titel: m[1].trim(), side: +m[2] });
  let markoer = reIndhold.lastIndex;

  // Find hvert punkt i rækkefølge; lange titler kan være brudt over flere linjer i selve teksten.
  // Nogle kommuner skriver titlen med versaler og løbenummer foran ("188.ORIENTERINGSSAG: …")
  // En afkortet titel er kun begyndelsen af overskriften; så bruger vi hele linjen fra teksten som titel.
  // Et punktum sidst i titlen forsvinder i indholdsfortegnelsens prikker ("lejekontrakt......" for "lejekontrakt."),
  // og i teksten mister pdftotext nogle gange bindestregen mellem årstal ("20272029").
  const findTitel = (titel, fra, afkortet = false) => {
    const ord = titel.split(/\s+/).map(reEsc).join("\\s+").replace(/(\d)-(?=\d)/g, "$1-?");
    const re = new RegExp(`(^|\\n)(?:\\d+\\.[ \\t]*)?(${ord}${afkortet ? "[^\\n]*" : ""})\\.?[ \\t]*\\n`, "gi");
    re.lastIndex = fra;
    const f = re.exec(t);
    return f && { titel: afkortet ? f[2].trim() : titel, idx: f.index, start: f.index + f[0].length };
  };
  // En titel, der er for lang til linjen i indholdsfortegnelsen, afkortes uden prikker og flyder sammen med den næste:
  // "… i hørin 10 MNBU/ØU/KB - Næste titel...... 13". Findes det hele ikke, deler vi ved et sidetal mellem forrige og
  // denne titels side, hvis begge dele står i teksten.
  const findDele = (titel, fra, fraSide, tilSide) => {
    const f = findTitel(titel, fra);
    if (f) return [f];
    for (const d of titel.matchAll(/\s(\d{1,3})\s+/g)) {
      if (+d[1] < fraSide || +d[1] > tilSide) continue;
      const a = findTitel(titel.slice(0, d.index), fra, true);
      const b = a && findDele(titel.slice(d.index + d[0].length), a.start, +d[1], tilSide);
      if (b) return [a, ...b];
    }
    return null;
  };
  // null = titlen blev ikke fundet; så kender vi ikke slutningen på punktet før.
  // Lukkede punkter står kun i indholdsfortegnelsen, så dem tæller vi bare med i nummereringen.
  const fund = []; let side = 0, nr = 0;
  for (const { titel, side: s } of titler) {
    const f = findDele(titel, markoer, side, s);
    if (f) { for (const x of f) fund.push({ ...x, nr: ++nr }); markoer = f.at(-1).start; }
    else { nr++; if (!/^Lukket\b/i.test(titel)) fund.push(null); }
    side = s;
  }

  // Afsnitsoverskrifter: kommunerne bruger forskellige navne, med versaler midt i teksten ("RESUME Økonomi- og …")
  // eller som en linje for sig ("Sagsfremstilling"). Beslutninger: "BESLUTNING I <UDVALG> DEN|den dd-mm-åååå".
  const OVERSKRIFTER = ["SAMMENHÆNG TIL POLITISKE STRATEGIER", "PERSONALEMÆSSIGE KONSEKVENSER", "ØKONOMISKE KONSEKVENSER", "BESKRIVELSE AF SAGEN",
    "BESLUTNINGSKOMPETENCE", "TIDLIGERE BESLUTNING", "SAGSFREMSTILLING", "STRATEGISK RAMME", "SAGSBESKRIVELSE", "PROBLEMSTILLING", "BORGERPERSPEKTIV",
    "SAGENS FORLØB", "KOMMUNIKATION", "VIDERE PROCES", "SAGSRESUMÉ", "SAGSRESUME", "INDSTILLING", "LOVGRUNDLAG", "LØSNINGER", "BESLUTNING", "VURDERING",
    "HISTORIK", "SAGSGANG", "LØSNING", "ØKONOMI", "RESUMÉ", "RESUME", "BILAG"];
  const LINJE = ["Sagsfremstilling", "Sagsbeskrivelse", "Sagsresumé", "Problemstilling", "Videre proces", "Indstilling", "Beslutning", "Vurdering", "Økonomi", "Resumé", "Resume", "Bilag"];
  const MARK = new RegExp(`(BESLUTNING I (.+?) (?:DEN|den) (\\d{2})-?(\\d{2})-?(\\d{4})|(?<![A-ZÆØÅa-zæøå])(${OVERSKRIFTER.join("|")})(?![A-ZÆØÅa-zæøå])|(?<=^|\\n)(${LINJE.join("|")})(?=[ \\t]*\\n|\\s+[A-ZÆØÅ][a-zæøå]))`, "g");
  const NAVN = { RESUME: "Resumé", "RESUMÉ": "Resumé", SAGSRESUME: "Resumé", "SAGSRESUMÉ": "Resumé", Resume: "Resumé", "Sagsresumé": "Resumé",
    SAGSFREMSTILLING: "Sagsfremstilling", SAGSBESKRIVELSE: "Sagsfremstilling", "BESKRIVELSE AF SAGEN": "Sagsfremstilling", Sagsbeskrivelse: "Sagsfremstilling" };
  const afsnitNavn = (h) => NAVN[h] || h.charAt(0).toUpperCase() + h.slice(1).toLowerCase();
  const punkter = [];
  fund.forEach((p, i) => {
    if (!p || /^(Lukket\b|Underskriftsark)/i.test(p.titel)) return;
    // Uden næste punkts overskrift ville kroppen tage det næste punkts tekst med; så springer vi punktet over
    if (fund[i + 1] === null) return;
    const krop = t.slice(p.start, fund[i + 1]?.idx ?? t.length);
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
        // En overskrift, der står flere gange i samme punkt, lægges sammen
        const navn = afsnitNavn(d[6] || d[7]);
        const forrige = afsnit.find((a) => a.titel === navn);
        if (forrige) forrige.tekst += `\n\n${tekst}`; else afsnit.push({ titel: navn, tekst });
      }
    });
    if (!dele.length && renTekst(krop)) afsnit.push({ titel: "Sagsfremstilling", tekst: renTekst(krop) });
    const bilagAfsnit = afsnit.find((a) => a.titel === "Bilag");
    punkter.push({
      nr: p.nr, titel: p.titel.replace(/\s+/g, " "),
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
    // Et enkelt udvalgs sitemap kan give serverfejl; så springer vi det over og tager resten
    let xml;
    try { xml = await hent(u); } catch (e) { console.warn(`  Sitemap sprunget over (${e.message.slice(0, 60)})`); continue; }
    let senest = "";
    for (const x of xml.matchAll(/<url>\s*<loc>[^<]*\/vis\?id=([0-9a-f-]{36})<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/gi)) {
      const lm = x[2].slice(0, 10);
      if (lm > senest) senest = lm;
      if (lm >= fra) dok.set(x[1], lm);
    }
    gemt.sitemaps[u] = { senest, tjekket: idag };
  }
  // Nye eller ændrede møder, og møder der gav nul punkter: kommunen lægger nogle gange mødet op, før dagsordenen er
  // fyldt ud, uden at lastmod ændrer sig bagefter. Dem prøver vi igen i en uge fra første tomme hentning.
  // Møder hentet før tomFra fandtes, prøves kun igen, hvis selve mødet er højst en uge gammelt.
  const enUge = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const nye = [...dok].filter(([id, lastmod]) => {
    const d = gemt.dokumenter[id];
    return d?.lastmod !== lastmod || (d.punkter === 0 && (d.tomFra || ((d.dato || "") >= enUge ? idag : "")) >= enUge);
  });
  console.log(`${k.kommune}: ${udvalgSitemaps.length} udvalg, ${dok.size} møder siden ${fra}, ${nye.length} nye eller ændrede`);

  const kendte = new Map(Object.values(gemt.dokumenter).filter((d) => d.udvalg).map((d) => [norm(d.udvalg), d.udvalg]));
  let antal = 0;
  for (const [id, lastmod] of nye) {
    try {
      const pdf = await hent(`/pdf/GetDagsorden/${id}`, { binaer: true });
      const m = parsePdf(await pdfTilTekst(pdf), kendte);
      // tomFra: hvornår mødet første gang gav nul punkter, så vi kun prøver igen i en uge
      // Mødets gamle punkter fjernes først, så et punkt, der har skiftet nummer eller er sprunget over, ikke bliver hængende
      for (const [sid, s] of Object.entries(gemt.sager)) if (s.kilde === `${k.base}/vis?id=${id}`) delete gemt.sager[sid];
      gemt.dokumenter[id] = { lastmod, type: m.type, udvalg: m.udvalg, dato: m.dato, punkter: m.punkter.length, ...(m.punkter.length ? {} : { tomFra: gemt.dokumenter[id]?.tomFra || idag }) };
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
  // Nogle kommuner bruger et "møde" med en pladsholderdato som beholder (Albertslunds budgetspørgsmål, udgivet 11/9,
  // dateret 24/12). Et rigtigt møde lægges ikke ud måneder før; står mødet over 60 dage efter udgivelsen, er det ikke et møde.
  const pladsholder = (dato, lastmod) => Date.parse(dato) - Date.parse(lastmod) > 60 * 864e5;
  for (const [sid, s] of Object.entries(gemt.sager)) {
    const d = gemt.dokumenter[s.kilde.split("id=")[1]];
    if (d && pladsholder(s.dato, d.lastmod)) delete gemt.sager[sid];
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
