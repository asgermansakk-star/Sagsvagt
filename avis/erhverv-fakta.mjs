// Sagsvagt Erhverv: et projektkort pr. signal, læst ud af hele sagsfremstillingen (ikke kun resuméet), så kunden ser
// hvad, hvor, hvor stort, hvornår, hvem og næste skridt uden at åbne kommunens dokument.
//
// Kortene ligger i avis/erhverv-fakta.json, ét pr. sag (id), og bliver der: et signal læses kun én gang. Uden AI giver
// regnestykket herunder stadig beløbet ("1,7 mio. kr."), som kunderne oftest spørger efter.
//
// Kør: node avis/erhverv-fakta.mjs                  nye signaler med Claude API (kræver ANTHROPIC_API_KEY; ellers kun beløb)
//      MAKS=50 node avis/erhverv-fakta.mjs          højst 50 signaler i denne kørsel (standard 200)
//      node avis/erhverv-fakta.mjs --udtraek vejle kolding   teksterne til de kommuners signaler uden kort
//                                                   i avis/erhverv-fakta-koe.json (til at skrive kortene i Claude Code)
//      node avis/erhverv-fakta.mjs --indlaes fil.json        læg kort skrevet i Claude Code ind (samme skema)
//      node avis/erhverv-fakta.mjs --steder [150]            slå projektkortenes steder op til kortet (OpenStreetMap)
//
// Kun virksomheder, foreninger og myndigheder nævnes som aktører, aldrig privatpersoner. Kortet er Sagsvagts læsning;
// kunden linkes altid til kommunens eget dokument.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROD = join(import.meta.dirname, "..");
const FIL = join(import.meta.dirname, "erhverv-fakta.json");
const MODEL = process.env.ERHVERV_MODEL || "claude-opus-5-5";
const MAKS = Number(process.env.MAKS || 200);
const SAMTIDIG = 4;

export const MULIGHEDER = ["entreprenør", "håndværker", "rådgiver", "arkitekt", "developer", "investor", "mægler", "leverandør", "energi", "drift og service"];
// Strukturerede output: alle felter skal være med; null, når sagen ikke siger det
const tekstEllerNull = { anyOf: [{ type: "string" }, { type: "null" }] };
const talEllerNull = { anyOf: [{ type: "number" }, { type: "null" }] };
export const SKEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hvad", "hvor", "beloeb_kr", "beloeb_tekst", "boliger", "areal_m2", "areal_ha", "tidsplan", "frist", "aktoerer", "naeste", "muligheder", "relevans"],
  properties: {
    hvad: { type: "string", description: "Én kort sætning (højst 25 ord) om selve projektet eller beslutningen, i almindeligt sprog." },
    hvor: { ...tekstEllerNull, description: "Adresse, vej, område eller bydel, hvis sagen nævner det." },
    beloeb_kr: { ...talEllerNull, description: "Projektets største relevante beløb i hele kroner (anlægsbevilling, budget, salgspris). 1,7 mio. kr. = 1700000." },
    beloeb_tekst: { ...tekstEllerNull, description: "Hvad beløbet er, fx 'anlægsbevilling 1,7 mio. kr.' eller 'salgspris 4,2 mio. kr.'." },
    boliger: { ...talEllerNull, description: "Antal boliger, hvis sagen nævner det." },
    areal_m2: { ...talEllerNull, description: "Etageareal eller bebyggelse i m², hvis nævnt." },
    areal_ha: { ...talEllerNull, description: "Grund- eller planområdets størrelse i hektar, hvis nævnt." },
    tidsplan: { ...tekstEllerNull, description: "Tidsplan med datoer eller år, fx 'høring nov.–dec. 2026, byggestart 2027'." },
    frist: { ...tekstEllerNull, description: "Nærmeste frist, en virksomhed kan handle på (høringsfrist, tilbudsfrist, frist for bud), som ÅÅÅÅ-MM-DD. Ellers null." },
    aktoerer: { type: "array", items: { type: "string" }, description: "Virksomheder, foreninger, boligselskaber og myndigheder, der nævnes som bygherre, ejer, køber, rådgiver eller samarbejdspartner. Aldrig privatpersoner." },
    naeste: { ...tekstEllerNull, description: "Næste skridt i sagen, fx 'forslaget sendes i 8 ugers høring' eller 'projektet udbydes i 2027'." },
    muligheder: { type: "array", items: { type: "string", enum: MULIGHEDER }, description: "Hvilke slags virksomheder kan få forretning ud af det." },
    relevans: { type: "integer", enum: [1, 2, 3], description: "3 = konkret projekt med byggeri, salg eller udbud på vej; 2 = plan eller bevilling, der kan blive til et projekt; 1 = orientering eller lille sag." },
  },
};

const SYSTEM = `Du læser sager fra danske kommuners dagsordener og referater for Sagsvagt Erhverv. Kunderne er virksomheder (entreprenører, rådgivere, developere, energiselskaber), der vil vide, hvor der er forretning på vej.
Udfyld projektkortet ud fra sagens egen tekst. Skriv kun, hvad teksten siger; brug null, hvis noget ikke står der, og gæt ikke. Beløb skal stå i hele kroner. Nævn aldrig privatpersoner (heller ikke lodsejere eller borgere med navn); kun virksomheder, foreninger og myndigheder. Skriv på dansk, kort og neutralt.`;

// ---------- Tekster ----------
async function raaSager(slug) {
  const fil = join(ROD, "data", slug === "koebenhavn" ? "kk.json" : `${slug}.json`);
  try {
    const d = JSON.parse(await readFile(fil, "utf8"));
    return new Map((Array.isArray(d.sager) ? d.sager : Object.values(d.sager || {})).map((s) => [s.id, s]));
  } catch { return new Map(); }
}
function sagsTekst(sig, raa) {
  const r = raa?.get(sig.id);
  const afsnit = r?.afsnit?.length ? r.afsnit.map((a) => `## ${a.titel}\n${a.tekst}`).join("\n\n") : sig.d || "";
  const bilag = r?.bilag?.length ? `\n\n## Bilag (kun titler)\n${r.bilag.map((b) => `- ${b.titel || b.navn || b}`).join("\n")}` : "";
  return `Kommune: ${sig.kn}\nUdvalg: ${sig.u}\nMødedato: ${sig.dato}${sig.kom ? " (kommende møde)" : ""}\nTitel: ${sig.t}\n\n${afsnit.slice(0, 9000)}${bilag.slice(0, 1500)}`;
}

// Beløb uden AI: det største "x mio. kr." / "x mia. kr." / "x kr." i teksten
export function beloebRegex(tekst) {
  let bedst = null;
  const rx = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(mia\.?|mio\.?|millioner|milliarder|t\.?\s?kr\.?|tusind)?\s*kr\b/gi;
  for (const m of tekst.matchAll(rx)) {
    const tal = Number(m[1].replace(/\./g, "").replace(",", "."));
    const enhed = (m[2] || "").toLowerCase();
    // "13.263.000 mio. kr." i tabeller er kroner med enheden fra kolonneoverskriften: et tal, der allerede er i millioner,
    // ganges ikke op igen. Det samme for tusinder foran "mia." og "t.kr."
    const gang = /^mia|^milliard/.test(enhed) ? (tal < 1000 ? 1e9 : 1) : /^mio|^million/.test(enhed) ? (tal < 100000 ? 1e6 : 1) : /^t|^tusind/.test(enhed) ? (tal < 1e6 ? 1e3 : 1) : 1;
    const kr = tal * gang;
    // Over 3 mia. kr. er næsten altid et landstal eller et samlet budget i teksten, ikke projektets pris
    if (kr >= 50000 && kr <= 3e9 && (!bedst || kr > bedst.kr)) bedst = { kr, tekst: m[0].replace(/\s+/g, " ") };
  }
  return bedst;
}

// ---------- Claude ----------
async function lavKort(client, sig, raa) {
  const svar = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Afviste forespørgsler køres igen på den model, Anthropic anbefaler til den slags afvisning
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SKEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: sagsTekst(sig, raa) }],
  });
  if (svar.stop_reason === "refusal") throw new Error(`afvist (${svar.stop_details?.category || "ukendt"})`);
  if (svar.stop_reason === "max_tokens") throw new Error("svaret blev afkortet");
  const tekst = svar.content.find((b) => b.type === "text")?.text;
  if (!tekst) throw new Error("intet svar");
  return JSON.parse(tekst);
}

// Et kort skal have de rigtige felter og typer, uanset om det kommer fra API'et eller fra en fil
export function rensKort(k) {
  if (!k || typeof k !== "object" || typeof k.hvad !== "string") return null;
  const tal = (x) => (typeof x === "number" && isFinite(x) && x >= 0 ? x : null);
  const tekst = (x, n = 200) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
  const frist = typeof k.frist === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.frist) ? k.frist : null;
  return {
    hvad: k.hvad.trim().slice(0, 240), hvor: tekst(k.hvor, 140), beloeb_kr: tal(k.beloeb_kr), beloeb_tekst: tekst(k.beloeb_tekst, 120),
    boliger: tal(k.boliger), areal_m2: tal(k.areal_m2), areal_ha: tal(k.areal_ha), tidsplan: tekst(k.tidsplan), frist,
    aktoerer: (Array.isArray(k.aktoerer) ? k.aktoerer : []).filter((a) => typeof a === "string").map((a) => a.trim().slice(0, 80)).filter(Boolean).slice(0, 6),
    naeste: tekst(k.naeste), muligheder: (Array.isArray(k.muligheder) ? k.muligheder : []).filter((m) => MULIGHEDER.includes(m)),
    relevans: [1, 2, 3].includes(k.relevans) ? k.relevans : 1,
  };
}

// ---------- Steder til kortet ----------
// Projektkortets "hvor" slås op i OpenStreetMap (Nominatim, højst ét opslag i sekundet) og gemmes i avis/erhverv-steder.json,
// så hvert sted kun slås op én gang. Kun steder, der ligger i sagens egen kommune (inden for ca. 40 km af kommunens midte), bruges.
const STEDFIL = join(import.meta.dirname, "erhverv-steder.json");
async function stedfaest(fakta, indeks, maks = 150) {
  let steder = {};
  try { steder = JSON.parse(await readFile(STEDFIL, "utf8")); } catch {}
  const midte = JSON.parse(await readFile(join(import.meta.dirname, "natkort-steder.json"), "utf8"));
  const afstand = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 63);
  let n = 0;
  for (const s of indeks.signaler) {
    const hvor = fakta[s.id]?.hvor;
    if (!hvor) continue;
    const noegle = `${s.k}|${hvor}`;
    if (noegle in steder || n >= maks) continue;
    // "hvor" er ofte flere steder ("Finlandsparken, Finlandsvej og Ellehammerparken, Vejle"): delene prøves hver for sig,
    // de mest præcise (vej, område) først og byen til sidst; kommunens navn holder opslaget i kommunen
    const dele = hvor.replace(/\(([^)]*)\)/g, ",$1").replace(/\b(bl\.a\.|bymidte|området|omkring|ved|matr\.?\s*nr\.?\s*\S+)\b/gi, ",")
      .split(/\s*(?:[,;/]|\sog\s|\s-\s)\s*/).map((x) => x.trim()).filter((x) => x.length > 2 && !/kommune/i.test(x));
    let p = null;
    try {
      for (const del of [...new Set(dele)].slice(0, 4)) {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=dk&q=${encodeURIComponent(`${del}, ${s.kn}`)}`,
          { headers: { "User-Agent": "Sagsvagt/1.0 (+https://sagsvagt.dk; mansa@sagsvagt.dk)" }, signal: AbortSignal.timeout(20000) });
        const [hit] = r.ok ? await r.json() : [];
        await new Promise((r) => setTimeout(r, 1100));
        const kand = hit && { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5) };
        if (kand && midte[s.k] && afstand(kand, midte[s.k]) < 40) { p = kand; break; }
      }
    } catch { continue; }
    steder[noegle] = p;
    n++;
  }
  await writeFile(STEDFIL, JSON.stringify(steder, null, 0).replace(/,"/g, ',\n"') + "\n");
  const fundet = Object.values(steder).filter(Boolean).length;
  console.log(`Steder: ${n} nye opslag, ${fundet} af ${Object.keys(steder).length} steder fundet`);
}

async function main() {
  const args = process.argv.slice(2);
  let fakta = {};
  try { fakta = JSON.parse(await readFile(FIL, "utf8")); } catch {}
  const gem = () => writeFile(FIL, JSON.stringify(fakta, null, 0).replace(/},"/g, '},\n"') + "\n");

  if (args[0] === "--steder") {
    const indeks = JSON.parse(await readFile(join(ROD, "api", "_erhverv-signaler.json"), "utf8"));
    return stedfaest(fakta, indeks, Number(args[1] || 150));
  }
  if (args[0] === "--indlaes") {
    const nye = JSON.parse(await readFile(args[1], "utf8"));
    let n = 0;
    for (const [id, k] of Object.entries(nye)) { const r = rensKort(k); if (r) { fakta[id] = { ...r, kilde: "claude-code", lavet: new Date().toISOString().slice(0, 10) }; n++; } }
    await gem(); return console.log(`Projektkort: ${n} lagt ind`);
  }

  const indeks = JSON.parse(await readFile(join(ROD, "api", "_erhverv-signaler.json"), "utf8"));
  // Kommende møder og de nyeste først; kun signaler, der ikke allerede har et kort lavet af AI
  const mangler = indeks.signaler.filter((s) => !fakta[s.id] || fakta[s.id].kilde === "regex")
    .sort((a, b) => b.kom - a.kom || b.dato.localeCompare(a.dato));
  const raa = new Map();
  const raaFor = async (k) => { if (!raa.has(k)) raa.set(k, await raaSager(k)); return raa.get(k); };

  if (args[0] === "--udtraek") {
    const valgte = new Set(args.slice(1));
    const koe = [];
    for (const s of mangler.filter((x) => !valgte.size || valgte.has(x.k))) koe.push({ id: s.id, tekst: sagsTekst(s, await raaFor(s.k)) });
    await writeFile(join(import.meta.dirname, "erhverv-fakta-koe.json"), JSON.stringify({ skema: SKEMA, system: SYSTEM, sager: koe }, null, 1));
    return console.log(`Projektkort: ${koe.length} tekster i avis/erhverv-fakta-koe.json`);
  }

  // Uden nøgle: kun beløbet, så rapporten stadig kan vise og sortere efter det
  if (!process.env.ANTHROPIC_API_KEY) {
    let n = 0;
    for (const s of mangler) {
      if (fakta[s.id]) continue;
      const b = beloebRegex(sagsTekst(s, await raaFor(s.k)));
      fakta[s.id] = { kilde: "regex", beloeb_kr: b?.kr ?? null, beloeb_tekst: b?.tekst ?? null };
      n++;
    }
    await gem();
    return console.log(`Projektkort: ingen ANTHROPIC_API_KEY, så kun beløb for ${n} nye signaler`);
  }

  const client = new Anthropic();
  const koe = mangler.slice(0, MAKS);
  let ok = 0, fejl = 0;
  const arbejder = async () => {
    for (let s; (s = koe.shift()); ) {
      try {
        const r = rensKort(await lavKort(client, s, await raaFor(s.k)));
        if (!r) throw new Error("ugyldigt kort");
        fakta[s.id] = { ...r, kilde: MODEL, lavet: new Date().toISOString().slice(0, 10) };
        ok++;
      } catch (e) {
        fejl++;
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) { koe.length = 0; console.error(`Projektkort: ${e.message}`); }
        else if (e instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 20000));
        else console.error(`Projektkort ${s.id}: ${e.message}`);
      }
      if ((ok + fejl) % 25 === 0) await gem();
    }
  };
  await Promise.all(Array.from({ length: SAMTIDIG }, arbejder));
  await gem();
  console.log(`Projektkort: ${ok} nye (${MODEL}), ${fejl} fejl, ${mangler.length - ok} mangler stadig`);
}

if (import.meta.filename === process.argv[1]) main().catch((e) => { console.error(`Projektkort: ${e.message}`); });
