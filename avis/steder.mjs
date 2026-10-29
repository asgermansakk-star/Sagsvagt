// Steder: én side for hver gade, plads, park eller kvarter i København, som flere sager handler om.
// Folk søger på "Toldbodgade" eller "Jernbanebyen", ikke på udvalgets navn, så siderne er til Google og deling.
// Stednavnene kommer fra OpenStreetMap (avis/steder-kk.json, hentes med avis/hent-steder.mjs).
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

const MIN_SAGER = 2; // færre giver en tynd side, der bare gentager sagen

// Finder stederne i sagens titel og resumé. Længste navn vinder, så "Lille Langebro" ikke også tæller som "Langebro".
// navne: stednavnene (standard: Københavns fra avis/steder-kk.json). min: hvor mange sager et sted skal have.
export async function findSteder(sager, ROD, { navne = null, min = MIN_SAGER } = {}) {
  if (!navne) {
    try { navne = JSON.parse(await readFile(join(ROD, "avis", "steder-kk.json"), "utf8")).navne; } catch { return { prSted: new Map(), stederFor: () => [] }; }
  }
  if (!navne.length) return { prSted: new Map(), stederFor: () => [] };
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const B = "A-Za-zÆØÅæøåÉéÜü0-9";
  const re = new RegExp(`(?<![${B}])(?:${[...navne].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![${B}])`, "g");
  const prSted = new Map();
  for (const s of sager) {
    const tekst = [s.titel, s.kommunensTitel || "", (s.afsnit.find((a) => a.titel === "Resumé")?.tekst || "").slice(0, 600)].join(" | ");
    for (const n of new Set(tekst.match(re) || [])) { if (!prSted.has(n)) prSted.set(n, []); prSted.get(n).push(s); }
  }
  for (const [n, l] of prSted) if (l.length < min) prSted.delete(n);
  const prSag = new Map();
  for (const [n, l] of prSted) for (const s of l) { if (!prSag.has(s.id)) prSag.set(s.id, []); prSag.get(s.id).push(n); }
  return { prSted, stederFor: (s) => prSag.get(s.id) || [] };
}

// Stederne som links på sagen. mappe: hvor stedsiderne ligger fra roden (København: sted/, fx kommune/viborg/sted/)
export const stedLinks = (navne, rod, H, mappe = "sted/", tekst = "Steder i sagen:") => navne.length
  ? `<p class="steder"><span>${tekst}</span> ${navne.map((n) => `<a href="${rod}${mappe}${H.slug(n)}.html">${H.esc(n)}</a>`).join(" · ")}</p>` : "";

// Stedsiderne og en oversigt A-Å. Standard er Københavns sted/; de andre kommuner bruger den samme opbygning
// til deres steder (kommune/<navn>/sted/) og byer og bydele (kommune/<navn>/bydel/).
export async function bygSteder(prSted, H, o = {}) {
  const { ROD, esc, side, kicker, saetninger, slug, datoTekst } = H;
  const { mappe = "sted", kommune = null, hvor = "København", aktiv = "sted", fra = "sted", hvem = "Borgerrepræsentationen, udvalgene og lokaludvalgene",
    titel = "Steder", indexTitel = "Steder i København – Sagsvagt", indexBeskrivelse = "Gader, pladser, parker og kvarterer i København og de politiske sager, der handler om dem.",
    indexIntro = "Gader, pladser, parker og kvarterer, som politikerne i København har haft på dagsordenen flere gange. Find din gade, og se, hvad der er besluttet.",
    alle = "Alle steder" } = o;
  const rod = "../".repeat(mappe.split("/").length);
  await rm(join(ROD, mappe), { recursive: true, force: true });
  await mkdir(join(ROD, mappe), { recursive: true });
  const steder = [...prSted.keys()].sort((a, b) => a.localeCompare(b, "da"));
  const KILDE = `<p class="kilde-osm">Stednavne fra OpenStreetMap (© OpenStreetMap-bidragydere). Sagerne kommer fra kommunens dagsordener og referater.</p>`;
  for (const n of steder) {
    const l = prSted.get(n);
    const tester = `<aside class="paa-mail tester">
  <h2 class="rubrik">Få besked, når ${esc(n)} er på dagsordenen</h2>
  <p>Sagsvagt læser alle dagsordener fra ${kommune ? "byråd og udvalg" : "byråd, udvalg og lokaludvalg"}. Skriv dig op, så får du en kort mail hver mandag med de sager, du følger. Vi søger testere i hele Danmark. Det er gratis.</p>
  <a href="${rod}vagt.html?fra=${fra}&amp;emne=${encodeURIComponent(n)}${kommune ? `&amp;kommune=${encodeURIComponent(kommune.navn)}` : ""}#tilmeld">Skriv dig op</a>
</aside>`;
    const nyeste = l[0];
    await writeFile(join(ROD, mappe, `${slug(n)}.html`), side({
      titel: `${n}: politiske sager og beslutninger – Sagsvagt`,
      beskrivelse: `Hvad har politikerne i ${hvor} besluttet om ${n}? ${l.length} ${l.length === 1 ? "sag" : "sager"} fra ${hvem}. Senest ${datoTekst(nyeste.dato)}.`,
      sti: `${mappe}/${slug(n)}.html`, rod, aktiv, kommune,
      indhold: `<div class="wrap"><div class="listing">
  <p class="kicker"><a href="./">${esc(alle)}</a></p>
  <h1>${esc(n)}</h1>
  <p class="intro">${l.length} ${l.length === 1 ? "sag" : "sager"} fra ${esc(hvem)} i ${esc(hvor)}, der handler om ${esc(n)}. Nyeste først.</p>
  ${delRad(`${H.SITE_URL}${mappe}/${slug(n)}.html`, `${n}: det har politikerne besluttet`)}
  ${l.map((s) => `<article>${kicker(s, rod, true)}<h2 class="hl"><a href="${rod}${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 200))}</p>` : ""}</article>`).join("\n")}
  ${tester}
  ${KILDE}
</div></div>${DEL_SCRIPT}`,
    }));
  }
  // Oversigt A-Å
  const grupper = {};
  for (const n of steder) (grupper[n[0].toUpperCase()] ||= []).push(n);
  await writeFile(join(ROD, mappe, "index.html"), side({
    titel: indexTitel, beskrivelse: indexBeskrivelse, sti: `${mappe}/`, rod, aktiv, kommune,
    indhold: `<div class="wrap"><div class="listing">
  <h1>${esc(titel)}</h1>
  <p class="intro">${esc(indexIntro)}</p>
  ${steder.length ? Object.entries(grupper).map(([b, ns]) => `<h2 class="sted-bogstav">${esc(b)}</h2><ul class="chips">${ns.map((n) => `<li><a href="${slug(n)}.html">${esc(n)} <span style="opacity:.6">(${prSted.get(n).length})</span></a></li>`).join("")}</ul>`).join("\n") : `<p class="intro">Ingen endnu. Siden fyldes op, efterhånden som der kommer flere sager.</p>`}
  ${KILDE}
</div></div>`,
  }));
  return [`${mappe}/`, ...steder.map((n) => `${mappe}/${slug(n)}.html`)];
}

// Del-knap: telefonens egen deling, ellers kopiér linket. Facebook-linket virker også uden JavaScript.
// Linkene har ?fra=del, så tilmeldinger fra delte links kan ses i kilden.
const attr = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const delRad = (url, titel) => `<div class="del-rad" data-url="${url}?fra=del" data-titel="${attr(titel)}">
  <button type="button" class="del-knap" hidden>Del</button>
  <a class="del-knap" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${url}?fra=fb-del`)}" target="_blank" rel="noopener">Del på Facebook</a>
  <span class="del-svar" role="status"></span>
</div>`;
export const DEL_SCRIPT = `<script>document.querySelectorAll(".del-rad").forEach(function(r){var b=r.querySelector("button"),s=r.querySelector(".del-svar");b.hidden=false;b.textContent=navigator.share?"Del":"Kopiér link";b.addEventListener("click",function(){var u=r.dataset.url;if(navigator.share){navigator.share({title:r.dataset.titel,url:u}).catch(function(){});return}navigator.clipboard.writeText(u).then(function(){s.textContent="Linket er kopieret"},function(){s.textContent=u})})})</script>`;
