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
// Hæves, når parseren lærer nye PDF-formater; så hentes møder, der før gav nul punkter, igen én gang
const PARSER = 3;
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
const udenPeriode = (u) => u.replace(/\s*[-–]?\s*\(?\d{4}\s*[-–]?\s*\d{4}\)?\s*$/, "").trim();
const norm = (u) => udenPeriode(u).toUpperCase().replace(/\s+/g, " ");
const dato = (d, m, y) => `${y}-${m}-${d}`;
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const datoTekst = (iso) => `${+iso.slice(8)}. ${MDR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

// Tabeller bliver til linjer med tal; dem springer vi over i den løbende tekst
const tabellinje = (l) => { const b = (l.match(/[a-zæøåA-ZÆØÅ]/g) || []).length; return l.trim().length > 0 && b / l.trim().length < 0.35; };
const renTekst = (t) => t.split("\n").filter((l) => !tabellinje(l)).join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function parsePdf(tekst, kendteUdvalg = new Map()) {
  // Gentofte skriver "Beslutninger: Økonomiudvalget den 19. oktober 2026" og tidligere behandlinger som
  // "Udvalg: Byplanudvalget Dato: 05-10-2026"; de omskrives til den almindelige form "BESLUTNING I … DEN dd-mm-åååå"
  const to = (n) => String(n).padStart(2, "0");
  const t = tekst.replace(/\r/g, "").replace(/\f/g, "\n")
    .replace(new RegExp(`Beslutninger:\\s*(.+?) den (\\d{1,2})\\. (${MDR.join("|")}) (\\d{4})`, "g"), (_, u, d, m, y) => `BESLUTNING I ${u} DEN ${to(d)}-${to(MDR.indexOf(m) + 1)}-${y}`)
    .replace(/(?:Tidligere beslutninger:\s*)?Udvalg:\s*(.+?)\s+Dato:\s*(\d{2}-\d{2}-\d{4})/g, "BESLUTNING I $1 DEN $2");
  // Datoen kan mangle en bindestreg ("2210-2026", "17-092026"), så de er valgfrie
  // Lange udvalgsnavne brydes over to linjer ("DAGSORDEN Kultur-, Fritids- &\nFolkesundhedsudvalget d. 26-10-2026")
  const hoved = t.match(/^\s*(DAGSORDEN|REFERAT)\s+([^\n]+?(?:\n[^\n]+?)?)\s+d\.\s*(\d{2})-?(\d{2})-?(\d{4})/m);
  if (hoved) hoved[2] = hoved[2].replace(/\s+/g, " ");
  if (!hoved) throw new Error("Kan ikke læse mødets overskrift");
  const type = hoved[1] === "REFERAT" ? "referat" : "dagsorden";
  const udvalg = udenPeriode(hoved[2]);
  const moededato = dato(hoved[3], hoved[4], hoved[5]);
  kendteUdvalg.set(norm(udvalg), udvalg);

  // Indholdsfortegnelsen: "Titel.......... 3 Titel........ 9" (kan stå på én eller flere linjer)
  // (Guldborgsund staver den "Innholdsfortegnelse")
  const mIndhold = t.match(/In[dn]holdsfortegnelse/);
  if (!mIndhold) throw new Error("Ingen indholdsfortegnelse");
  const reIndhold = /(\S[^\n]*?)\s*\.{4,}\s*(\d+)(?![.\d])\s*/gy;
  reIndhold.lastIndex = mIndhold.index + mIndhold[0].length;
  while (/\s/.test(t[reIndhold.lastIndex])) reIndhold.lastIndex++;
  const titler = []; let m, slut = reIndhold.lastIndex;
  while ((m = reIndhold.exec(t))) { titler.push({ titel: m[1].trim(), side: +m[2] }); slut = reIndhold.lastIndex; }
  // Nogle PDF'er (Herning, Ballerup, Albertslund m.fl.) har sidetallene i en kolonne for sig: først alle titler med
  // prikker, så sidetallene på hver sin linje bagefter. Lange titler kan være brudt over flere linjer før prikkerne.
  if (!titler.length) {
    const linjer = t.slice(mIndhold.index + mIndhold[0].length).split("\n");
    let pos = mIndhold.index + mIndhold[0].length, i = 0, start = "", efterTitel = pos;
    const tal = [];
    for (; i < linjer.length; i++) {
      const l = linjer[i].trim();
      pos += linjer[i].length + 1;
      if (!l) continue;
      const p = l.match(/^(.*?)\s*\.{4,}\s*$/);
      if (p) { titler.push({ titel: `${start} ${p[1]}`.trim(), side: 0 }); start = ""; efterTitel = pos; continue; }
      // Gentofte: én titel uden prikker (afkortet, hvis den er lang) og sidetallet på linjen under
      if (/^\d{1,3}$/.test(l) && !titler.length && start) { titler.push({ titel: start, side: +l, afkortet: true }); tal.push(+l); slut = pos; start = ""; continue; }
      if (/^\d{1,3}$/.test(l) && titler.length) { tal.push(+l); slut = pos; if (tal.length >= titler.length) break; continue; }
      if (tal.length || (titler.length && start.length > 300)) break;
      start = `${start} ${l}`.trim();
      if (start.length > 300) break;
    }
    if (!tal.length) slut = efterTitel;
    titler.forEach((x, j) => { x.side = tal[j] ?? (tal.at(-1) || 0) + j; });
  }
  // lastIndex nulstilles, når exec fejler, så slutningen gemmes undervejs. Markøren sættes på linjeskiftet før første
  // punkt, så punktsøgningen ikke rammer selve indholdsfortegnelsen (Gentoftes afkortede første titel gjorde det)
  let markoer = Math.max(0, t.lastIndexOf("\n", slut - 1));

  // Find hvert punkt i rækkefølge; lange titler kan være brudt over flere linjer i selve teksten.
  // Nogle kommuner skriver titlen med versaler og løbenummer foran ("188.ORIENTERINGSSAG: …")
  // En afkortet titel er kun begyndelsen af overskriften; så bruger vi hele linjen fra teksten som titel.
  // Et punktum sidst i titlen forsvinder i indholdsfortegnelsens prikker ("lejekontrakt......" for "lejekontrakt."),
  // og i teksten mister pdftotext nogle gange bindestregen mellem årstal ("20272029").
  const findTitel = (titel, fra, afkortet = false) => {
    const ord = titel.split(/\s+/).map(reEsc).join("\\s+").replace(/(\d)-(?=\d)/g, "$1-?");
    // Gentofte nummererer punkterne "1 (Åben) Titel" og har nogle gange "Sags ID: …" på samme linje som titlen
    const re = new RegExp(`(^|\\n)(?:\\d+\\.[ \\t]*|\\d+[ \\t]+[\\(\\[](?:Åben|Lukket)[\\)\\]][ \\t]*|Punkt[ \\t]+\\d+:[ \\t]*)?(${ord}${afkortet ? "[^\\n]*?" : ""})\\.?[ \\t]*(?:\\n|(?=Sags ID:))`, "gi");
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
      const a = findTitel(titel.slice(0, d.index).replace(/\.+$/, ""), fra, true); // "… i Herning.. 3" (for få prikker)
      const b = a && findDele(titel.slice(d.index + d[0].length), a.start, +d[1], tilSide);
      if (b) return [a, ...b];
    }
    return null;
  };
  // null = titlen blev ikke fundet; så kender vi ikke slutningen på punktet før.
  // Lukkede punkter står kun i indholdsfortegnelsen, så dem tæller vi bare med i nummereringen.
  const fund = []; let side = 0, nr = 0;
  for (const { titel, side: s, afkortet } of titler) {
    const f = afkortet ? [findTitel(titel, markoer, true)].filter(Boolean) : findDele(titel, markoer, side, s);
    if (f && !f.length) { nr++; fund.push({ mangler: true, titel }); side = s; continue; }
    if (f) { for (const x of f) fund.push({ ...x, nr: ++nr }); markoer = f.at(-1).start; }
    else { nr++; if (!/^Lukket\b/i.test(titel)) fund.push({ mangler: true, titel }); }
    side = s;
  }

  // Afsnitsoverskrifter: kommunerne bruger forskellige navne, med versaler midt i teksten ("RESUME Økonomi- og …")
  // eller som en linje for sig ("Sagsfremstilling"). Beslutninger: "BESLUTNING I <UDVALG> DEN|den dd-mm-åååå".
  const OVERSKRIFTER = ["SAMMENHÆNG TIL POLITISKE STRATEGIER", "PERSONALEMÆSSIGE KONSEKVENSER", "ØKONOMISKE KONSEKVENSER", "BESKRIVELSE AF SAGEN",
    "BESLUTNINGSKOMPETENCE", "TIDLIGERE BESLUTNING", "SAGSFREMSTILLING", "STRATEGISK RAMME", "SAGSBESKRIVELSE", "PROBLEMSTILLING", "BORGERPERSPEKTIV",
    "SAGENS FORLØB", "KOMMUNIKATION", "VIDERE PROCES", "SAGSRESUMÉ", "SAGSRESUME", "INDSTILLING", "LOVGRUNDLAG", "LØSNINGER", "BESLUTNING", "VURDERING",
    "HISTORIK", "SAGSGANG", "LØSNING", "ØKONOMI", "RESUMÉ", "RESUME", "BILAG"];
  const LINJE = ["Sagsfremstilling", "Sagsbeskrivelse", "Baggrund", "Sagsresumé", "Problemstilling", "Videre proces", "Indstilling", "Beslutning", "Vurdering", "Økonomi", "Resumé", "Resume", "Bilag"];
  const MARK = new RegExp(`((?:BESLUTNING(?:ER)?|(?<=^|\\n)Beslutning(?:er)?)(?: [Ii])? (.+?) (?:DEN|[Dd]en) (\\d{2})-?(\\d{2})-?(\\d{4})|(?<![A-ZÆØÅa-zæøå])(${OVERSKRIFTER.join("|")})(?![A-ZÆØÅa-zæøå])|(?<=^|\\n)(${LINJE.join("|")})(?=[ \\t]*\\n|\\s+[A-ZÆØÅ][a-zæøå]))`, "g");
  const NAVN = { RESUME: "Resumé", "RESUMÉ": "Resumé", SAGSRESUME: "Resumé", "SAGSRESUMÉ": "Resumé", Resume: "Resumé", "Sagsresumé": "Resumé",
    SAGSFREMSTILLING: "Sagsfremstilling", SAGSBESKRIVELSE: "Sagsfremstilling", "BESKRIVELSE AF SAGEN": "Sagsfremstilling", Sagsbeskrivelse: "Sagsfremstilling" };
  const afsnitNavn = (h) => NAVN[h] || h.charAt(0).toUpperCase() + h.slice(1).toLowerCase();
  const punkter = [];
  fund.forEach((p, i) => {
    if (p.mangler || /^(Lukket\b|Underskrift(sark)?\.?$)/i.test(p.titel)) return; // ikke fx "Underskrift på skøder …"
    // Mangler næste punkts overskrift (stavet lidt anderledes i teksten), leder vi efter dens første ord på en linje for
    // sig; ellers stopper vi ved det næste punkt, vi fandt. Uden nogen af delene springes punktet over.
    let slutIdx = fund[i + 1]?.idx ?? t.length;
    if (fund[i + 1]?.mangler) {
      const ord = fund[i + 1].titel.replace(/\.+$/, "").split(/\s+/).slice(0, 4).map(reEsc).join("\\s+");
      const r = new RegExp(`\\n(?:\\d+\\.\\s*|Punkt\\s+\\d+:\\s*)?${ord}`, "i"), f = r.exec(t.slice(p.start));
      const naeste = fund.slice(i + 1).find((x) => !x.mangler);
      if (f) slutIdx = p.start + f.index;
      else if (naeste) slutIdx = naeste.idx;
      // Sidste punkt mangler (typisk "Godkendelse af beslutningsprotokol" uden overskrift): tag resten med, men
      // stop ved en sidefod som "3/3", hvor det næste punkts side begynder
      else { const fod = /\n\d+\/(\d+)\n/g; let x; while ((x = fod.exec(t.slice(p.start)))) if (x[0].trim().split("/")[0] === x[1]) { slutIdx = p.start + x.index; break; } }
    }
    const krop = t.slice(p.start, slutIdx);
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
        // Samme udvalg på en tidligere dato (fx "Udsat" sidste måned) er en tidligere behandling, ikke dette mødes beslutning
        if (norm(d[2]) === norm(udvalg) && dd === moededato) afsnit.push({ titel: "Beslutning", tekst });
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

// Gentofte skriver "Beslutninger: Godkendt." sidst i indstillingen, Lyngby-Taarbæk "Beslutning Anbefalet." sidst i
// økonomiafsnittet. Har et referat intet afsnit med beslutningen, flyttes sådan en hale ud i sit eget afsnit.
// "Beslutning om …" (lille bogstav efter) og "Beslutningskompetence" rammes ikke. Kan køres igen uden at ændre noget.
export function udskilBeslutning(s) {
  const afsnit = s.afsnit || [];
  if (s.type !== "referat" || !afsnit.length || afsnit.some((a) => /^(Beslutning|Behandling)/.test(a.titel))) return afsnit;
  const sidst = afsnit.at(-1);
  const re = /(?<![A-Za-zÆØÅæøå])Beslutning(?:er)?:?[ \t]*\n?[ \t]*(?=[A-ZÆØÅ0-9])/g;
  let m, fund = null;
  while ((m = re.exec(sidst.tekst))) fund = m;
  if (!fund || sidst.tekst.length - fund.index > 1500) return afsnit;
  const tekst = sidst.tekst.slice(fund.index + fund[0].length).trim();
  const foer = sidst.tekst.slice(0, fund.index).replace(/\s*Tidligere beslutninger:?\s*$/, "").trim();
  if (!tekst) return afsnit;
  return [...afsnit.slice(0, -1), ...(foer ? [{ ...sidst, tekst: foer }] : []), { titel: "Beslutning", tekst }];
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
    // Hele kommunen hentes igen én gang, når parseren er hævet siden kommunens sidste fulde hentning
    if ((gemt.parser || 1) < PARSER) return true;
    return d?.lastmod !== lastmod || (d.punkter === 0 && (d.tomFra || ((d.dato || "") >= enUge ? idag : "")) >= enUge)
      || (d.punkter === 0 && (d.parser || 1) < PARSER); // tomme møder prøves igen, når parseren er forbedret
  });
  console.log(`${k.kommune}: ${udvalgSitemaps.length} udvalg, ${dok.size} møder siden ${fra}, ${nye.length} nye eller ændrede`);

  const kendte = new Map(Object.values(gemt.dokumenter).filter((d) => d.udvalg).map((d) => [norm(d.udvalg), d.udvalg]));
  let antal = 0;
  let fejlGemt = 0;
  // Teksten fra møder, der ikke kunne læses, gemmes i data/fejl/<kommune>/ (kommer ikke på webhotellet), så parseren
  // kan rettes ud fra den rigtige PDF-tekst. Højst 5 pr. kommune pr. kørsel.
  const gemFejl = async (id, tekst, grund) => {
    if (!tekst || fejlGemt >= 5) return;
    fejlGemt++;
    const dir = join(ROD, "data", "fejl", k.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.txt`), `# ${grund}\n# ${k.base}/vis?id=${id}\n\n${tekst.slice(0, 80000)}`);
  };
  for (const [id, lastmod] of nye) {
    let tekst = "";
    try {
      const pdf = await hent(`/pdf/GetDagsorden/${id}`, { binaer: true });
      tekst = await pdfTilTekst(pdf);
      const m = parsePdf(tekst, kendte);
      if (!m.punkter.length) await gemFejl(id, tekst, "0 punkter");
      else await rm(join(ROD, "data", "fejl", k.slug, `${id}.txt`), { force: true });
      // tomFra: hvornår mødet første gang gav nul punkter, så vi kun prøver igen i en uge
      // Mødets gamle punkter fjernes først, så et punkt, der har skiftet nummer eller er sprunget over, ikke bliver hængende
      for (const [sid, s] of Object.entries(gemt.sager)) if (s.kilde === `${k.base}/vis?id=${id}`) delete gemt.sager[sid];
      gemt.dokumenter[id] = { lastmod, type: m.type, udvalg: m.udvalg, dato: m.dato, punkter: m.punkter.length, parser: PARSER, ...(m.punkter.length ? {} : { tomFra: gemt.dokumenter[id]?.tomFra || idag }) };
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
      await gemFejl(id, tekst, e.message);
    }
  }
  // Nogle kommuner bruger et "møde" med en pladsholderdato som beholder (Albertslunds budgetspørgsmål, udgivet 11/9,
  // dateret 24/12). Et rigtigt møde lægges ikke ud måneder før; står mødet over 60 dage efter udgivelsen, er det ikke et møde.
  // Omvendt lægger nogle kommuner gamle referater op igen (Guldborgsund genudgav møder fra 2024 i august 2026);
  // et møde, der er over et år ældre end udgivelsen, er arkiv og ikke en nyhed.
  const pladsholder = (dato, lastmod) => Date.parse(dato) - Date.parse(lastmod) > 60 * 864e5 || Date.parse(lastmod) - Date.parse(dato) > 365 * 864e5;
  for (const [sid, s] of Object.entries(gemt.sager)) {
    const d = gemt.dokumenter[s.kilde.split("id=")[1]];
    if (d && pladsholder(s.dato, d.lastmod)) delete gemt.sager[sid];
  }
  // Beslutningen står i nogle kommuner inde i sidste afsnit i stedet for under sin egen overskrift
  for (const s of Object.values(gemt.sager)) s.afsnit = udskilBeslutning(s);
  // Udvalgsnavne i "Behandling i …" står med versaler i PDF'en; brug stavningen fra udvalgets egne møder, når vi kender den
  for (const s of Object.values(gemt.sager)) for (const a of s.afsnit) {
    const b = a.titel.match(/^Behandling i (.+?) (\d+\. \S+ \d{4})$/);
    if (b && kendte.has(norm(b[1]))) a.titel = `Behandling i ${kendte.get(norm(b[1]))} ${b[2]}`;
  }
  gemt.parser = PARSER;
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
  // Kommunerne ligger på hver sin server, så vi henter flere kommuner ad gangen. Hver server får stadig
  // kun én forespørgsel ad gangen med pause imellem (klient() ovenfor). SAMTIDIG styrer hvor mange.
  const SAMTIDIG = Math.max(1, Number(process.env.SAMTIDIG || 10));
  const koe = [...kommuner];
  await Promise.all(Array.from({ length: Math.min(SAMTIDIG, koe.length) }, async () => {
    for (let k; (k = koe.shift()); ) {
      try { await hentKommune(k); } catch (e) { console.error(`${k.kommune}: ${e.message}`); process.exitCode = 1; }
    }
  }));
}
