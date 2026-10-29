// Fælles kortkode til avis/plankort.mjs (plankort) og avis/stedkort.mjs (stedkort):
// hentning med genforsøg og User-Agent, Web-Mercator, OpenStreetMap-fliser som SVG-<image>, tonefilteret til sidens
// farver, og resvg + jpeg-js til færdigt JPEG. Kortdata: OpenStreetMap (ODbL), se ../../jura-billeder.md.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";

export const UA = "Sagsvagt-plankort/1.0 (+https://sagsvagt.dk/om.html)";
// PLANKORT_FLISER kan pege på en anden fliseserver ({z}/{x}/{y}, fx egne fliser eller Dataforsyningen)
const FLISER = process.env.PLANKORT_FLISER || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const KORTKILDE = process.env.PLANKORT_FLISER ? (process.env.PLANKORT_KILDE || "Kort: se kildeangivelse") : "Kort: © OpenStreetMap-bidragydere";
export const C = { nat: "#0E0F14", kalk: "#E6DFD3", lyng: "#B7BBD8", rubin: "#B04A50", vin: "#8A2430", muted: "#56535A", kalkLys: "#EEE8DE" };
export const xml = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const vent = (ms) => new Promise((r) => setTimeout(r, ms));

// Henter url (JSON, eller Buffer hvis bin) med op til 3 forsøg
export async function hent(url, bin = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return bin ? Buffer.from(await r.arrayBuffer()) : await r.json();
    } catch (e) { if (i === 2) throw e; await vent(2000 * (i + 1)); }
  }
}

// Web-Mercator: lon/lat → pixel på zoomniveau z (256-pixel fliser)
export const px = (lon, lat, z) => {
  const s = 256 * 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};

// Alle fliser, der dækker et W×H-udsnit med øverste venstre hjørne i (ox, oy) på zoom z, som SVG-<image>-elementer
export async function hentFliser(z, ox, oy, W, H) {
  const fliser = [];
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) {
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) {
      const url = FLISER.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
      fliser.push(`<image x="${(tx * 256 - ox).toFixed(1)}" y="${(ty * 256 - oy).toFixed(1)}" width="256" height="256" href="data:image/png;base64,${(await hent(url, true)).toString("base64")}"/>`);
      await vent(120);                                               // høflig mod fliseserveren
    }
  }
  return fliser;
}

// <defs> med filteret, der toner kortet til sidens palet (nat → kalk), og et sløret skyggefilter
export const TONE_DEFS = `<defs>
    <filter id="tone" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncR type="table" tableValues="0.23 0.77 0.93"/><feFuncG type="table" tableValues="0.22 0.74 0.91"/><feFuncB type="table" tableValues="0.24 0.70 0.87"/></feComponentTransfer></filter>
    <filter id="skygge" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>`;

// Montserrat: breddetabeller til at måle tekst, og skriftfilerne til resvg
export async function indlaesSkrift(ROD) {
  const fonte = join(ROD, "avis", "fonte");
  const bredde = { 500: JSON.parse(await readFile(join(fonte, "Montserrat-Medium.json"), "utf8")), 700: JSON.parse(await readFile(join(fonte, "Montserrat-Bold.json"), "utf8")) };
  const maal = (t, str, v) => [...t].reduce((n, c) => n + (bredde[v][c] ?? 620), 0) * str / 1000;
  return { maal, fontFiles: [join(fonte, "Montserrat-Medium.ttf"), join(fonte, "Montserrat-Bold.ttf")] };
}

// SVG → JPEG-buffer
export function svgTilJpeg(svg, fontFiles, kvalitet = 80) {
  const r = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Montserrat" } }).render();
  return jpeg.encode({ data: r.pixels, width: r.width, height: r.height }, kvalitet).data;
}
