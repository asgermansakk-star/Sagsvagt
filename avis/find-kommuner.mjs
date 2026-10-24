// Finder FirstAgenda-portalen (dagsordener.<kommune>.dk) for de kommuner, vi ikke har endnu, og skriver dem ind i
// avis/firstagenda.json med "aktiv": false. avis/aabn-kommuner.mjs åbner dem derefter nogle ad gangen.
//
// Vi rører kun det, robots.txt tillader: /robots.txt og /sitemap.xml. En portal tæller som FirstAgenda, når
// sitemappet har udvalgssitemaps (/Sitemap/ForCommittee). Kommuner uden FirstAgenda skrives i
// avis/kommune-status.json, så vi kan se, hvem der skal have deres egen løsning.
//
// Kør: node avis/find-kommuner.mjs           (kun kommuner, der ikke er tjekket den seneste uge)
//      ALLE=1 node avis/find-kommuner.mjs    (tjek alle igen)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = import.meta.dirname;
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";
const PRAEFIKS = ["dagsordener", "dagsordner", "dagsorden", "dagsordener-referater", "dagsordenerogreferater", "referater", "politik", "moeder", "udvalg"];
const idag = new Date().toISOString().slice(0, 10);
const enUge = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

const ascii = (s, oe) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, oe ? "oe" : "o").replace(/å/g, oe ? "aa" : "a").replace(/[^a-z0-9-]/g, "");

// Kandidat-domæner: kommunens eget webdomæne (uden www) og navnet stavet på de måder, kommunerne bruger
function domaener(k) {
  const d = new Set();
  try { d.add(new URL(k.web).hostname.replace(/^www\./, "")); } catch {}
  for (const oe of [false, true]) {
    const n = ascii(k.navn.replace(/\s+/g, "-"), oe);
    d.add(`${n}.dk`); d.add(`${n}kommune.dk`); d.add(`${n}-kommune.dk`);
  }
  return [...d];
}

// FirstAgenda sender første besøg via /Home/AnonymousAuthentication, som sætter en anonym cookie og sender videre.
// Derfor bruger vi høsterens klient, der husker cookies (kun kortere pause, da hver host kun får få forespørgsler).
process.env.PAUSE_MS ??= "300";
const { klient } = await import("./hent-firstagenda.mjs");

async function erFirstAgenda(host) {
  try {
    const hent = klient(`https://${host}`);
    const tekst = await Promise.race([hent("/sitemap.xml"), new Promise((_, nej) => setTimeout(() => nej(new Error("timeout")), 20000))]);
    if (!/Sitemap\/ForCommittee/i.test(tekst)) return null;
    return { base: `https://${host}`, udvalg: (tekst.match(/ForCommittee/gi) || []).length };
  } catch { return null; }
}

async function findKommune(k) {
  for (const dom of domaener(k)) for (const p of PRAEFIKS) {
    const r = await erFirstAgenda(`${p}.${dom}`);
    if (r) return r;
  }
  return null;
}

const kommuner = JSON.parse(await readFile(join(DIR, "kommuner.json"), "utf8"));
const fa = JSON.parse(await readFile(join(DIR, "firstagenda.json"), "utf8"));
const status = await readFile(join(DIR, "kommune-status.json"), "utf8").then(JSON.parse).catch(() => ({}));
const kendt = new Set(fa.map((k) => k.slug));
const tjek = kommuner.filter((k) => k.slug !== "koebenhavn" && !kendt.has(k.slug) && (process.env.ALLE || !(status[k.slug]?.tjekket >= enUge)));
console.log(`Tjekker ${tjek.length} kommuner for FirstAgenda …`);

const koe = [...tjek];
let fundet = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  for (let k; (k = koe.shift()); ) {
    const r = await findKommune(k);
    if (r) {
      fa.push({ slug: k.slug, kommune: k.navn, base: r.base, aktiv: false, fundet: idag });
      status[k.slug] = { system: "firstagenda", base: r.base, udvalg: r.udvalg, tjekket: idag };
      fundet++;
      console.log(`  ✓ ${k.navn}: ${r.base} (${r.udvalg} udvalg)`);
    } else {
      status[k.slug] = { system: "ukendt", tjekket: idag };
      console.log(`  – ${k.navn}: ingen FirstAgenda-portal fundet`);
    }
  }
}));

await writeFile(join(DIR, "firstagenda.json"), "[\n" + fa.map((k) => " " + JSON.stringify(k).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/,"/g, ', "').replace(/":/g, '": ')).join(",\n") + "\n]\n");
await writeFile(join(DIR, "kommune-status.json"), JSON.stringify(Object.fromEntries(Object.entries(status).sort()), null, 1) + "\n");
const ukendte = Object.entries(status).filter(([, s]) => s.system === "ukendt").map(([s]) => s);
console.log(`${fundet} nye FirstAgenda-kommuner fundet. Uden FirstAgenda (kræver egen løsning): ${ukendte.length ? ukendte.join(", ") : "ingen"}`);
