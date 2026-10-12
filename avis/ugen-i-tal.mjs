// "Ugen i tal": et delbart billede til Instagram og LinkedIn med ugens beslutninger, møder, den tætteste afstemning,
// ugens vigtigste sag og hvad der er på vej. Laves ud fra assets/sager.json (bygges af byg.mjs).
// Kør: node avis/ugen-i-tal.mjs            (sidste hele uge)
//      node avis/ugen-i-tal.mjs 2026-10-05 (ugen, der starter den mandag)
// Billederne (1080×1350 til opslag og 1080×1920 til story) og en opslagstekst gemmes i ../instagram/ugen-i-tal/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const ROD = join(import.meta.dirname, "..");
const UD = join(ROD, "..", "instagram", "ugen-i-tal");
const C = { nat: "#0E0F14", kalk: "#E6DFD3", rosen: "#DCA9A5", lyng: "#B7BBD8", skifer: "#5D6BA8", indigo: "#28377A", blaek: "#0C1430", rubin: "#B04A50", vin: "#8A2430", bordeaux: "#3E0E14" };
const MDR = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const xml = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dag = (iso) => new Date(iso + "T12:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = dag(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ugenr = (s) => { const t = dag(s); const d = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - d + 3); const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); };
const hvor = (u) => (/Lokaludvalg$/.test(u) ? u.replace(/\s*Lokaludvalg$/, "") + " Lokaludvalg" : u);
const tal = (n) => n.toLocaleString("da-DK");

// ---------- Ugens tal ----------
const data = JSON.parse(await readFile(join(ROD, "assets", "sager.json"), "utf8"));
const iDag = new Date(); const sidsteMandag = new Date(Date.UTC(iDag.getFullYear(), iDag.getMonth(), iDag.getDate() - ((iDag.getDay() + 6) % 7) - 7));
const fra = process.argv[2] || iso(sidsteMandag), til = plus(fra, 6);
const uge = data.sager.filter((s) => s.dato >= fra && s.dato <= til);
const besluttet = uge.filter((s) => s.st === "besluttet");
const moeder = new Set(uge.map((s) => `${s.dato}|${s.u}`)).size;
// Sager på vej de næste 14 dage (kommunen offentliggør dagsordenen ca. en uge før mødet)
const naesteUge = data.sager.filter((s) => s.st === "kommer" && s.dato > til && s.dato <= plus(til, 14) && !s.r).length;
const antalUdvalg = new Set(uge.map((s) => s.u)).size;
// Kort udfald: "Forkastet · 17 for · 38 imod" i stedet for kommunens lange sætning
const VERBUM = /\b(godkendt|vedtaget|anbefalet|tiltrådt|forkastet|nedstemt|udsat|oversendt|taget til efterretning)\b/i;
const kortUdfald = (s) => {
  const v = (s.ud || "").match(VERBUM)?.[0]; const ord = v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : "Besluttet";
  return s.tal ? `${ord} · ${s.tal.for} for · ${s.tal.imod} imod` : ord;
};
// Tætteste afstemning om selve sagen (ikke ændringsforslag), mindst 5 stemmer
const taet = besluttet.filter((s) => s.tal && s.tal.for + s.tal.imod >= 5).sort((a, b) => Math.abs(a.tal.for - a.tal.imod) - Math.abs(b.tal.for - b.tal.imod) || b.v - a.v)[0];
// Ugens vigtigste sag: højest vægt (Borgerrepræsentationen og Økonomiudvalget først), ikke rutine
const top = besluttet.filter((s) => !s.r && s !== taet).sort((a, b) => b.v - a.v || (b.d || "").length - (a.d || "").length)[0];
const emner = {}; for (const s of uge) if (!s.r) for (const e of s.e) emner[e] = (emner[e] || 0) + 1;
const [topEmne, topEmneN] = Object.entries(emner).sort((a, b) => b[1] - a[1])[0] || [];
const periode = `${dag(fra).getUTCDate()}.${dag(fra).getUTCMonth() === dag(til).getUTCMonth() ? "" : ` ${MDR[dag(fra).getUTCMonth()]}`}–${dag(til).getUTCDate()}. ${MDR[dag(til).getUTCMonth()]}`;
const nr = ugenr(fra);

// ---------- Tegning ----------
const fonte = join(ROD, "avis", "fonte");
const bredde = { 500: JSON.parse(await readFile(join(fonte, "Montserrat-Medium.json"), "utf8")), 700: JSON.parse(await readFile(join(fonte, "Montserrat-Bold.json"), "utf8")) };
const maal = (t, str, v) => [...t].reduce((n, c) => n + (bredde[v][c] ?? 620), 0) * str / 1000;
const ombryd = (t, str, v, max, linjer = 3) => {
  const ud = []; let l = "";
  for (const o of t.split(/\s+/)) { const p = l ? `${l} ${o}` : o; if (maal(p, str, v) <= max || !l) l = p; else { ud.push(l); l = o; } }
  if (l) ud.push(l);
  if (ud.length > linjer) { ud.length = linjer; let s = ud[linjer - 1]; while (maal(`${s} …`, str, v) > max) s = s.replace(/\s*\S+$/, ""); ud[linjer - 1] = `${s} …`; }
  return ud;
};
const logo = (await readFile(join(ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8")).replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "").replace(/<title>[\s\S]*?<\/title>/, "");
const tekst = (x, y, str, v, farve, t, ekstra = "") => `<text x="${x}" y="${y}" font-family="Montserrat" font-weight="${v}" font-size="${str}" fill="${farve}" ${ekstra}>${xml(t)}</text>`;

function billede(B, H) {
  const M = 80, story = H > 1500;
  let y = story ? 150 : 90;
  const dele = [];
  dele.push(`<g transform="translate(${M - 14} ${y - 10}) scale(${(60 / 300).toFixed(3)})">${logo}</g>`);
  y += story ? 190 : 150;
  dele.push(tekst(M, y, 26, 700, C.rosen, `UGEN I KØBENHAVN · UGE ${nr}`, 'letter-spacing="3"'));
  y += 96; dele.push(tekst(M, y, 92, 700, C.kalk, "Ugen i tal", 'letter-spacing="-2.5"'));
  y += 58; dele.push(tekst(M, y, 30, 500, C.kalk, periode, 'fill-opacity=".75"'));
  // Tre store tal
  y += story ? 150 : 120;
  const kol = (B - 2 * M) / 3;
  [[besluttet.length, "beslutninger"], [moeder, moeder === 1 ? "møde" : "møder"], naesteUge ? [naesteUge, "sager på vej"] : [antalUdvalg, "udvalg"]].forEach(([n, l], i) => {
    const x = M + i * kol;
    dele.push(tekst(x, y, 110, 700, C.kalk, tal(n), 'letter-spacing="-4"'));
    dele.push(tekst(x, y + 48, 28, 500, C.kalk, l, 'fill-opacity=".8"'));
  });
  y += story ? 130 : 110;
  dele.push(`<rect x="${M}" y="${y}" width="${B - 2 * M}" height="2" fill="${C.kalk}" fill-opacity=".25"/>`);
  // Afsnit: overskrift, sagens titel og en linje under
  const afsnit = (rubrik, farve, titel, under) => {
    y += story ? 80 : 66; dele.push(tekst(M, y, 24, 700, farve, rubrik.toUpperCase(), 'letter-spacing="2.5"'));
    for (const l of ombryd(titel, 40, 700, B - 2 * M, story ? 3 : 2)) { y += 52; dele.push(tekst(M, y, 40, 700, C.kalk, l, 'letter-spacing="-.8"')); }
    // Linjen under må ikke gå ud over kanten: udvalget droppes, hvis der ikke er plads
    const linje = maal(under, 26, 500) <= B - 2 * M ? under : under.split(" · ").slice(0, -1).join(" · ");
    y += 44; dele.push(tekst(M, y, 26, 500, C.kalk, linje, 'fill-opacity=".75"'));
  };
  if (taet) afsnit("Tætteste afstemning", C.rosen, taet.t, `${taet.tal.for} for · ${taet.tal.imod} imod · ${hvor(taet.u)}`);
  if (top) afsnit("Ugens sag", C.lyng, top.t, `${kortUdfald(top)} · ${hvor(top.u)}`);
  if (topEmne) { y += story ? 80 : 66; dele.push(tekst(M, y, 24, 700, C.rosen, "MEST PÅ DAGSORDENEN", 'letter-spacing="2.5"')); y += 52; dele.push(tekst(M, y, 40, 700, C.kalk, `${data.emner[topEmne].navn} · ${topEmneN} sager`, 'letter-spacing="-.8"')); }
  // Bund: opfordring
  const bundY = story ? H - 330 : H - 86;
  dele.push(`<rect x="${M}" y="${bundY - 46}" width="${maal("Få dine sager på mail · sagsvagt.dk", 30, 700) + 56}" height="68" rx="34" fill="${C.kalk}"/>`);
  dele.push(tekst(M + 28, bundY, 30, 700, C.nat, "Få dine sager på mail · sagsvagt.dk"));
  if (story) dele.push(tekst(B / 2, H - 170, 30, 700, C.kalk, "Tryk på linket herunder ↓", 'text-anchor="middle" fill-opacity=".85"'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${B}" height="${H}" viewBox="0 0 ${B} ${H}">
<defs>
  <radialGradient id="bl" cx="0" cy="0.1" r="1"><stop offset="0" stop-color="${C.skifer}"/><stop offset=".25" stop-color="${C.indigo}"/><stop offset=".52" stop-color="${C.blaek}"/><stop offset=".74" stop-color="${C.blaek}" stop-opacity="0"/></radialGradient>
  <radialGradient id="rd" cx="1" cy="1" r="0.95"><stop offset="0" stop-color="${C.rubin}"/><stop offset=".25" stop-color="${C.vin}"/><stop offset=".52" stop-color="${C.bordeaux}"/><stop offset=".76" stop-color="${C.bordeaux}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${B}" height="${H}" fill="${C.nat}"/><rect width="${B}" height="${H}" fill="url(#bl)"/><rect width="${B}" height="${H}" fill="url(#rd)"/>
${dele.join("\n")}
</svg>`;
}

await mkdir(UD, { recursive: true });
const fontFiles = [join(fonte, "Montserrat-Medium.ttf"), join(fonte, "Montserrat-Bold.ttf")];
const png = (svg, b) => new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Montserrat" }, fitTo: { mode: "width", value: b } }).render().asPng();
await writeFile(join(UD, `uge-${nr}-opslag.png`), png(billede(1080, 1350), 1080));
await writeFile(join(UD, `uge-${nr}-story.png`), png(billede(1080, 1920), 1080));

// Opslagstekst til Instagram og LinkedIn
const opslag = `Ugen i tal, uge ${nr} (${periode})

${tal(besluttet.length)} beslutninger på ${moeder} møder i Borgerrepræsentationen, udvalgene og lokaludvalgene i København.
${taet ? `\nTætteste afstemning: ${taet.t} (${hvor(taet.u)}), ${taet.tal.for} for og ${taet.tal.imod} imod.` : ""}
${top ? `\nUgens sag: ${top.t} (${hvor(top.u)}). ${kortUdfald(top)}.` : ""}
${topEmne ? `\nMest på dagsordenen: ${data.emner[topEmne].navn} med ${topEmneN} sager.` : ""}
${naesteUge ? `\nOg ${naesteUge} sager er på vej de næste to uger.` : ""}

Få de sager, der handler om dine emner, på mail hver mandag. Gratis og partineutralt: sagsvagt.dk

#kbhpol #københavn #lokalpolitik #sagsvagt
`.replace(/\n{3,}/g, "\n\n");
await writeFile(join(UD, `uge-${nr}-tekst.txt`), opslag);
console.log(`Uge ${nr} (${periode}): ${besluttet.length} beslutninger, ${moeder} møder, ${naesteUge} på vej\n→ ${UD}`);
