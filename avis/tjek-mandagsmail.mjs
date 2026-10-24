// Tjekker, at serverens mandagsmail (api/_mandagsmail_lav.php) er den samme som browserens (assets/mandagsmail.js og
// assets/profil.js), tegn for tegn, for en række forskellige tilmeldte og to uger. Kræver php på stien.
// Kør: node avis/tjek-mandagsmail.mjs            (fejler, hvis bare én mail er forskellig)
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { lavMandagsmail, lavVentemail } from "../assets/mandagsmail.js";
import { profilFor } from "../assets/profil.js";

const ROD = join(import.meta.dirname, "..");
const SITE = "https://sagsvagt.dk/";
const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
const fil = (slug) => join(ROD, slug === "koebenhavn" ? "assets/sager.json" : `kommune/${slug}/sager.json`);
const CACHE = new Map();
const hent = async (slug) => { if (!CACHE.has(slug)) CACHE.set(slug, JSON.parse(await readFile(fil(slug), "utf8"))); return CACHE.get(slug); };

// Forskellige slags tilmeldte: Min avis-profil, fritekst, egne ord, bydel, flere kommuner, ingen åben kommune, ingen emner
const enAf = (...s) => s.find((x) => aabne.some((k) => k.slug === x)) || aabne[1].slug;
const p = (o) => JSON.stringify(o);
const TILMELDTE = [
  { email: "a@test.invalid", kommuner: "København", emner: "", profil: p({ emner: ["trafik", "klima"], ord: ["Lersøparken"], bydel: "Valby Lokaludvalg", navn: "Asger" }) },
  { email: "b@test.invalid", kommuner: "Herning", emner: "Trafik og cykler, Klima og grønt", profil: null },
  { email: "c@test.invalid", kommuner: "Lyngby, Albertslund", emner: "Byplan, børn, ældre, vej og park", profil: null },
  { email: "d@test.invalid", kommuner: "Esbjerg og Odense", emner: "skoler", profil: p({ kommuner: [enAf("odense", "herning"), enAf("horsens", "viborg")], emner: [], ord: ["skole"] }) },
  { email: "e@test.invalid", kommuner: "Aarhus", emner: "affald", profil: null },
  { email: "f@test.invalid", kommuner: "", emner: "", profil: null },
  { email: "g@test.invalid", kommuner: "Viborg", emner: "", profil: null },
  { email: "h@test.invalid", kommuner: "Københavns Kommune", emner: "Solceller", profil: p({ navn: "Inge", emner: ["byggeri"], ord: ["Kommunehospitalet", "metro"] }) },
  { email: "i@test.invalid", kommuner: "Guldborgsund", emner: "solceller, trafik og klima", profil: null },
];
const AFMELD = "https://sagsvagt.dk/api/afmeld.php?id=1&t=abc";
const UGER = ["2026-10-19", "2026-10-26"];

// Som forbered() i min/admin.html
async function jsMail(a, uge) {
  const slugs = aabne.map((k) => k.slug), navnPaa = Object.fromEntries(aabne.map((k) => [k.slug, k.navn]));
  const EMNER = (await hent("koebenhavn")).emner;
  const pr = profilFor(a, EMNER, slugs);
  const skrevne = (t) => (t || "").split(/,|\/|\s+og\s+/i).map((x) => x.trim().replace(/\s+kommunes?$/i, "")).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1));
  if (!pr.kommuner.length) return lavVentemail({ kommuner: skrevne(a.kommuner), aabne: aabne.map((k) => k.navn), idag: uge, navn: pr.navn, modtager: a.email, afmeld: AFMELD });
  const udenEmner = !pr.emner.length && !pr.ord.length;
  const data = await Promise.all(pr.kommuner.map(async (s) => { const x = await hent(s); return { ...x, sager: x.sager.map((y) => ({ et: [], v: 0, r: 0, ...y, ks: s, kn: navnPaa[s] })) }; }));
  const m = lavMandagsmail({ data: { emner: data[0].emner, sager: data.flatMap((x) => x.sager) }, profil: udenEmner ? { ...pr, emner: Object.keys(EMNER) } : pr, idag: uge, modtager: a.email, afmeld: AFMELD, linkTil: (s) => SITE + s.url });
  return udenEmner ? { ...m, emne: m.emne.replace(/ om dine emner$/, " i din kommune") } : m;
}

const php = `<?php
require ${JSON.stringify(join(ROD, "api", "_mandagsmail_lav.php"))};
$in = json_decode(stream_get_contents(STDIN), true);
$cache = [];
$hent = function ($slug) use (&$cache, $in) { return $cache[$slug] ??= json_decode(file_get_contents($in['filer'][$slug]), true); };
$ud = [];
foreach ($in['uger'] as $uge) foreach ($in['tilmeldte'] as $a) $ud[] = mm_mail_til($a, $uge, $in['aabne'], $hent, $in['afmeld'])['mail'];
echo json_encode($ud, JSON_UNESCAPED_UNICODE);`;
const filer = Object.fromEntries(aabne.map((k) => [k.slug, fil(k.slug)]));
const kort = join(await mkdtemp(join(tmpdir(), "mm-")), "tjek.php");
await writeFile(kort, php);
const phpUd = JSON.parse(execFileSync("php", ["-d", "memory_limit=1G", "-d", "display_errors=stderr", kort],
  { input: JSON.stringify({ uger: UGER, tilmeldte: TILMELDTE, aabne, filer, afmeld: AFMELD }), encoding: "utf8", maxBuffer: 1 << 28 }));

let i = 0, fejl = 0;
for (const uge of UGER) for (const a of TILMELDTE) {
  const js = await jsMail(a, uge), ph = phpUd[i++];
  for (const k of ["emne", "preheader", "html", "tekst"]) {
    if (js[k] === ph?.[k]) continue;
    fejl++;
    const n = [...js[k]].findIndex((c, j) => c !== [...(ph?.[k] || "")][j]);
    console.log(`FORSKEL ${uge} ${a.email} ${k} ved tegn ${n}:\n  JS:  ${JSON.stringify(js[k].slice(Math.max(0, n - 60), n + 80))}\n  PHP: ${JSON.stringify((ph?.[k] || "").slice(Math.max(0, n - 60), n + 80))}`);
  }
}
console.log(fejl ? `${fejl} forskelle i ${i} mails.` : `Ens: ${i} mails, ${UGER.length} uger, ${TILMELDTE.length} slags tilmeldte.`);
process.exit(fejl ? 1 : 0);
