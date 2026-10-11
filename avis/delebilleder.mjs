// Delebilleder (1200×630 PNG), som Facebook, LinkedIn og Messenger viser, når en sag deles.
// Tegnes som SVG og gøres til PNG med resvg. Skrifttypen er Montserrat (avis/fonte/, OFL-licens, se LICENS.txt).
// For at holde størrelsen nede laves de kun til de 200 vigtigste sager fra de seneste 60 dage og de næste 14,
// og baggrunden er ensfarvet med en tynd stribe i Mødets farver (bløde gradienter gør PNG-filer meget store).
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { EMNER } from "./beriget.mjs";

const B = 1200, H_ = 630, M = 64;
const C = { nat: "#0E0F14", kalk: "#E6DFD3", rosen: "#DCA9A5", lyng: "#B7BBD8", bordeaux: "#3E0E14", blaek: "#0C1430",
  skifer: "#5D6BA8", indigo: "#28377A", rubin: "#B04A50", vin: "#8A2430" };
const xml = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function bygDelebilleder(sager, h) {
  const fonte = join(h.ROD, "avis", "fonte");
  const bredde = { 500: JSON.parse(await readFile(join(fonte, "Montserrat-Medium.json"), "utf8")), 700: JSON.parse(await readFile(join(fonte, "Montserrat-Bold.json"), "utf8")) };
  const maal = (t, str, vaegt) => [...t].reduce((n, c) => n + (bredde[vaegt][c] ?? 620), 0) * str / 1000;
  const ombryd = (t, str, vaegt, max) => {
    const linjer = []; let l = "";
    for (const ord of t.split(/\s+/)) { const p = l ? `${l} ${ord}` : ord; if (maal(p, str, vaegt) <= max || !l) l = p; else { linjer.push(l); l = ord; } }
    if (l) linjer.push(l);
    return linjer;
  };
  const logoSvg = await readFile(join(h.ROD, "assets", "sagsvagt-vandret-kalk.svg"), "utf8");
  const logo = logoSvg.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "").replace(/<title>[\s\S]*?<\/title>/, "");
  const fontFiles = [join(fonte, "Montserrat-Medium.ttf"), join(fonte, "Montserrat-Bold.ttf")];

  const udvalgte = sager.filter((s) => !s.rutine && s.vaegt > 0 && (new Date(h.IDAG) - new Date(s.dato)) / 864e5 <= 60 && (new Date(s.dato) - new Date(h.IDAG)) / 864e5 <= 14)
    .sort((a, b) => b.score - a.score).slice(0, 200);
  const mappe = join(h.ROD, "assets", "del");
  await rm(mappe, { recursive: true, force: true }); await mkdir(mappe, { recursive: true });
  const lavet = new Map();

  for (const s of udvalgte) {
    // Overskriften: største skrift, hvor den kan stå på højst fire linjer
    let str = 62, linjer;
    for (str of [62, 56, 50, 45, 40]) { linjer = ombryd(s.titel, str, 700, B - 2 * M); if (linjer.length <= 4) break; }
    if (linjer.length > 4) { linjer = linjer.slice(0, 4); let sidste = linjer[3]; while (maal(`${sidste} …`, str, 700) > B - 2 * M) sidste = sidste.replace(/\s*\S+$/, ""); linjer[3] = `${sidste} …`; }
    const lh = Math.round(str * 1.12), top = 196;
    const status = s.status === "besluttet" ? ["Besluttet", C.rosen] : s.status === "kommer" ? ["På dagsordenen", C.lyng] : ["Behandlet", C.kalk];
    const kicker = `<text x="${M}" y="160" font-family="Montserrat" font-weight="700" font-size="26" fill="${status[1]}">${xml(`${status[0]} ${h.kortDato(s.dato)}`)}<tspan font-weight="500" fill="${C.kalk}" fill-opacity=".8">${xml(` · ${h.hvorNavn(s.udvalg)}`)}</tspan></text>`;
    const overskrift = linjer.map((l, i) => `<text x="${M}" y="${top + str + i * lh}" font-family="Montserrat" font-weight="700" font-size="${str}" letter-spacing="${(-0.02 * str).toFixed(1)}" fill="${C.kalk}">${xml(l)}</text>`).join("");

    // Bunden: stemmetal som bjælke, ellers hvornår sagen behandles; emnerne til højre for det
    let bund = "", x = M;
    const t = s.tal;
    if (s.status === "besluttet" && t && t.for + t.imod > 0) {
      const w = 300, total = t.for + t.imod + (t.undlod || 0), wf = Math.round((w - 4) * t.for / total), wi = Math.round((w - 4) * t.imod / total);
      bund += `<rect x="${M}" y="548" width="${w}" height="12" rx="6" fill="${C.kalk}" fill-opacity=".15"/><rect x="${M}" y="548" width="${wf}" height="12" rx="6" fill="${C.kalk}"/>`
        + (wi ? `<rect x="${M + wf + 2}" y="548" width="${wi}" height="12" rx="6" fill="${C.kalk}" fill-opacity=".45"/>` : "")
        + `<text x="${M}" y="532" font-family="Montserrat" font-weight="700" font-size="24" fill="${C.kalk}">${t.for} for · ${t.imod} imod${t.undlod ? ` · ${t.undlod} undlod` : ""}</text>`;
      x = M + w + 36;
    } else if (s.status === "kommer") {
      const tekst = `Til beslutning ${h.ugedag(s.dato)} ${h.kortDato(s.dato)}`;
      bund += `<text x="${M}" y="560" font-family="Montserrat" font-weight="700" font-size="24" fill="${C.lyng}">${xml(tekst)}</text>`;
      x = M + maal(tekst, 24, 700) + 36;
    }
    for (const id of s.emner.slice(0, 2)) {
      const e = EMNER[id], w = maal(e.navn, 20, 700) + 32; if (x + w > B - M - 190) break;
      bund += `<rect x="${x}" y="530" width="${w}" height="38" rx="19" fill="${e.f === "r" ? C.rosen : C.lyng}"/><text x="${x + 16}" y="556" font-family="Montserrat" font-weight="700" font-size="20" fill="${e.f === "r" ? C.bordeaux : C.blaek}">${xml(e.navn)}</text>`;
      x += w + 10;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${B}" height="${H_}" viewBox="0 0 ${B} ${H_}">
<defs><linearGradient id="stribe" x1="0" x2="1"><stop offset="0" stop-color="${C.skifer}"/><stop offset=".35" stop-color="${C.indigo}"/><stop offset=".5" stop-color="${C.nat}"/><stop offset=".65" stop-color="${C.vin}"/><stop offset="1" stop-color="${C.rubin}"/></linearGradient></defs>
<rect width="${B}" height="${H_}" fill="${C.nat}"/><rect y="${H_ - 14}" width="${B}" height="14" fill="url(#stribe)"/>
<g transform="translate(${M - 12} 48) scale(${(52 / 300).toFixed(4)})">${logo}</g>
${kicker}
${overskrift}
${bund}
<text x="${B - M}" y="560" text-anchor="end" font-family="Montserrat" font-weight="700" font-size="24" fill="${C.kalk}" fill-opacity=".8">sagsvagt.dk</text>
</svg>`;
    const png = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Montserrat" }, fitTo: { mode: "width", value: B } }).render().asPng();
    const fil = `${s.url.slice(4, -5)}.png`;
    await writeFile(join(mappe, fil), png);
    lavet.set(s.id, `assets/del/${fil}`);
  }
  return lavet;
}
