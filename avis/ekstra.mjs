// Ekstra sider og funktioner til avisen: sagens vej, partiernes stemmer, høringer, kalendere og RSS.
// byg.mjs kalder funktionerne her og giver sine egne hjælpere med i `h` (esc, side, kicker, emneLinks …).
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { EMNER, PARTIER, stemmetal } from "./beriget.mjs";

const OEVERST = /^(Økonomiudvalget|Borgerrepræsentationen)$/;
const VERBUM = /\b(godkendt|vedtaget|anbefalet|tiltrådt|forkastet|nedstemt|udsat|oversendt|tilbagesendt|taget til efterretning|drøftet)\b/i;

// ---------- Sagens vej ----------
// Samme sag på flere møder: et fagudvalg → Økonomiudvalget → Borgerrepræsentationen. Vi kobler sager med samme overskrift,
// når de følger den vej (eller er samme udvalg på en senere dato) inden for 150 dage. Rutinesager med ens overskrifter
// i mange udvalg (fx "Tredje sag om bevillingsmæssige ændringer") er forskellige sager og kobles ikke.
export function sagensVej(sager) {
  const norm = (t) => t.toLowerCase().replace(/[^a-zæøå0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const grupper = new Map();
  for (const s of sager) { if (s.rutine) continue; const k = norm(s.titel); if (!grupper.has(k)) grupper.set(k, []); grupper.get(k).push(s); }
  const vej = new Map();
  for (const l of grupper.values()) {
    if (l.length < 2) continue;
    l.sort((a, b) => a.dato.localeCompare(b.dato));
    const fag = new Set(l.filter((s) => !OEVERST.test(s.udvalg)).map((s) => s.udvalg));
    if (fag.size > 1) continue;
    const dage = (new Date(l.at(-1).dato) - new Date(l[0].dato)) / 864e5;
    if (dage > 150 || new Set(l.map((s) => `${s.dato}|${s.udvalg}`)).size < 2) continue;
    for (const s of l) vej.set(s.id, l);
  }
  return vej;
}
export function vejBoks(s, vej, h) {
  const l = vej.get(s.id);
  const mangler = s.videre ? s.videre.split(/\s+og\s+|,\s*/).map((x) => x.trim()).filter((u) => OEVERST.test(u) && !(l || [s]).some((x) => x.udvalg === u)) : [];
  if (!l && !mangler.length) return "";
  const trin = (l || [s]).map((x) => {
    const st = x.status === "besluttet" ? h.stor((x.udfald.match(VERBUM) || ["Besluttet"])[0].toLowerCase()) : x.status === "kommer" ? "På dagsordenen" : "Behandlet";
    return `<li class="vej-trin${x === s ? " her" : ""}${x.status === "kommer" ? " kommer" : ""}"><span class="vej-dato">${h.kortDato(x.dato)}</span>`
      + `<span class="vej-hvor">${x === s ? `<b>${h.esc(h.hvorNavn(x.udvalg))}</b>` : `<a href="../${x.url}">${h.esc(h.hvorNavn(x.udvalg))}</a>`}</span><span class="vej-st">${h.esc(st)}</span></li>`;
  });
  for (const u of mangler) trin.push(`<li class="vej-trin senere"><span class="vej-dato">Senere</span><span class="vej-hvor">${h.esc(u)}</span><span class="vej-st">Afventer</span></li>`);
  return `<section class="vej" aria-labelledby="vej-h"><h2 id="vej-h">Sagens vej</h2><ol>${trin.join("")}</ol></section>`;
}

// ---------- Partiernes stemmer ----------
// Tæller hver afstemning i referaterne, også om ændringsforslag. Et parti tæller med, når det står på listen over for, imod
// eller undlod. Lokaludvalg stemmer som personer og er ikke med.
function opgoer(afst) {
  const partier = {}, par = {};
  for (const a of afst) {
    const side = {};
    for (const k of ["for", "imod", "undlod"]) for (const d of a[k]) if (d.b) side[d.b] = k;
    for (const [b, k] of Object.entries(side)) {
      const p = (partier[b] ||= { n: 0, for: 0, imod: 0, undlod: 0, flertal: 0, kendt: 0 });
      p.n++; p[k]++;
      // "Med flertallet" tæller kun afstemninger, hvor referatet siger, hvad der blev vedtaget
      if (a.vandt) { p.kendt++; if (k === a.vandt) p.flertal++; }
    }
    const bs = Object.keys(side);
    for (const x of bs) for (const y of bs) { if (x === y) continue; const q = (par[`${x}|${y}`] ||= { n: 0, enige: 0 }); q.n++; if (side[x] === side[y]) q.enige++; }
  }
  return { partier, par };
}
export async function bygPartier(sager, h) {
  const alle = sager.filter((s) => !h.erLokaludvalg(s.udvalg)).flatMap((s) => s.afstemninger.map((a) => ({ ...a, sag: s })))
    .filter((a) => [...a.for, ...a.imod, ...a.undlod].some((d) => d.b));
  if (!alle.length) return;
  const omfang = [
    ["alle", "Alle", alle],
    ["br", "Borgerrepræsentationen", alle.filter((a) => a.sag.udvalg === "Borgerrepræsentationen")],
    ["udvalg", "Udvalgene", alle.filter((a) => a.sag.udvalg !== "Borgerrepræsentationen")],
  ];
  const fra = alle.map((a) => a.sag.dato).sort()[0];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const visning = ([id, navn, afst], i) => {
    const { partier, par } = opgoer(afst);
    const bogst = Object.keys(partier).filter((b) => partier[b].n >= 5).sort((a, b) => a.localeCompare(b, "da"));
    const tabel = `<table class="parti-tabel"><thead><tr><th scope="col">Parti</th><th scope="col">Afstemninger</th><th scope="col">For</th><th scope="col">Imod</th><th scope="col">Undlod</th><th scope="col">Med flertallet</th></tr></thead><tbody>`
      + bogst.map((b) => { const p = partier[b]; const f = pct(p.flertal, p.kendt); return `<tr><th scope="row"><span class="parti"><b>${b}</b> ${h.esc(PARTIER[b] || b)}</span></th><td>${p.n}</td><td>${p.for}</td><td>${p.imod}</td><td>${p.undlod}</td><td><span class="pct"><span class="pct-bar"><span style="width:${f}%"></span></span>${f} %</span></td></tr>`; }).join("")
      + `</tbody></table>`;
    const matrix = `<div class="matrix-wrap"><table class="matrix"><caption>Hvor ofte to partier stemmer ens, i procent af de afstemninger, begge var med i.</caption><thead><tr><th></th>${bogst.map((b) => `<th scope="col" title="${h.esc(PARTIER[b] || b)}">${b}</th>`).join("")}</tr></thead><tbody>`
      + bogst.map((x) => `<tr><th scope="row" title="${h.esc(PARTIER[x] || x)}">${x}</th>${bogst.map((y) => {
        if (x === y) return `<td class="selv"></td>`;
        const q = par[`${x}|${y}`]; if (!q || q.n < 3) return `<td class="faa">–</td>`;
        const v = pct(q.enige, q.n);
        return `<td style="--v:${v / 100}" title="${h.esc(PARTIER[x] || x)} og ${h.esc(PARTIER[y] || y)}: enige i ${q.enige} af ${q.n}">${v}</td>`;
      }).join("")}</tr>`).join("") + `</tbody></table></div>`;
    return `<section class="omfang" id="omfang-${id}"${i ? " hidden" : ""} aria-label="${h.esc(navn)}">
  <p class="intro">${afst.length} afstemninger med partiernes stemmer.</p>
  ${tabel}
  <h2 class="sec-h" style="margin-top:36px">Hvem stemmer ens?</h2>
  ${matrix}
</section>`;
  };
  // De seneste afstemninger, hvor partierne var delt
  const delte = alle.filter((a) => a.for.some((d) => d.b) && a.imod.some((d) => d.b)).sort((a, b) => b.sag.dato.localeCompare(a.sag.dato)).slice(0, 12);
  const liste = (l) => l.map((d) => (d.b ? `<abbr title="${h.esc(d.navn)}">${d.b}</abbr>` : h.esc(d.navn))).join(", ");
  const delteHtml = delte.map((a) => {
    const t = stemmetal(a.om);
    return `<article class="delt">${h.kicker(a.sag, "")}<h3 class="hl"><a href="${a.sag.url}">${h.esc(a.sag.titel)}</a></h3>
  <p class="delt-om">${h.esc(a.om || "Afstemning")}</p>
  <p class="afst-bogst">For: ${liste(a.for)}<br>Imod: ${liste(a.imod)}${a.undlod.length ? `<br>Undlod: ${liste(a.undlod)}` : ""}${t ? ` <span class="delt-tal">(${t.for} mod ${t.imod})</span>` : ""}</p></article>`;
  }).join("");

  await writeFile(join(h.ROD, "partier.html"), h.side({
    titel: "Sådan stemmer partierne – Sagsvagt",
    beskrivelse: "Hvor ofte partierne i Københavns Borgerrepræsentation og udvalg stemmer for og imod, og hvilke partier der oftest stemmer ens. Opgjort ud fra kommunens egne referater.",
    sti: "partier.html", rod: "", aktiv: "partier",
    indhold: `<div class="wrap"><div class="listing partier-side">
  <h1>Sådan stemmer partierne</h1>
  <p class="intro">Opgjort ud fra alle afstemninger i referaterne fra Borgerrepræsentationen og udvalgene siden ${h.datoTekst(fra)}, også afstemninger om ændringsforslag. Et parti tæller med, når det står på listen over for, imod eller undlod. "Med flertallet" er, hvor ofte partiet stemte som det, der blev vedtaget. I udvalgene stemmer partiets medlemmer af udvalget.</p>
  <div class="faner" role="tablist" aria-label="Vis afstemninger fra">${omfang.map(([id, navn], i) => `<button type="button" role="tab" class="fane" data-omfang="${id}" aria-selected="${!i}">${h.esc(navn)}</button>`).join("")}</div>
  ${omfang.map(visning).join("")}
  <h2 class="sec-h" style="margin-top:40px">Seneste afstemninger, hvor partierne var uenige</h2>
  ${delteHtml}
  <p class="intro" style="margin-top:28px">Alle partier vises ens og i alfabetisk rækkefølge. Sagsvagt er partineutral, og tallene siger intet om, hvorfor et parti stemte, som det gjorde. Læs partiernes protokolbemærkninger i de enkelte sager.</p>
</div></div>
<script>
document.querySelector(".faner").addEventListener("click", function (e) {
  var b = e.target.closest("[data-omfang]"); if (!b) return;
  document.querySelectorAll("[data-omfang]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
  document.querySelectorAll(".omfang").forEach(function (s) { s.hidden = s.id !== "omfang-" + b.getAttribute("data-omfang"); });
});
</script>`,
  }));
}

// ---------- Høringer ----------
export async function bygHoeringer(sager, h) {
  const aabne = sager.filter((s) => s.frist && s.frist >= h.IDAG).sort((a, b) => a.frist.localeCompare(b.frist));
  const sendes = sager.filter((s) => !s.frist && s.hoering && s.status !== "kommer" && (new Date(h.IDAG) - new Date(s.dato)) / 864e5 <= 60).sort((a, b) => b.dato.localeCompare(a.dato));
  const kommer = sager.filter((s) => s.hoering && s.status === "kommer").sort((a, b) => a.dato.localeCompare(b.dato));
  const lukket = sager.filter((s) => s.frist && s.frist < h.IDAG && (new Date(h.IDAG) - new Date(s.frist)) / 864e5 <= 120).sort((a, b) => b.frist.localeCompare(a.frist));
  const dage = (iso) => Math.round((new Date(iso) - new Date(h.IDAG)) / 864e5);
  const kort = (s, frist) => `<article>${h.kicker(s, "")}<h2 class="hl"><a href="${s.url}">${h.esc(s.titel)}</a></h2>`
    + (frist ? `<p class="frist${dage(s.frist) <= 7 ? " snart" : ""}">Høringsfrist ${h.ugedag(s.frist)} ${h.datoTekst(s.frist)}${dage(s.frist) >= 0 ? ` · ${dage(s.frist) === 0 ? "i dag" : `om ${dage(s.frist)} ${dage(s.frist) === 1 ? "dag" : "dage"}`}` : ""}</p>` : "")
    + `<p class="dek">${h.esc(h.saetninger(s.dek, 200))}</p>${h.emneLinks(s, "")}</article>`;
  const sektion = (titel, intro, l, frist) => `<h2 class="sec-h" style="margin-top:34px">${titel}</h2>${intro ? `<p class="intro">${intro}</p>` : ""}${l.length ? l.map((s) => kort(s, frist)).join("\n") : `<p class="intro">Ingen lige nu.</p>`}`;
  await writeFile(join(h.ROD, "hoeringer.html"), h.side({
    titel: "Høringer – Sagsvagt", beskrivelse: "Forslag fra Københavns Kommune, som er sendt i høring, og hvornår fristen for at svare udløber.",
    sti: "hoeringer.html", rod: "", aktiv: "hoeringer",
    indhold: `<div class="wrap"><div class="listing hoeringer">
  <h1>Høringer</h1>
  <p class="intro">Når et forslag er i høring, kan alle sende kommentarer til kommunen, før det bliver endeligt vedtaget. Her er de sager, hvor referaterne nævner en høring. Selve høringerne og hvordan du svarer, finder du på <a href="https://blivhoert.kk.dk" rel="nofollow">blivhoert.kk.dk</a>.</p>
  ${sektion("Åbne høringer", "Med fristen fra sagen.", aabne, true)}
  ${sektion("Besluttet at sende i høring", "De seneste 60 dage. Fristen står i høringen hos kommunen.", sendes, false)}
  ${sektion("Skal behandles", "Forslag på kommende møder, som lægger op til en høring.", kommer, false)}
  ${sektion("Afsluttede høringer", "", lukket, true)}
</div></div>`,
  }));
}

// ---------- Kalendere ----------
// Én kalenderfil pr. udvalg og én med alle møder. Møderne er heldagsbegivenheder, fordi referaterne ikke har klokkeslæt.
const icsTekst = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (l) => { const b = Buffer.from(l, "utf8"); if (b.length <= 74) return l; const ud = []; let i = 0, s = ""; for (const c of l) { if (Buffer.byteLength(s + c) > (ud.length ? 73 : 74)) { ud.push(s); s = ""; } s += c; i++; } ud.push(s); return ud.join("\r\n "); };
export async function bygKalendere(moeder, h) {
  await rm(join(h.ROD, "kalender"), { recursive: true, force: true }); await mkdir(join(h.ROD, "kalender"), { recursive: true });
  const nu = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const begivenhed = (m) => {
    const d = m.dato.replace(/-/g, ""); const naeste = new Date(Date.UTC(+m.dato.slice(0, 4), +m.dato.slice(5, 7) - 1, +m.dato.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    const punkter = m.sager.filter((s) => !s.rutine).map((s) => `• ${s.titel}`).join("\n");
    return ["BEGIN:VEVENT", `UID:${d}-${h.slug(m.udvalg)}@sagsvagt.dk`, `DTSTAMP:${nu}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${naeste}`,
      `SUMMARY:${icsTekst(`Møde: ${h.hvorNavn(m.udvalg)}`)}`, `DESCRIPTION:${icsTekst(`${m.antal} punkter på dagsordenen.\n${punkter}\n\nDagsordenen: ${m.url}`)}`, `URL:${m.url}`, "TRANSP:TRANSPARENT", "END:VEVENT"].map(fold).join("\r\n");
  };
  const kalender = (navn, l) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sagsvagt//Møder//DA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${icsTekst(navn)}`), "X-WR-TIMEZONE:Europe/Copenhagen", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", ...l.map(begivenhed), "END:VCALENDAR"].join("\r\n") + "\r\n";
  const relevante = moeder.filter((m) => (new Date(h.IDAG) - new Date(m.dato)) / 864e5 <= 90);
  await writeFile(join(h.ROD, "kalender", "alle.ics"), kalender("Sagsvagt: Alle møder i København", relevante));
  const pr = new Map(); for (const m of relevante) { if (!pr.has(m.udvalg)) pr.set(m.udvalg, []); pr.get(m.udvalg).push(m); }
  for (const [u, l] of pr) await writeFile(join(h.ROD, "kalender", `${h.slug(h.erLokaludvalg(u) ? h.bydel(u) : u)}.ics`), kalender(`Sagsvagt: ${h.hvorNavn(u)}`, l));
}
export const kalenderLink = (u, rod, h) => `${rod}kalender/${h.slug(h.erLokaludvalg(u) ? h.bydel(u) : u)}.ics`;

// ---------- RSS ----------
const rfc822 = (iso) => new Date(iso + "T06:00:00Z").toUTCString();
export async function bygFeeds(sager, h) {
  await rm(join(h.ROD, "feed"), { recursive: true, force: true }); await mkdir(join(h.ROD, "feed"), { recursive: true });
  const feed = async (fil, titel, beskrivelse, l) => {
    const items = l.filter((s) => !s.rutine).sort((a, b) => b.dato.localeCompare(a.dato)).slice(0, 40).map((s) => `<item><title>${h.esc(s.titel)}</title><link>${h.SITE_URL}${s.url}</link><guid isPermaLink="true">${h.SITE_URL}${s.url}</guid><pubDate>${rfc822(s.dato)}</pubDate><category>${h.esc(h.hvorNavn(s.udvalg))}</category><description>${h.esc(s.status === "besluttet" && s.udfald ? `${s.udfald} ${s.dek}` : s.dek)}</description></item>`).join("\n");
    await writeFile(join(h.ROD, "feed", fil), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${h.esc(titel)}</title><link>${h.SITE_URL}</link><atom:link href="${h.SITE_URL}feed/${fil}" rel="self" type="application/rss+xml"/><description>${h.esc(beskrivelse)}</description><language>da</language>\n${items}\n</channel></rss>\n`);
  };
  await feed("alle.xml", "Sagsvagt: København", "Nye sager fra Borgerrepræsentationen, udvalgene og lokaludvalgene i København.", sager);
  for (const [id, e] of Object.entries(EMNER)) await feed(`emne-${id}.xml`, `Sagsvagt: ${e.navn}`, `Nye sager om ${e.navn.toLowerCase()} i København.`, sager.filter((s) => s.emner.includes(id)));
  const pr = new Map(); for (const s of sager) { if (!pr.has(s.udvalg)) pr.set(s.udvalg, []); pr.get(s.udvalg).push(s); }
  for (const [u, l] of pr) await feed(`${h.slug(h.erLokaludvalg(u) ? h.bydel(u) : u)}.xml`, `Sagsvagt: ${h.hvorNavn(u)}`, `Nye sager fra ${h.hvorNavn(u)}.`, l);
}
export const feedLink = (u, rod, h) => `${rod}feed/${h.slug(h.erLokaludvalg(u) ? h.bydel(u) : u)}.xml`;
