// Fælles hjælpere til hentningerne (avis/moedekilder.mjs) og PDF-parserens eget selvtjek (avis/tjek-parsepdf.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { slug, datoTekst, isoDato, afkod, tilTekst, linje, renUdvalg, sammeUdvalg, afsnitTitel } from "../../avis/moedekilder.mjs";

test("slug laver æ, ø og å om og fjerner tegn", () => {
  assert.equal(slug("Københavns Kommune"), "koebenhavns-kommune");
  assert.equal(slug("Ærø – Åbenrå!"), "aeroe-aabenraa");
});

test("datoTekst og isoDato er hinandens modsætning", () => {
  assert.equal(datoTekst("2026-10-28"), "28. oktober 2026");
  assert.equal(isoDato(3, "Februar", 2027), "2027-02-03");
});

test("afkod og tilTekst", () => {
  assert.equal(afkod("K&oslash;benhavn &amp; &#229;en &#x2013;"), "København & åen –");
  assert.equal(tilTekst("<p>Et</p><ul><li>to</li><li>tre</li></ul><script>x()</script>"), "Et\n\n• to\n\n• tre");
  assert.equal(linje("<h2>  Punkt\n 3 </h2>"), "Punkt 3");
});

test("renUdvalg fjerner forkortelse og valgperiode", () => {
  assert.equal(renUdvalg("Økonomiudvalget (ØK) (26-29)"), "Økonomiudvalget");
  assert.equal(renUdvalg("Kommunalbestyrelsen 2026-2029"), "Kommunalbestyrelsen");
  assert.ok(sammeUdvalg("Økonomiudvalget (ØK)", "økonomiudvalget"));
});

test("afsnitTitel skelner dette møde fra tidligere behandlinger", () => {
  assert.equal(afsnitTitel("Beslutning", "Økonomiudvalget"), "Beslutning");
  assert.equal(afsnitTitel("Beslutning i Økonomiudvalget", "Økonomiudvalget (ØK)"), "Beslutning");
  assert.equal(afsnitTitel("Beslutning i Teknik- og Miljøudvalget den 02-09-2026", "Økonomiudvalget"), "Behandling i Teknik- og Miljøudvalget 2. september 2026");
  assert.equal(afsnitTitel("Resume", "x"), "Resumé");
});

test("PDF-parserens selvtjek består", () => {
  const ud = execFileSync(process.execPath, [join(import.meta.dirname, "..", "..", "avis", "tjek-parsepdf.mjs")], { encoding: "utf8" });
  assert.match(ud, /alle tjek bestået/);
});
