// Stemmegrafik: søjle med For / Imod / Undlod og partiknapper. Ren HTML, ingen JS. Stil i stil/stemmegrafik.css.
// Input er en (beriget) sag; der bruges s.beslutning (eller s.afstemninger, hvis den allerede er udregnet) og s.tal.
import { afstemninger, stemmetal, PARTIER } from "./beriget.mjs";

// Kendte partifarver (baggrund på knappen). Tekstfarven vælges ud fra kontrast, se tekstFarve().
export const PARTIFARVER = {
  A: "#C8102E", // Socialdemokratiet, rød
  B: "#9A2A8C", // Radikale Venstre, lilla-magenta
  C: "#00583C", // Konservative, mørkegrøn
  D: "#00505B", // Nye Borgerlige, mørk petrol
  F: "#C4175F", // SF, lyserød-rød
  I: "#0F7B78", // Liberal Alliance, turkis
  K: "#E08A00", // Kristendemokraterne, orange
  M: "#5B3E96", // Moderaterne, violet
  O: "#E9C32A", // Dansk Folkeparti, gul (mørk blå tekst)
  Q: "#8CBF3F", // Frie Grønne, lysegrøn
  V: "#0057A8", // Venstre, blå
  Æ: "#3F6F9F", // Danmarksdemokraterne, stålblå
  Ø: "#CC4010", // Enhedslisten, orange-rød
  Å: "#217A35", // Alternativet, grøn
};
const MORK_TEKST = "#14213D"; // mørk marineblå; fungerer også på gul (DF)
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Hvid tekst hvis den kan læses (mindst 4,5:1), ellers mørk
export const tekstFarve = (bg) => (kontrast(bg, "#FFFFFF") >= 4.5 ? "#FFFFFF" : MORK_TEKST);

// ---------- Udlæsning af en afstemning ----------
const TAL = /^(\d+)\s+(?:personer?|medlemmer?|stemmer?)$/i;
function undlodTal(t) {
  const u = t.match(/(ingen|\d+)\s*(?:medlem(?:mer)?\s*)?(?:stemmer\s*)?undlod/i);
  return u ? (/ingen/i.test(u[1]) ? 0 : +u[1]) : null;
}
// Tal fra sætningen: "med 43 stemmer mod 11" (rækkefølge afgøres af udfaldet, se stemmetal) eller "3 for og 7 imod" / "(1 for, 21 imod, ingen undlod)"
function taltFraTekst(om) {
  if (!om) return null;
  const a = stemmetal(om);
  if (a) return { for: a.for, imod: a.imod, undlod: a.undlod };
  const m = om.match(/(\d+)\s*(?:stemmer\s*)?for\b[^\d]{0,14}(\d+)\s*(?:stemmer\s*)?imod/i);
  return m ? { for: +m[1], imod: +m[2], undlod: undlodTal(om) } : null;
}
const erAendring = (om = "") => /ændringsforslag|\bÆF\s*\d|stillet forslag om|forslag om at (?:ændre|tage|slette|tilføje)/i.test(om);

// "Ø (Anna, Bo og Cy), F (Dan), A" bliver delt op af deltagere(); sæt dem sammen igen til {b, navn, medlemmer}
function samlParenteser(liste) {
  const ud = []; let aaben = null;
  for (const x of liste) {
    const n = x.navn || "";
    if (aaben) { const slut = n.includes(")"); aaben.medlemmer.push(n.replace(/\)\s*$/, "").trim()); if (slut) aaben = null; continue; }
    const m = n.match(/^([A-ZÆØÅ])\s*\((.*)$/);
    if (!m) { ud.push(x); continue; }
    const g = { b: m[1], navn: PARTIER[m[1]] || m[1], medlemmer: [m[2].replace(/\)\s*$/, "").trim()] };
    ud.push(g); if (!n.includes(")")) aaben = g;
  }
  return ud;
}

// Gør en afstemning fra afstemninger() til noget, der kan tegnes
function læs(a, reserve) {
  // "For: 7 personer": antal i stedet for navne
  const t = { for: null, imod: null, undlod: null };
  const lister = {};
  for (const k of ["for", "imod", "undlod"]) {
    const l = samlParenteser(a[k] || []);
    if (l.length === 1 && TAL.test(l[0].navn || "")) { t[k] = +l[0].navn.match(TAL)[1]; lister[k] = []; } else lister[k] = l;
  }
  let tal = taltFraTekst(a.om);
  if (!tal && (t.for != null || t.imod != null)) tal = { for: t.for ?? 0, imod: t.imod ?? 0, undlod: t.undlod };
  if (!tal && reserve) tal = { for: reserve.for, imod: reserve.imod, undlod: reserve.undlod };
  let partier = false;
  if (!tal) { // sidste udvej: antal opførte partier/personer
    tal = { for: lister.for.length, imod: lister.imod.length, undlod: lister.undlod.length };
    partier = lister.for.concat(lister.imod, lister.undlod).every((x) => x.b);
  }
  if (tal.undlod == null && lister.undlod.length && !partier) tal.undlod = lister.undlod.length;
  const vandt = a.vandt || (tal.for > tal.imod ? "for" : tal.imod > tal.for ? "imod" : null);
  const m = (a.om || "").match(/\(?(ÆF\s*\d+)\)?/i);
  return { om: a.om || "", tal, partier, vandt, lister, nr: m ? m[1].replace(/\s/g, "") : "", aendring: erAendring(a.om) };
}
const ord = (v) => (v.vandt === "for" ? "Vedtaget" : v.vandt === "imod" ? "Forkastet" : "Afstemning");
// "50–3" (for–imod). Ved partitælling: "4 partier for, 2 imod"
const tekstTal = (v) => (v.partier ? `${v.tal.for} for, ${v.tal.imod} imod (partier)` : `${v.tal.for}–${v.tal.imod}`);
const lang = (v) => {
  const { for: f, imod: i, undlod: u } = v.tal, enhed = v.partier ? "partier" : "stemmer";
  return `${ord(v)}: ${f} ${enhed} for, ${i} imod${u != null ? `, ${u} undlod` : ""}`;
};

// Hovedafstemningen: den sidste, der ikke er et ændringsforslag; findes ingen, er det den sidste
function vælg(s) {
  const rå = s.afstemninger || afstemninger(s.beslutning || "");
  if (!rå.length) return null;
  const alle = rå.map((a) => læs(a, null));
  let hoved = [...alle].reverse().find((v) => !v.aendring) || alle.at(-1);
  if (!hoved.tal.for && !hoved.tal.imod && s.tal) { // afstemningen mangler tal: brug sagens egne
    const k = alle.indexOf(hoved); hoved = læs(rå[k], s.tal); alle[k] = hoved;
  }
  return { hoved, andre: alle.filter((v) => v !== hoved) };
}

// ---------- HTML ----------
const knap = (x, esc) => x.b
  ? `<li class="sg-knap" style="--pf:${PARTIFARVER[x.b] || "#56535A"};--pt:${tekstFarve(PARTIFARVER[x.b] || "#56535A")}" title="${esc(x.navn + (x.medlemmer ? `: ${x.medlemmer.join(", ")}` : ""))}" aria-label="${esc(x.navn + (x.medlemmer ? `, ${x.medlemmer.length} medlem${x.medlemmer.length > 1 ? "mer" : ""}` : ""))}"><span aria-hidden="true">${esc(x.b)}${x.medlemmer ? `<sup class="sg-ant">${x.medlemmer.length}</sup>` : ""}</span></li>`
  : `<li class="sg-knap sg-person">${esc(x.navn)}</li>`;
const bar = (v, cls, esc) => {
  const { for: f, imod: i, undlod: u } = v.tal, seg = [["for", f], ["imod", i], ["undlod", u || 0]].filter(([, n]) => n > 0);
  return `<div class="sg-bar ${cls}" role="img" aria-label="${esc(lang(v))}">${seg.map(([k, n]) => `<span class="sg-${k}" style="flex-grow:${n}"></span>`).join("")}</div>`;
};
const grupper = (v, esc) => [["for", "For"], ["imod", "Imod"], ["undlod", "Undlod"]].filter(([k]) => v.lister[k].length)
  .map(([k, navn]) => `<div class="sg-gruppe sg-g-${k}"><h4 class="sg-gh">${navn}</h4><ul class="sg-knapper">${v.lister[k].map((x) => knap(x, esc)).join("")}</ul></div>`).join("");

export function stemmeGrafik(s, esc = (x) => x) {
  const r = vælg(s); if (!r) return "";
  const v = r.hoved, { for: f, imod: i, undlod: u } = v.tal;
  if (f + i + (u || 0) === 0) return "";
  const enstemmig = i === 0 && u === 0 && f > 0 && !v.partier && !v.aendring;
  const tal = [["for", "For", f], ["imod", "Imod", i], ["undlod", "Undlod", u]].filter(([, , n]) => n != null)
    .map(([k, n, x]) => `<li class="sg-t sg-t-${k}"><span class="sg-prik" aria-hidden="true"></span>${n} <b>${x}</b></li>`).join("");
  const små = r.andre.slice(0, 3).map((a) => {
    const antal = a.lister.for.length + a.lister.imod.length + a.lister.undlod.length;
    return `<div class="sg-lille"><div class="sg-lh"><span class="sg-lnavn">${esc(a.nr || "Ændringsforslag")}</span> <span class="sg-lud sg-ud-${a.vandt || "x"}">${ord(a)} ${esc(tekstTal(a))}</span></div>${bar(a, "sg-bar-lille", esc)}${antal && antal <= 12 ? `<div class="sg-lknapper">${grupper(a, esc)}</div>` : ""}</div>`;
  }).join("");
  const flere = r.andre.length > 3 ? `<p class="sg-flere">og ${r.andre.length - 3} afstemning${r.andre.length - 3 > 1 ? "er" : ""} mere om ændringsforslag i beslutningen</p>` : "";
  return `<section class="sg" aria-label="Afstemning">
<p class="sg-udfald sg-ud-${v.vandt || "x"}">${v.aendring ? `<span class="sg-for-hvad">${esc(v.nr ? `Ændringsforslag ${v.nr}` : "Ændringsforslag")}</span> ` : ""}<b>${ord(v)}</b> ${esc(tekstTal(v))}${enstemmig ? ` <span class="sg-enig">enstemmigt</span>` : ""}</p>
${bar(v, "", esc)}
<ul class="sg-tal">${tal}</ul>
${grupper(v, esc) ? `<div class="sg-grupper">${grupper(v, esc)}</div>` : ""}
${v.partier ? `<p class="sg-note">Tallene viser antal partier, ikke stemmer.</p>` : ""}
${små ? `<div class="sg-smaa"><p class="sg-sh">${v.aendring ? "Andre afstemninger" : "Afstemninger om ændringsforslag"}</p>${små}${flere}</div>` : ""}
</section>`;
}

export function stemmeMini(s, esc = (x) => x) {
  const r = vælg(s); if (!r) return "";
  const v = r.hoved, { for: f, imod: i, undlod: u } = v.tal;
  if (f + i + (u || 0) === 0 || v.aendring) return ""; // kun ændringsforslag stemt: sagens udfald kendes ikke
  return `<span class="sg-mini sg-ud-${v.vandt || "x"}" role="img" aria-label="${esc(lang(v))}">${bar({ ...v }, "sg-bar-mini", esc).replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"')}<span class="sg-mini-tal">${ord(v)} ${f}–${i}${v.partier ? " partier" : ""}</span></span>`;
}
