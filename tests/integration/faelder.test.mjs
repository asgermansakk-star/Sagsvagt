// Fælder (honeypot): det usynlige felt i formularerne og fælde-adresserne som /wp-login.php. Kører på en kopi af api/ og
// fældefilerne med sin egen SQLite-database. Alle kald kommer fra 127.0.0.1, så testene kører i rækkefølge: først felterne,
// så fælde-adresserne og til sidst spærringen. Kræver php på stien.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const ROD = join(import.meta.dirname, "..", "..");
const PORT = await new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const URL_ = `http://127.0.0.1:${PORT}/`;
const SITE = mkdtempSync(join(tmpdir(), "sagsvagt-faelder-"));
const FAELDER = ["wp-login.php", "xmlrpc.php", "phpinfo.php", "wp-admin/install.php", "wp-admin/setup-config.php"];
let php;

const kaldPhp = (kode) => execFileSync("php", ["-r", kode], { cwd: join(SITE, "api") }).toString();
const sql = (s) => JSON.parse(kaldPhp(`$p = new PDO('sqlite:' . getcwd() . '/../db.sqlite'); echo json_encode($p->query(${JSON.stringify(s)})->fetchAll(PDO::FETCH_ASSOC));`));
const post = (sti, data = {}) => fetch(URL_ + "api/" + sti, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: JSON.stringify(data) });
const mails = () => (existsSync(join(SITE, "mails")) ? readdirSync(join(SITE, "mails")).length : 0);
const tilmeld = (email, mere) => post("tilmeld.php", { email, fornavn: "Test", efternavn: "Testesen", kommuner: "København", adgangskode: "en-lang-testkode-123", ...mere });
const antal = (hvad) => sql(`SELECT COUNT(*) n FROM faelder WHERE hvad = '${hvad}'`)[0].n;

before(async () => {
  cpSync(join(ROD, "api"), join(SITE, "api"), { recursive: true, filter: (f) => !/\/_(konfig\.php|ord-[^/]*|loft|fotos)$/.test(f) });
  mkdirSync(join(SITE, "wp-admin"));
  for (const f of FAELDER) cpSync(join(ROD, f), join(SITE, f));
  mkdirSync(join(SITE, "kommune")); writeFileSync(join(SITE, "kommune", "aabne.json"), JSON.stringify([{ navn: "København", slug: "koebenhavn" }]));
  writeFileSync(join(SITE, "api", "_konfig.php"), `<?php return ['site_url' => '${URL_}', 'admins' => ['a@example.test'], 'tilmeldinger_til' => 'a@example.test', 'db' => ['driver' => 'sqlite', 'fil' => __DIR__ . '/../db.sqlite'], 'mail' => ['metode' => 'fil', 'mappe' => __DIR__ . '/../mails', 'fra' => 'post@example.test', 'fra_navn' => 'Test', 'svar_til' => 'a@example.test']];`);
  php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", SITE], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL_ + "api/"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("php -S startede ikke");
});
after(() => { php?.kill(); rmSync(SITE, { recursive: true, force: true }); });

test("udfyldt usynligt felt i tilmeldingen: svaret ligner succes, men intet gemmes eller sendes", async () => {
  const foer = mails();
  const r = await tilmeld("robot@example.test", { sv_felt: "http://spam.example" });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(sql("SELECT COUNT(*) n FROM abonnenter WHERE email = 'robot@example.test'")[0].n, 0);
  assert.equal(mails(), foer, "ingen mail");
  assert.equal(antal("felt:tilmeld.php"), 1);
  const log = sql("SELECT ip, agent, tid FROM faelder")[0];
  assert.equal(log.ip, "127.0.0.1"); assert.ok(log.tid > 0);
});

test("tomt usynligt felt: tilmeldingen virker som før", async () => {
  const r = await tilmeld("menneske@example.test", { sv_felt: "" });
  assert.equal(r.status, 200);
  assert.equal(sql("SELECT COUNT(*) n FROM abonnenter WHERE email = 'menneske@example.test'")[0].n, 1);
});

test("feltet virker også i indlæg, glemt kode, Erhverv og fotos (multipart)", async () => {
  const foer = mails();
  for (const sti of ["indlaeg.php", "glemt.php", "erhverv-book.php", "erhverv-proeve.php"]) {
    const r = await post(sti, { email: "menneske@example.test", firma: "X", sv_felt: "x" });
    assert.equal(r.status, 200, sti); assert.equal(antal("felt:" + sti), 1, sti);
  }
  const fd = new FormData(); fd.set("navn", "Robot"); fd.set("email", "robot@example.test"); fd.set("sv_felt", "x");
  const r = await fetch(URL_ + "api/foto.php", { method: "POST", headers: { "X-Sagsvagt": "api" }, body: fd });
  assert.equal(r.status, 200); assert.equal(antal("felt:foto.php"), 1);
  assert.equal(mails(), foer, "ingen mails");
  assert.equal(sql("SELECT COUNT(*) n FROM forsoeg WHERE noegle LIKE 'faelde:%'")[0].n, 0, "felterne alene spærrer ikke");
});

test("fælde-adresserne svarer 404 og logges", async () => {
  for (const f of ["wp-login.php", "xmlrpc.php", "phpinfo.php", "wp-admin/install.php", "wp-admin/setup-config.php"]) {
    const kode = readFileSync(join(ROD, f), "utf8");
    assert.match(kode, /_faelde\.php/); assert.ok(kode.length < 200, f);
  }
  const r = await fetch(URL_ + "wp-login.php", { headers: { "User-Agent": "Testrobot/1.0" } });
  assert.equal(r.status, 404); assert.match(await r.text(), /Siden findes ikke/);
  assert.equal(antal("adresse:/wp-login.php"), 1);
  assert.equal(sql("SELECT agent FROM faelder WHERE hvad = 'adresse:/wp-login.php'")[0].agent, "Testrobot/1.0");
  assert.equal((await tilmeld("efter-en@example.test")).status, 200, "ét besøg spærrer ikke");
});

test("to besøg på fælder på et døgn: IP-adressen afvises på formularer og login", async () => {
  assert.equal((await fetch(URL_ + "wp-admin/install.php")).status, 404);
  assert.equal(antal("adresse:/wp-admin/install.php"), 1);
  assert.equal((await tilmeld("efter-to@example.test")).status, 403);
  assert.equal((await post("login.php", { email: "menneske@example.test", adgangskode: "x" })).status, 403);
  const fd = new FormData(); fd.set("navn", "X");
  assert.equal((await fetch(URL_ + "api/foto.php", { method: "POST", headers: { "X-Sagsvagt": "api" }, body: fd })).status, 403);
  assert.equal(sql("SELECT COUNT(*) n FROM abonnenter WHERE email = 'efter-to@example.test'")[0].n, 0);
  // Efter et døgn er spærringen væk (forsøgene tælles kun det sidste døgn)
  sql("UPDATE forsoeg SET tid = tid - 86401 WHERE noegle LIKE 'faelde:%'");
  assert.equal((await tilmeld("dagen-efter@example.test")).status, 200);
});

test("loggen slettes efter to døgn", async () => {
  sql("INSERT INTO faelder (ip, hvad, agent, tid) VALUES ('10.0.0.1', 'adresse:/gammel', '', 1)");
  await fetch(URL_ + "xmlrpc.php");
  assert.equal(antal("adresse:/gammel"), 0);
  assert.equal(antal("adresse:/xmlrpc.php"), 1);
});
