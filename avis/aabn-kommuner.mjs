// Åbner de næste kommuner i avis/firstagenda.json ("aktiv": false → true), nogle ad gangen.
// Første hentning af en kommune er tung (alle møder de seneste DAGE dage som PDF), og første upload af dens
// sider til webhotellet tager tid. Derfor åbner vi højst BATCH kommuner pr. kørsel (standard 10), i samme
// rækkefølge som avis/kommuner.json (hovedstadsområdet først).
//
// Kør: node avis/aabn-kommuner.mjs         BATCH=5 node avis/aabn-kommuner.mjs
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = import.meta.dirname;
const BATCH = Number(process.env.BATCH ?? 10);
const idag = new Date().toISOString().slice(0, 10);
const orden = JSON.parse(await readFile(join(DIR, "kommuner.json"), "utf8")).map((k) => k.slug);
const fa = JSON.parse(await readFile(join(DIR, "firstagenda.json"), "utf8"));

const naeste = fa.filter((k) => !k.aktiv && !k.pause).sort((a, b) => orden.indexOf(a.slug) - orden.indexOf(b.slug)).slice(0, BATCH);
for (const k of naeste) { k.aktiv = true; k.aabnet = idag; }

await writeFile(join(DIR, "firstagenda.json"), "[\n" + fa.map((k) => " " + JSON.stringify(k).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/,"/g, ', "').replace(/":/g, '": ')).join(",\n") + "\n]\n");
const tilbage = fa.filter((k) => !k.aktiv && !k.pause).length;
console.log(naeste.length ? `Åbner ${naeste.map((k) => k.kommune).join(", ")}. ${tilbage} venter.` : "Ingen nye kommuner at åbne.");
