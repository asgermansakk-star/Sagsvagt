// Radaren i Min avis (avis/naerhed.mjs): udvalgets oversigt over naboorienteringer, høringstitler og steder i nyheder
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOversigt, stedIHoering, findStedINyhed } from "../../avis/naerhed.mjs";

// Udsnit af oversigten, som pdftotext -layout skriver den (to kolonner, sidetal og orddeling)
const OVERSIGT = `
                                          Nye naboorienteringer
                                   I perioden 6. oktober 2026 – 26. oktober 2026

Periode for na-   Teglholmsgade 41 (S2026-6795)
boorientering:    Lokalplan: 310-3 'Teglværkshavnen Tillæg 3'

12-10-2026-       Frist: 9. november 2026 - Af hensyn til sagens videre forløb beder forvaltningen om en tilbage-
05-11-2026        melding senest denne dato, hvis der er spørgsmål til sagen eller et ønske om politisk behandling.

                  Dispensationens indhold
                  Ansøgning om at opføre etageboliger i op til 6 etager. Matriklen har et areal på 27.216 m².

                  En tilladelse forudsætter dispensation fra lokalplanens bestemmelser om
                                                                                                                  3/14
                             Naboorienteringer under sagsbehandling
Oversigten viser status på naboorienteringer, som udvalget allerede er informeret om.

Periode for na-    Møntmestervej 29 (S2026-5902)
boorientering:     Lokalplan: 581 ’Rentemestervej’

29-09-2026-        Forvaltningen har fortsat sagsbehandlingen efter fristen den 26. oktober 2026, da der ikke blev til-
20-10-2026         kendegivet ønske om politisk behandling af sagen.

4 høringssvar      Dispensationens indhold
                   Ansøgning om at opføre en døgninstitution. Bygningen vil indeholde boliger til 21 borgere.

                                   Meddelte lokalplandispensationer
Dispensations-     Gunhildsgade 1 (S2026-4858)
dato: 26-10-       Lokalplan: 292 'Vibekevang'
2026
                   Dispensationens indhold
                   Tilladelse til at udskifte to eksisterende kældervinduer på den bevaringsværdige bygning. Tilladel-
                   sen kræver dispensation.
`;

test("parseOversigt finder sagerne i alle tre afsnit", () => {
  const l = parseOversigt(OVERSIGT);
  assert.deepEqual(l.map((x) => [x.sagsnr, x.adresse, x.sektion]), [
    ["S2026-6795", "Teglholmsgade 41", "naboorientering"],
    ["S2026-5902", "Møntmestervej 29", "behandles"],
    ["S2026-4858", "Gunhildsgade 1", "dispensation"],
  ]);
});

test("parseOversigt læser lokalplan, frist, periode, høringssvar og indhold", () => {
  const [ny, behandles, givet] = parseOversigt(OVERSIGT);
  assert.equal(ny.lokalplan, "310-3 'Teglværkshavnen Tillæg 3'");
  assert.equal(ny.frist, "2026-11-09");
  assert.deepEqual(ny.periode, ["2026-10-12", "2026-11-05"]);
  assert.match(ny.indhold, /^Ansøgning om at opføre etageboliger/);
  assert.doesNotMatch(ny.indhold, /forudsætter/);
  assert.equal(behandles.hoeringssvar, 4);
  assert.equal(behandles.lokalplan, "581 'Rentemestervej'");
  assert.match(behandles.status, /efter fristen den 26\. oktober 2026, da der ikke blev tilkendegivet ønske om politisk behandling af sagen\.$/);
  assert.equal(givet.dispensationsdato, "2026-10-26");
  assert.match(givet.indhold, /Tilladelsen kræver dispensation\.$/); // orddelingen "Tilladel-/sen" er samlet
});

test("stedIHoering finder stedet i titlen på en lokalplanhøring", () => {
  assert.equal(stedIHoering("Tillæg 4 til Ny Ellebjerg-området – forslag til lokalplan"), "Ny Ellebjerg");
  assert.equal(stedIHoering("Lokalplan Middelgrundsvej 3 - Forslag til lokalplan"), "Middelgrundsvej 3");
  assert.equal(stedIHoering("Tillæg 2 lokalplan 390 Kildebrøndevej – forslag lokalplan"), "Kildebrøndevej");
  assert.equal(stedIHoering("Revideret lokalplan Jernbanebyen mm - forslag til lokalplan"), "Jernbanebyen");
});

test("findStedINyhed tager det længste hele stednavn og springer bydele over", () => {
  const navne = ["Christianshavn", "Christianshavns Torv", "Torvet", "Vesterbro Ny Skole"];
  assert.equal(findStedINyhed("Massive problemer på Christianshavns Torv i nat", navne), "Christianshavns Torv");
  assert.equal(findStedINyhed("Nyt fra Christianshavn", navne), null);
  assert.equal(findStedINyhed("Torvetsalg", navne), null);
});
