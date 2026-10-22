// "For og imod" og "Hvad betyder det for dig?" på sagssiden.
//
// Teksterne ligger i avis/perspektiv.json, én pr. sag. De skrives af Claude (AI) ud fra kommunens egen tekst:
//   - enten i Claude Code (som forenklet.json), eller
//   - automatisk i GitHub Actions, når hemmeligheden ANTHROPIC_API_KEY er sat (node avis/perspektiv.mjs).
// Som forenklet.json vises en tekst kun, når sagen stadig har samme type (dagsorden/referat), som da den blev skrevet.
//
// Neutralitet: hvert argument har et grundlag. "sagen" = står i kommunens tekst (forvaltningen, høringssvar, økonomi).
// "partier" = et parti eller medlem har sagt det i referatet. "debatten" = et almindeligt argument, sagen ikke selv
// nævner; dem markerer siden tydeligt, og der skal være lige mange for og imod af dem.
//
// Kør: node avis/perspektiv.mjs                 (skriv nye med Claude API; kræver ANTHROPIC_API_KEY)
//      MAKS=20 node avis/perspektiv.mjs         (højst 20 sager i denne kørsel, standard 120)
//      node avis/perspektiv.mjs --udtraek 25    (skriv de 25 vigtigste sager uden tekst til avis/perspektiv-koe.json)
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const DIR = import.meta.dirname, ROD = join(DIR, "..");
const FIL = join(DIR, "perspektiv.json");
const MODEL = process.env.PERSPEKTIV_MODEL || "claude-sonnet-5-5";
const MAKS = Number(process.env.MAKS || 120);

export async function laesPerspektiv() {
  try { return JSON.parse(await readFile(FIL, "utf8")).sager || {}; } catch { return {}; }
}

// ---------- Visning (bruges af byg.mjs) ----------
const GRUNDLAG = { sagen: "Fra sagen", partier: "Fra referatet", debatten: "Fra debatten" };
export function perspektivBokse(s, P, esc) {
  const p = P[s.id];
  if (!p || p.type !== s.type) return "";
  const arg = (a) => `<li><span class="fi-tekst">${esc(a.tekst)}</span>${a.kilde || a.grundlag ? `<span class="fi-kilde${a.grundlag === "debatten" ? " debat" : ""}">${esc(a.kilde || GRUNDLAG[a.grundlag] || "")}</span>` : ""}</li>`;
  const liste = (l, tom) => (l?.length ? `<ul>${l.map(arg).join("")}</ul>` : `<p class="fi-tom">${tom}</p>`);
  const debat = [...(p.for || []), ...(p.imod || [])].some((a) => a.grundlag === "debatten");
  const hverdag = p.hverdag ? `<section class="kf hverdag" aria-labelledby="hverdag-h">
          <h2 id="hverdag-h">Hvad betyder det for dig?</h2>
          <p class="hverdag-tekst">${esc(p.hverdag)}</p>
          ${p.berorer?.length ? `<p class="hverdag-hvem"><span>Berører især</span> ${p.berorer.map((b) => `<span class="hvem-tag">${esc(b)}</span>`).join(" ")}</p>` : ""}
        </section>` : "";
  const forImod = (p.for?.length || p.imod?.length) ? `<section class="kf for-imod" aria-labelledby="fi-h">
          <h2 id="fi-h">For og imod</h2>
          <div class="fi-grid">
            <div class="fi-for"><h3>For</h3>${liste(p.for, "Sagen nævner ingen argumenter for.")}</div>
            <div class="fi-imod"><h3>Imod</h3>${liste(p.imod, "Sagen nævner ingen argumenter imod.")}</div>
          </div>
          <p class="kf-mere">Argumenterne er samlet af Sagsvagt med hjælp fra AI ud fra kommunens egen tekst${debat ? '. Punkter mærket "Fra debatten" står ikke i sagen, men er almindelige argumenter for og imod den slags beslutninger' : ""}. De er ikke Sagsvagts holdning. Læs hele sagen herunder.</p>
        </section>` : "";
  return hverdag + forImod;
}

// ---------- Udvælgelse ----------
const STOEJ = /^(\d+\.\s*)?(godkendelse af (dagsorden|referat)|eventuelt|meddelelser|orientering$|underskrift|spørgetid|kommende sager|næste møde|lukket punkt)/i;
const TOP = /(borgerrepræsentation|kommunalbestyrelse|byråd|økonomiudvalg)/i;
const laengde = (s) => (s.afsnit || []).reduce((n, a) => n + a.tekst.length, 0);

export async function kandidater(P = {}) {
  const idag = new Date().toISOString().slice(0, 10);
  const fra = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const alle = [];
  for (const f of (await readdir(join(ROD, "data"))).filter((f) => f.endsWith(".json"))) {
    for (const s of Object.values(JSON.parse(await readFile(join(ROD, "data", f), "utf8")).sager)) {
      if (s.dato < fra || STOEJ.test(s.titel) || /fortrolig|lukket/i.test(s.titel) || laengde(s) < 700) continue;
      if (P[s.id]?.type === s.type) continue;
      // Vigtigst: byråd/økonomiudvalg, sager med økonomi og sager på vej (dagsordener), og lange sager
      const score = (TOP.test(s.udvalg) ? 3 : 1) + (s.dato >= idag ? 1 : 0) + Math.min(laengde(s) / 4000, 2) + (/mio\. kr|kr\./.test(JSON.stringify(s.afsnit)) ? 0.5 : 0);
      alle.push({ s, score });
    }
  }
  // Samme sag behandles i flere udvalg: tag kun den nyeste udgave af hver titel pr. kommune
  const set = new Set();
  return alle.sort((a, b) => b.score - a.score || b.s.dato.localeCompare(a.s.dato)).filter(({ s }) => {
    const k = `${s.kommune}|${s.titel.toLowerCase().replace(/^\d+\.\s*/, "")}`;
    return !set.has(k) && set.add(k);
  }).map(({ s }) => s);
}

const sagsTekst = (s) => `Kommune: ${s.kommune || "København"}\nUdvalg: ${s.udvalg}\nMøde: ${s.dato} (${s.type})\nTitel: ${s.titel}\n\n` +
  (s.afsnit || []).map((a) => `## ${a.titel}\n${a.tekst}`).join("\n\n").slice(0, 24000);

// ---------- Claude API ----------
const SYSTEM = `Du skriver for Sagsvagt, en partineutral, gratis avis om kommunalpolitik for almindelige borgere, også unge.
Du får én sag fra en kommunes dagsorden eller referat. Svar KUN med JSON i dette format:
{"hverdag": "...", "berorer": ["..."], "for": [{"tekst": "...", "grundlag": "sagen|partier|debatten", "kilde": "..."}], "imod": [...]}

hverdag: 2-3 korte sætninger til borgeren i du-form om, hvad sagen konkret betyder i hverdagen: hvad ændrer sig, for hvem, hvornår, og hvad koster det, hvis sagen siger det. Brug tal og steder fra sagen. Skriv betinget, når det kun gælder nogle ("Bor du i …", "Har du børn i …"). Ændrer sagen intet, man mærker, så sig det ligeud og forklar med én sætning, hvad den handler om. Ingen gætterier om tal, der ikke står i sagen.
berorer: 1-4 korte grupper, der især berøres (fx "Børnefamilier i Vanløse", "Cyklister på Amagerbrogade"). Tom liste, hvis ingen særlige.
for/imod: 2-4 argumenter hver vej, hver højst 25 ord, skrevet som en påstand ("Giver …", "Koster …"), ikke som et citat.
grundlag: "sagen" når argumentet står i kommunens tekst (forvaltningens begrundelse, høringssvar, risici, økonomi, fravalgte alternativer). "partier" når et parti eller medlem har sagt det i referatet (fx protokolbemærkning, ændringsforslag, stemmeforklaring); så er kilde partinavnet med bogstav, fx "Enhedslisten (Ø)". "debatten" kun når sagen ikke selv rummer argumenter den ene vej: et almindeligt, sagligt argument, som modstandere eller tilhængere typisk fremfører om den slags beslutninger. Brug "debatten" lige meget for og imod, og aldrig om personer.
kilde: kort, fx "Forvaltningen", "Høringssvar fra beboerne", "Økonomiafsnittet", "Socialdemokratiet (A)". For "debatten" skriv "Fra debatten".
Regler: Ingen holdning fra Sagsvagt. Ingen navne på privatpersoner. Ingen oplysninger, der ikke står i sagen, undtagen argumenter med grundlag "debatten". Er sagen ren administration (fx regnskab, udpegning), så giv højst ét argument hver vej og sig det i hverdag. Skriv enkelt dansk uden forvaltningssprog.`;

async function spoerg(s) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: sagsTekst(s) }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const svar = (await res.json()).content.map((c) => c.text || "").join("");
  const json = JSON.parse(svar.slice(svar.indexOf("{"), svar.lastIndexOf("}") + 1));
  const ren = (l) => (Array.isArray(l) ? l : []).filter((a) => a?.tekst).slice(0, 4).map((a) => ({ tekst: String(a.tekst).trim(), grundlag: ["sagen", "partier", "debatten"].includes(a.grundlag) ? a.grundlag : "sagen", kilde: String(a.kilde || "").trim() }));
  return { hverdag: String(json.hverdag || "").trim(), berorer: (json.berorer || []).slice(0, 4).map(String), for: ren(json.for), imod: ren(json.imod) };
}

async function gem(P) {
  const gammel = await readFile(FIL, "utf8").then(JSON.parse).catch(() => ({}));
  await writeFile(FIL, JSON.stringify({ om: gammel.om || "For og imod samt betydning i hverdagen, skrevet af Claude (AI) ud fra kommunens egen tekst. 'type' er dagsorden eller referat: teksten vises kun, når sagen stadig har samme type.", sager: P }, null, 1) + "\n");
}

if (process.argv[1]?.endsWith("perspektiv.mjs")) {
  const P = await laesPerspektiv();
  if (process.argv[2] === "--udtraek") {
    const k = (await kandidater(P)).slice(0, Number(process.argv[3] || 25));
    await writeFile(join(DIR, "perspektiv-koe.json"), JSON.stringify(k.map((s) => ({ id: s.id, type: s.type, tekst: sagsTekst(s) })), null, 1));
    console.log(`${k.length} sager skrevet til avis/perspektiv-koe.json`);
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY er ikke sat; springer For og imod over.");
  } else {
    const koe = (await kandidater(P)).slice(0, MAKS);
    console.log(`Skriver For og imod til ${koe.length} sager med ${MODEL} …`);
    let n = 0, fejl = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let s; (s = koe.shift()); ) {
        try { P[s.id] = { type: s.type, lavet: new Date().toISOString().slice(0, 10), ...(await spoerg(s)) }; n++; }
        catch (e) { fejl++; console.warn(`  ${s.id}: ${e.message}`); if (fejl > 10) koe.length = 0; }
        if (n % 20 === 0) await gem(P);
      }
    }));
    await gem(P);
    console.log(`${n} skrevet, ${fejl} fejl.`);
  }
}
