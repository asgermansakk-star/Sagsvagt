// Henter dagsordener og referater fra kommuner, der bruger "Åben Dagsorden" (fx dagsorden.glostrup.dk og
// aabendagsorden.syddjurs.dk), og gemmer hvert dagsordenspunkt i data/<kommune>.json i samme format som
// hent-firstagenda.mjs. Kommunerne står i avis/firstagenda.json med "system": "aabendagsorden".
//
// Portalens robots.txt tillader alt. Vi bruger de samme to adresser som portalens egen side: mødelisten
// (/rest/meeting/search, JSON) og mødet (/fragments/meeting/<id>/view, HTML med hele teksten). Ingen PDF'er.
// Én forespørgsel ad gangen med pause imellem.
//
// Kør: node avis/hent-aabendagsorden.mjs            (alle aktive)
//      node avis/hent-aabendagsorden.mjs glostrup   (kun én)
// Miljø: DAGE (hvor langt tilbage, standard 75), PAUSE_MS (standard 1500)
import { hent, linje, renUdvalg, afsnitFra, gemKommune, koerAlle, DAGE } from "./moedekilder.mjs";

// ---------- Ét møde ----------
// Hvert punkt er en <h3 class="agenda-item-title">Punkt 4 Titel</h3> fulgt af afsnit med en <h4>-overskrift
// (Sagsfremstilling, Indstilling, Resumé, Beslutning i … den dd-mm-åååå, Bilag).
export function parseMoede(html, udvalg, base) {
  const punkter = [];
  for (const del of html.split(/<h3 class="agenda-item-title">/).slice(1)) {
    const m = linje(del.slice(0, del.indexOf("</h3>"))).match(/^Punkt (\d+)\.?\s*(.*)$/);
    if (m) punkter.push({ nr: +m[1], titel: m[2].trim(), ...afsnitFra(del, "h4", udvalg, base) });
  }
  return punkter;
}

// ---------- Én kommune ----------
async function hentKommune(k) {
  const fra = new Date(Date.now() - DAGE * 864e5);
  const fraTekst = `${String(fra.getUTCDate()).padStart(2, "0")}/${String(fra.getUTCMonth() + 1).padStart(2, "0")}/${fra.getUTCFullYear()}`;
  const liste = JSON.parse(await hent(`${k.base}/rest/meeting/search?query=&fromDate=${encodeURIComponent(fraTekst)}`)).meetings || [];
  // Portalen har ingen ændringsdato; nøglen er status og punktlisten
  const moeder = liste.filter((m) => !m.blocked && /^(Dagsorden|Referat)$/i.test(m.status)).map((m) => ({
    id: m.meetingId, kilde: `${k.base}/meeting/${m.meetingId}`, udvalg: renUdvalg(m.committeeGroupName || m.committeeName),
    dato: m.date.slice(0, 10), type: /referat/i.test(m.status) ? "referat" : "dagsorden", noegle: `${m.status}|${(m.agendaItems || []).join("|")}`,
  }));
  await gemKommune(k, moeder, async (m) => parseMoede(await hent(`${k.base}/fragments/meeting/${m.id}/view`), m.udvalg, k.base));
}

if (process.argv[1]?.endsWith("hent-aabendagsorden.mjs")) await koerAlle("aabendagsorden", hentKommune);
