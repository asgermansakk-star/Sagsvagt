// Mandagsmailen: den ugentlige mail med sagerne om modtagerens emner.
// Bruges både i browseren (Min avis viser din egen mail) og i Node (avis/mandagsmail.mjs laver mails til udsendelse).
// Mailen er bygget med tabeller og inline-styling, så den ser rigtig ud i Gmail, Outlook og Apple Mail.
//
//   lavMandagsmail({ data, profil, idag, linkTil, modtager })
//   data:     indholdet af assets/sager.json ({ emner, sager })
//   profil:   { navn, emner: ["trafik", …], ord: ["Lersøparken", …], bydel: "Valby Lokaludvalg" }
//   idag:     "2026-10-12" (mandagen, mailen sendes)
//   linkTil:  (sag) => adresse, som overskriften linker til (kommunens side, mens avisen er lukket)
//   modtager: e-mailadressen, der står i bunden af mailen
//   logo:     adressen på logoet (som standard på sagsvagt.dk)
//   afmeld:   personligt afmeldingslink (api/afmeld.php); uden link står redaktionens mail
// api/_mandagsmail_lav.php laver den samme mail på serveren. Ret begge; avis/tjek-mandagsmail.mjs sammenligner dem.
// Giver { emne, preheader, html, tekst, antal }.

const C = {
  nat: "#0E0F14", kalk: "#E6DFD3", kalkLys: "#EEE8DE", muted: "#56535A", rule: "#CFC6B8", brod: "#3E3B40",
  vin: "#8A2430", bordeaux: "#3E0E14", rosen: "#DCA9A5", indigo: "#28377A", blaek: "#0C1430", lyng: "#B7BBD8", sten: "#8D8A86", rubin: "#B04A50",
};
const SANS = "Montserrat, 'Segoe UI', Arial, sans-serif";
const SERIF = SANS; // Montserrat er Sagsvagts eneste skrift
// Mørk tilstand: mailprogrammer i mørk tilstand (Apple Mail, Outlook-apps) viser mailen med disse farver i stedet for at farve
// om på egen hånd. moerk() giver hvert element en klasse ud fra dets egne farver; [data-ogsb]/[data-ogsc] er Outlooks markering
// af elementer, den har farvet om. Samme tekst og regler som i api/_mandagsmail_lav.php.
const MOERK_CSS = '<style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media (prefers-color-scheme:dark){.mm-bg{background:#16171D!important}.mm-kort{background:#23242C!important}.mm-streg{background:#3A3B44!important}.mm-lys{background:#E6DFD3!important}.mm-knap{background:#E6DFD3!important;color:#0E0F14!important}.mm-tx{color:#E6DFD3!important}.mm-tx2{color:#CFC7BA!important}.mm-mu{color:#A29CA3!important}.mm-vin{color:#DCA9A5!important}.mm-ind{color:#B7BBD8!important}.mm-vinkant{border-color:#DCA9A5!important}}[data-ogsb] .mm-bg{background:#16171D!important}[data-ogsb] .mm-kort{background:#23242C!important}[data-ogsb] .mm-streg{background:#3A3B44!important}[data-ogsb] .mm-lys{background:#E6DFD3!important}[data-ogsb] .mm-knap{background:#E6DFD3!important}[data-ogsc] .mm-knap{color:#0E0F14!important}[data-ogsc] .mm-tx{color:#E6DFD3!important}[data-ogsc] .mm-tx2{color:#CFC7BA!important}[data-ogsc] .mm-mu{color:#A29CA3!important}[data-ogsc] .mm-vin{color:#DCA9A5!important}[data-ogsc] .mm-ind{color:#B7BBD8!important}[data-ogsc] .mm-vinkant{border-color:#DCA9A5!important}</style>';
const moerk = (html) => html.replace(/ style="([^"]*)"/g, (m, s) => {
  const k = [];
  const bg = (s.match(/(?:^|;)background(?:-color)?:(#[0-9A-F]{6})/) || [])[1] || "";
  const fg = (s.match(/(?:^|;)color:(#[0-9A-F]{6})/) || [])[1] || "";
  const knap = bg === C.nat && fg === C.kalk;
  if (bg && !s.includes("background-image")) {
    const b = { [C.kalk]: "mm-bg", [C.kalkLys]: "mm-kort", [C.rule]: "mm-streg", [C.nat]: knap ? "mm-knap" : "mm-lys" }[bg] || "";
    if (b) k.push(b);
  }
  if (fg && !knap) {
    const f = { [C.nat]: "mm-tx", [C.brod]: "mm-tx2", [C.muted]: "mm-mu", [C.vin]: "mm-vin", [C.indigo]: "mm-ind" }[fg] || "";
    if (f) k.push(f);
  }
  if (new RegExp(`border[a-z-]*:[^;]*${C.vin}`).test(s)) k.push("mm-vinkant");
  return (k.length ? ` class="${k.join(" ")}"` : "") + m;
});
const SITE = "https://sagsvagt.dk/";
const REDAKTION = "mansa@sagsvagt.dk";
// Mailens billeder (toppen i Mødet-gradienten, sektionsikoner og symbolet i bunden). Mailen skal give mening uden dem.
const MAIL = `${SITE}assets/mail/`;

const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dag = (iso) => new Date(iso + "T12:00:00Z");
const dato = (iso, o) => dag(iso).toLocaleDateString("da-DK", { timeZone: "UTC", ...o });
const kort = (iso) => dato(iso, { day: "numeric", month: "long" });
const stor = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const alder = (idag, iso) => (dag(idag) - dag(iso)) / 864e5;
const ugenr = (iso) => { const t = dag(iso); const d = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - d + 3); const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); };
const klip = (t = "", n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + " …" : t);
const hvor = (u) => (/Lokaludvalg$/.test(u) ? u.replace(/\s*Lokaludvalg$/, "") + " Lokaludvalg" : u);

// ---------- Udvælgelse ----------
// Fire sager pr. sektion: den vigtigste fuldt ud, de næste tre kort (overskrift og beslutning). Resten ligger i Min avis.
const VIS = 4;
export function vaelgSager({ data, profil, idag }) {
  const ord = (profil.ord || []).map((o) => o.trim()).filter(Boolean);
  const emner = (profil.emner || []).filter((id) => data.emner[id]);
  const vurder = (s) => {
    const tekst = `${s.t} ${s.d}`.toLowerCase();
    const mE = emner.filter((id) => s.e.includes(id)), mO = ord.filter((o) => tekst.includes(o.toLowerCase()));
    const iTitel = emner.filter((id) => s.et.includes(id)).length + ord.filter((o) => s.t.toLowerCase().includes(o.toLowerCase())).length;
    const hits = mE.length + mO.length * 2;
    return { ...s, mE, mO, hits, score: s.v * 6 + hits * 4 + iTitel * 8 - Math.max(0, alder(idag, s.dato)) * 0.35 - s.r * 25 };
  };
  const mine = data.sager.filter((s) => !s.r).map(vurder).filter((s) => s.hits > 0);
  // Ugen der gik: de sidste 7 dage. Er der næsten intet, kigger vi 14 dage tilbage.
  let dage = 7;
  let sket = mine.filter((s) => s.st !== "kommer" && alder(idag, s.dato) >= 0 && alder(idag, s.dato) <= dage);
  if (sket.length < 3) { dage = 14; sket = mine.filter((s) => s.st !== "kommer" && alder(idag, s.dato) >= 0 && alder(idag, s.dato) <= dage); }
  sket.sort((a, b) => b.score - a.score);
  // Det, politikerne skal tage stilling til, før orienteringer ("Orientering om …", "B-sag - Orientering …"), derefter efter dato
  const orient = (s) => (/^(?:[A-Z]-sag\s*-\s*)?orientering/i.test(s.t) ? 1 : 0);
  const kommer = mine.filter((s) => s.st === "kommer" && -alder(idag, s.dato) >= 0 && -alder(idag, s.dato) <= 14)
    .sort((a, b) => orient(a) - orient(b) || a.dato.localeCompare(b.dato) || b.score - a.score);
  const brugt = new Set([...sket.slice(0, VIS), ...kommer.slice(0, VIS)].map((s) => s.id));
  const bydel = profil.bydel
    ? data.sager.filter((s) => s.u === profil.bydel && !s.r && !brugt.has(s.id) && Math.abs(alder(idag, s.dato)) <= 14).map(vurder).slice(0, 2)
    : [];
  return { besluttet: sket.slice(0, VIS), flereBesluttet: Math.max(0, sket.length - VIS), kommer: kommer.slice(0, VIS), flereKommer: Math.max(0, kommer.length - VIS), alleKommer: kommer, bydel, dage, emner, ord: profil.ord || [] };
}

// Mailens top (logo, uge og dato) og bund (afsender, afmelding), fælles for mandagsmailen og ventelistemailen
// Toppen: et natkort over modtagerens (første) kommune fra assets/mail/natkort/, ellers Mødet-gradienten. Nat er reserven.
const mailTop = ({ emne, preheader, uge, idag, logo, kommune = "" }) => { const bg = `${MAIL}${kommune ? `natkort/${kommune}.jpg` : "top.jpg"}`; return `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no, date=no, address=no"><title>${esc(emne)}</title>${MOERK_CSS}</head>
<body style="margin:0;padding:0;background:${C.kalk};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.kalk}" style="background:${C.kalk};"><tr><td align="center" style="padding:24px 12px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.kalk};border-radius:10px;overflow:hidden;">
<tr><td bgcolor="${C.nat}" background="${bg}" style="background-color:${C.nat};background-image:url(${bg});background-size:cover;background-position:center;padding:32px 24px 30px;">
  <a href="${SITE}" style="text-decoration:none;"><img src="${esc(logo)}" width="120" height="28" alt="Sagsvagt" style="display:block;border:0;color:${C.kalk};font:700 20px ${SANS};"></a>
  <p style="margin:36px 0 0;font:700 28px/1.05 ${SANS};letter-spacing:.04em;text-transform:uppercase;color:${C.kalk};">Mandagsmailen</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 12px;"><tr><td width="48" height="3" bgcolor="${C.rubin}" style="background:${C.rubin};font-size:0;line-height:0;">&nbsp;</td></tr></table>
  <p style="margin:0;font:500 15px/1.45 ${SANS};color:${C.lyng};">Uge ${uge}<br>${esc(stor(dato(idag, { weekday: "long", day: "numeric", month: "long" })))}</p>
</td></tr>
`; };
const mailBund = (modtager, afmeld = "") => `<tr><td style="padding:34px 28px 28px;font:12px/1.6 ${SANS};color:${C.muted};">
  <img src="${MAIL}symbol.png" width="23" height="28" alt="" style="display:block;border:0;margin:0 0 14px;">
  Sagsvagt er partineutral og bygger på kommunens egne dagsordener og referater. Læs altid den originale sag, før du handler på den.<br><br>
  Du får denne mail, fordi du har skrevet dig op til Sagsvagt${modtager ? ` med ${esc(modtager)}` : ""}.
  <!-- Linkene på deres egen linje med luft, så de er nemme at ramme med en finger -->
  <br><a href="mailto:${REDAKTION}?subject=${encodeURIComponent("Ret mine emner")}" style="display:inline-block;padding:12px 18px 12px 0;line-height:20px;font-weight:600;color:${C.indigo};">Ret dine emner</a><a href="${afmeld ? esc(afmeld) : `mailto:${REDAKTION}?subject=${encodeURIComponent("Afmeld Sagsvagt")}`}" style="display:inline-block;padding:12px 18px 12px 0;line-height:20px;font-weight:600;color:${C.indigo};">Afmeld</a><a href="${SITE}privatliv.html" style="display:inline-block;padding:12px 0;line-height:20px;font-weight:600;color:${C.indigo};">Privatliv</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

// Bunden af tekstudgaven: med personligt afmeldingslink, når det findes
const tekstBund = (afmeld, ret = true) => afmeld
  ? `\n\n--\nDu får denne mail, fordi du har skrevet dig op til Sagsvagt.\nAfmeld: ${afmeld}${ret ? `\nRet dine emner: ${REDAKTION}` : ""}\n`
  : `\n\n--\nDu får denne mail, fordi du har skrevet dig op til Sagsvagt. ${ret ? "Afmeld eller ret dine emner: " : "Afmeld: "}${REDAKTION}\n`;

// ---------- Mailen ----------
export function lavMandagsmail({ data, profil = {}, idag, linkTil = (s) => s.k, modtager = "", afmeld = "", logo = `${SITE}assets/mail-logo.png` }) {
  const v = vaelgSager({ data, profil, idag });
  const uge = ugenr(idag);
  // Følger modtageren flere kommuner (sagerne har ks/kn fra Min avis eller avis/mandagsmail.mjs), står kommunen efter udvalget
  const flere = new Set(data.sager.map((s) => s.ks).filter(Boolean)).size > 1;
  const hvorSag = (s) => hvor(s.u) + (flere && s.kn && !s.u.includes(s.kn) ? `, ${s.kn}` : ""); // ikke "Herning Byråd, Herning"
  const nB = v.besluttet.length + v.flereBesluttet, nK = v.kommer.length + v.flereKommer;
  const navn = (profil.navn || "").trim();
  const tal = (n, en, flere) => `${n === 0 ? "Ingen" : n} ${n === 1 ? en : flere}`;
  const dele = [nB && tal(nB, "beslutning", "beslutninger"), nK && `${tal(nK, "sag", "sager")} på vej`].filter(Boolean);
  const emne = dele.length ? `Uge ${uge}: ${dele.join(" og ")} om dine emner` : `Uge ${uge}: Ingen nye sager om dine emner`;
  const top = v.besluttet[0] || v.kommer[0];
  const preheader = top ? `${top.t}${nB + nK > 1 ? ` og ${nB + nK - 1} sager mere` : ""}.` : "Der er ingen nye sager om dine emner i denne uge.";

  const tag = (id) => { const e = data.emner[id]; const r = e.f === "r"; return `<span style="display:inline-block;margin:8px 6px 0 0;padding:3px 9px;border-radius:6px;background:${r ? C.rosen : C.lyng};color:${r ? C.bordeaux : C.blaek};font:700 12px/1.4 ${SANS};">${esc(e.navn)}</span>`; };
  const ordTag = (o) => `<span style="display:inline-block;margin:8px 6px 0 0;padding:3px 9px;border-radius:6px;background:${C.kalk};box-shadow:inset 0 0 0 1px ${C.rule};color:${C.nat};font:700 12px/1.4 ${SANS};">${esc(o)}</span>`;
  // Stemmetallet står allerede i udfaldet ("med 50 stemmer mod 3"); vi tilføjer kun dem, der undlod
  const stemmer = (s) => (s.tal?.undlod ? ` <b style="white-space:nowrap;">${s.tal.undlod} undlod.</b>` : "");
  // Afstemningen som bjælke, neutral som på sitet: for i nat, imod i sten, undlod i rule (ingen parti- eller farvesejr)
  const afst = (s) => {
    const t = s.tal, ialt = t ? t.for + t.imod + (t.undlod || 0) : 0;
    if (s.st !== "besluttet" || !ialt) return "";
    const dele = [[t.for, C.nat], [t.imod, C.sten], [t.undlod || 0, C.rule]].filter(([n]) => n > 0);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;border-radius:5px;overflow:hidden;"><tr>${dele.map(([n, f]) => `<td width="${Math.round((100 * n) / ialt)}%" height="4" bgcolor="${f}" style="background:${f};font-size:0;line-height:0;">&nbsp;</td>`).join(`<td width="2" style="font-size:0;line-height:0;">&nbsp;</td>`)}</tr></table>
  <p style="margin:6px 0 0;font:12px/1.4 ${SANS};color:${C.muted};"><b style="color:${C.nat};">${t.for}</b> for · <b style="color:${C.nat};">${t.imod}</b> imod${t.undlod ? ` · <b style="color:${C.nat};">${t.undlod}</b> undlod` : ""}</p>`;
  };

  // Kort sag: status, overskrift og beslutningen på én linje, uden beskrivelse og mærker
  const kortSag = (s) => {
    const status = s.st === "besluttet" ? `<span style="color:${C.vin};font-weight:700;">Besluttet ${kort(s.dato)}</span>`
      : s.st === "kommer" ? `<span style="color:${C.indigo};font-weight:700;">${esc(stor(dato(s.dato, { weekday: "long", day: "numeric", month: "long" })))}</span>`
      : `<span style="font-weight:700;">Behandlet ${kort(s.dato)}</span>`;
    return `<tr><td style="padding:0 22px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.kalkLys};border-radius:10px;"><tr><td style="padding:16px 20px 17px;">
  <p style="margin:0 0 4px;font:600 12px/1.45 ${SANS};color:${C.muted};">${status} · ${esc(hvorSag(s))}</p>
  <a href="${esc(linkTil(s))}" style="font:600 16px/1.35 ${SERIF};color:${C.nat};text-decoration:none;">${esc(s.t)}</a>
  ${s.st === "besluttet" && (s.ud || s.kb) ? `<p style="margin:5px 0 0;font:14px/1.5 ${SANS};color:${C.brod};">${esc(klip(s.ud || s.kb, 140))}${s.ud ? stemmer(s) : ""}</p>` : ""}${afst(s)}
</td></tr></table></td></tr>`;
  };
  const sag = (s) => {
    const status = s.st === "besluttet" ? `<span style="color:${C.vin};font-weight:700;">Besluttet ${kort(s.dato)}</span>`
      : s.st === "kommer" ? `<span style="color:${C.indigo};font-weight:700;">På dagsordenen ${esc(dato(s.dato, { weekday: "long", day: "numeric", month: "long" }))}</span>`
      : `<span style="font-weight:700;">Behandlet ${kort(s.dato)}</span>`;
    // Som beslutningen på sagsvagt.dk: en vinrød streg over og ordet "Beslutning"; kort form, når udfaldet ikke er klart
    const besl = s.st === "besluttet" && (s.ud || s.kb)
      ? `<p style="margin:14px 0 0;padding:8px 0 0;border-top:2px solid ${C.vin};font:14px/1.5 ${SANS};color:${C.nat};"><b style="display:block;margin-bottom:2px;font:700 12px/1.4 ${SANS};letter-spacing:.06em;text-transform:uppercase;color:${C.vin};">Beslutning</b>${esc(s.ud || klip(s.kb, 220))}${s.ud ? stemmer(s) : ""}</p>` : "";
    return `<tr><td style="padding:0 22px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.kalkLys};border-radius:10px;"><tr><td style="padding:20px 20px 20px;">
  <p style="margin:0 0 6px;font:600 12px/1.45 ${SANS};color:${C.muted};">${status} · ${esc(hvorSag(s))}</p>
  <a href="${esc(linkTil(s))}" style="font:600 19px/1.3 ${SERIF};color:${C.nat};text-decoration:none;">${esc(s.t)}</a>
  ${s.d ? `<p style="margin:8px 0 0;font:15px/1.55 ${SERIF};color:${C.brod};">${esc(klip(s.d, 170))}</p>` : ""}
  ${besl}${afst(s)}
  <div>${(s.mE || []).map(tag).join("")}${(s.mO || []).map(ordTag).join("")}</div>
</td></tr></table></td></tr>`;
  };
  // fuld: den første sag vises med beskrivelse og mærker (bydelen vises kun kort)
  // Hver sektion har sin farve og sit ikon, som i talrækken: vin = besluttet, indigo = på vej, nat = bydelen
  const sektion = (titel, under, liste, flere, fuld = true, ikon = "", farve = C.nat, top = "") => liste.length ? `<tr><td style="padding:32px 28px 12px;">
  <h2 style="margin:0;font:700 20px/1.25 ${SANS};color:${C.nat};">${esc(titel)}</h2>
  ${under ? `<p style="margin:4px 0 0;font:13px/1.5 ${SANS};color:${C.muted};">${esc(under)}</p>` : ""}
</td></tr>${top}${liste.map((s, i) => (i === 0 && fuld ? sag(s) : kortSag(s))).join("")}${flere ? `<tr><td style="padding:4px 28px 6px;font:13px/1.5 ${SANS};color:${C.muted};">Og ${flere} ${flere === 1 ? "sag" : "sager"} mere om dine emner. <a href="${SITE}min/#sager" style="color:${C.indigo};font-weight:600;">Se dem i Min avis</a></td></tr>` : ""}` : "";

  const dineEmner = [...v.emner.map((id) => data.emner[id].navn), ...v.ord].join(", ");
  const ingen = !v.besluttet.length && !v.kommer.length && !v.bydel.length;
  // Ugens tal er det vigtigste i mailen: store tal i sektionernes farver, med luft imellem
  const talCelle = (n, en, fl, under, farve, b) => `<td width="${b}%" valign="top" style="padding:10px 0 0;">
    <p style="margin:0;font:700 34px/1.1 ${SANS};color:${n ? C.nat : C.muted};">${n}</p>
    <p style="margin:4px 0 0;font:700 13px/1.35 ${SANS};color:${C.nat};">${n === 1 ? en : fl}</p>
    <p style="margin:2px 0 0;font:12px/1.4 ${SANS};color:${C.muted};">${esc(under)}</p>
  </td>`;
  const b = profil.bydel ? 30 : 47;
  // Ugen der kommer: fem dage fra mailens dag med antallet af sager om dine emner og de udvalg, der behandler dem
  const UGEDAG = ["man", "tir", "ons", "tor", "fre", "lør", "søn"], UGEDAG_LANG = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
  const fem = [0, 1, 2, 3, 4].map((i) => {
    const t = new Date(dag(idag).getTime() + i * 864e5), iso = t.toISOString().slice(0, 10), l = v.alleKommer.filter((s) => s.dato === iso), w = (t.getUTCDay() + 6) % 7;
    return { kort: UGEDAG[w], lang: UGEDAG_LANG[w], nr: t.getUTCDate(), n: l.length, udvalg: [...new Set(l.map((s) => hvor(s.u)))] };
  });
  const kalender = fem.some((d) => d.n) ? `<tr><td style="padding:0 22px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${fem.map((d) => `<td width="20%" align="center" valign="top" style="padding:0 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${d.n ? C.lyng : C.kalk}" style="padding:8px 2px 10px;border-radius:8px;background:${d.n ? C.lyng : C.kalk};">
    <p style="margin:0;font:600 11px/1.3 ${SANS};letter-spacing:.06em;text-transform:uppercase;color:${d.n ? C.blaek : C.muted};">${d.kort}</p>
    <p style="margin:2px 0 0;font:700 20px/1.2 ${SANS};color:${d.n ? C.indigo : C.muted};">${d.nr}</p>
    <p style="margin:3px 0 0;font:600 11px/1.3 ${SANS};color:${d.n ? C.blaek : C.muted};">${d.n ? `${d.n} ${d.n === 1 ? "sag" : "sager"}` : "&ndash;"}</p>
  </td></tr></table></td>`).join("")}</tr></table>
  ${fem.filter((d) => d.n).map((d) => `<p style="margin:8px 0 0;font:13px/1.5 ${SANS};color:${C.brod};"><b style="color:${C.nat};">${d.lang} ${d.nr}.</b> ${esc(d.udvalg.slice(0, 3).join(" · "))}${d.udvalg.length > 3 ? ` · +${d.udvalg.length - 3}` : ""}</p>`).join("")}
</td></tr>` : "";
  const talRaekke = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;"><tr>
  ${[talCelle(nB, "beslutning", "beslutninger", v.dage === 7 ? "i ugen der gik" : "de seneste to uger", C.vin, b), talCelle(nK, "sag på vej", "sager på vej", "de næste to uger", C.indigo, b),
    ...(profil.bydel ? [talCelle(v.bydel.length, "sag i bydelen", "sager i bydelen", hvor(profil.bydel), C.nat, b)] : [])].join(`<td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>`)}
</tr></table>`;
  const html = mailTop({ emne, preheader, uge, idag, logo, kommune: (profil.kommuner || [])[0] || "" }) + `<tr><td style="padding:24px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.kalkLys};border-radius:10px;"><tr><td style="padding:22px 22px 20px;">
  <h1 style="margin:0;font:600 26px/1.15 ${SERIF};color:${C.nat};">God morgen${navn ? `, ${esc(navn)}` : ""}.</h1>
  ${ingen ? `<p style="margin:10px 0 0;font:16px/1.55 ${SERIF};color:${C.brod};">Der er ingen nye sager om dine emner i denne uge. Vi holder øje og skriver, når der sker noget.</p>` : talRaekke}
  ${dineEmner ? `<p style="margin:16px 0 0;font:13px/1.5 ${SANS};color:${C.muted};">Du følger: ${esc(dineEmner)}${profil.bydel ? ` · ${esc(hvor(profil.bydel))}` : ""}</p>` : ""}
</td></tr></table></td></tr>
${sektion(v.dage === 7 ? "Besluttet i ugen der gik" : "Besluttet de seneste to uger", "", v.besluttet, v.flereBesluttet, true, "besluttet", C.vin)}
${sektion("Det skal de tage stilling til", "De næste to uger.", v.kommer, v.flereKommer, true, "paa-vej", C.indigo, kalender)}
${sektion(`Fra ${hvor(profil.bydel || "")}`, "Det sker i din bydel.", v.bydel, 0, false, "bydel", C.nat)}
` + mailBund(modtager, afmeld);

  // Ren tekst til mailprogrammer, der ikke viser HTML
  const linje = (s) => `- ${s.t}\n  ${s.st === "besluttet" ? `Besluttet ${kort(s.dato)}` : s.st === "kommer" ? `På dagsordenen ${kort(s.dato)}` : `Behandlet ${kort(s.dato)}`}, ${hvorSag(s)}${s.st === "besluttet" && (s.ud || s.kb) ? `\n  ${s.ud || klip(s.kb, 220)}${s.ud && s.tal ? ` ${s.tal.for} for, ${s.tal.imod} imod.` : ""}` : ""}\n  ${linkTil(s)}`;
  const del = (t, l) => (l.length ? `\n\n${t.toUpperCase()}\n\n${l.map(linje).join("\n\n")}` : "");
  const tekst = `Sagsvagt, uge ${uge}\n\nGod morgen${navn ? `, ${navn}` : ""}.${ingen ? " Der er ingen nye sager om dine emner i denne uge." : ""}`
    + del("Besluttet", v.besluttet) + del("Det skal de tage stilling til", v.kommer) + del(`Fra ${hvor(profil.bydel || "")}`, v.bydel)
    + tekstBund(afmeld);

  return { emne, preheader, html: moerk(html), tekst, antal: { besluttet: nB, kommer: nK, bydel: v.bydel.length } };
}

// ---------- Ventelistemailen ----------
// Til tilmeldte, hvis kommune ikke er åben endnu (eller som ikke har skrevet en kommune): en kort mail om, at deres
// kommune er på vej, hvilke kommuner der er åbne, og et link, de kan dele, så kommunen rykker op i køen.
// kommuner: de navne, de skrev ved tilmeldingen. aabne: navnene på de åbne kommuner.
export function lavVentemail({ kommuner = [], aabne = [], idag, navn = "", modtager = "", afmeld = "", logo = `${SITE}assets/mail-logo.png` }) {
  const uge = ugenr(idag);
  const liste = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} og ${l.at(-1)}` : l[0] || "");
  const hvem = liste(kommuner);
  const emne = hvem ? `Uge ${uge}: Sagsvagt er på vej til ${hvem}` : `Uge ${uge}: Hvilken kommune vil du følge?`;
  const preheader = hvem ? `Vi giver besked, så snart ${hvem} er åben.` : "Svar på mailen med din kommune, så kommer den i køen.";
  const del = `${SITE}vagt.html?fra=mandagsmail${kommuner[0] ? `&kommune=${encodeURIComponent(kommuner[0])}` : ""}#tilmeld`;
  const p = (t) => `<p style="margin:12px 0 0;font:16px/1.55 ${SERIF};color:${C.brod};">${t}</p>`;
  // Hvor langt vi er: et stort tal og en bjælke i stedet for en liste, der vokser med hver ny kommune
  const IALT = 98, pct = Math.round((100 * aabne.length) / IALT);
  const fremdrift = aabne.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
  <tr><td style="padding:0 0 8px;font:700 13px/1.4 ${SANS};color:${C.nat};"><span style="font:700 34px/1.1 ${SANS};color:${C.vin};">${aabne.length}</span> af ${IALT} kommuner er åbne</td></tr>
  <tr><td style="font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:5px;overflow:hidden;"><tr><td width="${pct}%" height="10" bgcolor="${C.vin}" style="background:${C.vin};font-size:0;line-height:0;">&nbsp;</td><td height="10" bgcolor="${C.rule}" style="background:${C.rule};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
  <tr><td style="padding:8px 0 0;font:13px/1.5 ${SANS};color:${C.muted};"><a href="${SITE}kommune/" style="color:${C.indigo};font-weight:600;">Se de åbne kommuner</a></td></tr>
</table>` : "";
  const html = mailTop({ emne, preheader, uge, idag, logo }) + `<tr><td style="padding:28px 28px 26px;">
  <h1 style="margin:0;font:600 26px/1.15 ${SERIF};color:${C.nat};">God morgen${navn ? `, ${esc(navn)}` : ""}.</h1>
  ${hvem
    ? p(`Sagsvagt er endnu ikke åben i <b style="color:${C.nat};">${esc(hvem)}</b>. Vi åbner kommune for kommune, der hvor flest skriver sig op, og du får besked, så snart ${esc(hvem)} er med.`)
    : p("Du har ikke skrevet, hvilken kommune du vil følge. Svar på denne mail med navnet på din kommune, så sætter vi den i køen.")}
  ${fremdrift}
  ${hvem ? `<p style="margin:20px 0 0;"><a href="${esc(del)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${C.nat};color:${C.kalk};font:700 15px/1.2 ${SANS};text-decoration:none;">Del Sagsvagt med en nabo</a></p>
  <p style="margin:10px 0 0;font:13px/1.5 ${SANS};color:${C.muted};">Jo flere fra ${esc(hvem)}, der skriver sig op, jo før åbner vi.</p>` : ""}
</td></tr>` + mailBund(modtager, afmeld);
  const tekst = `Sagsvagt, uge ${uge}\n\nGod morgen${navn ? `, ${navn}` : ""}.\n\n`
    + (hvem ? `Sagsvagt er endnu ikke åben i ${hvem}. Vi åbner kommune for kommune, der hvor flest skriver sig op, og du får besked, så snart ${hvem} er med.\n\nDel Sagsvagt med en nabo: ${del}`
      : "Du har ikke skrevet, hvilken kommune du vil følge. Svar på denne mail med navnet på din kommune, så sætter vi den i køen.")
    + (aabne.length ? `\n\nLige nu følger vi byrådene i ${aabne.length} af ${IALT} kommuner: ${SITE}kommune/` : "")
    + tekstBund(afmeld, false);
  return { emne, preheader, html: moerk(html), tekst, antal: { besluttet: 0, kommer: 0, bydel: 0 }, vente: true };
}
