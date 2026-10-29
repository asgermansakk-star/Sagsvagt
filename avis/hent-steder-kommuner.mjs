// Henter stednavne (gader, pladser, parker, skoler) og byer/bydele for de andre åbne kommuner fra OpenStreetMap
// og gemmer dem i avis/steder/<kommune>.json, ligesom avis/hent-steder.mjs gør for København. Køres i hånden af og til:
//   node avis/hent-steder-kommuner.mjs            (alle aktive kommuner i avis/firstagenda.json)
//   node avis/hent-steder-kommuner.mjs viborg     (kun én)
// Data © OpenStreetMap-bidragydere, ODbL. Siderne nævner kilden.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SPEJLE = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kommuner = JSON.parse(await readFile(join(import.meta.dirname, "kommuner.json"), "utf8"));
const aktive = JSON.parse(await readFile(join(import.meta.dirname, "firstagenda.json"), "utf8")).filter((k) => k.aktiv && (!process.argv[2] || k.slug === process.argv[2]));
await mkdir(join(import.meta.dirname, "steder"), { recursive: true });

for (const fa of aktive) {
  const k = kommuner.find((x) => x.navn === fa.kommune);
  if (!k) { console.warn(`${fa.kommune}: findes ikke i kommuner.json`); continue; }
  // Kommunen findes som det administrative område (admin_level 7) med kommunens navn
  const Q = `[out:json][timeout:170];area["boundary"="administrative"]["admin_level"="7"]["name"="${k.kommune}"]->.k;(
way["highway"]["name"](area.k);
nwr["leisure"~"park|garden|playground|sports_centre|nature_reserve"]["name"](area.k);
nwr["place"~"square|neighbourhood|quarter|locality|island|suburb|town|village|city"]["name"](area.k);
nwr["amenity"~"school|library|community_centre|kindergarten"]["name"](area.k);
nwr["landuse"~"allotments|cemetery|recreation_ground"]["name"](area.k);
nwr["natural"~"water|wood"]["name"](area.k););out tags;`;
  let data = null;
  for (const url of SPEJLE) {
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: Q }), headers: { "User-Agent": "Sagsvagt/1.0 (mansa@sagsvagt.dk)" } });
      if (!r.ok) { console.warn(`${k.navn} ${url}: HTTP ${r.status}`); continue; }
      data = await r.json(); if (data.elements?.length) break;
      console.warn(`${k.navn} ${url}: tomt svar ${data.remark || ""}`);
    } catch (e) { console.warn(`${k.navn} ${url}: ${e.message}`); }
  }
  if (!data?.elements?.length) { console.error(`${k.navn}: fik ingen steder`); continue; }
  // Byer og bydele (place=town/village/suburb/…) bliver til "Bydele"; resten til "Steder". Kommunens eget navn
  // springes over, for det står i næsten alle sager ("Viborg Kommune").
  const ok = (n) => n.length >= 4 && /^[A-ZÆØÅ]/.test(n) && n !== k.navn && !/^Vej \d/.test(n);
  const byer = [...new Set(data.elements.filter((e) => /^(town|village|suburb|neighbourhood|quarter|city)$/.test(e.tags.place || "")).map((e) => e.tags.name.trim()))].filter(ok).sort((a, b) => a.localeCompare(b, "da"));
  const navne = [...new Set(data.elements.map((e) => e.tags.name.trim()))].filter((n) => ok(n) && n.length >= 5 && !byer.includes(n)).sort((a, b) => a.localeCompare(b, "da"));
  await writeFile(join(import.meta.dirname, "steder", `${k.slug}.json`), JSON.stringify({ kilde: "© OpenStreetMap-bidragydere (ODbL)", hentet: new Date().toISOString().slice(0, 10), byer, navne }));
  console.log(`${k.navn}: ${byer.length} byer og bydele, ${navne.length} stednavne`);
  await sleep(8000); // vær flink ved Overpass
}
