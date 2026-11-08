// Det byggede site hænger sammen: data, sider og links (robotten committer de byggede sider, så de ligger i repoet)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..", "..");
const json = (...p) => JSON.parse(readFileSync(join(ROD, ...p), "utf8"));
// Sidens adresse står i url (sag/<slug>.html); id kan have æ, ø og å
const side = (s) => join(ROD, s.url);

test("hver sag i København har sin egen side og sit fragment til Min avis", () => {
  const { sager } = json("assets", "sager.json");
  assert.ok(sager.length > 100);
  const mangler = sager.filter((s) => !existsSync(side(s)) || !existsSync(join(ROD, "assets", "sager", s.url.replace(/^sag\//, ""))));
  assert.deepEqual(mangler.map((s) => s.url), []);
});

test("hver åben kommune har en forside og en sager.json med sider", () => {
  const aabne = json("kommune", "aabne.json");
  assert.ok(aabne.length > 50);
  for (const { slug } of aabne) {
    if (slug === "koebenhavn") continue;
    assert.ok(existsSync(join(ROD, "kommune", `${slug}.html`)), `kommune/${slug}.html mangler`);
    const { sager } = json("kommune", slug, "sager.json");
    for (const s of sager) assert.ok(existsSync(side(s)), `${s.url} mangler`);
  }
});

test("kommunelisterne i avis/ er gyldige", () => {
  const kommuner = json("avis", "kommuner.json");
  assert.equal(new Set(kommuner.map((k) => k.slug)).size, kommuner.length, "to kommuner med samme slug");
  for (const k of json("avis", "firstagenda.json")) assert.ok(k.slug && k.kommune && /^https:\/\//.test(k.base), JSON.stringify(k));
});

test("ingen døde interne links på det byggede site", () => {
  const ud = execFileSync(process.execPath, [join(ROD, "avis", "linktjek.mjs")], { encoding: "utf8" });
  assert.match(ud, / 0 døde mål/);
});
