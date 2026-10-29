// Ordindeks til søgning i hele sagsteksten. Søgesiden, Min avis og mandagsmailen kender kun overskrift, resumé og et kort
// uddrag (sager.json); hele teksten (alle afsnit og bilagenes navne) ligger i data/*.json og er for stor til telefonen.
// Her laves ét indeks pr. åben kommune, api/_ord-<slug>.txt, som api/soeg.php slår op i (api/_ord.php).
//
// Format: første linje er "#<antal sager>", derefter én linje pr. ord, sorteret byte for byte: "ord<TAB>3,17,250".
// Tallene er sagens plads i kommunens sager.json (assets/sager.json for København), så svaret er kort.
// Antallet står øverst, så den, der spørger, kan se, om indekset og sager.json er fra samme kørsel.
// Filerne bygges af robotten efter avisen og hører ikke til i repoet (.gitignore). Kør: node avis/ordindeks.mjs
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");

// Samme opdeling som api/_ord.php: små bogstaver, alt andet end bogstaver og tal skiller ordene
const ordAf = (tekst) => String(tekst || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((o) => o.length > 1 && !/^\d+$/.test(o));

const tekstAf = (s, r) => [s.t, s.d, s.x, s.u, r?.titel, ...(r?.afsnit || []).flatMap((a) => [a.titel, a.tekst]), ...(r?.bilag || []).map((b) => b.navn)].join(" ");

async function bygOrdindeks() {
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const lavet = new Set();
  let ialt = 0;
  for (const { slug } of aabne) {
    const offentlig = slug === "koebenhavn" ? join(ROD, "assets", "sager.json") : join(ROD, "kommune", slug, "sager.json");
    const sager = JSON.parse(await readFile(offentlig, "utf8").catch(() => '{"sager":[]}')).sager;
    const raa = JSON.parse(await readFile(join(ROD, "data", `${slug === "koebenhavn" ? "kk" : slug}.json`), "utf8").catch(() => '{"sager":{}}')).sager || {};
    const ord = new Map();
    sager.forEach((s, i) => {
      for (const o of new Set(ordAf(tekstAf(s, raa[s.id])))) (ord.get(o) || ord.set(o, []).get(o)).push(i);
    });
    // Sorteret efter tegnenes kodepunkt, som strcmp i PHP sorterer UTF-8
    const linjer = [...ord.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((o) => `${o}\t${ord.get(o).join(",")}`);
    const fil = `_ord-${slug}.txt`;
    await writeFile(join(ROD, "api", fil), `#${sager.length}\n${linjer.join("\n")}\n`);
    lavet.add(fil); ialt += sager.length;
  }
  // Kommuner, der ikke længere er åbne
  for (const f of await readdir(join(ROD, "api"))) if (/^_ord-.+\.txt$/.test(f) && !lavet.has(f)) await unlink(join(ROD, "api", f));
  return { kommuner: lavet.size, sager: ialt };
}

const t = Date.now(), r = await bygOrdindeks();
console.log(`Ordindeks: ${r.sager} sager i ${r.kommuner} kommuner (${((Date.now() - t) / 1000).toFixed(1)} s)`);
