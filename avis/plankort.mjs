// Plankort (1200×800 JPEG) til sager om lokalplaner: et frit grundkort med lokalplanens grænse fra Plandata.dk tegnet ovenpå.
// Billedet er vores eget (se ../../jura-billeder.md): kortdata fra OpenStreetMap (ODbL), plangrænsen er offentlig registerdata.
// Sagen kobles til en plan i Plandata.dk ud fra plannavnets ord i titlen (fx "Tillæg 2 til Lokalplan 517 På Bjerget"
// ↔ "På Bjerget tillæg 2"); et tillæg med et andet nummer kobles ikke. Kortene gemmes i assets/plankort/ og laves kun igen,
// når planen er ændret i Plandata. MAKS (standard 25) nye kort pr. kørsel, så OpenStreetMaps fliseserver kun bruges let.
// PLANKORT_FLISER kan pege på en anden fliseserver ({z}/{x}/{y}, fx egne fliser eller Dataforsyningen), PLANKORT=0 slår det fra.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hent, px, xml, C, KORTKILDE, TONE_DEFS, hentFliser, indlaesSkrift, svgTilJpeg } from "./kortbase.mjs";

const W = 1200, H_ = 800;
const WFS = "https://geoserver.plandata.dk/geoserver/wfs";
const MDR = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];

// ---------- kobling sag → plan ----------
const STOP = new Set(["og", "i", "på", "ved", "for", "til", "af", "nr", "lokalplan", "tillæg", "nord", "syd", "øst", "vest", "ii", "iii", "iv", "m", "fl", "mfl"]);
const ord = (t) => (t || "").toLowerCase().replace(/[‐–—-]/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter(Boolean);
const tillaegNr = (t) => { const m = (t || "").toLowerCase().match(/tillæg\s*(?:nr\.?\s*)?(\d+)/); return m ? +m[1] : null; };
const erPlansag = (s) => /lokalplan/i.test(s.titel || "");

function findPlan(s, planer) {
  const titelOrd = new Set(ord(s.titel)), tT = tillaegNr(s.titel);
  const forslagIOrd = /forslag|høring|hoering/i.test(s.titel);
  let bedst = null, bedstPoint = 0;
  for (const p of planer) {
    const navnOrd = ord(p.plannavn), kerne = navnOrd.filter((o) => !STOP.has(o) && !/^\d+$/.test(o));
    if (!kerne.length || !kerne.some((o) => o.length >= 4) || !kerne.every((o) => titelOrd.has(o))) continue;
    const pT = tillaegNr(p.plannavn);
    if (tT != null && pT != null && tT !== pT) continue;            // et andet tillæg til samme plan
    if ((tT == null) !== (pT == null)) continue;                     // tillæg mod grundplan (eller omvendt)
    // en ny plan under udarbejdelse må ikke vises med den gamle, vedtagne plans grænse
    if (p.status === "V" && forslagIOrd && !/dispensation|endelig|vedtag/i.test(s.titel) && pT == null) continue;
    let point = navnOrd.filter((o) => titelOrd.has(o)).length * 10 + kerne.join("").length;
    if (pT != null && tT === pT) point += 30;
    if (p.status === "F" && forslagIOrd) point += 8;
    if (p.status === "V" && /endelig|vedtag/i.test(s.titel)) point += 8;
    point += ((p.datoforsl || p.datovedt || 0) / 1e8);               // nyeste plan vinder ved lighed
    if (point > bedstPoint) { bedst = p; bedstPoint = point; }
  }
  return bedst;
}

async function planListe(komnr, cache) {
  if (cache.has(komnr)) return cache.get(komnr);
  const felter = "planid,plannavn,plannr,komnr,status,datoforsl,datovedt,datoslut,doklink,datoopdt,kommunenavn";
  const ud = [];
  for (const lag of ["forslag", "vedtaget"]) {
    const q = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: `pdk:theme_pdk_lokalplan_${lag}`,
      outputFormat: "application/json", propertyName: felter, CQL_FILTER: `komnr=${komnr}` });
    try { for (const f of (await hent(`${WFS}?${q}`)).features) ud.push(f.properties); }
    catch (e) { console.warn(`Plankort: kunne ikke hente ${lag} for kommune ${komnr}: ${e.message}`); }
  }
  cache.set(komnr, ud);
  return ud;
}

async function planGeometri(p) {
  const lag = p.status === "F" ? "forslag" : "vedtaget";
  const q = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: `pdk:theme_pdk_lokalplan_${lag}`,
    outputFormat: "application/json", srsName: "EPSG:4326", CQL_FILTER: `planid=${p.planid}` });
  const f = (await hent(`${WFS}?${q}`)).features[0];
  if (!f) throw new Error(`ingen geometri for plan ${p.planid}`);
  return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
}

// ---------- tegning ----------
async function tegn(p, polygoner, maal) {
  const alle = polygoner.flat(2);
  const lons = alle.map((c) => c[0]), lats = alle.map((c) => c[1]);
  const [minLo, maxLo, minLa, maxLa] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  let z = 18, x0, y0, x1, y1;
  for (; z > 10; z--) { [x0, y1] = px(minLo, minLa, z); [x1, y0] = px(maxLo, maxLa, z); if (x1 - x0 <= W * 0.64 && y1 - y0 <= H_ * 0.64) break; }
  const ox = (x0 + x1) / 2 - W / 2, oy = (y0 + y1) / 2 - H_ / 2 + 30;      // lidt ned, så mærkaten øverst ikke dækker planen
  const fliser = await hentFliser(z, ox, oy, W, H_);
  const sti = polygoner.map((poly) => poly.map((ring) => "M" + ring.map(([lo, la]) => { const [x, y] = px(lo, la, z); return `${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`; }).join("L") + "Z").join("")).join("");
  const status = p.status === "F" ? "Lokalplanforslag" : "Lokalplan";
  const dato = (v) => { const s = String(v); return `${+s.slice(6, 8)}. ${MDR[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}`; };
  const iDag = +new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const linje1 = p.plannavn, linje2 = `${p.status === "F" && p.datoslut >= iDag ? `Høring til ${dato(p.datoslut)} · ` : p.status === "V" && p.datovedt ? `Vedtaget ${dato(p.datovedt)} · ` : ""}${p.kommunenavn}`;
  const b = Math.max(maal(linje1, 40, 700), maal(linje2, 22, 500)) + 56;
  const kilde = `${KORTKILDE} · Plangrænse: Plandata.dk, ${p.kommunenavn} Kommune · Sagsvagt`, kb = maal(kilde, 15, 500);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H_}" viewBox="0 0 ${W} ${H_}">
  ${TONE_DEFS}
  <rect width="${W}" height="${H_}" fill="${C.kalk}"/>
  <g filter="url(#tone)">${fliser.join("")}</g>
  <path d="${sti}" fill="#28181c" fill-opacity="0.28" fill-rule="evenodd" filter="url(#skygge)"/>
  <path d="${sti}" fill="${C.vin}" fill-opacity="0.30" fill-rule="evenodd" stroke="${C.vin}" stroke-width="5" stroke-linejoin="round"/>
  <rect x="32" y="32" width="${b.toFixed(0)}" height="132" rx="18" fill="${C.nat}" fill-opacity="0.93"/>
  <text x="60" y="66" font-family="Montserrat" font-weight="700" font-size="15" letter-spacing="1.2" fill="${C.rubin}">${xml(status.toUpperCase())}</text>
  <text x="58" y="112" font-family="Montserrat" font-weight="700" font-size="40" fill="${C.kalk}">${xml(linje1)}</text>
  <text x="60" y="146" font-family="Montserrat" font-weight="500" font-size="22" fill="${C.lyng}">${xml(linje2)}</text>
  <rect x="${(W - kb - 28).toFixed(0)}" y="${H_ - 34}" width="${(kb + 28).toFixed(0)}" height="34" fill="${C.kalkLys}" fill-opacity="0.85"/>
  <text x="${(W - kb - 16).toFixed(0)}" y="${H_ - 12}" font-family="Montserrat" font-weight="500" font-size="15" fill="${C.muted}">${xml(kilde)}</text>
</svg>`;
  return svg;
}

// ---------- byg ----------
export async function bygPlankort(sager, h, KOMMUNE) {
  const mappe = join(h.ROD, "assets", "plankort");
  await mkdir(mappe, { recursive: true });
  const indeksSti = join(mappe, "index.json");
  const indeks = existsSync(indeksSti) ? JSON.parse(await readFile(indeksSti, "utf8")) : { planer: {} };
  const tilSag = new Map();
  if (process.env.PLANKORT === "0") return tilSag;

  const { maal, fontFiles } = await indlaesSkrift(h.ROD);

  const plansager = sager.filter(erPlansag).sort((a, b) => b.dato.localeCompare(a.dato));
  const lister = new Map();
  let nye = 0, fejl = 0;
  const MAKS = +(process.env.MAKS_PLANKORT || 25);
  for (const s of plansager) {
    const komnr = s.kommune && s.kommune !== "København" ? KOMMUNE[s.kommune]?.kode : 101;
    if (!komnr) continue;
    const p = findPlan(s, await planListe(komnr, lister));
    if (!p) continue;
    const id = String(p.planid), kendt = indeks.planer[id], fil = `${id}.jpg`;
    const aktuel = kendt && kendt.datoopdt === p.datoopdt && kendt.status === p.status && existsSync(join(mappe, fil));
    if (!aktuel) {
      if (nye >= MAKS) continue;                                     // resten kommer ved næste kørsel
      try {
        const svg = await tegn(p, await planGeometri(p), maal);
        await writeFile(join(mappe, fil), svgTilJpeg(svg, fontFiles));
        indeks.planer[id] = { plannavn: p.plannavn, status: p.status, datoopdt: p.datoopdt, doklink: p.doklink, kommune: p.kommunenavn };
        nye++;
      } catch (e) { fejl++; console.warn(`Plankort: ${p.plannavn} (${id}) fejlede: ${e.message}`); continue; }
    }
    tilSag.set(s.id, { fil: `assets/plankort/${fil}`, ...indeks.planer[id] });
  }
  await writeFile(indeksSti, JSON.stringify(indeks, null, 1));
  console.log(`Plankort: ${tilSag.size} sager har kort (${nye} nye, ${fejl} fejl, ${plansager.length} plansager i alt).`);
  return tilSag;
}

// Figuren på sagssiden (rod: "../" fra sag/ og min/)
export function plankortFigur(s, kort, rod, esc) {
  const k = kort.get(s.id);
  if (!k) return "";
  const hvad = k.status === "F" ? "lokalplanforslaget" : "lokalplanen";
  return `<figure class="plankort">
          <a href="${esc(k.doklink || "https://www.plandata.dk/")}" target="_blank" rel="noopener nofollow">
            <img src="${rod}${k.fil}" width="1200" height="800" loading="lazy" alt="Kort over området for ${esc(hvad)} ${esc(k.plannavn)}">
          </a>
          <figcaption>Det røde område er ${hvad} ${esc(k.plannavn)}. Tryk på kortet for at læse planen på Plandata.dk.<br>${esc(KORTKILDE)}. Plangrænse: Plandata.dk, ${esc(k.kommune)} Kommune.</figcaption>
        </figure>`;
}
