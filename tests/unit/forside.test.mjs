// Papirforsidens dele (avis/forside.mjs): de skal altid kunne bygges, også uden høring, opslag eller kommende sager
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { forsideDele, dagensSag } from "../../avis/forside.mjs";

const ROD = join(import.meta.dirname, "..", "..");
const H = {
  esc: (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
  hvorNavn: (u) => u, erLokaludvalg: (u) => /Lokaludvalg/.test(u), billedeSti: (s) => s.billede || "assets/emner/budget.jpg",
};
const sag = (id, mere = {}) => ({ id, url: `sag/${id}.html`, titel: `Sag ${id}`, dato: "2026-11-17", status: "besluttet", udvalg: "Økonomiudvalget", vaegt: 1, score: 1, emner: ["budget"], udfald: "", ...mere });
const idag = "2026-11-22";
const valg = {
  collager: [{ hoering: "330", sag: "h", billede: "assets/nyt/luftfoto.webp", bredde: 1000, hoejde: 656, alt: "Luftfoto", tekst: "Jernbanebyen" }],
  opslag: [{ sag: "a", billeder: ["assets/nyt/stormflod-1.webp"], alt: ["Stormflod"] }],
};
const kommer = sag("a", { status: "kommer", dato: "2026-11-26" });

test("Dagens sag er en kommende sag med opslag, ellers den vigtigste kommende, ellers tophistorien", () => {
  const vigtig = sag("b", { status: "kommer", dato: "2026-11-27", vaegt: 9 }), top = sag("t");
  assert.equal(dagensSag({ sager: [vigtig, kommer], top, idag, valg }).id, "a");
  assert.equal(dagensSag({ sager: [vigtig, kommer], top, idag, valg: {} }).id, "b");
  assert.equal(dagensSag({ sager: [sag("x"), sag("y", { status: "kommer", dato: "2026-11-01" })], top, idag, valg }).id, "t");
});

test("collagen viser den åbne høring og forsvinder, når fristen er gået", () => {
  const hoeringer = [{ id: "330", frist: "2026-12-15", aaben: true, url: "https://blivhoert.kk.dk/hearing/330" }];
  const a = forsideDele({ sager: [kommer, sag("h")], gitter: [sag("c")], top: sag("t"), idag, hoeringer, valg, H }).collage;
  assert.match(a, /Høring til 15\. dec\./); assert.match(a, /href="\/sag\/h\.html"/);
  const b = forsideDele({ sager: [kommer], gitter: [sag("c", { billede: "assets/stedkort/101-valby.jpg" })], top: sag("t"), idag: "2026-12-16", hoeringer, valg, H }).collage;
  assert.doesNotMatch(b, /Høring/); assert.match(b, /riv-foto/); assert.match(b, /OpenStreetMap/);
  // Findes sagen ikke længere, peger mærkatet på høringen hos kommunen
  assert.match(forsideDele({ sager: [kommer], gitter: [], top: null, idag, hoeringer, valg, H }).collage, /blivhoert\.kk\.dk\/hearing\/330/);
});

test("uden opslag vises sagens eget billede, og teksten er escapet (ingen server-direktiver)", () => {
  const farlig = sag("z", { titel: '<!--#exec cmd="ls" --><b>', status: "kommer", dato: "2026-11-24" });
  const { sager } = forsideDele({ sager: [farlig], gitter: [], top: null, idag, valg: {}, H });
  assert.match(sager, /dagens-billede/); assert.doesNotMatch(sager, /<!--#/); assert.doesNotMatch(sager, /<b>(?!DAGENS|FRA)/);
});

test("højst seks sager, to pr. udvalg og én pr. lokaludvalg, og aldrig Dagens sag igen", () => {
  const mange = [...Array(5)].flatMap((_, i) => [sag(`o${i}`, { score: i }), sag(`l${i}`, { udvalg: "Valby Lokaludvalg", score: 20 + i }), sag(`u${i}`, { udvalg: `Udvalg ${i}` })]);
  const { sager } = forsideDele({ sager: [kommer, ...mange], gitter: [kommer, ...mange], top: mange[0], idag, valg, H });
  assert.equal(sager.match(/<article/g).length, 6);
  assert.equal(sager.match(/Valby Lokaludvalg/g).length, 1);
  assert.equal(sager.match(/<h3><a href="\/sag\/o\d/g)?.length, 2);
  assert.doesNotMatch(sager, /<h3><a href="\/sag\/a\.html/);
});

test("ingen sager giver tomme dele uden fejl", () => {
  assert.deepEqual(forsideDele({ sager: [], gitter: [], top: null, idag, valg: {}, H }), { collage: "", sager: "" });
});

test("billederne i avis/forside.json findes, og vagt.html henter delene", async () => {
  const v = JSON.parse(await readFile(join(ROD, "avis", "forside.json"), "utf8"));
  for (const b of [...v.collager.map((c) => c.billede), ...v.opslag.flatMap((o) => o.billeder)]) await access(join(ROD, b));
  const vagt = await readFile(join(ROD, "vagt.html"), "utf8");
  for (const n of ["collage", "sager"]) assert.ok(vagt.includes(`<!--#include virtual="/del/forside-${n}.html" -->`));
});
