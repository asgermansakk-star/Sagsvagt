// Laver en mandagsmail ud fra assets/sager.json, så den kan ses eller sendes.
// Kør fx: node avis/mandagsmail.mjs --emner trafik,klima --ord "Lersøparken" --bydel "Valby Lokaludvalg" --navn Asger
// Mailen skrives som .html og .txt i ../mandagsmails/ (uden for hjemmesiden). Udsendelse kræver en mailtjeneste og er ikke bygget endnu.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { lavMandagsmail } from "../assets/mandagsmail.js";

const ROD = join(import.meta.dirname, "..");
const { values: a } = parseArgs({ options: {
  emner: { type: "string", default: "trafik,klima,byggeri" }, ord: { type: "string", default: "" }, bydel: { type: "string", default: "" },
  navn: { type: "string", default: "" }, til: { type: "string", default: "" }, dato: { type: "string" }, ud: { type: "string", default: join(ROD, "..", "mandagsmails") },
} });
// Mens avisen er lukket, linker sagerne til kommunens egen side. Når avisen åbner, skal de linke til sagsvagt.dk.
const AVIS_AABEN = false;

const data = JSON.parse(await readFile(join(ROD, "assets", "sager.json"), "utf8"));
const idag = a.dato || new Date().toISOString().slice(0, 10);
const profil = { navn: a.navn, emner: a.emner.split(",").map((x) => x.trim()).filter(Boolean), ord: a.ord.split(",").map((x) => x.trim()).filter(Boolean), bydel: a.bydel };
const mail = lavMandagsmail({ data, profil, idag, modtager: a.til, linkTil: (s) => (AVIS_AABEN ? `https://sagsvagt.dk/${s.url}` : s.k) });

await mkdir(a.ud, { recursive: true });
const navn = `mandagsmail-${idag}${a.navn ? `-${a.navn.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-")}` : ""}`;
await writeFile(join(a.ud, `${navn}.html`), mail.html);
await writeFile(join(a.ud, `${navn}.txt`), `Emne: ${mail.emne}\n\n${mail.tekst}`);
console.log(`${mail.emne}\n${mail.antal.besluttet} besluttet, ${mail.antal.kommer} på vej, ${mail.antal.bydel} fra bydelen\n→ ${join(a.ud, navn)}.html`);
