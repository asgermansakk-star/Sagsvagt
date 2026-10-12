// Mødebriefing: en printbar oversigt over et kommende udvalgsmøde med "Kort fortalt" og sagens vej for hvert punkt.
// Til at sende som PDF til politikere og andre, der skal forberede sig til mødet.
// Kør: node avis/briefing.mjs                  (alle kommende møder)
//      node avis/briefing.mjs "Børne"          (kun møder i udvalg, hvis navn indeholder teksten)
// Bygger på assets/sager.json og sagsfragmenterne i assets/sager/ (begge laves af byg.mjs), så briefingen og
// avisen altid siger det samme. HTML og PDF gemmes i ../briefinger/. PDF laves med Microsoft Edge, hvis den findes.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROD = join(import.meta.dirname, "..");
const UD = join(ROD, "..", "briefinger");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const DAGE = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dag = (iso) => new Date(iso + "T12:00:00Z");
const datoTekst = (iso) => `${DAGE[dag(iso).getUTCDay()]} ${dag(iso).getUTCDate()}. ${MDR[dag(iso).getUTCMonth()]} ${dag(iso).getUTCFullYear()}`;
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hvor = (u) => (/Lokaludvalg$/.test(u) ? u.replace(/\s*Lokaludvalg$/, "") + " Lokaludvalg" : u);
// Kommunens adresser vises læsbart (uden %C3%B8 osv.) og er klikbare i PDF'en
const kilde = (url) => { let t = url; try { t = decodeURI(url); } catch {} return `<a href="${esc(url)}">${esc(t.replace(/^https?:\/\/(www\.)?/, ""))}</a>`; };
const nr = (s) => +(s.id.match(/-(\d+)$/)?.[1] || 0);

const data = JSON.parse(await readFile(join(ROD, "assets", "sager.json"), "utf8"));
const css = await readFile(join(ROD, "assets", "avis.css"), "utf8");
const logo = (await readFile(join(ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8")).replace(/<title>[\s\S]*?<\/title>/, "").replace(/<svg /, '<svg class="b-logo" ');
const idag = new Date().toISOString().slice(0, 10);
const filter = (process.argv[2] || "").toLowerCase();
const moeder = (data.moeder || []).filter((m) => m.dato >= idag && m.u.toLowerCase().includes(filter));
if (!moeder.length) { console.log("Ingen kommende møder med offentliggjort dagsorden" + (filter ? ` for "${filter}"` : "") + "."); process.exit(0); }

// Kort fortalt og sagens vej hentes fra sagens fragment; links til avisens sider bliver til tekst (avisen er lukket)
async function fragment(s) {
  const html = await readFile(join(ROD, "assets", "sager", s.url.slice(4)), "utf8").catch(() => "");
  const del = (re) => (html.match(re) || [""])[0];
  return (del(/<section class="kf"[\s\S]*?<\/section>/) + del(/<section class="vej"[\s\S]*?<\/section>/))
    .replace(/<a [^>]*href="\.\.\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, "$1")
    .replace(/ id="(kf-h|vej-h)"/g, "").replace(/ aria-labelledby="[^"]*"/g, "")
    .replace(/<dfn class="ord"[^>]*>([\s\S]*?)<\/dfn>/g, "$1");
}

await mkdir(UD, { recursive: true });
for (const m of moeder) {
  const punkter = data.sager.filter((s) => s.u === m.u && s.dato === m.dato).sort((a, b) => nr(a) - nr(b));
  const vigtige = punkter.filter((s) => !s.r), rutine = punkter.filter((s) => s.r);
  const sektioner = [];
  for (const s of vigtige) {
    const emner = s.e.map((id) => `<span class="emne-tag ${data.emner[id].f}">${esc(data.emner[id].navn)}</span>`).join("");
    sektioner.push(`<article class="b-punkt">
  <p class="b-nr">Punkt ${nr(s)}</p>
  <h2 class="hl">${esc(s.t)}</h2>
  ${s.d ? `<p class="dek">${esc(s.d)}</p>` : ""}
  ${emner ? `<p class="emner">${emner}</p>` : ""}
  ${await fragment(s)}
  <p class="b-kilde">Hele sagen hos kommunen: ${kilde(s.k)}</p>
</article>`);
  }
  const titel = `Mødebriefing: ${hvor(m.u)}, ${datoTekst(m.dato)}`;
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><title>${esc(titel)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}
/* Briefing: A4, til print og PDF */
@page { size: A4; margin: 16mm 16mm 18mm; }
body { background: #fff0; display: block; min-height: 0; }
.b-side { max-width: 178mm; margin: 0 auto; }
.b-top { background: var(--moedet); color: var(--kalk); padding: 22px 26px 24px; border-radius: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.b-logo { height: 34px; width: auto; display: block; margin-left: -6px; }
.b-top .rubrik { color: var(--rosen); border: 0; padding: 0; margin: 22px 0 6px; }
.b-top h1 { font-family: var(--serif); font-weight: 600; font-size: 1.9rem; line-height: 1.12; margin: 0; }
.b-top p { margin: 10px 0 0; font-size: .9375rem; color: rgba(230,223,211,.85); }
.b-indhold { margin: 22px 0 6px; padding: 0; list-style: none; columns: 1; }
.b-indhold li { padding: 6px 0; border-bottom: 1px solid var(--rule); font-family: var(--serif); font-size: .9688rem; }
.b-indhold b { font-family: var(--sans); font-size: .75rem; color: var(--muted); margin-right: 8px; }
.b-punkt { margin-top: 30px; padding-top: 22px; border-top: 2px solid var(--nat); }
.b-punkt:first-of-type { margin-top: 26px; }
.b-punkt .b-nr, .b-punkt .hl, .b-punkt .dek { break-after: avoid; }
.b-punkt .kf div, .b-punkt .kf dt, .b-punkt .kf dd, .b-punkt .vej li { break-inside: avoid; }
.b-nr { font: 700 .75rem var(--sans); text-transform: uppercase; letter-spacing: .12em; color: var(--vin); margin: 0 0 6px; }
.b-punkt .hl { font-size: 1.5rem; line-height: 1.18; }
.b-punkt .dek { font-size: 1rem; line-height: 1.55; }
.b-punkt .kf { margin-top: 18px; }
.b-punkt .vej { margin: 0 0 12px; }
.b-kilde { font-size: .78rem; color: var(--muted); overflow-wrap: anywhere; margin: 10px 0 0; }
.b-kilde a, .b-fod a { color: inherit; text-decoration: none; }
.b-rutine { break-inside: avoid; margin-top: 26px; }
.b-rutine li { font-size: .9375rem; padding: 4px 0; }
.b-rutine b { font-family: var(--sans); font-size: .75rem; color: var(--muted); margin-right: 8px; }
.b-fod { margin-top: 28px; padding-top: 12px; border-top: 2px solid var(--nat); font-size: .8125rem; color: var(--muted); break-inside: avoid; }
.b-fod b { color: var(--nat); }
.kf, .vej, .emne-tag, .afst-bar span, .parti b { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head>
<body><div class="b-side">
  <header class="b-top">
    ${logo}
    <p class="rubrik">Mødebriefing</p>
    <h1>${esc(hvor(m.u))}</h1>
    <p>${esc(datoTekst(m.dato).replace(/^./, (c) => c.toUpperCase()))} · ${m.n} punkter på dagsordenen · ${vigtige.length} gennemgået her</p>
  </header>
  <ol class="b-indhold">${vigtige.map((s) => `<li><b>${nr(s)}</b>${esc(s.t)}</li>`).join("")}</ol>
  ${sektioner.join("\n")}
  ${rutine.length ? `<section class="b-rutine"><h2 class="rubrik">Rutinesager på dagsordenen</h2><ul class="notitser">${rutine.map((s) => `<li><b>${nr(s)}</b> ${esc(s.t)}</li>`).join("")}</ul></section>` : ""}
  <footer class="b-fod"><b>Lavet af Sagsvagt</b> ud fra kommunens offentliggjorte dagsorden. Læs altid den originale sag, før du handler på den. Dagsordenen hos kommunen: ${kilde(m.url)}<br><b>Få briefingen og de sager, der handler om dine emner, hver uge: sagsvagt.dk</b> · Sagsvagt er partineutral.</footer>
</div></body></html>`;
  const navn = `briefing-${m.dato}-${slug(hvor(m.u))}`;
  const htmlFil = join(UD, `${navn}.html`);
  await writeFile(htmlFil, html);
  let pdf = "";
  try {
    await access(EDGE);
    execFileSync(EDGE, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=6000", `--print-to-pdf=${join(UD, `${navn}.pdf`)}`, pathToFileURL(htmlFil).href], { stdio: "ignore", timeout: 60000 });
    pdf = ` + PDF`;
  } catch { pdf = " (PDF ikke lavet: Microsoft Edge blev ikke fundet)"; }
  console.log(`${titel}: ${vigtige.length} punkter, ${rutine.length} rutinesager → ${navn}.html${pdf}`);
}
