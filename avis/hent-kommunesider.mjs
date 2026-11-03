// Henter dagsordener og referater fra kommuner, der lægger dem på deres egen hjemmeside som HTML, og gemmer hvert
// dagsordenspunkt i data/<kommune>.json i samme format som hent-firstagenda.mjs. Kommunerne står i
// avis/firstagenda.json med "system": "kommuneside", og hver har sin egen læser nedenfor (LAESERE[slug]).
//
// Hjemmesidernes robots.txt tillader det, vi henter (Aalborgs mødeserver har ingen robots.txt, og
// Ringkøbing-Skjern frabeder kun PDF'erne under /Edoc/, som vi ikke henter).
// Én forespørgsel ad gangen pr. kommune med pause imellem.
//
// Kør: node avis/hent-kommunesider.mjs              (alle aktive)
//      node avis/hent-kommunesider.mjs hedensted    (kun én)
// Miljø: DAGE (hvor langt tilbage, standard 75), PAUSE_MS (standard 1500)
import { hent, linje, afkod, renUdvalg, afsnitFra, afsnitTitel, gemKommune, koerAlle, isoDato, datoTekst, DAGE } from "./moedekilder.mjs";

const fra = () => new Date(Date.now() - DAGE * 864e5).toISOString().slice(0, 10);
const erReferat = (punkter) => punkter.some((p) => p.afsnit.some((a) => a.titel === "Beslutning"));

// "Historik" med tidligere udvalgs beslutninger ("Beslutning fra Økonomiudvalget, 20. maj 2026, pkt. 96:") deles op
// i ét "Behandling i …"-afsnit pr. udvalg, ligesom hos de andre kommuner
const RE_HIST = /^Beslutning fra (.+?),?\s+(?:den )?(\d{1,2})\. (\S+) (\d{4})(?:,\s*(?:pkt\.|punkt) \d+)?:?$/;
function udenHistorik(afsnit) {
  return afsnit.flatMap((a) => {
    if (a.titel !== "Historik") return [a];
    const ud = [];
    let nu = null;
    for (const l of a.tekst.split("\n")) {
      const m = l.trim().match(RE_HIST);
      if (m) { nu = { titel: `Behandling i ${renUdvalg(m[1])} ${datoTekst(isoDato(m[2], m[3], m[4]))}`, tekst: "" }; ud.push(nu); }
      else if (nu) nu.tekst += (nu.tekst ? "\n" : "") + l;
      else ud.push(nu = { titel: "Historik", tekst: l });
    }
    return ud.map((x) => ({ ...x, tekst: x.tekst.trim() })).filter((x) => x.tekst);
  });
}

const LAESERE = {
  // Frederikssund (www.frederikssund.dk/Politik/Dagsordener-og-referater): én side pr. udvalg med links til
  // møderne som …/<udvalg>/<åååå-mm-dd_tt-mm>/<dagsorden|referat|tillaegsdagsorden|tillaegsreferat>.
  // Hvert punkt er <h2 class="agenda-item"><span class="no">73</span><span>Titel</span></h2> med <h3>-afsnit.
  async frederikssund(k) {
    const STI = "/Politik/Dagsordener-og-referater";
    const indeks = await hent(k.base + STI);
    const udvalg = new Map();
    for (const a of indeks.matchAll(/href="\/Politik\/Dagsordener-og-referater\/([^"/#?]+)"[^>]*>([^<]+)</g))
      if (!/^udvalg-\d{4}/.test(a[1])) udvalg.set(a[1], linje(a[2]));
    const moeder = new Map();
    for (const [sti, navn] of udvalg) {
      const side = await hent(`${k.base}${STI}/${sti}`);
      for (const a of side.matchAll(new RegExp(`href="(${STI}/${sti}/(\\d{4}-\\d{2}-\\d{2})_(\\d{2}-\\d{2})/(tillaeg)?(dagsorden|referat))"`, "g"))) {
        const [, href, dato, tid, tillaeg, type] = a;
        if (dato < fra()) continue;
        // Referatet erstatter dagsordenen for samme møde; et tillæg er sit eget møde med egne punktnumre
        const id = `${sti}/${dato}_${tid}${tillaeg ? "/tillaeg" : ""}`;
        if (moeder.get(id)?.type === "referat") continue;
        moeder.set(id, { id, kilde: k.base + href, udvalg: navn, dato, type, noegle: href });
      }
    }
    await gemKommune(k, [...moeder.values()], async (m) => {
      const html = await hent(m.kilde);
      return html.split(/<h2 id="a-\d+" class="agenda-item">/).slice(1).map((del) => {
        const t = del.match(/<span class="no">(\d+)<\/span>\s*<span>([\s\S]*?)<\/span>/);
        if (!t) return null;
        const { afsnit, bilag } = afsnitFra(del.slice(del.indexOf("box-body")), "h3", m.udvalg, k.base);
        return { nr: +t[1], titel: linje(t[2]), afsnit: udenHistorik(afsnit), bilag };
      }).filter(Boolean);
    });
  },

  // Hedensted (www.hedensted.dk): én side pr. udvalg under …/dagsordener-og-referater/ med links til møderne som
  // ?agenda=/dagsorden/<kode>/<dd-mm-åååå>&elementid=<hex> (SBSYS' webpublicering). Udvalgets navn står i mødet
  // ("Udvalg: Kommunalbestyrelsen 2026-2029"). Hvert punkt er <h2>155. Titel</h2> med <h3>-afsnit.
  // Siden siger ikke, om det er dagsorden eller referat; et møde med beslutninger er et referat.
  async hedensted(k) {
    const STI = "/politik-og-indflydelse/kommunalbestyrelse-og-udvalg/dagsordener-og-referater";
    const indeks = await hent(k.base + STI);
    const sider = [...new Set([...indeks.matchAll(/href="(?:https:\/\/www\.hedensted\.dk)?(\/politik-og-indflydelse\/kommunalbestyrelse-og-udvalg\/dagsordener-og-referater\/[^"?#]+)"/g)]
      .map((a) => a[1]).filter((s) => !/arkiv/.test(s)))];
    const moeder = new Map();
    for (const side of sider) {
      const html = await hent(k.base + side);
      for (const a of html.matchAll(/\?agenda=(\/dagsorden\/[^&"]+?\/(\d{2})-(\d{2})-(\d{4}))&amp;elementid=([0-9a-f]+)/g)) {
        const dato = `${a[4]}-${a[3]}-${a[2]}`;
        if (dato < fra()) continue;
        moeder.set(a[1], { id: a[1], kilde: `${k.base}${side}?agenda=${a[1]}&elementid=${a[5]}`, udvalg: "", dato, type: "dagsorden", noegle: a[1] });
      }
    }
    await gemKommune(k, [...moeder.values()], async (m) => {
      const html = await hent(m.kilde);
      const u = html.match(/<strong>Udvalg: <\/strong>([^<]+)</);
      // "Økonomiudvalget - Udvalget for Økonomi & Erhverv" → "Økonomiudvalget"
      m.udvalg = renUdvalg(afkod(u ? u[1] : "Ukendt udvalg")).replace(/ - Udvalget for .*$/, "");
      const punkter = html.split(/<div class="accordion__item js-accordion-item"[^>]*>/).slice(1).map((del) => {
        const t = linje((del.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || "").match(/^(\d+)\.\s*(.*)$/);
        if (!t) return null;
        const { afsnit, bilag } = afsnitFra(del.slice(del.indexOf("</h2>")), "h3", m.udvalg, k.base);
        // "Beslutningstema" er sagens korte resumé
        const resume = afsnit.findIndex((a) => a.titel === "Beslutningstema");
        if (resume >= 0 && !afsnit.some((a) => a.titel === "Resumé")) afsnit.unshift({ ...afsnit.splice(resume, 1)[0], titel: "Resumé" });
        return { nr: +t[1], titel: t[2].trim(), afsnit: udenHistorik(afsnit), bilag };
      }).filter(Boolean);
      return { punkter, type: erReferat(punkter) ? "referat" : "dagsorden" };
    }, { frisk: 14 });
  },

  // Aalborg: aalborg.dk viser møderne fra en egen server (apps.aalborgkommune.dk/dagsordenreferat). Mødelisten pr.
  // udvalg er /dagsordenreferat/?Id=<udvalg>, og mødet /dagsordenreferat/visreferat?id=<udvalg>&moedetitel=<åååå-mm-dd tt.mm>.
  // Udvalgenes numre står i "vis-referat/?id="-linkene på udvalgenes sider på aalborg.dk (tjekket 3/11-2026).
  // Hvert punkt er <h3>4. Titel</h3> med <h4>-afsnit (Indstilling, Beslutning, Bilag).
  async aalborg(k) {
    const UDVALG = [15, 31, 35, 56, 57, 58, 59, 12, 13, 24, 29];
    const moeder = [];
    for (const id of UDVALG) {
      const html = await hent(`${k.base}/dagsordenreferat/?Id=${id}`);
      const navn = linje((html.match(/<h[12][^>]*>\s*(?:<span>)?([^<]+)/) || [])[1] || "").replace(/^Referater fra /, "");
      if (!navn) continue;
      const udvalg = navn[0].toUpperCase() + navn.slice(1);
      for (const a of new Set([...html.matchAll(/moedetitel=(\d{4}-\d{2}-\d{2})%20(\d{2}\.\d{2})/g)].map((x) => `${x[1]}|${x[2]}`))) {
        const [dato, tid] = a.split("|");
        if (dato < fra()) continue;
        const kilde = `${k.base}/dagsordenreferat/visreferat?id=${id}&moedetitel=${dato}%20${tid}`;
        moeder.push({ id: `${id}/${dato} ${tid}`, kilde, udvalg, dato, type: "referat", noegle: kilde });
      }
    }
    await gemKommune(k, moeder, async (m) => {
      const html = await hent(m.kilde);
      const h1 = linje((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
      const punkter = html.split(/<h3 class="text-heading-sm-strong[^"]*">/).slice(1).map((del) => {
        const t = linje(del.slice(0, del.indexOf("</h3>"))).match(/^(\d+)\.\s*(.*)$/);
        return t && { nr: +t[1], titel: t[2].replace(/\.$/, "").trim(), ...afsnitFra(del, "h4", m.udvalg, k.base) };
      }).filter(Boolean);
      return { punkter, type: / - dagsorden/i.test(h1) || !erReferat(punkter) ? "dagsorden" : "referat" };
    }, { frisk: 14 });
  },

  // Ringkøbing-Skjern (www.rksk.dk): byrådets møder står i en tabel på /om-kommunen/byraad/dagsorden-og-referat og
  // hvert udvalgs på /om-kommunen/politiske-udvalg/<udvalg>/dagsordener-referater, med dato, udvalg, type og et link
  // ?AgendaID=<nr>. Hvert punkt er <div class="agenda--item"> med <h2>4 <span>: Titel</span></h2>, og afsnittene
  // begynder med en <strong>-overskrift efter en afsluttet blok. robots.txt frabeder PDF'erne under /Edoc/; dem
  // henter vi ikke (bilagene linkes kun).
  async "ringkoebing-skjern"(k) {
    const sider = ["/om-kommunen/byraad/dagsorden-og-referat"];
    const udvalgsside = await hent(`${k.base}/om-kommunen/politiske-udvalg`);
    // Udvalgenes mødelister hedder forskelligt (dagsordener-referater, dag-ref-<udvalg>); linket står på udvalgets side
    for (const a of new Set([...udvalgsside.matchAll(/href="\/om-kommunen\/politiske-udvalg\/([^"/#?]+)"/g)].map((x) => x[1]))) {
      if (a.startsWith("ref-")) continue;
      const html = await hent(`${k.base}/om-kommunen/politiske-udvalg/${a}`).catch(() => "");
      const l = html.match(new RegExp(`href="(/om-kommunen/politiske-udvalg/${a}/[^"]*dag[^"]*)"`));
      if (l) sider.push(l[1]);
    }
    const moeder = new Map();
    for (const side of sider) {
      let html;
      try { html = await hent(k.base + side); } catch (e) { console.warn(`  ${side}: ${e.message}`); continue; }
      for (const r of html.matchAll(/<tr class="agenda--tr"[^>]*>\s*<td[^>]*>\d+<\/td>\s*<td>(\d{1,2})\. (\S+) (\d{4}) kl\. (\d{2}:\d{2})<\/td>\s*<td>([^<]+)<\/td>\s*<td><a href="([^"]*AgendaID=(\d+))"[^>]*>([^<]+)<\/a>/g)) {
        const [, d, mdr, aar, tid, udvalg, href, agendaId, type] = r;
        const dato = isoDato(d, afkod(mdr), aar);
        if (dato < fra()) continue;
        // Dagsorden og referat til samme møde er to rækker; referatet vinder
        const id = `${afkod(udvalg).trim()}|${dato} ${tid}`, t = /referat/i.test(type) ? "referat" : "dagsorden";
        if (moeder.get(id)?.type === "referat") continue;
        moeder.set(id, { id, kilde: new URL(afkod(href), k.base).href, udvalg: renUdvalg(afkod(udvalg)), dato, type: t, noegle: `${agendaId}|${t}` });
      }
    }
    await gemKommune(k, [...moeder.values()], async (m) => {
      const html = await hent(m.kilde);
      return html.split(/<div class="agenda--card agenda--item"[^>]*>/).slice(1).map((del) => {
        const t = linje((del.match(/<h2 class="h3">([\s\S]*?)<\/h2>/) || [])[1] || "").match(/^(\d+)\s*(?::\s*|LUKKET PUNKT:\s*)?(.*)$/);
        if (!t) return null;
        // Topniveauets <strong>-overskrifter gøres til <h5>, så afsnitFra kan dele ved dem
        const krop = del.slice(del.indexOf("</h2>")).replace(/(<\/(?:p|ul|ol|h2|table|div)>)\s*<strong>([^<]{1,120})<\/strong>/g, "$1<h5>$2</h5>");
        const { afsnit, bilag } = afsnitFra(krop, "h5", m.udvalg, k.base);
        const ud = [];
        for (const a of afsnit) {
          const tidl = a.titel.match(/^(.+?) (\d{2})-(\d{2})-(\d{4})$/);
          if (a.titel === "Fraværende" && ud.at(-1)?.titel === "Beslutning") ud.at(-1).tekst += `\nFraværende: ${a.tekst.replace(/\s*\(\)/g, "").replace(/^•\s*/, "").replace(/\s*\n[•,]?\s*/g, ", ")}`;
          else if (a.titel === "Fraværende") continue;
          else ud.push(tidl ? { titel: `Behandling i ${renUdvalg(tidl[1])} ${datoTekst(`${tidl[4]}-${tidl[3]}-${tidl[2]}`)}`, tekst: a.tekst } : a);
        }
        return { nr: +t[1], titel: t[2].trim(), afsnit: ud, bilag: bilag.filter((b) => !/^Ingen bilag/i.test(b.navn)) };
      }).filter(Boolean);
    });
  },

  // Norddjurs (norddjurs.meetingsplus.dk, MeetingsPlus): hvert udvalg har en side /committees/<udvalg> med alle møder
  // (møde-id, adresse og dato). Mødesiden viser punkterne, men teksten står kun i en PDF pr. punkt (den første PDF i
  // punktet; resten er bilag), som læses med pdftotext ligesom i hent-firstagenda.mjs. /agenda/ i adressen er en
  // dagsorden og /protocol/ et referat. robots.txt frabeder kun /admin. Hele mødet som ZIP (80 MB) bruges ikke.
  async norddjurs(k) {
    const { pdfTilTekst } = await import("./hent-firstagenda.mjs");
    const forside = await hent(`${k.base}/committees`);
    const udvalg = [...new Set([...forside.matchAll(/href="(?:https:\/\/norddjurs\.meetingsplus\.dk)?\/committees\/([a-z0-9-]+)"/g)].map((x) => x[1]))].filter((u) => !u.startsWith("test"));
    const moeder = [];
    for (const u of udvalg) {
      const html = await hent(`${k.base}/committees/${u}`);
      const navn = linje((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || u);
      for (const a of html.matchAll(/data-content-id="(\d+)">\s*<a[^>]+href="(\/committees\/[^"]+)"[^>]+aria-label="Møde (\d{4}-\d{2}-\d{2})/g)) {
        if (a[3] < fra()) continue;
        moeder.push({ id: a[1], kilde: k.base + a[2], udvalg: renUdvalg(navn), dato: a[3], type: "dagsorden", noegle: "" });
      }
    }
    // Siden siger ikke, hvornår et møde er ændret, så møder fra de seneste 14 dage hentes igen hver gang
    await gemKommune(k, moeder, async (m) => {
      const html = await hent(m.kilde);
      // Mødesiden har en fane med dagsordenen og en med referatet; er der punkter i referatet, læses kun det
      const fane = (id) => { const i = html.indexOf(`id="${id}"`); if (i < 0) return ""; const j = html.indexOf('role="tabpanel"', i); return html.slice(i, j > i ? j : undefined); };
      const protokol = fane("protocolTabContent"), side = /meeting-item-row/.test(protokol) ? protokol : fane("agendaTabContent") || html;
      const punkter = [];
      for (const del of side.split(/<li class="meeting-item-row[^"]*"[^>]*>/).slice(1)) {
        const nr = +linje((del.match(/<span class="list-item-number">([\s\S]*?)<\/span>/) || [])[1] || "");
        const titel = linje((del.match(/<p class="item-title">([\s\S]*?)<\/p>/) || [])[1] || "");
        if (!nr || !titel) continue;
        const [hoved, bilagsdel = ""] = del.split(/<p class="item-title">\s*Bilag\s*<\/p>/);
        const pdf = (hoved.match(/href="(\/welcome-da\/[^"]+pdf\?downloadMode=open)"/) || [])[1];
        const bilag = [...bilagsdel.matchAll(/href="(\/welcome-da\/[^"]+pdf\?downloadMode=open)"[^>]*>([\s\S]*?)<\/a>/g)]
          .map((b) => ({ navn: linje(b[2]).replace(/^\d+\.\d+\.\s*/, "").replace(/\.pdf$/i, ""), url: k.base + afkod(b[1]) }));
        let afsnit = [];
        if (pdf) {
          if (/\/protocol\//.test(pdf)) m.type = "referat";
          afsnit = afsnitFraPdf(await pdfTilTekst(await hent(k.base + afkod(pdf), { binaer: true })), m.udvalg);
        }
        punkter.push({ nr, titel, afsnit, bilag });
      }
      return { punkter, type: m.type };
    }, { frisk: 14 });
  },
};

// Norddjurs' punkt-PDF: sidehoved "<Udvalg> dd-mm-åååå" på hver side, titel, sagsnummer, "Åben Sag" og derefter
// afsnit med faste overskrifter. "Beslutning i <udvalg> den dd-mm-åååå" bliver "Beslutning" eller "Behandling i …",
// "Afbud:" lægges under beslutningen som fravær, og "Sagsgang" og "Bilag:" springes over (bilagene linkes fra mødesiden).
const PDF_OVERSKRIFTER = new Set(["Resumé", "Sagsgang", "Sagsfremstilling", "Sammenhæng til andre politikker/strategier og fagområder", "Økonomiske konsekvenser",
  "Lovgrundlag", "Høring", "Borgerinddragelse", "Kommunikation", "Tidligere beslutninger", "Indstilling", "Beslutning", "Afbud:", "Bilag:"]);
function afsnitFraPdf(tekst, udvalg) {
  const linjer = tekst.replace(/\r/g, "").replace(/\f/g, "\n").split("\n");
  const hoved = linjer.find((l) => l.trim())?.trim();
  const afsnit = [];
  let nu = null;
  for (const l of linjer) {
    const t = l.trim();
    if (t === hoved) continue;
    if (PDF_OVERSKRIFTER.has(t) || /^Beslutning i .+ den \d{2}-\d{2}-\d{4}$/.test(t)) { afsnit.push(nu = { titel: afsnitTitel(t.replace(/:$/, ""), udvalg), tekst: "" }); continue; }
    if (nu) nu.tekst += l + "\n";
  }
  const ud = [];
  for (const a of afsnit) {
    const tekst = a.tekst.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (a.titel === "Afbud") { if (tekst && ud.at(-1)?.titel === "Beslutning") ud.at(-1).tekst += `\nAfbud: ${tekst.split("\n").filter(Boolean).join(", ")}`; continue; }
    if (a.titel === "Sagsgang" || a.titel === "Bilag" || !tekst) continue;
    ud.push({ titel: a.titel, tekst });
  }
  return ud;
}

async function hentKommune(k) {
  if (!LAESERE[k.slug]) throw new Error("ingen læser til kommunen i hent-kommunesider.mjs");
  await LAESERE[k.slug](k);
}

if (process.argv[1]?.endsWith("hent-kommunesider.mjs")) await koerAlle("kommuneside", hentKommune);
export { LAESERE, udenHistorik };
