// En læsers profil til mandagsmailen: fra Min avis-profilen, hvis den findes, ellers fra tilmeldingens fritekst.
// Bruges af redaktionens udsendelse (min/admin.html). Reglerne er de samme som i Min avis (min/index.html).

// Emner ud fra tilmeldingens fritekst ("Skoler, cykelstier og klima")
export const NOEGLEORD = { trafik: /trafik|cykl|parkering/, klima: /klima|grøn|miljø|solcelle/, affald: /affald|genbrug/, bolig: /bolig/,
  byggeri: /bygg|lokalplan|byplan/, skole: /skole|børn|dagtilbud|uddannelse/, aeldre: /ældre|sundhed|pleje/, social: /social|udsat|hjemløs/,
  budget: /budget|økonomi/, kultur: /kultur|fritid|idræt|bibliotek/, erhverv: /erhverv|job|arbejdsmarked/ };
export const emnerFraTekst = (tekst, EMNER) => {
  const t = (tekst || "").toLowerCase();
  return Object.keys(EMNER).filter((id) => t.includes(EMNER[id].navn.toLowerCase()) || NOEGLEORD[id]?.test(t));
};

// Kommuner ud fra fritekst ("Lyngby, Aarhus", "Københavns Kommune og Herning"); kun de åbne (slugs fra kommune/aabne.json)
const slugAf = (t) => t.toLowerCase().replace(/\s+kommunes?$/, "").replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ALIAS = { kbh: "koebenhavn", koebenhavns: "koebenhavn", lyngby: "lyngby-taarbaek", taastrup: "hoeje-taastrup" };
export const kommunerFraTekst = (tekst, aabne) => [...new Set((tekst || "").split(/,|\/|\s+og\s+/i)
  .map((t) => ALIAS[slugAf(t)] || slugAf(t)).filter((s) => aabne.includes(s)))];

// Profilen til mailen. kommuner er tom, hvis læseren ikke følger en åben kommune; så får de ingen mail
// (vi sender aldrig Københavns sager til en, der har skrevet sig op til en anden kommune).
export function profilFor(a, EMNER, aabne) {
  let p = {};
  try { p = a.profil ? JSON.parse(a.profil) : {}; } catch { p = {}; }
  const valgte = (Array.isArray(p.kommuner) ? p.kommuner : p.kommune ? [p.kommune] : []).filter((s) => aabne.includes(s));
  const emner = (p.emner || []).filter((id) => EMNER[id]);
  return {
    navn: (p.navn || "").trim(),
    emner: emner.length ? emner : emnerFraTekst(a.emner, EMNER),
    ord: Array.isArray(p.ord) ? p.ord : [],
    bydel: p.bydel || "",
    kommuner: valgte.length ? valgte : kommunerFraTekst(a.kommuner, aabne),
  };
}
