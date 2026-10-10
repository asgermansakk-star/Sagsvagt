// Henter dagsordener og referater fra Københavns Kommune (kk.dk) og gemmer
// hvert dagsordenspunkt i data/kk.json. kk.dk's robots.txt tillader stien.
// Vi spørger høfligt: én forespørgsel ad gangen med pause imellem.
import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://www.kk.dk";
const LISTE = `${BASE}/dagsordener-og-referater`;
const DATA = join(import.meta.dirname, "..", "data", "kk.json");
const SIDER = Number(process.env.SIDER || 2);        // hvor mange oversigtssider tilbage
const PAUSE_MS = Number(process.env.PAUSE_MS || 800);
const UA = "SagsvagtBot/0.1 (+https://sagsvagt.dk/om.html)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hent(url) {
  await sleep(PAUSE_MS);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "da" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return cheerio.load(await res.text());
}

const ren = (s) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

// "/dagsordener-og-referater/<udvalg>/møde-DDMMYYYY/<type>"
function parseMoedeUrl(href) {
  const m = decodeURIComponent(href).match(/^\/dagsordener-og-referater\/([^/]+)\/møde-(\d{2})(\d{2})(\d{4})\/(dagsorden|referat)$/);
  if (!m) return null;
  return { udvalg: m[1], dato: `${m[4]}-${m[3]}-${m[2]}`, type: m[5], url: BASE + href };
}

// Deler et punkts tekst op i afsnit efter overskrifterne (Indstilling, Problemstilling ...)
function afsnit($, root) {
  const ud = [];
  let cur = { titel: "Resumé", tekst: [] };
  root.find("h2, h3, p, li").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const t = ren($(el).text());
    if (!t) return;
    if (tag === "h2" || tag === "h3") {
      if (/^bilag$/i.test(t)) return;
      if (cur.tekst.length) ud.push(cur);
      cur = { titel: t, tekst: [] };
    } else if (!$(el).parents("li").length || tag === "li") {
      cur.tekst.push(tag === "li" ? "• " + t : t);
    }
  });
  if (cur.tekst.length) ud.push(cur);
  // Fjern gentagne overskrifter i starten af teksten ("Indstilling Klima-...")
  return ud.map((a) => ({ titel: a.titel, tekst: a.tekst.join("\n\n").replace(new RegExp("^" + a.titel + "\\s*"), "") }));
}

async function hentPunkt(url) {
  const $ = await hent(url);
  const titel = ren($("h1.page-title").text());
  const root = $(".paragraph--type--agenda-element-case").parent();
  const dele = afsnit($, root.length ? root : $("main"));
  const bilag = $(".file-link").map((_, e) => {
    const a = $(e).is("a") ? $(e) : $(e).closest("a");
    return { navn: ren($(e).find(".file-link-text").text() || $(e).text()), url: a.attr("href") ? new URL(a.attr("href"), BASE).href : null };
  }).get().filter((b) => b.navn);
  return { titel, afsnit: dele, bilag };
}

async function main() {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  const gammel = JSON.parse(await readFile(DATA, "utf8").catch(() => '{"sager":{}}'));
  const sager = gammel.sager;

  // 1. Find møder på oversigtssiderne
  const moeder = new Map();
  for (let side = 0; side < SIDER; side++) {
    const $ = await hent(`${LISTE}?page=${side}`);
    $('a[href^="/dagsordener-og-referater/"]').each((_, a) => {
      const m = parseMoedeUrl($(a).attr("href"));
      if (!m) return;
      const key = `${m.udvalg}|${m.dato}`;
      // Et referat erstatter dagsordenen for samme møde
      if (!moeder.has(key) || m.type === "referat") moeder.set(key, m);
    });
  }
  console.log(`Fandt ${moeder.size} møder`);

  // 2. Hent punkterne for hvert møde
  let nye = 0, opdateret = 0;
  for (const m of moeder.values()) {
    let $;
    try { $ = await hent(m.url); } catch (e) { console.warn("Spring over:", e.message); continue; }
    const punkter = $('a[href*="/punkt-"]').map((_, a) => $(a).attr("href")).get()
      .filter((h) => decodeURIComponent(h).includes(`/møde-${m.dato.slice(8, 10)}${m.dato.slice(5, 7)}${m.dato.slice(0, 4)}/${m.type}/punkt-`));
    for (const href of [...new Set(punkter)]) {
      const nr = Number(href.match(/punkt-(\d+)/)[1]);
      const id = `kk-${m.dato}-${m.udvalg}-${nr}`.toLowerCase().replace(/[^a-z0-9æøå-]+/g, "-");
      const findes = sager[id];
      if (findes && (findes.type === "referat" || findes.type === m.type)) continue;
      try {
        const p = await hentPunkt(BASE + href);
        if (!p.titel || /^lukket/i.test(p.titel)) continue;
        sager[id] = {
          id, kommune: "København", udvalg: m.udvalg, dato: m.dato, type: m.type, nr,
          kilde: BASE + href, hentet: new Date().toISOString(), ...p,
        };
        findes ? opdateret++ : nye++;
        console.log(`${findes ? "Opdateret" : "Ny"}: ${m.udvalg} ${m.dato} pkt. ${nr}: ${p.titel}`);
      } catch (e) { console.warn("Fejl:", e.message); }
    }
  }

  await writeFile(DATA, JSON.stringify({ opdateret: new Date().toISOString(), sager }, null, 1));
  console.log(`Færdig: ${nye} nye, ${opdateret} opdaterede, ${Object.keys(sager).length} i alt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
