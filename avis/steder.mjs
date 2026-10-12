// Steder: én side for hver gade, plads, park eller kvarter i København, som flere sager handler om.
// Folk søger på "Toldbodgade" eller "Jernbanebyen", ikke på udvalgets navn, så siderne er til Google og deling.
// Stednavnene kommer fra OpenStreetMap (avis/steder-kk.json, hentes med avis/hent-steder.mjs).
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const MIN_SAGER = 2; // færre giver en tynd side, der bare gentager sagen

// Finder stederne i sagens titel og resumé. Længste navn vinder, så "Lille Langebro" ikke også tæller som "Langebro".
export async function findSteder(sager, ROD) {
  let navne = [];
  try { navne = JSON.parse(await readFile(join(ROD, "avis", "steder-kk.json"), "utf8")).navne; } catch { return { prSted: new Map(), stederFor: () => [] }; }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const B = "A-Za-zÆØÅæøåÉéÜü0-9";
  const re = new RegExp(`(?<![${B}])(?:${[...navne].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![${B}])`, "g");
  const prSted = new Map();
  for (const s of sager) {
    const tekst = [s.titel, s.kommunensTitel || "", (s.afsnit.find((a) => a.titel === "Resumé")?.tekst || "").slice(0, 600)].join(" | ");
    for (const n of new Set(tekst.match(re) || [])) { if (!prSted.has(n)) prSted.set(n, []); prSted.get(n).push(s); }
  }
  for (const [n, l] of prSted) if (l.length < MIN_SAGER) prSted.delete(n);
  const prSag = new Map();
  for (const [n, l] of prSted) for (const s of l) { if (!prSag.has(s.id)) prSag.set(s.id, []); prSag.get(s.id).push(n); }
  return { prSted, stederFor: (s) => prSag.get(s.id) || [] };
}

// Stederne som links på sagen
export const stedLinks = (navne, rod, H) => navne.length
  ? `<p class="steder"><span>Steder i sagen:</span> ${navne.map((n) => `<a href="${rod}sted/${H.slug(n)}.html">${H.esc(n)}</a>`).join(" · ")}</p>` : "";

export async function bygSteder(prSted, H) {
  const { ROD, esc, side, kicker, saetninger, slug, datoTekst } = H;
  await rm(join(ROD, "sted"), { recursive: true, force: true }); await mkdir(join(ROD, "sted"), { recursive: true });
  const steder = [...prSted.keys()].sort((a, b) => a.localeCompare(b, "da"));
  const KILDE = `<p class="kilde-osm">Stednavne fra OpenStreetMap (© OpenStreetMap-bidragydere). Sagerne kommer fra kommunens dagsordener og referater.</p>`;
  for (const n of steder) {
    const l = prSted.get(n);
    const tester = `<aside class="paa-mail tester">
  <h2 class="rubrik">Få besked, når ${esc(n)} er på dagsordenen</h2>
  <p>Sagsvagt læser alle dagsordener fra byråd, udvalg og lokaludvalg. Skriv dig op, så får du en kort mail hver mandag med de sager, du følger. Vi søger de første testere i København. Det er gratis.</p>
  <a href="../vagt.html?fra=sted&amp;emne=${encodeURIComponent(n)}#tilmeld">Bliv tester →</a>
</aside>`;
    const nyeste = l[0];
    await writeFile(join(ROD, "sted", `${slug(n)}.html`), side({
      titel: `${n}: politiske sager og beslutninger – Sagsvagt`,
      beskrivelse: `Hvad har politikerne i København besluttet om ${n}? ${l.length} sager fra Borgerrepræsentationen, udvalgene og lokaludvalgene. Senest ${datoTekst(nyeste.dato)}.`,
      sti: `sted/${slug(n)}.html`, rod: "../", aktiv: "sted",
      indhold: `<div class="wrap"><div class="listing">
  <p class="kicker"><a href="./">Alle steder</a></p>
  <h1>${esc(n)}</h1>
  <p class="intro">${l.length} sager fra Borgerrepræsentationen, udvalgene og lokaludvalgene i København, der handler om ${esc(n)}. Nyeste først.</p>
  ${delRad(`${H.SITE_URL}sted/${slug(n)}.html`, `${n}: det har politikerne besluttet`)}
  ${l.map((s) => `<article>${kicker(s, "../", true)}<h2 class="hl"><a href="../${s.url}">${esc(s.titel)}</a></h2>${s.dek ? `<p class="dek">${esc(saetninger(s.dek, 200))}</p>` : ""}</article>`).join("\n")}
  ${tester}
  ${KILDE}
</div></div>${DEL_SCRIPT}`,
    }));
  }
  // Oversigt A-Å
  const grupper = {};
  for (const n of steder) (grupper[n[0].toUpperCase()] ||= []).push(n);
  await writeFile(join(ROD, "sted", "index.html"), side({
    titel: "Steder i København – Sagsvagt",
    beskrivelse: "Gader, pladser, parker og kvarterer i København og de politiske sager, der handler om dem.",
    sti: "sted/", rod: "../", aktiv: "sted",
    indhold: `<div class="wrap"><div class="listing">
  <h1>Steder</h1>
  <p class="intro">Gader, pladser, parker og kvarterer, som politikerne i København har haft på dagsordenen flere gange. Find din gade, og se, hvad der er besluttet.</p>
  ${Object.entries(grupper).map(([b, ns]) => `<h2 class="sted-bogstav">${esc(b)}</h2><ul class="chips">${ns.map((n) => `<li><a href="${slug(n)}.html">${esc(n)} <span style="opacity:.6">(${prSted.get(n).length})</span></a></li>`).join("")}</ul>`).join("\n")}
  ${KILDE}
</div></div>`,
  }));
  return ["sted/", ...steder.map((n) => `sted/${slug(n)}.html`)];
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
