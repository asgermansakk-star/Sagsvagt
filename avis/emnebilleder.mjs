// Emneillustrationer: ét sæt pr. emne i EMNER (beriget.mjs) plus "generel" som reserve.
// Fra 8/11-2026 er tegningerne lavet i Canva (identitet/canva-emnetegninger.md): assets/emner/<id>.jpg, <id>-2.jpg og <id>-3.jpg.
// Hver sag får en fast variant ud fra sit id, så samme sag altid har samme billede, men nabosager ikke ligner hinanden.
// De gamle <id>.svg bliver liggende, fordi Sagsvagt Erhvervs mails (signaler.mjs) og ældre sider bruger dem.
const VARIANTER = { trafik: 3, bolig: 3, byggeri: 3, klima: 3, skole: 3, budget: 2, affald: 2, social: 2, kultur: 2, aeldre: 2, unge: 2, erhverv: 2, generel: 1 };
const EMNEBILLEDER = new Set(Object.keys(VARIANTER));

// Sagens emne-id. s.emnerTitel (emner fundet i overskriften) går forud for s.emner (overskrift + underrubrik),
// fordi overskriften afgør, hvad sagen handler om; s.emner står i EMNER's rækkefølge, ikke efter relevans.
export const emneId = (s) => [...(s?.emnerTitel || []), ...(s?.emner || [])].find((id) => EMNEBILLEDER.has(id)) || "generel";

// Fast variant pr. sag: en simpel hash af sagens id
const hash = (t = "") => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const emneFil = (s) => {
  const id = emneId(s), n = hash(s?.id) % VARIANTER[id];
  return `assets/emner/${id}${n ? `-${n + 1}` : ""}.jpg`;
};

export const emneBillede = (s, rod, { lazy = true } = {}) =>
  `<img class="emnebillede" src="${rod}${emneFil(s)}" width="1200" height="674" alt=""${lazy ? ' loading="lazy"' : ""}>`;
