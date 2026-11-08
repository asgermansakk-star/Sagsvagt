// PHP-API'et sammen med de data, robotten bygger: ordindekset (avis/ordindeks.mjs) → api/soeg.php → sagssiderne,
// og mandagsmailen, som serveren (PHP) og browseren (JavaScript) skal lave tegn for tegn ens. Kræver php på stien.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROD = join(import.meta.dirname, "..", "..");
const PORT = 4410;
const API = `http://127.0.0.1:${PORT}/`;
let php;

before(async () => {
  execFileSync(process.execPath, [join(ROD, "avis", "ordindeks.mjs")], { stdio: "ignore" });
  php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", join(ROD, "api")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(API); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("php -S startede ikke");
});
after(() => php?.kill());

test("alle PHP-filer i api/ kan læses af PHP", () => {
  const filer = ["", "admin"].flatMap((d) => readdirSync(join(ROD, "api", d)).filter((f) => f.endsWith(".php")).map((f) => join(ROD, "api", d, f)));
  assert.ok(filer.length > 20);
  for (const f of filer) execFileSync("php", ["-l", f], { stdio: "pipe" });
});

test("søgning i hele sagsteksten finder sager, der nævner ordet", async () => {
  const sager = JSON.parse(readFileSync(join(ROD, "assets", "sager.json"), "utf8")).sager;
  const svar = await fetch(`${API}soeg.php?k=koebenhavn&q=skole`);
  assert.equal(svar.status, 200);
  const { n, i } = await svar.json();
  assert.equal(n, sager.length, "indekset og sager.json skal være fra samme kørsel");
  assert.ok(i.length > 0);
  for (const nr of i.slice(0, 10)) {
    assert.ok(nr >= 0 && nr < sager.length);
    const side = readFileSync(join(ROD, sager[nr].url), "utf8").toLowerCase();
    assert.ok(side.includes("skol"), `${sager[nr].id} nævner ikke skole`);
  }
});

test("søgning med flere ord og ukendt kommune", async () => {
  const svar = await (await fetch(`${API}soeg.php?k=koebenhavn&o=${encodeURIComponent("skole|cykelsti")}`)).json();
  assert.deepEqual(Object.keys(svar.o), ["skole", "cykelsti"]);
  const ukendt = await fetch(`${API}soeg.php?k=findes-ikke&q=skole`);
  assert.equal(ukendt.status, 404);
});

test("mandagsmailen er ens fra PHP og JavaScript", () => {
  const ud = execFileSync(process.execPath, [join(ROD, "avis", "tjek-mandagsmail.mjs")], { encoding: "utf8" });
  assert.match(ud, /^Ens:/m);
});
