// Laver en mandagsmail for en eller flere kommuner, så den kan ses eller sendes. København ligger i assets/sager.json,
// de andre åbne kommuner i kommune/<slug>/sager.json.
// Kør fx: node avis/mandagsmail.mjs --emner trafik,klima --ord "Lersøparken" --bydel "Valby Lokaludvalg" --navn Asger
//         node avis/mandagsmail.mjs --kommune albertslund,herning --emner skole,klima --navn Inge
// Mailen skrives som .html og .txt i ../mandagsmails/ (uden for hjemmesiden). Udsendelse kræver en mailtjeneste og er ikke bygget endnu.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { lavMandagsmail } from "../assets/mandagsmail.js";

const ROD = join(import.meta.dirname, "..");
const { values: a } = parseArgs({ options: {
  kommune: { type: "string", default: "koebenhavn" }, emner: { type: "string", default: "trafik,klima,byggeri" }, ord: { type: "string", default: "" }, bydel: { type: "string", default: "" },
  navn: { type: "string", default: "" }, til: { type: "string", default: "" }, dato: { type: "string" }, ud: { type: "string", default: join(ROD, "..", "mandagsmails") },
} });
// Avisen er åben (som i Min avis), så sagerne linker til sagsvagt.dk. Sæt false for at linke til kommunens egen side.
const AVIS_AABEN = true;

const slugs = a.kommune.split(",").map((x) => x.trim()).filter(Boolean);
const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8").catch(() => '[{"navn":"København","slug":"koebenhavn"}]'));
const navnPaa = (s) => aabne.find((k) => k.slug === s)?.navn || s;
const filer = await Promise.all(slugs.map(async (s) => ({ s, d: JSON.parse(await readFile(s === "koebenhavn" ? join(ROD, "assets", "sager.json") : join(ROD, "kommune", s, "sager.json"), "utf8")) })));
// Som i Min avis: sagerne fra alle kommunerne i én liste, med kommunen på (ks/kn), og standardværdier for ældre filer
const data = { emner: filer[0].d.emner, moeder: filer.flatMap((f) => f.d.moeder || []), sager: filer.flatMap(({ s, d }) => d.sager.map((x) => ({ et: [], v: 0, r: 0, ...x, ks: s, kn: navnPaa(s) }))) };
const idag = a.dato || new Date().toISOString().slice(0, 10);
const profil = { navn: a.navn, emner: a.emner.split(",").map((x) => x.trim()).filter(Boolean), ord: a.ord.split(",").map((x) => x.trim()).filter(Boolean), bydel: a.bydel };
const mail = lavMandagsmail({ data, profil, idag, modtager: a.til, linkTil: (s) => (AVIS_AABEN ? `https://sagsvagt.dk/${s.url}` : s.k) });

await mkdir(a.ud, { recursive: true });
const navn = `mandagsmail-${idag}${a.navn ? `-${a.navn.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-")}` : ""}`;
await writeFile(join(a.ud, `${navn}.html`), mail.html);
await writeFile(join(a.ud, `${navn}.txt`), `Emne: ${mail.emne}\n\n${mail.tekst}`);
console.log(`${mail.emne}\n${mail.antal.besluttet} besluttet, ${mail.antal.kommer} på vej, ${mail.antal.bydel} fra bydelen\n→ ${join(a.ud, navn)}.html`);
