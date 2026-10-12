// Beriger sagerne med emner, afstemninger og "Kort fortalt". Bruges af byg.mjs.
// Emnerne er de samme på avisen og i Min avis: byg.mjs skriver dem med i assets/sager.json.

// ---------- Emner ----------
// Korte ord (højst 4 bogstaver) matches som hele ord med bøjning, lange ord også inde i sammensatte ord
// ("cykelsti" i "supercykelstien"). f er farven på mærket: r (rosen) eller b (lyng).
export const EMNER = {
  trafik:  { navn: "Trafik og cykler", f: "b", ord: ["trafik", "cykel", "cykler", "cyklist", "vejarbejde", "vejbelysning", "bil", "bus", "metro", "letbane", "gågade", "parkering", "fortov", "fodgænger", "trafiksikker", "hastighed", "krydset"] },
  klima:   { navn: "Klima og grønt", f: "r", ord: ["klima", "skybrud", "regnvand", "træ", "natur", "grøn", "park", "biodiversitet", "kloak", "co2", "energi", "solcelle"] },
  affald:  { navn: "Affald", f: "b", ord: ["affald", "skrald", "renovation", "genbrug", "tømning", "storskrald"] },
  bolig:   { navn: "Boliger", f: "r", ord: ["bolig", "lejlighed", "almene", "husleje", "udlejning", "boligområde"] },
  byggeri: { navn: "Byggeri og lokalplaner", f: "b", ord: ["byggeri", "lokalplan", "byplan", "servitut", "byggesag", "bevaring", "kommuneplan", "dispensation", "bebyggelse", "nedrivning"] },
  skole:   { navn: "Skoler og børn", f: "r", ord: ["skole", "dagtilbud", "børnehave", "vuggestue", "børn", "institution", "fritidshjem", "klub", "elever", "undervisning"] },
  aeldre:  { navn: "Ældre og sundhed", f: "b", ord: ["ældre", "plejehjem", "hjemmepleje", "sundhed", "omsorg", "senior", "demens", "rehabilitering"] },
  social:  { navn: "Det sociale", f: "r", ord: ["hjemløs", "udsat", "misbrug", "handicap", "botilbud", "psykiatri", "socialt", "sociale"] },
  budget:  { navn: "Budget og økonomi", f: "b", ord: ["budget", "bevilling", "anlægsbevilling", "anlægsoversigt", "skat", "overførsel", "besparelse", "regnskab"] },
  kultur:  { navn: "Kultur og fritid", f: "r", ord: ["kultur", "bibliotek", "kunst", "teater", "museum", "idræt", "svømmehal", "forening"] },
  erhverv: { navn: "Erhverv og job", f: "b", ord: ["erhverv", "beskæftigelse", "ledig", "job", "virksomhed", "turisme", "natteliv", "udeservering"] },
};
const BOGSTAV = "a-zæøåéü0-9";
const RE = Object.fromEntries(Object.entries(EMNER).map(([id, e]) => [id, new RegExp(e.ord.map((o) => {
  const w = o.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return w.length <= 4 ? `(?<![${BOGSTAV}])${w}(e|er|en|et|erne|ene|ets|s)?(?![${BOGSTAV}])` : w;
}).join("|"), "i")]));
// Udvalgs-, forvaltnings- og borgmestertitler fjernes først, ellers handler alt fra "Klima-, Miljø- og Teknikudvalget"
// og "klima-, miljø- og teknikborgmesteren" om klima
const ORG = /(?:[\wæøå]+-,?\s+)*(?:og\s+)?[\wæøå]*(?:udvalg|forvaltning|borgmester)[\wæøå]*/gi;
export const emnerFor = (tekst) => {
  const t = tekst.replace(ORG, " ");
  return Object.keys(EMNER).filter((id) => RE[id].test(t));
};

// ---------- Partier og afstemninger ----------
// Bogstaverne i Københavns referater. Q er Frie Grønne (det fremgår af referaterne).
export const PARTIER = {
  A: "Socialdemokratiet", B: "Radikale Venstre", C: "Det Konservative Folkeparti", D: "Nye Borgerlige", F: "SF",
  I: "Liberal Alliance", K: "Kristendemokraterne", M: "Moderaterne", O: "Dansk Folkeparti", Q: "Frie Grønne",
  V: "Venstre", Æ: "Danmarksdemokraterne", Ø: "Enhedslisten", Å: "Alternativet",
};
// "Ø, F, A og V." → [{ b: "Ø", navn: "Enhedslisten" }, …]. Lokaludvalg stemmer ofte med personnavne, som vises som de er.
export const deltagere = (tekst = "") => tekst.replace(/\.\s*$/, "").split(/[,;]\s*|\s+og\s+/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean)
  .map((x) => (x === "0" ? "O" : x)).map((x) => (/^[A-ZÆØÅ]$/.test(x) ? { b: x, navn: PARTIER[x] || x } : { navn: x }));
// Stemmetal fra beslutningen: "med 37 stemmer mod 17. 1 undlod at stemme."
// Rækkefølgen er ikke fast: Borgerrepræsentationen skriver "forkastet med 50 stemmer mod 3" (flertallet først),
// udvalgene ofte "forkastet med 2 stemmer mod 9" (for først). Derfor afgør udfaldet det: et forkastet forslag har
// flest imod, et vedtaget flest for. Står stemmerne lige, beholdes rækkefølgen.
export function stemmetal(beslutning = "") {
  const m = beslutning.match(/med (\d+) stemmer? mod (\d+)/i);
  if (!m) return null;
  const foer = beslutning.slice(0, m.index), saetning = foer.slice(Math.max(foer.lastIndexOf(". "), foer.lastIndexOf("\n")) + 1);
  const a = +m[1], b = +m[2], hoej = Math.max(a, b), lav = Math.min(a, b);
  const [f, i] = a === b ? [a, b] : TABT.test(saetning) ? [lav, hoej] : [hoej, lav];
  const u = beslutning.slice(m.index).match(/(Ingen|\d+)(?: medlem(?:mer)?)? undlod/i);
  return { for: f, imod: i, undlod: u ? (/ingen/i.test(u[1]) ? 0 : +u[1]) : null };
}

// Alle afstemninger i en beslutning, også om ændringsforslag. Referaterne skriver dem på to måder:
//   "Ændringsforslaget blev forkastet med 1 stemme mod 7. …"  efterfulgt af  "For stemte: I" / "Imod stemte: A, B" / "Undlod at stemme: C"
//   "Indstillingen blev godkendt med 50 stemmer mod 3. …"     efterfulgt af  "For: Ø, F" / "Imod: Å og Q"
// Giver [{ om, vandt: "for" | "imod" | null, for: [...], imod: [...], undlod: [...] }] med deltagere() som elementer.
// vandt er null, når referatet ikke har en sætning om udfaldet lige før listerne.
const UDFALD_LINJE = /\b(godkendt|vedtaget|anbefalet|tiltrådt|forkastet|nedstemt|faldt|bortfaldt|oversendt|tilbagesendt|stemmer mod|stemme mod)\b/i;
const TABT = /\b(forkastet|nedstemt|faldt|bortfaldt|ikke (?:godkendt|vedtaget|anbefalet|tiltrådt))\b/i;
export function afstemninger(beslutning = "") {
  const ud = []; let blok = null;
  for (const l of beslutning.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(/^(for|imod|undl(?:od|ader))(?: at stemme| stemte)?(?: \d+ medlem(?:mer)?)?:\s*(.+)$/i);
    if (m) {
      if (!blok) { blok = { om: "", vandt: null, for: [], imod: [], undlod: [] }; ud.push(blok); }
      const k = /^for/i.test(m[1]) ? "for" : /^imod/i.test(m[1]) ? "imod" : "undlod";
      blok[k] = /^ingen\.?$/i.test(m[2].trim()) ? [] : deltagere(m[2]);
    } else if (UDFALD_LINJE.test(l)) {
      blok = { om: l, vandt: TABT.test(l) ? "imod" : "for", for: [], imod: [], undlod: [] }; ud.push(blok);
    }
  }
  return ud.filter((b) => b.for.length + b.imod.length + b.undlod.length > 0);
}

// ---------- Høringer ----------
const MAANED = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
// "Høringsfristen er den 28. oktober 2026", "høringsfristens udløb den 22. september 2026", "Høringsfrist: 28. august 2026" → "2026-10-28"
export function hoeringsfrist(tekst = "") {
  const m = tekst.match(new RegExp(`høringsfrist\\w*[^.\\d]{0,40}?(\\d{1,2})\\.\\s*(${MAANED.join("|")})\\s*(\\d{4})`, "i"));
  return m ? `${m[3]}-${String(MAANED.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
// Sager, der sendes i (offentlig) høring
export const iHoering = (tekst = "") => /(sendes|udsendes|sende|udsendelse|sendt)\s[^.]{0,40}?\bi\s+(offentlig\s+)?høring|offentlig høring i \d+/i.test(tekst);

// ---------- Ordforklaringer ----------
// Forklares første gang, ordet står i sagsteksten. Nøglen er et regulært udtryk (uden flag), værdien forklaringen.
export const ORDBOG = [
  ["indstilling(?:en)?", "Forvaltningens forslag til, hvad politikerne skal beslutte."],
  ["medlemsforslag(?:et)?", "Et forslag, som et eller flere politikere selv har stillet, i stedet for forvaltningen."],
  ["ændringsforslag(?:et)?", "Et forslag om at ændre indstillingen. Det stemmes der om, før selve sagen afgøres."],
  ["Borgerrepræsentationen", "Københavns byråd med 55 medlemmer. Den træffer de endelige beslutninger."],
  ["Økonomiudvalget", "Kommunens øverste udvalg, ledet af overborgmesteren. Mange sager går herigennem, før de når Borgerrepræsentationen."],
  ["lokaludvalg(?:et)?", "Et råd af borgere og foreninger i en bydel, som rådgiver kommunen. Det kan ikke træffe beslutninger på kommunens vegne."],
  ["lokalplan(?:en)?", "Regler for, hvad der må bygges i et bestemt område, og hvordan det skal se ud."],
  ["kommuneplantillæg(?:get)?", "En ændring af kommuneplanen, kommunens overordnede plan for, hvordan byen skal udvikle sig."],
  ["anlægsbevilling(?:en)?", "Penge, som politikerne afsætter til et byggeri eller et andet fysisk projekt."],
  ["dispensation(?:en)?", "En tilladelse til at fravige reglerne i et bestemt tilfælde."],
  ["servitut(?:ten)?", "En tinglyst regel på en ejendom, fx om hvad den må bruges til, eller hvor højt der må bygges."],
  ["protokolbemærkning(?:en)?", "En udtalelse, som et parti får skrevet ind i referatet, typisk for at forklare sin stemme."],
  ["høringssvar(?:et|ene)?", "Et skriftligt svar til kommunen, når en sag er sendt i høring."],
  ["offentlig høring", "En periode, hvor alle kan sende kommentarer til et forslag, før det bliver endeligt vedtaget."],
  ["taget til efterretning", "Politikerne har hørt orienteringen og har ingen yderligere bemærkninger."],
  ["forespørgsel(?:en)?", "Et spørgsmål fra en politiker til en borgmester, som besvares på mødet."],
  ["bilag IV-art(?:en)?", "En dyre- eller planteart, som EU's habitatdirektiv beskytter strengt."],
  ["miljøkonsekvensrapport(?:en)?", "En rapport om, hvordan et stort projekt påvirker natur, miljø og naboer."],
];
const ORDBOG_RE = ORDBOG.map(([o, f]) => [new RegExp(`(?<![${BOGSTAV}])(${o})(?![${BOGSTAV}])`, "i"), f]);
// Sætter forklaringer på i færdig, escapet HTML: kun i tekst (ikke i tags eller links), første forekomst af hvert ord
// Højst `max` forklaringer pr. side, så teksten ikke drukner i prikkede ord
export function forklar(html, escAttr, max = 4) {
  const brugt = new Set(); let iLink = 0;
  return html.split(/(<[^>]+>)/).map((del) => {
    if (del.startsWith("<")) { if (/^<a[\s>]/i.test(del)) iLink++; else if (/^<\/a>/i.test(del)) iLink = Math.max(0, iLink - 1); return del; }
    if (iLink) return del;
    // Find alle match i den oprindelige tekst først, så en indsat forklaring aldrig selv bliver matchet
    const fund = [];
    for (const [re, f] of ORDBOG_RE) {
      if (brugt.has(re) || brugt.size >= max) continue;
      const m = del.match(re);
      if (m && !fund.some((x) => m.index < x.slut && m.index + m[1].length > x.start)) { brugt.add(re); fund.push({ start: m.index, slut: m.index + m[1].length, f }); }
    }
    fund.sort((a, b) => b.start - a.start);
    for (const x of fund) del = del.slice(0, x.start) + `<dfn class="ord" tabindex="0" data-ord="${escAttr(x.f)}">${del.slice(x.start, x.slut)}</dfn>` + del.slice(x.slut);
    return del;
  }).join("");
}

// ---------- Kort fortalt ----------
const stort = (t) => t.replace(/^./, (c) => c.toUpperCase());
// Indstillingens at-punkter: "• at godkende X" → "Godkende X"
export function indstillingPunkter(tekst = "") {
  // Punkter står med "•" eller nummereret ("1. at …")
  const PKT = /^([•·\-–]|\d{1,2}\.(?=\s*at\s))\s*/i;
  return tekst.split("\n").map((l) => l.trim()).filter((l) => PKT.test(l))
    .map((l) => stort(l.replace(PKT, "").replace(/^at\s+/i, "").replace(/[,;]\s*(og)?$/i, "").trim()))
    .filter((l) => l.length > 8);
}
// Hvem sagen går videre til: "… indstiller, at udvalget over for Økonomiudvalget og Borgerrepræsentationen anbefaler, …"
export function videreTil(tekst = "") {
  const m = tekst.match(/over for\s+(.+?)\s+anbefaler/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
