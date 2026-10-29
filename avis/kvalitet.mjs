// Kvalitetstjek af hver kommunes data: er der kommet møder, kan PDF'erne læses, har referaterne en beslutning,
// og er titlerne til at læse? Skriver avis/kvalitet.json og en tabel til GitHub Actions' oversigt.
// Det er ikke en test, der fejler kørslen; det er en liste over, hvor parseren skal forbedres.
//
// Kør: node avis/kvalitet.mjs
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const idag = new Date().toISOString().slice(0, 10);
const dageSiden = (iso) => Math.round((Date.parse(idag) - Date.parse(iso)) / 864e5);
const laengde = (s) => (s.afsnit || []).reduce((n, a) => n + a.tekst.length, 0);

const fa = JSON.parse(await readFile(join(import.meta.dirname, "firstagenda.json"), "utf8"));
const rapport = {};
for (const k of fa.filter((k) => k.aktiv)) {
  const g = await readFile(join(ROD, "data", `${k.slug}.json`), "utf8").then(JSON.parse).catch(() => null);
  if (!g) { rapport[k.slug] = { kommune: k.kommune, fejl: ["Ingen data endnu"] }; continue; }
  const S = Object.values(g.sager), D = Object.values(g.dokumenter || {});
  const rigtige = S.filter((s) => laengde(s) > 250);
  const ref = rigtige.filter((s) => s.type === "referat");
  const udenBeslutning = ref.filter((s) => !s.afsnit.some((a) => /^(Beslutning|Behandling)/.test(a.titel)));
  const nulMoeder = D.filter((d) => d.punkter === 0);
  const versaler = S.filter((s) => s.titel.length > 12 && s.titel === s.titel.toUpperCase());
  const nyeste = S.reduce((m, s) => (s.dato <= idag && s.dato > m ? s.dato : m), "");
  const r = {
    kommune: k.kommune, moeder: D.length, udvalg: new Set(D.map((d) => d.udvalg)).size, punkter: S.length, sager: rigtige.length,
    referater: ref.length, udenBeslutning: udenBeslutning.length, nulMoeder: nulMoeder.length, versaltitler: versaler.length,
    nyesteMoede: nyeste, opdateret: g.opdateret?.slice(0, 10),
  };
  const fejl = [];
  if (!D.length) fejl.push("Ingen møder fundet i sitemappet");
  if (D.length && nulMoeder.length / D.length > 0.25) fejl.push(`${nulMoeder.length} af ${D.length} møder gav ingen punkter (PDF'en kunne ikke læses)`);
  if (ref.length >= 10 && udenBeslutning.length / ref.length > 0.15) fejl.push(`${udenBeslutning.length} af ${ref.length} referater mangler beslutningen`);
  if (versaler.length > 5) fejl.push(`${versaler.length} titler med versaler`);
  if (nyeste && dageSiden(nyeste) > 45) fejl.push(`Seneste møde er ${dageSiden(nyeste)} dage gammelt`);
  r.fejl = fejl;
  r.eksempler = udenBeslutning.slice(0, 3).map((s) => s.kilde);
  rapport[k.slug] = r;
}
await writeFile(join(import.meta.dirname, "kvalitet.json"), JSON.stringify({ lavet: idag, kommuner: rapport }, null, 1) + "\n");

const linjer = ["| Kommune | Møder | Udvalg | Sager | Referater uden beslutning | Tomme møder | Seneste møde | Problemer |", "|---|---|---|---|---|---|---|---|"];
for (const r of Object.values(rapport).sort((a, b) => (b.fejl?.length || 0) - (a.fejl?.length || 0) || a.kommune.localeCompare(b.kommune, "da"))) {
  linjer.push(`| ${r.kommune} | ${r.moeder ?? 0} | ${r.udvalg ?? 0} | ${r.sager ?? 0} | ${r.udenBeslutning ?? "-"} | ${r.nulMoeder ?? "-"} | ${r.nyesteMoede || "-"} | ${r.fejl.join("; ") || "OK"} |`);
}
const tekst = `## Kvalitet pr. kommune (${idag})\n\n${linjer.join("\n")}\n`;
console.log(tekst);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, tekst);
