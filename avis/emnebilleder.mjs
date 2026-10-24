// Emneillustrationer: assets/emner/<id>.svg, ét til hvert emne i EMNER (beriget.mjs) plus "generel" som reserve.
export const EMNEBILLEDER = new Set(["trafik", "klima", "affald", "bolig", "byggeri", "skole", "unge", "aeldre", "social", "budget", "kultur", "erhverv", "generel"]);

// Sagens emne-id. s.emnerTitel (emner fundet i overskriften) går forud for s.emner (overskrift + underrubrik),
// fordi overskriften afgør, hvad sagen handler om; s.emner står i EMNER's rækkefølge, ikke efter relevans.
export const emneId = (s) => [...(s?.emnerTitel || []), ...(s?.emner || [])].find((id) => EMNEBILLEDER.has(id)) || "generel";

export const emneBillede = (s, rod, { klasse = "emnebillede", lazy = true } = {}) =>
  `<img class="${klasse}" src="${rod}assets/emner/${emneId(s)}.svg" width="640" height="360" alt=""${lazy ? ' loading="lazy"' : ""}>`;
