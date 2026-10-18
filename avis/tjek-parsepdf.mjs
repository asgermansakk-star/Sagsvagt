// Selvtjek af parsePdf: afkortede titler i indholdsfortegnelsen og titler, der ikke findes i teksten.
// Kør: node avis/tjek-parsepdf.mjs
import assert from "node:assert/strict";
import { parsePdf } from "./hent-firstagenda.mjs";

const punkt = (titel, tekst) => `${titel}\nIndstilling\n${tekst}\n\n`;
const tekst = (indhold, punkter) => `DAGSORDEN Miljø-, Natur- og Byudvalget (2026-2029) d. 22-09-2026\nIndholdsfortegnelse\n${indhold}\n\n${punkter}`;

// Punkt 2's titel er afkortet uden prikker og flyder sammen med punkt 3 ("… i hørin 10 MNBU …")
const r = parsePdf(tekst(
  // Punkt 4's punktum ("lejekontrakt.") er slugt af prikkerne
  "PBU/MNBU - Orientering om P-Nord........ 6 ØU - Fællesskabs- og antiracismepolitik 2027 - 2030 i hørin 10 MNBU/ØU/KB - Tillæg til affaldsplan 2027-2028...... 13 Forlængelse af lejekontrakt...... 14 MNBU - Eventuelt...... 15",
  punkt("PBU/MNBU - Orientering om P-Nord", "Udgifter til P-Nord.") +
  punkt("ØU - Fællesskabs- og antiracismepolitik 2027 - 2030 i høring", "Politikken sendes i høring.") +
  punkt("MNBU/ØU/KB - Tillæg til affaldsplan 2027-2028", "Tillægget sendes i høring.") +
  punkt("Forlængelse af lejekontrakt.", "Lejen forlænges.") +
  punkt("MNBU - Eventuelt", "Intet."),
));
assert.deepEqual(r.punkter.map((p) => [p.nr, p.titel]), [
  [1, "PBU/MNBU - Orientering om P-Nord"],
  [2, "ØU - Fællesskabs- og antiracismepolitik 2027 - 2030 i høring"],
  [3, "MNBU/ØU/KB - Tillæg til affaldsplan 2027-2028"],
  [4, "Forlængelse af lejekontrakt"],
  [5, "MNBU - Eventuelt"],
]);
assert.equal(r.punkter[0].afsnit[0].tekst, "Udgifter til P-Nord.");

// En titel, der slet ikke står i teksten: punktet før springes over i stedet for at få næste punkts tekst med
const r2 = parsePdf(tekst(
  "Punkt A...... 3 Punkt der mangler...... 5 Punkt C...... 7",
  punkt("Punkt A", "Tekst A.") + punkt("Et andet navn", "Tekst B.") + punkt("Punkt C", "Tekst C."),
));
assert.deepEqual(r2.punkter.map((p) => [p.nr, p.titel]), [[3, "Punkt C"]]);
assert.ok(!JSON.stringify(r2.punkter).includes("Tekst B"));

// Årstal uden bindestreg i teksten, og et lukket punkt, der kun står i indholdsfortegnelsen
const r3 = parsePdf(tekst(
  "Laks i Gudenåen 2027-2029...... 3 Meddelelser...... 5 Lukket: Ejendomssag...... 6 Underskriftsark...... 6",
  punkt("Laks i Gudenåen 20272029", "Tilskud.") + punkt("Meddelelser", "Ingen.") + "Underskriftsark\n",
));
assert.deepEqual(r3.punkter.map((p) => [p.nr, p.titel]), [[1, "Laks i Gudenåen 2027-2029"], [2, "Meddelelser"]]);
assert.equal(r3.punkter[1].afsnit[0].tekst, "Ingen.");

console.log("parsePdf: alle tjek bestået");
