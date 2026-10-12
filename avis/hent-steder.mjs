// Henter navne på gader, pladser, parker, skoler og kvarterer i Københavns Kommune fra OpenStreetMap
// og gemmer dem i avis/steder-kk.json. Køres i hånden af og til (navnene skifter sjældent):
//   node avis/hent-steder.mjs
// Data © OpenStreetMap-bidragydere, ODbL. Stedsiderne nævner kilden.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
// Københavns Kommune findes som det område (admin_level 7), Rådhuspladsen ligger i
const Q = `[out:json][timeout:170];is_in(55.6761,12.5683)->.a;area.a["admin_level"="7"]->.k;(
way["highway"]["name"](area.k);
nwr["leisure"~"park|garden|playground|sports_centre|nature_reserve"]["name"](area.k);
nwr["place"~"square|neighbourhood|quarter|locality|island|suburb"]["name"](area.k);
nwr["amenity"~"school|library|community_centre|kindergarten"]["name"](area.k);
nwr["landuse"~"allotments|cemetery|recreation_ground"]["name"](area.k);
nwr["natural"~"water|wood"]["name"](area.k););out tags;`;

const SPEJLE = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
// Et tidligere svar fra Overpass kan gives som fil, hvis serverne er travle: node avis/hent-steder.mjs svar.json
let data = process.argv[2] ? JSON.parse(await readFile(process.argv[2], "utf8")) : null;
for (const url of data ? [] : SPEJLE) {
  try {
    const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: Q }), headers: { "User-Agent": "Sagsvagt/1.0 (mansa@sagsvagt.dk)" } });
    if (!r.ok) { console.warn(`${url}: HTTP ${r.status}`); continue; }
    data = await r.json(); if (data.elements?.length) break;
    console.warn(`${url}: tomt svar ${data.remark || ""}`);
  } catch (e) { console.warn(`${url}: ${e.message}`); }
}
if (!data?.elements?.length) throw new Error("Fik ingen steder fra OpenStreetMap");

// Bydelene har deres egne sider, og korte eller nummererede navne ("Vej 3") giver falske fund
const UD = /^(København|Frederiksberg|Valby|Vanløse|Nørrebro|Østerbro|Vesterbro|Amager|Amager Øst|Amager Vest|Christianshavn|Indre By|Bispebjerg|Brønshøj|Husum|Kongens Enghave|Sydhavnen)$|^Vej \d/;
const navne = [...new Set(data.elements.map((e) => e.tags.name.trim()))]
  .filter((n) => n.length >= 5 && /^[A-ZÆØÅ]/.test(n) && !UD.test(n))
  .sort((a, b) => a.localeCompare(b, "da"));
await writeFile(join(ROD, "avis", "steder-kk.json"), JSON.stringify({ kilde: "© OpenStreetMap-bidragydere (ODbL)", hentet: new Date().toISOString().slice(0, 10), navne }, null, 0));
console.log(`${navne.length} stednavne gemt i avis/steder-kk.json`);
