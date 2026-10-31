// Kortet under sagerne på forsiderne (assets/sagskort.jpg): København i Sagsvagts mørke toner. Ligger på vores egen server,
// så forsiden ikke sender noget til OpenStreetMap, før man selv åbner det store kort (kort.html).
// Rammen står også i SAGSKORT i avis/byg.mjs og i data-attributterne på #sagskort-flade i vagt.html. Kør kun, hvis rammen ændres:
// node avis/sagskort.mjs (skriver 2400×2060; skaleres bagefter til 1400 px i bredden)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hentFliser, px, svgTilJpeg, indlaesSkrift } from "./kortbase.mjs";

const ROD = join(import.meta.dirname, ".."), Z = 14, W = 2400, H = 2060;
const [cx, cy] = px(12.5525, 55.675, Z);
const fliser = await hentFliser(Z, cx - W / 2, cy - H / 2, W, H);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<filter id="nat" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>
<feFuncR type="table" tableValues="0.05 0.05 0.05 0.05 0.05 0.06 0.08 0.11 0.15 0.27 0.72"/><feFuncG type="table" tableValues="0.05 0.05 0.05 0.05 0.05 0.06 0.085 0.115 0.155 0.28 0.74"/><feFuncB type="table" tableValues="0.07 0.07 0.07 0.07 0.08 0.09 0.12 0.16 0.21 0.35 0.86"/></feComponentTransfer></filter>
</defs><rect width="${W}" height="${H}" fill="#0E0F14"/><g filter="url(#nat)">${fliser.join("")}</g></svg>`;
const { fontFiles } = await indlaesSkrift(ROD);
await writeFile(join(ROD, "assets", "sagskort.jpg"), svgTilJpeg(svg, fontFiles, 70));
console.log("Ramme:", JSON.stringify({ zoom: Z, x0: cx - W / 2, y0: cy - H / 2, W, H }));
