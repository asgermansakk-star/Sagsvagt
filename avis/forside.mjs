// Papirforsiden på sagsvagt.dk (vagt.html, Asger 22/11-2026): de dele, der skifter med sagerne. byg.mjs skriver dem i del/,
// og serveren sætter dem ind i vagt.html (server-side include), så robotten holder forsiden frisk uden at røre vagt.html.
//   del/forside-collage.html  billedet øverst: en åben høring fra avis/forside.json, ellers en ny sag med kort
//   del/forside-sager.html    Dagens sag (opslagets billeder fra avis/forside.json, ellers sagens eget billede) og seks nye sager
// Links går fra roden (/). Alt er escapet, så en sags tekst ikke kan indeholde server-direktiver.
import { EMNER } from "./beriget.mjs";
import { emneId } from "./emnebilleder.mjs";

const MD = ["jan.", "feb.", "mar.", "apr.", "maj", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "dec."];
const dag = (iso) => { const [, m, t] = iso.split("-").map(Number); return `${t}. ${MD[m - 1]}`; };
const DAGE = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const ugedag = (iso) => DAGE[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const KORT = /assets\/(plankort|stedkort)\//;
const ANTAL = 6;

// Dagens sag: en kommende sag, der har et opslag, ellers den vigtigste kommende, ellers avisens tophistorie
export function dagensSag({ sager, top, idag, valg }) {
  const kommer = sager.filter((s) => s.status === "kommer" && s.dato >= idag && !s.rutine);
  const medOpslag = kommer.find((s) => (valg.opslag || []).some((o) => o.sag === s.id));
  return medOpslag || [...kommer].sort((a, b) => (b.vaegt || 0) - (a.vaegt || 0) || (b.score || 0) - (a.score || 0) || a.dato.localeCompare(b.dato))[0] || top || sager[0];
}

const hvornaar = (s) => s.status === "kommer" ? `Til beslutning ${ugedag(s.dato)} ${dag(s.dato)}` : `Besluttet ${dag(s.dato)}`;

export function forsideDele({ sager, gitter, top, idag, hoeringer = [], valg = {}, H }) {
  const { esc, hvorNavn, billedeSti } = H, href = (s) => `/${s.url}`;
  const leder = dagensSag({ sager, top, idag, valg });
  if (!leder) return { collage: "", sager: "" };
  const findSag = (id) => sager.find((s) => s.id === id);
  const aaben = (id) => hoeringer.find((h) => String(h.id) === String(id) && h.aaben !== false && h.frist && h.frist >= idag);
  const maerkat = (link, tekst) => `<div class="maerkat"><img src="/assets/nyt/maerkat.webp" alt="" width="660" height="341"><a href="${esc(link)}">${esc(tekst)}</a></div>`;

  // Collagen øverst
  const valgt = (valg.collager || []).map((c) => ({ ...c, h: aaben(c.hoering) })).find((c) => c.h);
  let collage;
  if (valgt) {
    const s = findSag(valgt.sag);
    collage = `<img class="foto" src="/${esc(valgt.billede)}" width="${valgt.bredde}" height="${valgt.hoejde}" alt="${esc(valgt.alt)}" fetchpriority="high">
      ${maerkat(s ? href(s) : valgt.h.url, `Høring til ${dag(valgt.h.frist)}`)}
      <figcaption>${esc(valgt.tekst)}</figcaption>`;
  } else {
    const andre = [...sager.filter((s) => s.status === "kommer" && s.dato >= idag && !s.rutine), ...gitter].filter((s) => s.id !== leder.id);
    const s = andre.find((x) => KORT.test(billedeSti(x))) || andre[0] || leder, sti = billedeSti(s);
    collage = `<img class="foto riv-foto" src="/${esc(sti)}" width="1000" height="656" alt="" fetchpriority="high">
      ${maerkat(href(s), s.status === "kommer" ? `Beslutning ${dag(s.dato)}` : `Besluttet ${dag(s.dato)}`)}
      <figcaption>${esc(s.titel)}${KORT.test(sti) ? " · Kort: © OpenStreetMap-bidragydere" : ""}</figcaption>`;
  }

  // Dagens sag
  const opslag = (valg.opslag || []).find((o) => o.sag === leder.id);
  const indhold = opslag
    ? `<div class="strimmel-ydre"><div class="strimmel" tabindex="0" role="region" aria-label="Sagen i ${opslag.billeder.length} billeder"><div>${opslag.billeder.map((b, i) => `<img src="/${esc(b)}" width="640" height="800" alt="${esc(opslag.alt?.[i] || "")}"${i > 1 ? ' loading="lazy"' : ""} decoding="async">`).join("")}</div></div></div>`
    : `<a class="dagens-billede" href="${href(leder)}" tabindex="-1" aria-hidden="true"><img class="riv-foto" src="/${esc(billedeSti(leder))}" width="1000" height="656" alt="" loading="lazy" decoding="async"></a>`;

  // Seks af de vigtigste nye sager (de sidste 14 dage, ellers ældre), nyeste øverst: højst to fra samme udvalg og én fra et lokaludvalg
  const graense = new Date(Date.parse(`${idag}T12:00:00Z`) - 14 * 864e5).toISOString().slice(0, 10), kort = [];
  for (const s of [top, ...gitter].filter(Boolean).sort((a, b) => (b.dato >= graense) - (a.dato >= graense) || (b.score || 0) - (a.score || 0))) {
    if (kort.length >= ANTAL) break;
    if (kort.includes(s) || s.id === leder.id || s.titel.toLowerCase() === leder.titel.toLowerCase()) continue;
    if (kort.filter((x) => x.udvalg === s.udvalg).length >= (H.erLokaludvalg(s.udvalg) ? 1 : 2)) continue;
    kort.push(s);
  }
  kort.sort((a, b) => b.dato.localeCompare(a.dato) || (b.score || 0) - (a.score || 0));
  const maerke = (s) => { const e = EMNER[emneId(s)]; return e ? `<span class="emne${e.f === "r" ? " r" : ""}">${esc(e.navn)}</span>` : "<span></span>"; };
  const udfald = (s) => { const t = (s.udfald || "").replace(/\.$/, ""); return s.status !== "kommer" && t && t.length <= 70 ? `${esc(t)} · ` : s.status === "kommer" ? "Kommer · " : ""; };
  const kortHtml = (s) => `<article class="sagkort"><div class="linje1">${maerke(s)}<time datetime="${s.dato}">${dag(s.dato)}</time></div><h3><a href="${href(s)}">${esc(s.titel)}</a></h3><p>${udfald(s)}${esc(hvorNavn(s.udvalg))}</p></article>`;

  return {
    collage: `${collage}\n`,
    sager: `<section class="papir" aria-labelledby="dagens-h"><img class="kant" src="/assets/nyt/kant-kalk.webp" alt="" width="1440" height="120">
  <div class="wrap papirafsnit"><div class="hoved"><div class="rubrikker"><span class="maerke"><img src="/assets/nyt/label-vin.webp" alt="" width="460" height="154"><b>DAGENS SAG</b></span><h2 id="dagens-h"><a href="${href(leder)}">${esc(leder.titel)}</a></h2></div><a class="laes" href="${href(leder)}">Læs sagen →</a></div>
  ${indhold}
  <p class="hvornaar">${esc(hvornaar(leder))} · ${esc(hvorNavn(leder.udvalg))}</p></div></section>
<section class="papir-m" aria-labelledby="sker-h"><img class="kant vend" src="/assets/nyt/kant-kalkmoerk.webp" alt="" width="1440" height="120" loading="lazy">
  <div class="wrap papirafsnit sidste"><div class="rubrikker"><span class="maerke bred"><img src="/assets/nyt/label-indigo.webp" alt="" width="460" height="138"><b>FRA DAGSORDENERNE</b></span><h2 id="sker-h">Det sker i København</h2></div>
    <div class="kort-gitter">
${kort.map(kortHtml).join("\n")}
    </div><a class="knap moerk" href="/index.html">Vis flere sager</a></div></section>
`,
  };
}
