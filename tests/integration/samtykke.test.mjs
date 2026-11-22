// Samtykket til mails: fluebenet i tilmeldingen er valgfrit og gælder først, når linket i mailen er brugt, og i Min avis kan
// man sige ja og nej hver for sig. Kører på en kopi af api/ med sin egen SQLite-database. Kræver php på stien.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const ROD = join(import.meta.dirname, "..", "..");
const PORT = await new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const API = `http://127.0.0.1:${PORT}/api/`;
const SITE = mkdtempSync(join(tmpdir(), "sagsvagt-samt-"));
let php;

const kaldPhp = (kode) => execFileSync("php", ["-r", kode], { cwd: join(SITE, "api") }).toString();
const sql = (s) => JSON.parse(kaldPhp(`$p = new PDO('sqlite:' . getcwd() . '/../db.sqlite'); echo json_encode($p->query(${JSON.stringify(s)})->fetchAll(PDO::FETCH_ASSOC));`));
const post = (sti, data = {}, cookie = "") => fetch(API + sti, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api", cookie }, body: JSON.stringify(data) });
const KODE = "prøve-kode-" + PORT;
const tilmeld = (email, mere) => post("tilmeld.php", { email, fornavn: "Test", efternavn: "Testesen", kommuner: "København", adgangskode: KODE, ...mere });
// Mailen til adressen (ikke den, redaktionen får om den): teksten og linket
const mail = (email) => readdirSync(join(SITE, "mails")).map((f) => readFileSync(join(SITE, "mails", f), "utf8")).filter((m) => m.startsWith(`To: ${email}\r\n`))
  .map((m) => Buffer.from(m.split(/Content-Transfer-Encoding: base64\r?\n\r?\n/)[1].split("--")[0], "base64").toString()).at(-1);
const link = (email) => mail(email).match(/http\S+bekraeft\.php\?t=[^\s"<]+/)[0];
const bekraeft = (email) => fetch(link(email), { method: "POST", redirect: "manual" });
const kan = (hvad, email) => sql(`SELECT COUNT(*) n FROM abonnenter WHERE email = '${email}' AND ${hvad}`)[0].n;
const regel = (fil, navn) => readFileSync(join(ROD, "api", fil), "utf8").match(new RegExp(`const ${navn} = "([^"]+)"`))[1];
const MANDAG = regel("_mandagsmail.php", "MM_KAN"), ANDRE = regel("_bootstrap.php", "ANDRE_KAN");

before(async () => {
  cpSync(join(ROD, "api"), join(SITE, "api"), { recursive: true, filter: (f) => !/\/_(konfig\.php|ord-[^/]*|loft|fotos)$/.test(f) });
  mkdirSync(join(SITE, "kommune")); writeFileSync(join(SITE, "kommune", "aabne.json"), JSON.stringify([{ navn: "København", slug: "koebenhavn" }]));
  writeFileSync(join(SITE, "api", "_konfig.php"), `<?php return ['site_url' => 'http://127.0.0.1:${PORT}/', 'admins' => ['a@example.test'], 'tilmeldinger_til' => 'a@example.test', 'db' => ['driver' => 'sqlite', 'fil' => __DIR__ . '/../db.sqlite'], 'mail' => ['metode' => 'fil', 'mappe' => __DIR__ . '/../mails', 'fra' => 'post@example.test', 'fra_navn' => 'Test', 'svar_til' => 'a@example.test']];`);
  php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", SITE], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(API); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("php -S startede ikke");
});
after(() => { php?.kill(); rmSync(SITE, { recursive: true, force: true }); });

test("med flueben: mandagsmail og andre informationer, men først når linket i mailen er brugt", async () => {
  const m = "ja@example.test";
  assert.equal((await tilmeld(m, { samtykke: true })).status, 200);
  assert.match(mail(m), /sagt ja til, at Sagsvagt må sende dig mandagsmailen og andre informationer/);
  assert.equal(kan(MANDAG, m) + kan(ANDRE, m), 0, "intet før bekræftelsen");
  assert.match(await (await fetch(link(m))).text(), /mandagsmail og andre informationer/);
  assert.equal((await bekraeft(m)).status, 303);
  assert.equal(kan(MANDAG, m), 1); assert.equal(kan(ANDRE, m), 1);
  const log = sql("SELECT s.svar, s.tekst, s.sted, s.tid FROM samtykker s JOIN abonnenter a ON a.id = s.abonnent_id WHERE a.email = 'ja@example.test'");
  assert.equal(log.length, 1); assert.equal(log[0].svar, "ja"); assert.equal(log[0].sted, "tilmelding"); assert.ok(log[0].tid && log[0].tekst);
});

test("uden flueben: kontoen virker, men der sendes hverken mandagsmail eller andre informationer", async () => {
  const m = "nej@example.test";
  assert.equal((await tilmeld(m, { samtykke: false })).status, 200);
  assert.match(mail(m), /ikke sagt ja til mandagsmailen/);
  assert.doesNotMatch(mail(m), /hver mandag kl\. 7/);
  assert.equal((await bekraeft(m)).status, 303);
  assert.equal(sql(`SELECT status FROM abonnenter WHERE email = '${m}'`)[0].status, "aktiv");
  assert.equal(kan(MANDAG, m), 0); assert.equal(kan(ANDRE, m), 0);
});

test("uden konto og uden flueben: bekræftelsen lover ingen mandagsmail", async () => {
  const m = "venter@example.test";
  assert.equal((await tilmeld(m, { kommuner: "Aarhus", adgangskode: "", samtykke: false })).status, 200);
  const svar = await (await bekraeft(m)).text();
  assert.match(svar, /Du får ikke mandagsmailen/);
  assert.equal(kan(MANDAG, m), 0);
});

test("en gammel side uden fluebenet giver kun mandagsmailen, og gamle tilmeldinger beholder den", async () => {
  const m = "gammel@example.test";
  await tilmeld(m); await bekraeft(m);
  assert.equal(kan(MANDAG, m), 1); assert.equal(kan(ANDRE, m), 0);
  kaldPhp(`$p = new PDO('sqlite:' . getcwd() . '/../db.sqlite'); $p->exec("UPDATE abonnenter SET samtykke = NULL WHERE email = '${m}'");`);
  assert.equal(kan(MANDAG, m), 1); assert.equal(kan(ANDRE, m), 0);
});

test("i Min avis slås mails til og fra hver for sig, og kun når man er logget ind", async () => {
  assert.equal((await post("samtykke.php", { mandag: true, andre: true })).status, 401);
  const m = "nej@example.test";
  const ind = await post("login.php", { email: m, adgangskode: KODE });
  assert.equal(ind.status, 200);
  const cookie = ind.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const mig = async () => (await (await fetch(API + "mig.php", { headers: { cookie } })).json()).mails;
  assert.deepEqual(await mig(), { mandag: false, andre: false });
  for (const [mandag, andre] of [[true, false], [false, true], [true, true], [false, false]]) {
    assert.equal((await post("samtykke.php", { mandag, andre }, cookie)).status, 200);
    assert.deepEqual(await mig(), { mandag, andre });
    assert.equal(kan(MANDAG, m), +mandag); assert.equal(kan(ANDRE, m), +andre);
  }
  assert.equal((await post("samtykke.php", { mandag: "ja" }, cookie)).status, 400);
});

test("afmelding i en mail stopper begge dele", async () => {
  const m = "ja@example.test", id = sql(`SELECT id FROM abonnenter WHERE email = '${m}'`)[0].id;
  const url = kaldPhp(`$_SERVER['REQUEST_METHOD'] = 'GET'; require '_bootstrap.php'; echo afmeld_link(${id});`);
  assert.equal((await fetch(url, { method: "POST" })).status, 200);
  assert.equal(kan(MANDAG, m), 0); assert.equal(kan(ANDRE, m), 0);
});

test("en fremmed kan ikke ændre en bekræftet persons valg ved at skrive personen op igen", async () => {
  const m = "gammel@example.test", foer = sql(`SELECT samtykke FROM abonnenter WHERE email = '${m}'`)[0].samtykke;
  assert.equal((await tilmeld(m, { samtykke: true })).status, 200);
  assert.equal(sql(`SELECT samtykke FROM abonnenter WHERE email = '${m}'`)[0].samtykke, foer);
});

test("tilmeldingen gør ingen til medlem af Sæt Dagsordenen, heller ikke hvis nogen sender det gamle felt", async () => {
  const m = "sd@example.test";
  assert.equal((await tilmeld(m, { samtykke: true, medlem: true, alder: 20 })).status, 200);
  await bekraeft(m);
  const r = sql(`SELECT medlem, medlem_venter, alder FROM abonnenter WHERE email = '${m}'`)[0];
  assert.deepEqual(r, { medlem: null, medlem_venter: null, alder: null });
  assert.ok(!readdirSync(join(SITE, "mails")).some((f) => readFileSync(join(SITE, "mails", f), "utf8").includes("kontakt@saetdagsordenen.dk")));
});

test("teksten ved fluebenet er den samme i tilmeldingen og i serverens note, og feltet er ikke sat på forhånd", () => {
  const side = readFileSync(join(ROD, "vagt.html"), "utf8"), felt = side.match(/<label class="flueben"><input type="checkbox" id="samtykke"([^>]*)> <span>([^<]+)<\/span>/);
  assert.ok(felt); assert.doesNotMatch(felt[1], /checked|required/);
  const note = readFileSync(join(ROD, "api", "_bootstrap.php"), "utf8").replace(/\n\/\/ +/g, " ");
  assert.ok(note.includes(felt[2]), "ret teksten og SAMTYKKE_TEKST i api/_bootstrap.php sammen");
  assert.doesNotMatch(side, /Sæt Dagsordenen|saetdagsordenen/i);
});
