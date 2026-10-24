// Stedkort (800×450 JPEG): et lille kort med en nål (eller gaden som tyk vinrød streg) til sager med et stedsnavn.
// Stednavnene kommer fra avis/steder.mjs (stederFor). Sagen får det første sted, der kan placeres i sagens kommune.
// Geokodning: Danmarks Adresser (DAWA) på Dataforsyningen svarer nu 410 Gone, så vi bruger OpenStreetMap Nominatim
// (max 1 forespørgsel i sekundet, User-Agent, kun Danmark, kun resultater i sagens kommune). Alle svar, også huller,
// gemmes i avis/steder-koordinater.json (nøgle "<kommunekode>|<navn>"), så et sted kun slås op én gang.
// Ét kort pr. sted (ikke pr. sag) i assets/stedkort/<kommunekode>-<slug>.jpg. Kortdata: OpenStreetMap (ODbL).
// MAKS_STEDKORT (standard 30) nye kort og MAKS_GEOKODER (standard 60) nye opslag pr. kørsel. STEDKORT=0 slår det fra.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UA, px, xml, vent, C, KORTKILDE, TONE_DEFS, hentFliser, indlaesSkrift, svgTilJpeg } from "./kortbase.mjs";

const W = 800, H = 450;
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CREDIT = "Kort: © OpenStreetMap-bidragydere · Sagsvagt";
let sidste = new Map();

const slugNavn = (n) => n.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sted";
const kodeFor = (s, KOMMUNE) => (!s.kommune || s.kommune === "København") ? 101 : KOMMUNE[s.kommune]?.kode;
const afstandKm = (a, b) => Math.hypot((a[0] - b[0]) * 62, (a[1] - b[1]) * 111);
const afrund = (v) => Math.round(v * 1e5) / 1e5;

// Mindre geometri i cachen: højst n punkter pr. linje/ring
const tynd = (pkt, n) => { if (pkt.length <= n) return pkt; const t = []; for (let i = 0; i < n; i++) t.push(pkt[Math.round(i * (pkt.length - 1) / (n - 1))]); return t; };

// ---------- geokodning ----------
let sidsteOpslag = 0;
async function nominatim(navn, kommuneTekst) {
  const vent_ = 1100 - (Date.now() - sidsteOpslag);
  if (vent_ > 0) await vent(vent_);
  sidsteOpslag = Date.now();
  const q = new URLSearchParams({ q: `${navn}, ${kommuneTekst}`, countrycodes: "dk", format: "jsonv2", polygon_geojson: "1", limit: "10", "accept-language": "da" });
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${NOMINATIM}?${q}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) throw new Error(String(r.status));
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { if (i === 2) return null; await vent(3000 * (i + 1)); sidsteOpslag = Date.now(); }
  }
}

// Vælger det bedste resultat i kommunen med samme navn; gader samles af alle stykker nær det første
function vaelg(navn, resultater, kommune) {
  const norm = (t) => (t || "").toLowerCase();
  const ok = resultater.filter((r) => {
    const d = r.display_name || "";
    const iKommune = d.includes(kommune.kommune) || d.includes(`${kommune.navn} Kommune`) || d.includes(`${kommune.navn}s Kommune`);
    return iKommune && norm(r.name) === norm(navn);
  });
  if (!ok.length) return null;
  const foerst = ok[0], punkt = [+foerst.lon, +foerst.lat];
  if (foerst.category === "highway") {
    const stykker = ok.filter((r) => r.category === "highway" && r.geojson?.type === "LineString" && afstandKm([+r.lon, +r.lat], punkt) < 3).map((r) => r.geojson.coordinates);
    if (stykker.length) {
      const alle = stykker.flat(), mid = stykker.flat()[Math.floor(alle.length / 2)];
      return { lat: afrund(mid[1]), lon: afrund(mid[0]), type: "vej", linjer: stykker.map((l) => tynd(l, 60).map(([lo, la]) => [afrund(lo), afrund(la)])) };
    }
  }
  const g = foerst.geojson;
  const ud = { lat: afrund(+foerst.lat), lon: afrund(+foerst.lon), type: foerst.type };
  if (g?.type === "Polygon" && g.coordinates[0]) ud.omrids = tynd(g.coordinates[0], 80).map(([lo, la]) => [afrund(lo), afrund(la)]);
  return ud;
}

// ---------- tegning ----------
function nal(x, y) {
  return `<ellipse cx="${x}" cy="${y + 1}" rx="13" ry="5" fill="#28181c" fill-opacity="0.35"/>
  <path d="M${x} ${y} C${x - 7} ${y - 15} ${x - 19} ${y - 24} ${x - 19} ${y - 40} A19 19 0 1 1 ${x + 19} ${y - 40} C${x + 19} ${y - 24} ${x + 7} ${y - 15} ${x} ${y}Z" fill="${C.vin}" stroke="${C.kalkLys}" stroke-width="3.5" stroke-linejoin="round"/>
  <circle cx="${x}" cy="${y - 40}" r="7" fill="${C.kalkLys}"/>`;
}

async function tegn(k, navn, kommuneNavn, maal) {
  const pkt = [...(k.linjer || []).flat(), ...(k.omrids || [])];
  if (!pkt.length) pkt.push([k.lon, k.lat]);
  const lons = pkt.map((p) => p[0]), lats = pkt.map((p) => p[1]);
  const [minLo, maxLo, minLa, maxLa] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const harFlade = !!(k.linjer || k.omrids);
  let z = 17;
  if (harFlade) for (; z > 12; z--) { const [x0, y1] = px(minLo, minLa, z), [x1, y0] = px(maxLo, maxLa, z); if (x1 - x0 <= W * 0.7 && y1 - y0 <= H * 0.5) break; }
  else z = 16;
  const [cx, cy] = harFlade && k.linjer ? px((minLo + maxLo) / 2, (minLa + maxLa) / 2, z) : px(k.lon, k.lat, z);
  const PX = 400, PY = 262;                                          // nålens spids (nålen står under mærkaten)
  const ox = cx - PX, oy = cy - PY;
  const fliser = await hentFliser(z, ox, oy, W, H);
  const til = ([lo, la]) => { const [x, y] = px(lo, la, z); return `${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`; };
  let figur = "";
  if (k.linjer) {
    const d = k.linjer.map((l) => "M" + l.map(til).join("L")).join("");
    figur = `<path d="${d}" fill="none" stroke="${C.kalkLys}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"/>
  <path d="${d}" fill="none" stroke="${C.vin}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    if (k.omrids) { const d = "M" + k.omrids.map(til).join("L") + "Z"; figur += `<path d="${d}" fill="${C.vin}" fill-opacity="0.28" stroke="${C.vin}" stroke-width="4" stroke-linejoin="round"/>`; }
    const [nx, ny] = px(k.lon, k.lat, z);
    figur += nal(Math.round(nx - ox), Math.round(ny - oy));
  }
  let str = 30;
  const maxB = W - 88;
  while (maal(navn, str, 700) > maxB && str > 18) str--;
  const b1 = maal(navn, str, 700), b2 = maal(kommuneNavn, 15, 500);
  const bb = Math.min(maxB, Math.max(b1, b2)) + 44, hh = 84;
  const kb = maal(CREDIT, 13, 500);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${TONE_DEFS}
  <rect width="${W}" height="${H}" fill="${C.kalk}"/>
  <g filter="url(#tone)">${fliser.join("")}</g>
  ${figur}
  <rect x="20" y="20" width="${bb.toFixed(0)}" height="${hh}" rx="14" fill="${C.nat}" fill-opacity="0.93"/>
  <text x="42" y="${20 + 22 + 14}" font-family="Montserrat" font-weight="700" font-size="${str}" fill="${C.kalk}">${xml(navn)}</text>
  <text x="43" y="${20 + hh - 16}" font-family="Montserrat" font-weight="500" font-size="15" fill="${C.lyng}">${xml(kommuneNavn)}</text>
  <rect x="${(W - kb - 24).toFixed(0)}" y="${H - 26}" width="${(kb + 24).toFixed(0)}" height="26" fill="${C.kalkLys}" fill-opacity="0.85"/>
  <text x="${(W - kb - 12).toFixed(0)}" y="${H - 9}" font-family="Montserrat" font-weight="500" font-size="13" fill="${C.muted}">${xml(CREDIT)}</text>
</svg>`;
}

// ---------- byg ----------
// Returnerer Map(sagsId → { fil, sted, lat, lon, kommune }). fil er null, hvis kortet endnu ikke er tegnet (loftet nåede).
export async function bygStedkort(sager, h, KOMMUNE, stederFor) {
  const ud = new Map();
  sidste = ud;
  if (process.env.STEDKORT === "0") return ud;
  const mappe = join(h.ROD, "assets", "stedkort");
  await mkdir(mappe, { recursive: true });
  const koordSti = join(h.ROD, "avis", "steder-koordinater.json");
  const koord = existsSync(koordSti) ? JSON.parse(await readFile(koordSti, "utf8")) : {};
  const { maal, fontFiles } = await indlaesSkrift(h.ROD);
  const MAKS_K = +(process.env.MAKS_STEDKORT || 30), MAKS_G = +(process.env.MAKS_GEOKODER || 60);
  let nyeKort = 0, nyeOpslag = 0, fejl = 0;
  const sorteret = [...sager].sort((a, b) => (b.dato || "").localeCompare(a.dato || ""));   // nyeste sager først
  const kommuneFor = (s) => (!s.kommune || s.kommune === "København") ? KOMMUNE["København"] : KOMMUNE[s.kommune];

  for (const s of sorteret) {
    const kommune = kommuneFor(s), kode = kodeFor(s, KOMMUNE);
    if (!kommune || !kode) continue;
    let valgt = null;
    for (const navn of stederFor(s) || []) {
      const nøgle = `${kode}|${navn}`;
      if (!(nøgle in koord)) {
        if (nyeOpslag >= MAKS_G) continue;                             // resten kommer ved næste kørsel
        nyeOpslag++;
        const r = await nominatim(navn, kommune.kommune);
        if (r === null) { continue; }                                   // netfejl: gem ikke et hul
        koord[nøgle] = vaelg(navn, r, kommune) || { hul: true };
      }
      if (!koord[nøgle].hul) { valgt = { navn, nøgle, k: koord[nøgle] }; break; }
    }
    if (!valgt) continue;
    const fil = `${kode}-${slugNavn(valgt.navn)}.jpg`, sti = join(mappe, fil);
    if (!existsSync(sti) && nyeKort < MAKS_K) {
      try {
        await writeFile(sti, svgTilJpeg(await tegn(valgt.k, valgt.navn, kommune.kommune, maal), fontFiles));
        nyeKort++;
      } catch (e) { fejl++; console.warn(`Stedkort: ${valgt.navn} fejlede: ${e.message}`); }
    }
    ud.set(s.id, { fil: existsSync(sti) ? `assets/stedkort/${fil}` : null, sted: valgt.navn, lat: valgt.k.lat, lon: valgt.k.lon, kommune: kommune.navn });
  }
  const sorteretKoord = Object.fromEntries(Object.entries(koord).sort(([a], [b]) => a.localeCompare(b, "da")));
  await writeFile(koordSti, JSON.stringify(sorteretKoord));
  const hul = Object.values(koord).filter((v) => v.hul).length;
  console.log(`Stedkort: ${[...ud.values()].filter((v) => v.fil).length} af ${ud.size} sager med koordinat har kort (${nyeKort} nye, ${nyeOpslag} nye opslag, ${fejl} fejl; ${Object.keys(koord).length} steder i cachen, ${hul} uden fund).`);
  return ud;
}

// Alle sager med koordinat fra seneste bygStedkort, til en oversigtsside med nåle: Map(sagsId → { sted, lat, lon, kommune, fil })
export const alleKoordinater = () => sidste;

// Figuren på sagssiden (rod: "../" fra sag/ og min/)
export function stedkortFigur(s, kort, rod, esc) {
  const k = kort.get(s.id);
  if (!k?.fil) return "";
  return `<figure class="stedkort">
          <img src="${rod}${k.fil}" width="800" height="450" loading="lazy" alt="Kort over ${esc(k.sted)}">
          <figcaption>${esc(k.sted)} på kortet. ${esc(KORTKILDE)} · Sagsvagt</figcaption>
        </figure>`;
}
