// Natkort: et mørkt kort over hver åben kommunes hovedby, tonet i Mødet-farverne (nat, blå øverst til venstre, rød nederst til højre).
// To størrelser: assets/mail/natkort/<kommune>.jpg (1200×440, zoom 14) til toppen af mandagsmailen og
// assets/natkort/<kommune>.jpg (2400×1100, zoom 15) til toppen af forsiden og Min avis.
// Laver kun de kort, der mangler, så en kommune, der åbner, får sine kort ved næste kørsel. Hovedbyens koordinater gemmes i
// avis/natkort-steder.json (opslag i Nominatim højst én gang pr. kommune). Fejl stopper aldrig robotten.
// Kør: node avis/natkort.mjs
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { hentFliser, px, svgTilJpeg, indlaesSkrift, vent } from "./kortbase.mjs";

const ROD = join(import.meta.dirname, "..");
const STEDER = join(import.meta.dirname, "natkort-steder.json");
const STOERRELSER = [
  { mappe: "assets/mail/natkort", W: 1200, H: 440, z: 14, kvalitet: 66 },
  { mappe: "assets/natkort", W: 2400, H: 1100, z: 15, kvalitet: 72 },
];
// Kommuner, hvis navn ikke er hovedbyens
const BY = { "lyngby-taarbaek": "Kongens Lyngby", "hoeje-taastrup": "Taastrup", guldborgsund: "Nykøbing Falster", vesthimmerland: "Aars", mariagerfjord: "Hobro",
  jammerbugt: "Aabybro", rebild: "Støvring", syddjurs: "Ebeltoft", norddjurs: "Grenaa", lolland: "Nakskov", stevns: "Store Heddinge", halsnaes: "Frederiksværk",
  egedal: "Stenløse", furesoe: "Farum", rudersdal: "Holte", gribskov: "Helsinge", "ikast-brande": "Ikast", "ringkoebing-skjern": "Ringkøbing", morsoe: "Nykøbing Mors",
  odsherred: "Nykøbing Sjælland", "faaborg-midtfyn": "Faaborg", nordfyn: "Bogense", langeland: "Rudkøbing", aeroe: "Ærøskøbing", solroed: "Solrød Strand",
  bornholm: "Rønne", fanoe: "Nordby", laesoe: "Byrum", samsoe: "Tranebjerg", alleroed: "Lillerød", taarnby: "Kastrup", gladsaxe: "Søborg", broendby: "Brøndby Strand" };

// Fliserne i gråtoner, vendt om, så vejene lyser; derefter Mødets blå og røde lys og en mørkere venstre side til teksten
const svg = (fliser, W, H) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
  <filter id="nat" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>
    <feFuncR type="table" tableValues="0.05 0.05 0.05 0.05 0.05 0.055 0.06 0.07 0.09 0.17 0.66"/><feFuncG type="table" tableValues="0.05 0.05 0.05 0.05 0.05 0.055 0.065 0.075 0.095 0.18 0.68"/><feFuncB type="table" tableValues="0.07 0.07 0.07 0.07 0.07 0.08 0.09 0.11 0.14 0.25 0.82"/></feComponentTransfer></filter>
  <radialGradient id="bla" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="scale(0.9 1.6)"><stop offset="0" stop-color="#5D6BA8" stop-opacity=".6"/><stop offset=".45" stop-color="#28377A" stop-opacity=".35"/><stop offset="1" stop-color="#0C1430" stop-opacity="0"/></radialGradient>
  <radialGradient id="rod" cx="1" cy="1" r="0.8" fx="1" fy="1" gradientTransform="translate(1 1) scale(0.9 1.7) translate(-1 -1)"><stop offset="0" stop-color="#B04A50" stop-opacity=".75"/><stop offset=".45" stop-color="#8A2430" stop-opacity=".5"/><stop offset="1" stop-color="#3E0E14" stop-opacity="0"/></radialGradient>
  <linearGradient id="laes" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0E0F14" stop-opacity=".55"/><stop offset=".6" stop-color="#0E0F14" stop-opacity=".2"/><stop offset="1" stop-color="#0E0F14" stop-opacity=".1"/></linearGradient>
</defs><rect width="${W}" height="${H}" fill="#0E0F14"/><g filter="url(#nat)">${fliser.join("")}</g>
<rect width="${W}" height="${H}" fill="url(#bla)"/><rect width="${W}" height="${H}" fill="url(#rod)"/><rect width="${W}" height="${H}" fill="url(#laes)"/></svg>`;

const findes = (f) => access(f).then(() => true, () => false);

async function hovedby(k, steder) {
  if (steder[k.slug]) return steder[k.slug];
  if (k.slug === "koebenhavn") return (steder[k.slug] = { by: "København", lat: 55.679, lon: 12.58 });
  const by = BY[k.slug] || k.navn;
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=dk&q=${encodeURIComponent(by)}`,
    { headers: { "User-Agent": "Sagsvagt/1.0 (+https://sagsvagt.dk; mansa@sagsvagt.dk)" } });
  await vent(1100); // Nominatim: højst ét opslag i sekundet
  const j = await r.json();
  if (!j[0]) throw new Error(`fandt ikke ${by}`);
  return (steder[k.slug] = { by, lat: +j[0].lat, lon: +j[0].lon });
}

async function main() {
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const steder = JSON.parse(await readFile(STEDER, "utf8").catch(() => "{}"));
  const { fontFiles } = await indlaesSkrift(ROD);
  let nye = 0, fejl = 0;
  for (const s of STOERRELSER) await mkdir(join(ROD, s.mappe), { recursive: true });
  for (const k of aabne) {
    const mangler = [];
    for (const s of STOERRELSER) if (!(await findes(join(ROD, s.mappe, `${k.slug}.jpg`)))) mangler.push(s);
    if (!mangler.length) continue;
    try {
      const { lat, lon } = await hovedby(k, steder);
      for (const s of mangler) {
        const [cx, cy] = px(lon, lat, s.z);
        const fliser = await hentFliser(s.z, cx - s.W / 2, cy - s.H / 2, s.W, s.H);
        await writeFile(join(ROD, s.mappe, `${k.slug}.jpg`), svgTilJpeg(svg(fliser, s.W, s.H), fontFiles, s.kvalitet));
        nye++;
      }
    } catch (e) { fejl++; console.warn(`Natkort til ${k.navn} mislykkedes: ${e.message}`); }
  }
  await writeFile(STEDER, JSON.stringify(steder, null, 1));
  console.log(`Natkort: ${nye} nye, ${fejl} fejl, ${aabne.length} åbne kommuner.`);
}

main().catch((e) => { console.warn("Natkort sprunget over:", e.message); });
