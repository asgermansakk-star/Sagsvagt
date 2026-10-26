// Sagsvagt Erhverv: kommunernes EU-udbud fra TED (Tenders Electronic Daily, EU's udbudsdatabase). Åbne data uden nøgle.
// Henter alle danske bekendtgørelser de seneste DAGE dage og beholder dem, hvor en åben kommune er ordregiver (også fælles
// udbud, hvor flere kommuner står som ordregivere). Tre slags er med:
//   kommer  forhåndsmeddelelser og markedsdialog (pin-*): udbud, der er på vej
//   aaben   udbudsbekendtgørelser (cn-*), med tilbudsfrist
//   vundet  tildelinger (can-*), med vinder og kontraktværdi
// Skrives til data/udbud.json; avis/signaler.mjs --indeks lægger dem i signalindekset til kundernes rapport.
//
// Kør: node avis/udbud.mjs   (fejler aldrig robotten: ved fejl beholdes den gamle fil)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const DAGE = 150;
const API = "https://api.ted.europa.eu/v3/notices/search";
const FELTER = ["publication-number", "notice-title", "buyer-name", "publication-date", "deadline-receipt-tender-date-lot", "notice-type",
  "estimated-value-lot", "total-value", "winner-name", "classification-cpv", "description-lot"];

// CPV-koderne grupperet, så kunden kan se de udbud, der angår deres branche
const GRUPPER = [
  ["bygge", "Bygge og anlæg", /^45/],
  ["raadgivning", "Rådgivning og arkitekter", /^71/],
  ["energi", "Energi og forsyning", /^(09|65|3112|3121|3152|4525|7131)/],
  ["ejendom", "Ejendomme og drift", /^(70|7999|5070|9091)/],
];

const dag = (d) => String(d || "").slice(0, 10);
const foerste = (x) => (Array.isArray(x) ? x[0] : x);
const dansk = (o) => (o && typeof o === "object" ? foerste(o.dan) || foerste(Object.values(o)[0]) : o) || "";

async function hent(side, fra) {
  const svar = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Sagsvagt/1.0 (sagsvagt.dk)" },
    body: JSON.stringify({ query: `organisation-country-buyer=DNK AND publication-date>=${fra}`, fields: FELTER, limit: 250, page: side }),
    signal: AbortSignal.timeout(60000),
  });
  if (!svar.ok) throw new Error(`TED svarede ${svar.status}`);
  return svar.json();
}

async function main() {
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  // "Vejle Kommune", "Københavns Kommune", "Faaborg-Midtfyn kommune": kommunens navn efterfulgt af (s) kommune
  const kommuner = aabne.map(({ slug, navn }) => ({ slug, rx: new RegExp(`(^|[\\s,(])${navn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s? kommune\\b`, "i") }));
  const fra = new Date(Date.now() - DAGE * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const alle = [];
  for (let side = 1; side <= 40; side++) {
    const j = await hent(side, fra);
    alle.push(...j.notices);
    if (j.notices.length < 250) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const ud = [];
  for (const n of alle) {
    const ordregivere = [n["buyer-name"]?.dan || Object.values(n["buyer-name"] || {})[0] || []].flat();
    const k = kommuner.filter((x) => ordregivere.some((o) => x.rx.test(o))).map((x) => x.slug);
    if (!k.length) continue;
    const type = String(n["notice-type"] || "");
    const art = type.startsWith("pin") ? "kommer" : type.startsWith("cn") ? "aaben" : type.startsWith("can") || type === "veat" ? "vundet" : null;
    if (!art) continue;
    // Titlen er "Danmark – <CPV-betegnelse> – <udbuddets navn>"; kategorien og navnet holdes hver for sig
    const dele = dansk(n["notice-title"]).split(" – ");
    const cpv = [...new Set([n["classification-cpv"] || []].flat())];
    const vaerdi = Number(n["total-value"] || foerste(n["estimated-value-lot"]) || 0) || null;
    const beskr = dansk(n["description-lot"]).replace(/\s+/g, " ").replace(/-{5,}/g, "").trim();
    ud.push({
      id: n["publication-number"], art, k, ordregivere: ordregivere.slice(0, 6),
      titel: dele.length > 2 ? dele.slice(2).join(" – ") : dele.at(-1), kategori: dele.length > 2 ? dele[1] : "",
      dato: dag(n["publication-date"]), frist: dag(foerste(n["deadline-receipt-tender-date-lot"])) || null, vaerdi,
      vinder: [...new Set([n["winner-name"]?.dan || Object.values(n["winner-name"] || {})[0] || []].flat())].slice(0, 4),
      g: GRUPPER.filter(([, , rx]) => cpv.some((c) => rx.test(c))).map(([id]) => id),
      d: beskr.length > 400 ? `${beskr.slice(0, 397).replace(/\s\S*$/, "")} …` : beskr,
      url: `https://ted.europa.eu/da/notice/-/detail/${n["publication-number"]}`,
    });
  }
  ud.sort((a, b) => b.dato.localeCompare(a.dato));
  await writeFile(join(ROD, "data", "udbud.json"), JSON.stringify({ hentet: new Date().toISOString(), dage: DAGE,
    grupper: GRUPPER.map(([id, navn]) => ({ id, navn })), udbud: ud }) + "\n");
  const t = (a) => ud.filter((u) => u.art === a).length;
  console.log(`Udbud: ${alle.length} danske bekendtgørelser, ${ud.length} fra åbne kommuner (${t("kommer")} på vej, ${t("aaben")} åbne, ${t("vundet")} tildelt)`);
}

main().catch((e) => { console.error(`Udbud: ${e.message} (den gamle data/udbud.json beholdes)`); });
