// Bygger avisen (forside, en side pr. sag, udvalgs- og bydelssider, sitemap)
// ud fra data/*.json. Kør: npm run byg
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..");
const SITE_URL = (process.env.SITE_URL || "https://sagsvagt.dk/").replace(/\/?$/, "/");
const IDAG = process.env.IDAG || new Date().toISOString().slice(0, 10);

// ---------- Hjælpere ----------
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
  .normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const DAGE = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const d = (iso) => new Date(iso + "T12:00:00Z");
const datoTekst = (iso) => `${d(iso).getUTCDate()}. ${MDR[d(iso).getUTCMonth()]} ${d(iso).getUTCFullYear()}`;
const kortDato = (iso) => `${d(iso).getUTCDate()}. ${MDR[d(iso).getUTCMonth()]}`;
const ugedag = (iso) => DAGE[d(iso).getUTCDay()];
function ugenr(iso) {
  const t = d(iso); const dag = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dag + 3);
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}
const afsnitTilHtml = (tekst) => tekst.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
const saetninger = (t, max) => {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max); const i = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return (i > max * 0.45 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, "") + " …");
};

// ---------- Udvælgelse ----------
const STOEJ = /^(godkendelse af (dagsorden|referat)|referat og godkendelse|eventuelt|evt\.?$|meddelelser|orientering$|orientering fra|sager til orientering|kommende sager|næste møde|åben spørgetid|borgernes tid|aflæggerbordet|beslutning på fortrolige|fremlæggermappe|rokering i udvalg|borgerbesøg|spørgetid|underskrift)/i;
// Rutinesager publiceres, men kommer ikke på forsiden
const RUTINE = /(forretningsorden|regnskab|økonomi efter budget|bydelspulje|puljeansøgning|status på bydelsplan|mødekalender)|^(henvendelser|henvendelse til|puljeansøgning|ansøgninger til|beslutning om (pulje)?ansøgning|anerkendelsespris|punkter til dagsorden|mødeplan|ændring af forretningsorden|forretningsorden|.*studietur|regnskab|anden regnskabsprognose|aflæggelse af|årsplan|udpegning af|valg af|godkendelse af referat|tredje sag om bevillings|teknisk tilpasning)/i;
const renTitel = (t) => t.replace(/^[A-ZÆØÅ]-sag:\s*/, "").replace(/^[A-ZÆØÅ]\.\s+/, "")
  .replace(/^Beslutning(:| vedr\.?)\s+/i, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
const erLokaludvalg = (u) => /Lokaludvalg$/.test(u);
const bydel = (u) => u.replace(/\s*Lokaludvalg$/, "").replace(/^Christianshavns$/, "Christianshavn");
const VAEGT = { "Borgerrepræsentationen": 3, "Økonomiudvalget": 3, "Rådet for Visuel Kunst": 0 };

function berig(s) {
  const titel = renTitel(s.titel);
  const find = (re) => s.afsnit.find((a) => re.test(a.titel));
  const resume = find(/^Resumé$/) || find(/^Problemstilling/) || find(/^Indstilling/) || s.afsnit[0];
  const besl = find(/beslutning/i);
  let beslutning = besl ? besl.tekst.replace(/^[^\n]*beslutning[^\n]*den \d+\.? \w+ \d{4}\s*/i, "").trim() : "";
  // Selve udfaldet: "Indstillingen blev godkendt med 37 stemmer mod 12" e.l.
  const UDFALD = "godkendt|vedtaget|anbefalet|tiltrådt|forkastet|nedstemt|udsat|oversendt|taget til efterretning|tilbagesendt|standset|trukket|drøftet";
  const hoved = new RegExp(`(Indstillingen|Medlemsforslaget|Forslaget|Sagen)\\b[^.\\n]*\\b(${UDFALD})\\b[^.\\n]*\\.`, "i");
  const andet = new RegExp(`[^.:”"\\n]*\\b(blev|er|var)\\b[^.\\n]{0,60}\\b(${UDFALD})\\b[^.\\n]*\\.`, "i");
  const m = beslutning.match(hoved) || beslutning.match(andet);
  const udfaldTekst = m ? m[0].trim() : "";
  // Partiernes stemmer står lige efter afgørelsen: "For: Ø, F og A\nImod: Å"
  const efter = m ? beslutning.slice(m.index + m[0].length) : "";
  const st = efter.match(/^[^\n]*\n?\s*For:\s*([^\n]+)\n\s*Imod:\s*([^\n]+)/);
  const stemmer = st ? { for: st[1].trim(), imod: st[2].trim() } : null;
  const fremtid = s.dato >= IDAG;
  const status = s.type === "referat" && beslutning ? "besluttet" : fremtid ? "kommer" : "behandlet";
  const laengde = s.afsnit.reduce((n, a) => n + a.tekst.length, 0);
  const vaegt = VAEGT[s.udvalg] ?? (/musikudvalg|Rådet for|kunst|legat/i.test(s.udvalg) ? 0 : erLokaludvalg(s.udvalg) ? 1 : 2);
  const alder = Math.max(0, (d(IDAG) - d(s.dato)) / 864e5);
  const rutine = RUTINE.test(titel);
  const score = vaegt * 10 + Math.min(laengde / 800, 8) + (beslutning ? 3 : 0) - alder * 0.6 - (rutine ? 25 : 0);
  return {
    ...s, titel, beslutning, udfald: udfaldTekst, stemmer, status, laengde, vaegt, score, rutine,
    dek: resume ? saetninger(resume.tekst.replace(/^Indstilling[^\n]*\n*/i, ""), 300) : "",
    url: `sag/${slug(s.id)}.html`,
    udvalgUrl: `${erLokaludvalg(s.udvalg) ? "bydel" : "udvalg"}/${slug(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}.html`,
  };
}
const publicerbar = (s) => !STOEJ.test(renTitel(s.titel)) && !/fortrolig/i.test(s.titel) && s.afsnit.reduce((n, a) => n + a.tekst.length, 0) > 250;

// ---------- Skabeloner ----------
function side({ titel, beskrivelse, sti, rod, indhold, aktiv = "", ogType = "website" }) {
  const canonical = SITE_URL + sti;
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beskrivelse)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0E0F14">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beskrivelse)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}assets/og-billede.png">
<meta property="og:locale" content="da_DK">
<link rel="icon" href="${rod}favicon.ico" sizes="48x48">
<link rel="icon" href="${rod}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rod}apple-touch-icon.png">
<link rel="manifest" href="${rod}site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rod}assets/avis.css">
</head>
<body>
<header class="masthead">
  <div class="wrap">
    <div class="mh-row">
      <a class="mh-logo" href="${rod}./" aria-label="Sagsvagt, til forsiden"><img src="${rod}assets/sagsvagt-vandret-kalk.svg" alt="Sagsvagt" width="168" height="52"></a>
      ${aktiv === "forside"
        ? `<p class="mh-edition"><b>${esc(ugedag(IDAG).replace(/^./, (c) => c.toUpperCase()))} ${datoTekst(IDAG)}</b><br>Uge ${ugenr(IDAG)}. Nyt fra byråd, udvalg og lokaludvalg</p>`
        : `<p class="mh-edition">Nyt fra byråd, udvalg og lokaludvalg</p>`}
    </div>
    <nav class="mh-nav" aria-label="Hovedmenu">
      <a href="${rod}./"${aktiv === "forside" ? ' aria-current="page"' : ""}>Forside</a>
      <a href="${rod}udvalg/borgerrepraesentationen.html"${aktiv === "br" ? ' aria-current="page"' : ""}>Borgerrepræsentationen</a>
      <a href="${rod}udvalg/"${aktiv === "udvalg" ? ' aria-current="page"' : ""}>Udvalg</a>
      <a href="${rod}bydel/"${aktiv === "bydel" ? ' aria-current="page"' : ""}>Bydele</a>
      <a href="${rod}om.html"${aktiv === "om" ? ' aria-current="page"' : ""}>Om Sagsvagt</a>
      <a class="cta" href="${rod}vagt.html">Få dine sager på mail</a>
    </nav>
  </div>
</header>
<main>
${indhold}
</main>
<footer class="foot">
  <div class="wrap">
    <img src="${rod}assets/sagsvagt-vandret-kalk.svg" alt="Sagsvagt" width="110" height="34">
    <span>Sagsvagt bygger på kommunernes offentlige dagsordener og referater. Læs altid den originale sag. <a href="${rod}om.html">Om Sagsvagt</a></span>
  </div>
</footer>
</body>
</html>
`;
}

const kicker = (s, rod, medUdvalg = true) => {
  const st = s.status === "besluttet" ? `<span class="status besluttet">Besluttet ${kortDato(s.dato)}</span>`
    : s.status === "kommer" ? `<span class="status kommer">På dagsordenen ${kortDato(s.dato)}</span>`
    : `<span class="status">Behandlet ${kortDato(s.dato)}</span>`;
  const hvor = erLokaludvalg(s.udvalg) ? `${bydel(s.udvalg)} Lokaludvalg` : s.udvalg;
  return `<p class="kicker">${st}${medUdvalg ? `, <a href="${rod}${s.udvalgUrl}">${esc(hvor)}</a>` : ""}</p>`;
};
const beslutningsboks = (s) => s.status === "besluttet"
  ? `<div class="decision"><b>Beslutning</b>${esc(s.udfald || saetninger(s.beslutning, 260))}${s.stemmer ? `<span class="votes"><span>For: ${esc(s.stemmer.for)}</span><span>Imod: ${esc(s.stemmer.imod)}</span></span>` : ""}</div>`
  : s.status === "kommer" ? `<div class="decision kommer"><b>Til beslutning ${ugedag(s.dato)} ${datoTekst(s.dato)}</b>${esc(saetninger((s.afsnit.find((a) => /^Indstilling/.test(a.titel))?.tekst || "Sagen er på dagsordenen.").replace(/^[^\n]*indstiller[^\n]*\n*/i, ""), 220))}</div>` : "";

const vagtBoks = (rod) => `<aside class="vagt-box">
  <h2>Følg det, der betyder noget for dig</h2>
  <p>Vælg emner som cykelstier, skoler eller lokalplaner, og få en mail, når politikerne tager dem op.</p>
  <a class="btn" href="${rod}vagt.html">Skriv dig op gratis</a>
</aside>`;

// ---------- Sider ----------
async function main() {
  const filer = (await readdir(join(ROD, "data"))).filter((f) => f.endsWith(".json"));
  const alle = [];
  for (const f of filer) alle.push(...Object.values(JSON.parse(await readFile(join(ROD, "data", f), "utf8")).sager));
  const sager = alle.filter(publicerbar).map(berig).sort((a, b) => b.dato.localeCompare(a.dato) || a.nr - b.nr);
  console.log(`${alle.length} punkter, ${sager.length} publiceres`);

  for (const dir of ["sag", "udvalg", "bydel"]) { await rm(join(ROD, dir), { recursive: true, force: true }); await mkdir(join(ROD, dir), { recursive: true }); }

  // Forside
  const afholdt = sager.filter((s) => s.status !== "kommer");
  const nyheder = afholdt.filter((s) => s.vaegt > 0 && !s.rutine).sort((a, b) => b.score - a.score);
  // Højst `max` historier fra samme udvalg, så forsiden ikke kun er ét udvalg
  const spred = (liste, n, max) => {
    const talt = {}; const ud = [];
    for (const s of liste) { if (ud.length >= n) break; if ((talt[s.udvalg] = (talt[s.udvalg] || 0) + 1) <= max) ud.push(s); }
    return ud;
  };
  const top = nyheder[0];
  const anden = spred(nyheder.filter((s) => s !== top && !erLokaludvalg(s.udvalg)), 6, 2);
  const brugt = new Set([top, ...anden]);
  const bydele = spred(nyheder.filter((s) => erLokaludvalg(s.udvalg) && !brugt.has(s)), 6, 2);
  bydele.forEach((s) => brugt.add(s));
  const kommende = spred(sager.filter((s) => s.status === "kommer" && s.vaegt > 0 && !s.rutine).sort((a, b) => a.dato.localeCompare(b.dato) || b.score - a.score), 7, 2);
  const seneste = afholdt.filter((s) => !brugt.has(s) && s.vaegt > 0 && !s.rutine).slice(0, 15);

  const forside = `<div class="wrap">
  <div class="front">
    <div>
      <article class="lead">
        ${kicker(top, "")}
        <h1 class="hl"><a href="${top.url}">${esc(top.titel)}</a></h1>
        <p class="dek">${esc(top.dek)}</p>
        ${beslutningsboks(top).replace('class="decision', 'class="decision')}
      </article>
      <div class="second">
        ${anden.map((s) => `<article>${kicker(s, "")}<h2 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h2><p class="dek">${esc(saetninger(s.dek, 170))}</p></article>`).join("\n        ")}
      </div>
    </div>
    <div class="rail">
      ${vagtBoks("")}
      <section aria-labelledby="h-bydele" style="margin-top:34px">
        <h2 id="h-bydele" class="sec-h">Fra bydelene <a href="bydel/">Alle bydele</a></h2>
        ${bydele.map((s) => `<article class="mini">${kicker(s, "")}<h3 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h3></article>`).join("\n        ")}
      </section>
      <section aria-labelledby="h-kommer">
        <h2 id="h-kommer" class="sec-h">Det skal de tage stilling til</h2>
        ${kommende.map((s) => `<article class="mini">${kicker(s, "")}<h3 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h3></article>`).join("\n        ")}
      </section>
    </div>
  </div>
  <section class="latest" aria-labelledby="h-seneste">
    <h2 id="h-seneste" class="sec-h">Flere sager fra København</h2>
    <ol>
      ${seneste.map((s) => `<li>${kicker(s, "")}<h3 class="hl"><a href="${s.url}">${esc(s.titel)}</a></h3></li>`).join("\n      ")}
    </ol>
  </section>
</div>`;
  await writeFile(join(ROD, "index.html"), side({
    titel: "Sagsvagt – nyt fra byråd og udvalg i København",
    beskrivelse: "Det, politikerne i Københavns Kommune har besluttet og skal tage stilling til. Fra Borgerrepræsentationen, udvalgene og lokaludvalgene, hentet fra de officielle referater.",
    sti: "", rod: "", indhold: forside, aktiv: "forside",
  }));

  // Sagssider
  const prUdvalg = new Map();
  for (const s of sager) { if (!prUdvalg.has(s.udvalg)) prUdvalg.set(s.udvalg, []); prUdvalg.get(s.udvalg).push(s); }
  for (const s of sager) {
    const krop = s.afsnit.filter((a) => a.titel !== "Resumé" && !/beslutning/i.test(a.titel));
    const relateret = prUdvalg.get(s.udvalg).filter((x) => x !== s).slice(0, 5);
    const jsonld = { "@context": "https://schema.org", "@type": "Article", headline: s.titel.slice(0, 110), datePublished: s.dato, inLanguage: "da", isBasedOn: s.kilde, publisher: { "@type": "Organization", name: "Sagsvagt" } };
    const indhold = `<div class="wrap">
  <div class="article">
    <article>
      <header>
        ${kicker(s, "../")}
        <h1 class="hl">${esc(s.titel)}</h1>
        ${s.dek ? `<p class="dek">${esc(s.dek)}</p>` : ""}
      </header>
      <div class="body">
        ${beslutningsboks(s)}
        ${krop.map((a) => `<h2>${esc(a.titel)}</h2>\n${afsnitTilHtml(a.tekst)}`).join("\n")}
        ${s.status === "besluttet" ? `<h2>Beslutning</h2>\n${afsnitTilHtml(s.beslutning)}` : ""}
        ${s.bilag.length ? `<h2>Bilag</h2><ul class="files">${s.bilag.map((b) => `<li>${b.url ? `<a href="${esc(b.url)}" rel="nofollow">${esc(b.navn)}</a>` : esc(b.navn)}</li>`).join("")}</ul>` : ""}
        <p class="source">Kilde: ${esc(s.kommune)}s Kommune, ${esc(s.udvalg)}, ${s.type === "referat" ? "referat" : "dagsorden"} fra mødet ${ugedag(s.dato)} ${datoTekst(s.dato)}, punkt ${s.nr}. <a href="${esc(s.kilde)}" rel="nofollow">Læs den originale sag hos kommunen</a>.</p>
      </div>
    </article>
    <aside class="side">
      ${vagtBoks("../")}
      ${relateret.length ? `<h2 class="sec-h">Mere fra ${esc(erLokaludvalg(s.udvalg) ? bydel(s.udvalg) : s.udvalg)}</h2>${relateret.map((x) => `<article class="mini">${kicker(x, "../", false)}<h3 class="hl"><a href="../${x.url}">${esc(x.titel)}</a></h3></article>`).join("")}` : ""}
    </aside>
  </div>
</div>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`;
    await writeFile(join(ROD, s.url), side({
      titel: `${s.titel} – Sagsvagt`, beskrivelse: s.dek || `${s.udvalg}, ${datoTekst(s.dato)}`,
      sti: s.url, rod: "../", indhold, ogType: "article",
    }));
  }

  // Udvalgs- og bydelssider
  const liste = (s) => `<article>${kicker(s, "../", false)}<h2 class="hl"><a href="../${s.url}">${esc(s.titel)}</a></h2><p class="dek">${esc(saetninger(s.dek, 200))}</p></article>`;
  const udvalg = [...prUdvalg.keys()].filter((u) => !erLokaludvalg(u)).sort((a, b) => (VAEGT[b] ?? 2) - (VAEGT[a] ?? 2) || a.localeCompare(b, "da"));
  const lokal = [...prUdvalg.keys()].filter(erLokaludvalg).sort((a, b) => a.localeCompare(b, "da"));
  for (const u of [...udvalg, ...lokal]) {
    const lu = erLokaludvalg(u); const navn = lu ? bydel(u) : u;
    const sti = `${lu ? "bydel" : "udvalg"}/${slug(navn)}.html`;
    await writeFile(join(ROD, sti), side({
      titel: `${lu ? `${navn}: Nyt fra lokaludvalget` : navn} – Sagsvagt`,
      beskrivelse: `Sager og beslutninger fra ${lu ? `${navn} Lokaludvalg` : `${navn} i Københavns Kommune`}, hentet fra de officielle dagsordener og referater.`,
      sti, rod: "../", aktiv: u === "Borgerrepræsentationen" ? "br" : lu ? "bydel" : "udvalg",
      indhold: `<div class="wrap"><div class="listing"><h1>${esc(lu ? `${navn}` : navn)}</h1><p class="intro">${lu ? `Sager fra ${esc(navn)} Lokaludvalg i Københavns Kommune.` : `Sager fra ${esc(navn)} i Københavns Kommune.`}</p>${prUdvalg.get(u).map(liste).join("\n")}</div></div>`,
    }));
  }
  const oversigt = (titel, intro, navne, mappe, aktiv) => side({
    titel: `${titel} – Sagsvagt`, beskrivelse: intro, sti: `${mappe}/`, rod: "../", aktiv,
    indhold: `<div class="wrap"><div class="listing"><h1>${titel}</h1><p class="intro">${intro}</p><ul class="chips">${navne.map((u) => `<li><a href="${slug(mappe === "bydel" ? bydel(u) : u)}.html">${esc(mappe === "bydel" ? bydel(u) : u)} <span style="opacity:.6">(${prUdvalg.get(u).length})</span></a></li>`).join("")}</ul></div></div>`,
  });
  await writeFile(join(ROD, "udvalg", "index.html"), oversigt("Udvalg i Københavns Kommune", "Borgerrepræsentationen og de stående udvalg.", udvalg, "udvalg", "udvalg"));
  await writeFile(join(ROD, "bydel", "index.html"), oversigt("Bydele i København", "Hver bydel har et lokaludvalg, som behandler sager om byrum, trafik, puljer og høringer i lokalområdet.", lokal, "bydel", "bydel"));

  // Om-side
  await writeFile(join(ROD, "om.html"), side({
    titel: "Om Sagsvagt", beskrivelse: "Sagsvagt gør det let at følge med i, hvad politikerne i din kommune beslutter.", sti: "om.html", rod: "", aktiv: "om",
    indhold: `<div class="wrap"><div class="listing prose"><h1 style="font-family:var(--sans)">Om Sagsvagt</h1>
<p>Sagsvagt gør det let at følge med i, hvad politikerne i din kommune beslutter. Hver dag læser vi de dagsordener og referater, kommunen selv offentliggør, og samler sagerne ét sted, så du ikke skal lede i udvalgenes dokumenter.</p>
<h2>Hvor kommer sagerne fra?</h2>
<p>Alt på Sagsvagt kommer fra kommunernes offentligt tilgængelige dagsordener og referater. Vi starter med Københavns Kommune, Borgerrepræsentationen, udvalgene og de 12 lokaludvalg, og udvider til flere kommuner i hovedstadsområdet. Hver sag linker til den originale side hos kommunen.</p>
<h2>Hvad er "Besluttet" og "På dagsordenen"?</h2>
<p>"Besluttet" betyder, at referatet fra mødet er offentliggjort, og at vi viser udvalgets beslutning. "På dagsordenen" betyder, at sagen skal behandles på et kommende møde.</p>
<h2>Fejl og rettelser</h2>
<p>Overskrifter og uddrag er taget fra kommunens egne dokumenter. Ser du en fejl, eller er en sag gengivet forkert, så skriv til os, så retter vi det hurtigst muligt. Læs altid den originale sag, før du handler på den.</p>
<h2>Kontakt</h2>
<p><a href="mailto:mansa@sagsvagt.dk">mansa@sagsvagt.dk</a></p>
</div></div>`,
  }));

  // Sitemap og robots
  const urls = ["", "om.html", "udvalg/", "bydel/", ...[...udvalg].map((u) => `udvalg/${slug(u)}.html`), ...lokal.map((u) => `bydel/${slug(bydel(u))}.html`), ...sager.map((s) => s.url)];
  await writeFile(join(ROD, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(ROD, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
  console.log(`Byggede forside, ${sager.length} sager, ${udvalg.length} udvalg, ${lokal.length} bydele`);
}

main().catch((e) => { console.error(e); process.exit(1); });
