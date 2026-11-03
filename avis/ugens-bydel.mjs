// Ugens sager i din bydel: et kort opslag pr. bydel eller by med ugens sager, klar til at kopiere ind i bydelens
// Facebook-gruppe. Formatet er lånt fra lokalmediernes faste ugelister (fx "Ugens seneste boligsalg"): samme overskrift
// hver uge, få punkter, ét link. Opslagene laves her, men postes af et menneske: Sagsvagt poster aldrig selv i grupper.
//
// Kør:  node avis/ugens-bydel.mjs                         København (bydelene) og de 7 seneste dage + næste uges møder
//       node avis/ugens-bydel.mjs guldborgsund vejle       byerne i de kommuner
//       node avis/ugens-bydel.mjs koebenhavn --dage 14
//
// Skrives til plan/ugens-bydel/ (plan/ uploades ikke): én side pr. kommune med et opslag pr. bydel og en kopiér-knap.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { vurder } from "./tipliste.mjs";

const ROD = join(import.meta.dirname, "..");
const SITE = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
const UD = join(ROD, "plan", "ugens-bydel");
const IDAG = new Date().toISOString().slice(0, 10);
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const dato = (d) => { const [, m, dg] = d.split("-"); return `${Number(dg)}. ${MDR[m - 1]}`; };
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plus = (d, dage) => new Date(Date.parse(d) + dage * 864e5).toISOString().slice(0, 10);
const uge = (d) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const slug = (t) => t.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MAKS = 6;
const LU_FAST = /tilhørernes punkt|kom og tal|byens puls|orientering om puljen|puljemidler|puljeansøgning|oplæg og dialog|godkendelse af (referat|dagsorden)|meddelelser|eventuelt|budgetopfølgning|mødeplan/i;
// "B-sag Orientering om …", "Kl. 19: Oplæg af …": lokaludvalgenes egne mærker foran titlen
const renTitel = (t) => t.replace(/^[ABC]-sag:?\s+/i, "").replace(/^Kl\.\s*\d{1,2}([.:]\d{2})?:?\s*/i, "").replace(/^./, (c) => c.toUpperCase());

// Københavns bydele: lokaludvalgets eget navn og de kvarterer, folk kalder bydelen. Gruppenavnene på Facebook følger
// kvartererne (fx "Sydhavnen", "Nordvest"), så de tæller med.
const KK_BYDELE = {
  "Indre By": ["Indre By", "Nyhavn", "Kongens Nytorv", "Rådhuspladsen", "Frederiksstaden", "Nordhavn"],
  "Østerbro": ["Østerbro", "Fælledparken", "Svanemøllen"],
  "Nørrebro": ["Nørrebro", "Nørrebrogade", "Assistens Kirkegård", "Superkilen"],
  "Vesterbro": ["Vesterbro", "Kødbyen", "Carlsberg Byen", "Enghave Plads", "Istedgade"],
  "Valby": ["Valby"],
  "Vanløse": ["Vanløse"],
  "Brønshøj-Husum": ["Brønshøj", "Husum", "Tingbjerg"],
  "Bispebjerg": ["Bispebjerg", "Nordvest", "Utterslev"],
  "Amager Øst": ["Amager Øst", "Amagerbro", "Sundby", "Kastrup Fort", "Amager Strandpark"],
  "Amager Vest": ["Amager Vest", "Ørestad", "Islands Brygge", "Sundbyvester", "Bella"],
  "Kongens Enghave": ["Kongens Enghave", "Sydhavn", "Sydhavnen"],
  "Christianshavn": ["Christianshavn", "Christiania", "Holmen", "Refshaleøen"],
};
const ord = (n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");

async function hent(slugK, navne) {
  const f = slugK === "koebenhavn" ? join(ROD, "assets", "sager.json") : join(ROD, "kommune", slugK, "sager.json");
  const sager = JSON.parse(await readFile(f, "utf8")).sager;
  if (slugK === "koebenhavn") {
    const bydele = Object.entries(KK_BYDELE).map(([navn, alias]) => ({
      navn, link: `${SITE}soeg.html?q=${encodeURIComponent(alias[0])}&fra=fb-uge`,
      passer: (s) => s.u.replace(/\s*Lokaludvalg$/, "").replace(/^Christianshavns$/, "Christianshavn") === navn || alias.some((a) => ord(a).test(`${s.t} ${s.kt || ""} ${s.d || ""}`)),
    }));
    return { navn: "København", sager, bydele };
  }
  let byer = [];
  try { byer = JSON.parse(await readFile(join(import.meta.dirname, "steder", `${slugK}.json`), "utf8")).byer || []; } catch {}
  return {
    navn: navne[slugK] || slugK, sager,
    // Byerne har en side på sagsvagt.dk, så snart én sag nævner dem (findKommuneSteder i udgave.mjs)
    bydele: byer.map((by) => ({ navn: by, link: `${SITE}kommune/${slugK}/bydel/${slug(by)}.html?fra=fb-uge`, passer: (s) => ord(by).test(`${s.t} ${s.kt || ""} ${s.d || ""}`) })),
  };
}

function opslag(navn, l, link) {
  const punkter = l.map((v) => `• ${renTitel(v.s.kt || v.s.t)} (${v.s.u}, ${v.s.st === "kommer" ? `på dagsordenen ${dato(v.s.dato)}` : dato(v.s.dato)})`);
  return [
    `Ugens sager i ${navn} · uge ${uge(IDAG)}`, "",
    `Det har politikerne haft på bordet om ${navn} den seneste uge${l.some((v) => v.s.st === "kommer") ? " og på de næste møder" : ""}:`, "",
    ...punkter, "",
    `Se sagerne: ${link}`,
    `Få dem på mail hver mandag, gratis: ${SITE}vagt.html?fra=fb-uge`,
  ].join("\n");
}

function sideHtml(k, kort, fra) {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Ugens sager i bydelene, ${esc(k.navn)} uge ${uge(IDAG)} – Sagsvagt</title>
<link rel="stylesheet" href="${SITE}assets/fonts/montserrat.css">
<style>
:root{--nat:#0E0F14;--indigo:#28377A;--vin:#8A2430;--rosen:#DCA9A5;--kalk:#E6DFD3;--kalk-lys:#EEE8DE;--rule:#CFC6B8;--muted:#56535A;--sans:Montserrat,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--kalk);color:var(--nat);font:500 16px/1.55 var(--sans)}
h1,h2,p{margin:0}.wrap{max-width:820px;margin:0 auto;padding:0 24px}
header{background:var(--nat);color:var(--kalk);padding:28px 0 32px}header .k{font:700 12px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--rosen)}
header h1{font:800 clamp(28px,1.3rem + 2.2vw,42px)/1.08 var(--sans);letter-spacing:-.02em;margin:8px 0 10px}header p{color:rgba(230,223,211,.85);max-width:44em}
main{padding:32px 0 64px}.note{font-size:13px;color:var(--muted);border-left:3px solid var(--vin);padding:4px 0 4px 12px;margin-bottom:28px}
.kort{background:var(--kalk-lys);border:1px solid var(--rule);border-radius:16px;padding:18px 20px;margin-bottom:20px}
.kort-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.kort h2{font:800 20px var(--sans)}.kort h2 span{font:700 13px var(--sans);color:var(--muted);margin-left:6px}
textarea{width:100%;min-height:220px;font:500 14.5px/1.5 var(--sans);color:var(--nat);background:#fff;border:1.5px solid var(--rule);border-radius:10px;padding:12px;resize:vertical}
button{font:700 14px/1 var(--sans);padding:12px 18px;min-height:44px;border:0;border-radius:99px;background:var(--nat);color:var(--kalk);cursor:pointer}button.ok{background:var(--indigo)}
.tom{font-size:14px;color:var(--muted)}
</style>
</head>
<body>
<header><div class="wrap">
  <p class="k">Sagsvagt · til Facebook-grupperne</p>
  <h1>Ugens sager i bydelene, ${esc(k.navn)}</h1>
  <p>Uge ${uge(IDAG)}: sager fra ${esc(dato(fra))} til i dag og møder til og med ${esc(dato(plus(IDAG, 7)))}. ${kort.length} ${kort.length === 1 ? "bydel har" : "bydele har"} sager i perioden.</p>
</div></header>
<main><div class="wrap">
  <p class="note">Kladder. Læs opslaget, før du poster det, og post kun i grupper, hvor reglerne tillader det. Sagerne er fundet automatisk ud fra bydelens navn i titel og resumé, så tjek, at de handler om bydelen.</p>
  ${kort.map((x) => `<section class="kort"><div class="kort-h"><h2>${esc(x.navn)} <span>${x.antal} ${x.antal === 1 ? "sag" : "sager"}${x.antal > MAKS ? `, de ${MAKS} vigtigste vist` : ""}</span></h2><button type="button" data-til="t-${slug(x.navn)}">Kopiér</button></div><textarea id="t-${slug(x.navn)}" aria-label="Opslag til ${esc(x.navn)}">${esc(x.tekst)}</textarea></section>`).join("\n") || `<p class="tom">Ingen bydele har sager i perioden.</p>`}
</div></main>
<script>document.querySelectorAll("button[data-til]").forEach(function(b){b.addEventListener("click",function(){var t=document.getElementById(b.dataset.til);navigator.clipboard.writeText(t.value).then(function(){b.textContent="Kopieret";b.classList.add("ok");setTimeout(function(){b.textContent="Kopiér";b.classList.remove("ok")},2000)},function(){t.select()})})})</script>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--dage"); const dage = i >= 0 ? Number(args.splice(i, 2)[1]) : 7;
  const slugs = args.filter((a) => !a.startsWith("--"));
  if (!slugs.length) slugs.push("koebenhavn");
  const aabne = JSON.parse(await readFile(join(ROD, "kommune", "aabne.json"), "utf8"));
  const navne = Object.fromEntries(aabne.map((x) => [x.slug, x.navn]));
  const ukendte = slugs.filter((s) => !navne[s]);
  if (ukendte.length) throw new Error(`ukendte eller lukkede kommuner: ${ukendte.join(", ")}`);
  await mkdir(UD, { recursive: true });
  const fra = plus(IDAG, -dage), til = plus(IDAG, 7);
  for (const s of slugs) {
    const k = await hent(s, navne);
    const valgt = k.sager.filter((x) => !x.r && ((x.st === "kommer" && x.dato >= IDAG && x.dato <= til) || (x.st !== "kommer" && x.dato >= fra && x.dato <= IDAG)));
    const kort = [];
    for (const b of k.bydele) {
      // Samme sag i flere udvalg tæller én gang; de vigtigste først (samme point som tiplisten), så nyeste
      const set = new Map();
      for (const x of valgt.filter(b.passer)) { const n = (x.kt || x.t).toLowerCase(); if (!set.has(n) || x.dato > set.get(n).dato) set.set(n, x); }
      // Lokaludvalgenes egne møder har mange faste punkter (tilhørernes punkt, puljen, oplæg); de kommer kun med,
      // når tiplisten finder en grund (høring, penge, noget folk mærker)
      const l = [...set.values()].map((x) => vurder(x, []))
        .filter((v) => !/Lokaludvalg$/.test(v.s.u) || (v.grunde.length && !LU_FAST.test(v.s.t)))
        .sort((a, b2) => b2.point - a.point || b2.s.dato.localeCompare(a.s.dato));
      if (!l.length) continue;
      const vist = l.slice(0, MAKS).sort((a, b2) => a.s.dato.localeCompare(b2.s.dato));
      kort.push({ navn: b.navn, antal: l.length, tekst: opslag(b.navn, vist, b.link) });
    }
    kort.sort((a, b) => b.antal - a.antal || a.navn.localeCompare(b.navn, "da"));
    const fil = `ugens-bydel-${s}-uge${uge(IDAG)}.html`;
    await writeFile(join(UD, fil), sideHtml(k, kort, fra));
    console.log(`${fil}: ${kort.length} bydele med sager (${kort.map((x) => `${x.navn} ${x.antal}`).join(", ")})`);
  }
}

if (import.meta.filename === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
