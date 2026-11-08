// Emner, afstemninger, høringer og "Kort fortalt" (avis/beriget.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { emnerFor, deltagere, stemmetal, afstemninger, hoeringsfrist, iHoering, forklar, indstillingPunkter, videreTil } from "../../avis/beriget.mjs";

test("emnerFor finder emner, også inde i sammensatte ord", () => {
  assert.deepEqual(emnerFor("Ny supercykelsti langs søerne"), ["trafik"]);
  assert.ok(emnerFor("Budget 2027 for skoler").includes("skole"));
  assert.ok(emnerFor("Budget 2027 for skoler").includes("budget"));
});

test("emnerFor tæller ikke udvalgets navn med", () => {
  assert.deepEqual(emnerFor("Klima-, Miljø- og Teknikudvalget godkender referatet"), []);
});

test("korte ord matches kun som hele ord", () => {
  assert.ok(emnerFor("Ny bus til Valby").includes("trafik"));
  assert.ok(!emnerFor("Busker i bylivet").includes("trafik"));
});

test("deltagere oversætter partibogstaver", () => {
  assert.deepEqual(deltagere("Ø, F, A og V."), [
    { b: "Ø", navn: "Enhedslisten" }, { b: "F", navn: "SF" }, { b: "A", navn: "Socialdemokratiet" }, { b: "V", navn: "Venstre" },
  ]);
  assert.deepEqual(deltagere("0"), [{ b: "O", navn: "Dansk Folkeparti" }]);
});

test("stemmetal: vedtaget har flest for, forkastet flest imod, uanset rækkefølge", () => {
  assert.deepEqual(stemmetal("Indstillingen blev godkendt med 37 stemmer mod 17. 1 undlod at stemme."), { for: 37, imod: 17, undlod: 1 });
  assert.deepEqual(stemmetal("Forslaget blev forkastet med 50 stemmer mod 3."), { for: 3, imod: 50, undlod: null });
  assert.deepEqual(stemmetal("Forslaget blev forkastet med 2 stemmer mod 9. Ingen undlod."), { for: 2, imod: 9, undlod: 0 });
  assert.equal(stemmetal("Godkendt uden afstemning."), null);
});

test("afstemninger læser lister over for og imod", () => {
  const r = afstemninger("Ændringsforslaget blev forkastet med 1 stemme mod 7.\nFor stemte: I\nImod stemte: A, B og F\nUndlod at stemme: Ingen");
  assert.equal(r.length, 1);
  assert.equal(r[0].vandt, "imod");
  assert.deepEqual(r[0].for.map((d) => d.b), ["I"]);
  assert.deepEqual(r[0].imod.map((d) => d.b), ["A", "B", "F"]);
  assert.deepEqual(r[0].undlod, []);
});

test("hoeringsfrist finder datoen i flere skrivemåder", () => {
  assert.equal(hoeringsfrist("Høringsfristen er den 28. oktober 2026."), "2026-10-28");
  assert.equal(hoeringsfrist("Høringsfrist: 3. august 2026"), "2026-08-03");
  assert.equal(hoeringsfrist("Ingen frist her."), "");
});

test("iHoering genkender sager, der sendes i høring", () => {
  assert.ok(iHoering("Forslaget sendes i offentlig høring i 8 uger."));
  assert.ok(!iHoering("Høringssvarene er behandlet."));
});

test("forklar sætter højst én forklaring pr. ord og aldrig i links", () => {
  const esc = (s) => s.replace(/"/g, "&quot;");
  const ud = forklar('<p>Lokalplanen og lokalplanen igen. <a href="x">lokalplan</a></p>', esc);
  assert.equal((ud.match(/<dfn/g) || []).length, 1);
  assert.match(ud, /<a href="x">lokalplan<\/a>/);
});

test("forklar respekterer loftet over forklaringer", () => {
  const ud = forklar("<p>indstilling, lokalplan, kommuneplan, dispensation, servitut</p>", (s) => s, 2);
  assert.equal((ud.match(/<dfn/g) || []).length, 2);
});

test("indstillingPunkter og videreTil", () => {
  const tekst = "Forvaltningen indstiller, at udvalget over for Økonomiudvalget og Borgerrepræsentationen anbefaler,\n• at godkende en anlægsbevilling på 2 mio. kr.,\n• at sende planen i høring";
  assert.deepEqual(indstillingPunkter(tekst), ["Godkende en anlægsbevilling på 2 mio. kr.", "Sende planen i høring"]);
  assert.equal(videreTil(tekst), "Økonomiudvalget og Borgerrepræsentationen");
});
