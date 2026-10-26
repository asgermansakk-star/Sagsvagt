// Sagsvagt Erhverv: Claude Haiku 5.5 bedømmer, hvor relevant hvert signal er for en virksomhed (1–3), ud fra titel, udvalg og
// starten af sagsfremstillingen. Ordreglerne i avis/signaler.mjs finder kandidaterne; bedømmelsen sorterer dem, så mailen kun
// tager relevans 2–3 med, og rapporten viser de vigtigste først. Asger sagde ja 26/10 (ca. 0,20 dollar for alle signaler).
//
// Bedømmelserne ligger i avis/erhverv-relevans.json, én pr. signal (id), og bliver der: et signal bedømmes kun én gang.
// Nøglen læses fra RELEVANS_NOEGLE (ikke ANTHROPIC_API_KEY), så robottens andre trin ikke kan bruge den ved en fejl.
//
// Kør: RELEVANS_NOEGLE=… node avis/erhverv-relevans.mjs        nye signaler (højst MAKS, standard 3000)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { raaSager, sagsTekst } from "./erhverv-fakta.mjs";

const ROD = join(import.meta.dirname, "..");
const FIL = join(import.meta.dirname, "erhverv-relevans.json");
const MODEL = "claude-haiku-5-5";
const MAKS = Number(process.env.MAKS || 3000);
const SAMTIDIG = 6;

const SKEMA = {
  type: "object",
  additionalProperties: false,
  required: ["relevans", "grund"],
  properties: {
    relevans: { type: "integer", enum: [1, 2, 3] },
    grund: { type: "string", description: "Højst 12 ord på dansk." },
  },
};
const SYSTEM = `Du sorterer sager fra danske kommuners dagsordener og referater for Sagsvagt Erhverv. Kunderne er virksomheder: entreprenører, håndværkere, rådgivende ingeniører, arkitekter, developere, ejendomsinvestorer, energiselskaber og leverandører til byggeri og anlæg. De vil vide, hvor der kommer opgaver, de kan byde på eller sælge til.

Giv sagen en relevans:
3 = et konkret projekt med byggeri, anlæg, renovering, nedrivning, grundsalg, udbud eller et energi-, vand- eller klimaanlæg, som en virksomhed kan få en opgave i. Fx en lokalplan for et nyt boligområde, en anlægsbevilling til en skole eller vej, skema A/B for almene boliger, salg af en grund eller et udbud af totalrådgivning.
2 = en plan, bevilling eller beslutning, der sandsynligvis fører til projekter, men endnu ikke er konkret. Fx en helhedsplan, en varmeplan, et kommuneplantillæg for et udviklingsområde eller en forundersøgelse.
1 = ingen forretning for den slags virksomheder: administration, personale, sociale ydelser, politiske processer, orienteringer uden projekt, generelle budgetter, kultur og arrangementer, dispensationer til enkelte private ejendomme, tilskud til foreninger.

Bedøm kun ud fra teksten. Svar kort og neutralt.`;

async function main() {
  const noegle = process.env.RELEVANS_NOEGLE;
  let vurd = {};
  try { vurd = JSON.parse(await readFile(FIL, "utf8")); } catch {}
  const gem = () => writeFile(FIL, JSON.stringify(vurd, null, 0).replace(/},"/g, '},\n"') + "\n");
  if (!noegle) return console.log("Relevans: ingen RELEVANS_NOEGLE, springes over");

  const indeks = JSON.parse(await readFile(join(ROD, "api", "_erhverv-signaler.json"), "utf8"));
  // Kommende møder og de nyeste først, så de vigtigste er bedømt, hvis kørslen stopper undervejs
  const koe = indeks.signaler.filter((s) => !vurd[s.id]).sort((a, b) => b.kom - a.kom || b.dato.localeCompare(a.dato)).slice(0, MAKS);
  const raa = new Map();
  const raaFor = async (k) => { if (!raa.has(k)) raa.set(k, await raaSager(k)); return raa.get(k); };
  const client = new Anthropic({ apiKey: noegle });
  let ok = 0, fejl = 0, stop = false, tokensInd = 0, tokensUd = 0;

  const bedoem = async (s) => {
    const tekst = sagsTekst(s, await raaFor(s.k)).slice(0, 2500);
    const svar = await client.messages.create({
      model: MODEL,
      max_tokens: 1024, // plads til adaptiv tænkning foran det korte svar
      output_config: { effort: "low", format: { type: "json_schema", schema: SKEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: tekst }],
    });
    tokensInd += svar.usage?.input_tokens || 0; tokensUd += svar.usage?.output_tokens || 0;
    if (svar.stop_reason === "refusal") throw new Error(`afvist (${svar.stop_details?.category || "ukendt"})`);
    if (svar.stop_reason === "max_tokens") throw new Error("svaret blev afkortet");
    const t = svar.content.find((b) => b.type === "text")?.text; // svaret kan starte med en tænke-blok
    const j = JSON.parse(t || "{}");
    if (![1, 2, 3].includes(j.relevans)) throw new Error("ugyldigt svar");
    return { r: j.relevans, g: String(j.grund || "").slice(0, 120) };
  };
  const arbejder = async () => {
    for (let s; !stop && (s = koe.shift()); ) {
      try { vurd[s.id] = { ...(await bedoem(s)), m: MODEL, d: new Date().toISOString().slice(0, 10) }; ok++; }
      catch (e) {
        fejl++;
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) { stop = true; console.error(`Relevans: ${e.message}`); }
        else if (e instanceof Anthropic.RateLimitError) { koe.push(s); await new Promise((r) => setTimeout(r, 15000)); }
        else console.error(`Relevans ${s.id}: ${e.message}`);
      }
      if ((ok + fejl) % 100 === 0) await gem();
    }
  };
  await Promise.all(Array.from({ length: SAMTIDIG }, arbejder));
  await gem();
  // Pris efter Haiku 5.5's takst for korte prompts: 0,10 / 0,50 dollar pr. million tokens ind / ud
  const pris = (tokensInd * 0.1 + tokensUd * 0.5) / 1e6;
  console.log(`Relevans: ${ok} bedømt, ${fejl} fejl, ${indeks.signaler.filter((s) => !vurd[s.id]).length} mangler · ${tokensInd} tokens ind, ${tokensUd} ud ≈ ${pris.toFixed(2)} dollar`);
}

main().catch((e) => { console.error(`Relevans: ${e.message}`); });
