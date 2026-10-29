// Mindre grafik til sagerne: høringsnedtælling, læserfotos og luftfoto.
// Luftfoto (Klimadatastyrelsen, frie data) kræver en gratis nøgle:
//   DATAFORSYNINGEN_TOKEN  fra dataforsyningen.dk (Min side › Tokens)   LUFTFOTO_LAG (standard orto_foraar)
// Uden nøgle springes det over. Se ../../jura-billeder.md for kildeangivelser og ret til brug.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dage = (fra, til) => Math.round((Date.parse(til) - Date.parse(fra)) / 864e5);

// ---------- Høringsnedtælling ----------
// "Høring: 22 dage tilbage" ved siden af status (forside, lister og sagsside). Kun når fristen ikke er overskredet.
export function hoeringsMaerke(s, IDAG) {
  if (!s.frist || s.frist < IDAG) return "";
  const n = dage(IDAG, s.frist);
  const tekst = n === 0 ? "Høring: sidste dag i dag" : n === 1 ? "Høring: 1 dag tilbage" : `Høring: ${n} dage tilbage`;
  return ` <span class="frist-maerke${n <= 7 ? " snart" : ""}" title="Høringsfrist ${s.frist}">${tekst}</span>`;
}

// ---------- Læserfotos ----------
// Godkendte fotos ligger i assets/laeserfotos/<sag-id>.jpg med { fotograf, tekst } i assets/laeserfotos/index.json.
export async function laesLaeserfotos(ROD) {
  const f = join(ROD, "assets", "laeserfotos", "index.json");
  return existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : {};
}
export function laeserfotoFigur(s, fotos, rod, esc) {
  const f = fotos[s.id];
  if (!f) return "";
  return `<figure class="laeserfoto"><img src="${rod}assets/laeserfotos/${esc(s.id)}.jpg" alt="${esc(f.tekst || "Læserfoto fra stedet")}" loading="lazy">
          <figcaption>${f.tekst ? `${esc(f.tekst)} ` : ""}Foto: ${esc(f.fotograf)}, Sagsvagts læser.</figcaption></figure>`;
}
// Lille opfordring under kortet på sager med et sted
export const sendFotoLink = (s, sted, rod, esc) =>
  `<p class="send-foto"><a href="${rod}foto.html?sag=${encodeURIComponent(s.id)}${sted ? `&amp;sted=${encodeURIComponent(sted)}` : ""}">Har du et billede fra ${sted ? esc(sted) : "stedet"}? Send det til os</a></p>`;

export function fotoSideIndhold() {
  return `<div class="wrap smal">
  <article class="foto-side">
    <h1 class="hl">Send et billede til Sagsvagt</h1>
    <p class="dek">Bor du tæt på et sted, politikerne beslutter noget om? Et billede fra virkeligheden gør sagen lettere at forstå for alle.</p>
    <form id="foto-form" class="foto-form" novalidate>
      <input type="hidden" name="sag" id="f-sag">
      <div class="felt"><label for="f-foto">Billede (JPEG, PNG eller HEIC, højst 10 MB)</label><input id="f-foto" name="foto" type="file" accept="image/*" required></div>
      <div class="felt"><label for="f-sted">Hvor er billedet taget?</label><input id="f-sted" name="sted" type="text" maxlength="120" placeholder="fx hjørnet af Enghavevej og Vasbygade"></div>
      <div class="felt"><label for="f-tekst">Fortæl kort, hvad vi ser (valgfrit)</label><textarea id="f-tekst" name="tekst" rows="3" maxlength="1000"></textarea></div>
      <div class="felt"><label for="f-navn">Dit navn (står under billedet)</label><input id="f-navn" name="navn" type="text" maxlength="80" autocomplete="name" required></div>
      <div class="felt"><label for="f-email">Din e-mail (vises ikke)</label><input id="f-email" name="email" type="email" autocomplete="email" required></div>
      <label class="tjek"><input type="checkbox" name="egen" value="1" required> Jeg har selv taget billedet.</label>
      <label class="tjek"><input type="checkbox" name="ret" value="1" required> Sagsvagt må bruge billedet på sagsvagt.dk og i sine nyhedsbreve med mit navn som fotograf.</label>
      <label class="tjek"><input type="checkbox" name="personer" value="1" required> Der er ingen genkendelige personer på billedet, eller de har sagt ja til at være med.</label>
      <button class="btn" type="submit">Send billedet</button>
      <p class="lille" id="f-svar" role="status"></p>
    </form>
    <p class="lille">Vi kigger på alle billeder, før de kommer på. Din e-mail bruger vi kun til at spørge, hvis noget er uklart. Læs mere i <a href="privatliv.html">privatlivspolitikken</a>.</p>
  </article>
</div>
<script>(function(){var q=new URLSearchParams(location.search),f=document.getElementById("foto-form"),s=document.getElementById("f-svar");
document.getElementById("f-sag").value=q.get("sag")||"";if(q.get("sted"))document.getElementById("f-sted").value=q.get("sted");
f.addEventListener("submit",function(e){e.preventDefault();if(!f.reportValidity())return;var b=f.querySelector("button");b.disabled=true;s.className="lille";s.textContent="Sender …";
fetch("api/foto.php",{method:"POST",credentials:"same-origin",headers:{"X-Sagsvagt":"api"},body:new FormData(f)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.fejl||"Det gik ikke");})})
.then(function(){f.reset();s.className="besked ok";s.textContent="Tak! Vi kigger på billedet og skriver, hvis vi bruger det.";}).catch(function(e){s.className="besked fejl";s.textContent=e.message;}).finally(function(){b.disabled=false;});});})();</script>`;
}

// ---------- Luftfoto (Klimadatastyrelsen) ----------
// Et luftfoto af planområdet med planens grænse, til sager med plankort. WMS-billedet hentes for præcis kortets udsnit.
export async function bygLuftfotos(plankort, h) {
  const token = process.env.DATAFORSYNINGEN_TOKEN, ud = new Map();
  if (!token) return ud;
  const { hent, px, xml, C, indlaesSkrift, svgTilJpeg } = await import("./kortbase.mjs");
  const { fontFiles } = await indlaesSkrift(h.ROD);
  const mappe = join(h.ROD, "assets", "luftfoto");
  await mkdir(mappe, { recursive: true });
  const lag = process.env.LUFTFOTO_LAG || "orto_foraar", W = 1200, H = 800, R = 20037508.34;
  const planer = new Map();                                            // samme plan på flere sager: ét billede
  for (const [id, k] of plankort) (planer.get(k.fil) || planer.set(k.fil, []).get(k.fil)).push([id, k]);
  let nye = 0;
  for (const [pfil, sager] of planer) {
    const k = sager[0][1], fil = pfil.replace("plankort", "luftfoto");
    if (!existsSync(join(h.ROD, fil))) {
      if (nye >= +(process.env.MAKS_LUFTFOTO || 25)) continue;
      try {
        const planid = pfil.match(/(\d+)\.jpg$/)[1];
        const q = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: `pdk:theme_pdk_lokalplan_${k.status === "F" ? "forslag" : "vedtaget"}`,
          outputFormat: "application/json", srsName: "EPSG:4326", CQL_FILTER: `planid=${planid}` });
        const g = (await hent(`https://geoserver.plandata.dk/geoserver/wfs?${q}`)).features[0].geometry;
        const poly = g.type === "Polygon" ? [g.coordinates] : g.coordinates, alle = poly.flat(2);
        const lo = alle.map((c) => c[0]), la = alle.map((c) => c[1]);
        let z = 19, x0, y0, x1, y1;
        for (; z > 11; z--) { [x0, y1] = px(Math.min(...lo), Math.min(...la), z); [x1, y0] = px(Math.max(...lo), Math.max(...la), z); if (x1 - x0 <= W * 0.7 && y1 - y0 <= H * 0.7) break; }
        const ox = (x0 + x1) / 2 - W / 2, oy = (y0 + y1) / 2 - H / 2, S = 256 * 2 ** z;
        const m = (x, y) => [x / S * 2 * R - R, R - y / S * 2 * R];
        const [bx0, by0] = m(ox, oy + H), [bx1, by1] = m(ox + W, oy);
        const wms = new URLSearchParams({ service: "WMS", request: "GetMap", version: "1.1.1", layers: lag, styles: "", srs: "EPSG:3857",
          bbox: [bx0, by0, bx1, by1].join(","), width: W, height: H, format: "image/jpeg", token });
        const foto = await hent(`https://api.dataforsyningen.dk/orto_foraar_DAF?${wms}`, true);
        const sti = poly.map((p) => p.map((ring) => "M" + ring.map(([a, b]) => { const [x, y] = px(a, b, z); return `${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`; }).join("L") + "Z").join("")).join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><image width="${W}" height="${H}" href="data:image/jpeg;base64,${foto.toString("base64")}"/>
  <path d="${sti}" fill="none" stroke="${C.kalkLys}" stroke-width="9" stroke-linejoin="round" stroke-opacity="0.9"/>
  <path d="${sti}" fill="none" stroke="${C.vin}" stroke-width="4.5" stroke-linejoin="round"/>
  <rect x="${W - 520}" y="${H - 34}" width="520" height="34" fill="${C.kalkLys}" fill-opacity="0.85"/>
  <text x="${W - 506}" y="${H - 12}" font-family="Montserrat" font-weight="500" font-size="15" fill="${C.muted}">${xml("Luftfoto: Klimadatastyrelsen · Plangrænse: Plandata.dk · Sagsvagt")}</text></svg>`;
        await writeFile(join(h.ROD, fil), svgTilJpeg(svg, fontFiles, 78));
        nye++;
      } catch (e) { console.warn(`Luftfoto: ${k.plannavn}: ${e.message}`); continue; }
    }
    for (const [id] of sager) ud.set(id, { fil, plannavn: k.plannavn });
  }
  console.log(`Luftfoto: ${ud.size} sager (${nye} nye).`);
  return ud;
}
export function luftfotoFigur(s, l, rod, esc) {
  const k = l.get(s.id);
  return k ? `<figure class="luftfoto"><img src="${rod}${k.fil}" width="1200" height="800" loading="lazy" alt="Luftfoto af området for ${esc(k.plannavn)}">
          <figcaption>Sådan ser området ud fra luften i dag. Luftfoto: Klimadatastyrelsen, Ortofoto forår. Plangrænse: Plandata.dk.</figcaption></figure>` : "";
}
