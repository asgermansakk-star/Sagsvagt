// Spørgeskemaet: kun dem, der har brugt Sagsvagt i over en måned og sagt ja til andre mails, får det; linket er personligt;
// svar gemmes kun for kendte spørgsmål og erstattes, hvis man svarer igen; sletter man kontoen, beholdes svarene uden person.
// Kører på en kopi af api/ med sin egen SQLite-database. Kræver php på stien.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const ROD = join(import.meta.dirname, "..", "..");
const PORT = await new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const URL_ = `http://127.0.0.1:${PORT}/`;
const SITE = mkdtempSync(join(tmpdir(), "sagsvagt-spoerg-"));
let php, cookie = "";

const kaldPhp = (kode) => execFileSync("php", ["-r", kode], { cwd: join(SITE, "api") }).toString();
const PDO = "$p = new PDO('sqlite:' . getcwd() . '/../db.sqlite');";
const sql = (s) => JSON.parse(kaldPhp(`${PDO} echo json_encode($p->query(${JSON.stringify(s)})->fetchAll(PDO::FETCH_ASSOC));`));
const koer = (s) => kaldPhp(`${PDO} $p->exec(${JSON.stringify(s)});`);
const post = (sti, data = {}) => fetch(URL_ + "api/" + sti, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api", cookie }, body: JSON.stringify(data) });
const admin = (data) => post("admin/spoergeskema.php", data).then((r) => r.json());
const mails = () => (existsSync(join(SITE, "mails")) ? readdirSync(join(SITE, "mails")).map((f) => readFileSync(join(SITE, "mails", f), "utf8")) : []);
const tekst = (m) => Buffer.from(m.split(/Content-Transfer-Encoding: base64\r?\n\r?\n/)[1].split("--")[0], "base64").toString();
const linkTil = (email) => tekst(mails().filter((m) => m.startsWith(`To: ${email}\r\n`)).at(-1)).match(/spoergeskema\.html\?id=(\d+)&t=([a-f0-9]+)/);
// Adgangskoden hashes i PHP og sættes med et forberedt kald (en hash indeholder $, som PHP ellers ville læse som variabler)
const saetKode = (email, kode) => kaldPhp(`${PDO} $p->prepare("UPDATE abonnenter SET status = 'aktiv', adgangskode = ? WHERE email = ?")->execute([password_hash(${JSON.stringify(kode)}, PASSWORD_DEFAULT), ${JSON.stringify(email)}]);`);
const dage = (n) => new Date(Date.now() - n * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
const id = (email) => sql(`SELECT id FROM abonnenter WHERE email = '${email}'`)[0].id;
// En læser: bekræftet for $alder dage siden med samtykke $samtykke
const laeser = (email, alder, samtykke, mere = "") =>
  koer(`INSERT INTO abonnenter (email, kommuner, status, oprettet, bekraeftet, samtykke${mere ? ", mail_afmeldt" : ""}) VALUES ('${email}', 'København', 'tilmeldt', '${dage(alder)}', '${dage(alder)}', ${samtykke === null ? "NULL" : `'${samtykke}'`}${mere ? `, '${dage(1)}'` : ""})`);

before(async () => {
  cpSync(join(ROD, "api"), join(SITE, "api"), { recursive: true, filter: (f) => !/\/_(konfig\.php|ord-[^/]*|loft|fotos)$/.test(f) });
  mkdirSync(join(SITE, "kommune")); writeFileSync(join(SITE, "kommune", "aabne.json"), JSON.stringify([{ navn: "København", slug: "koebenhavn" }]));
  writeFileSync(join(SITE, "api", "_konfig.php"), `<?php return ['site_url' => '${URL_}', 'admins' => ['a@example.test'], 'tilmeldinger_til' => 'a@example.test', 'db' => ['driver' => 'sqlite', 'fil' => __DIR__ . '/../db.sqlite'], 'mail' => ['metode' => 'fil', 'mappe' => __DIR__ . '/../mails', 'fra' => 'post@example.test', 'fra_navn' => 'Test', 'svar_til' => 'a@example.test']];`);
  php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", SITE], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL_ + "api/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  // Redaktøren: en aktiv konto med adgangskode, logget ind
  await post("login.php", { email: "x@example.test", adgangskode: "x" }); // opretter tabellerne
  koer(`INSERT INTO abonnenter (email, kommuner, status, oprettet, bekraeftet, samtykke) VALUES ('a@example.test', '', 'aktiv', '${dage(90)}', '${dage(90)}', 'ja')`);
  saetKode("a@example.test", "redaktoer-kode-1");
  const r = await post("login.php", { email: "a@example.test", adgangskode: "redaktoer-kode-1" });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  laeser("gammel-ja@example.test", 45, "ja");
  laeser("gammel-andre@example.test", 31, "andre");
  laeser("ny-ja@example.test", 10, "ja");                     // under en måned
  laeser("gammel-mandag@example.test", 60, null);              // kun ja til mandagsmailen (fra før 22/11)
  laeser("gammel-nej@example.test", 60, "nej");
  laeser("gammel-afmeldt@example.test", 60, "ja", "afmeldt");  // afmeldt i en mail
});
after(() => { php?.kill(); rmSync(SITE, { recursive: true, force: true }); });

test("kun læsere over en måned med ja til andre mails kan få spørgeskemaet", async () => {
  const s = await admin({ handling: "status" });
  // a@example.test (redaktøren, 90 dage, ja) tæller også med
  assert.equal(s.kan_faa, 3); assert.equal(s.kun_mandag, 1); assert.equal(s.sendt, 0); assert.equal(s.svar, 0);
});

test("prøven går kun til redaktøren og tæller ikke som sendt", async () => {
  const foer = mails().length;
  const j = await admin({ handling: "proeve" });
  assert.equal(j.sendt_til, "a@example.test");
  assert.equal(mails().length, foer + 1);
  assert.match(mails().at(-1), /^To: a@example\.test/);
  assert.equal((await admin({ handling: "status" })).sendt, 0);
});

test("send: én mail pr. læser med personligt link og afmelding, og ingen får den to gange", async () => {
  const j = await admin({ handling: "send" });
  assert.equal(j.sendt_nu, 3); assert.equal(j.kan_faa, 0); assert.equal(j.sendt, 3);
  for (const m of ["gammel-ja@example.test", "gammel-andre@example.test"]) {
    const mail = mails().filter((x) => x.startsWith(`To: ${m}\r\n`));
    assert.equal(mail.length, 1, m);
    assert.match(mail[0], /List-Unsubscribe: <http[^>]+afmeld\.php/);
    assert.equal(+linkTil(m)[1], id(m));
  }
  for (const m of ["ny-ja", "gammel-mandag", "gammel-nej", "gammel-afmeldt"]) assert.equal(mails().filter((x) => x.startsWith(`To: ${m}@example.test\r\n`)).length, 0, m);
  assert.equal((await admin({ handling: "send" })).sendt_nu, 0);
});

test("svar: kræver det rigtige link, gemmer kun kendte valg og erstattes, hvis man svarer igen", async () => {
  const [, lid, t] = linkTil("gammel-ja@example.test");
  assert.equal((await post("spoergeskema.php", { id: lid, t: "0".repeat(32), svar: { rammer: 4 } })).status, 400);
  assert.equal((await post("spoergeskema.php", { id: String(+lid + 1), t, svar: { rammer: 4 } })).status, 400, "et andet id med samme t");
  assert.equal((await post("spoergeskema.php", { id: lid, t, svar: { kontakt: true } })).status, 400, "kun flueben er ikke et svar");
  const r = await post("spoergeskema.php", { id: lid, t, svar: { brug: ["mandagsmail", "hack", "soeg"], hyppighed: "hver_uge", rammer: "4", anbefal: 11, rolle: "konge", mangler: "  Flere kommuner  ", kontakt: true, ekstra: "x" } });
  assert.equal(r.status, 200); assert.equal((await r.json()).igen, false);
  const gemt = sql("SELECT svar, abonnent_id FROM spoergeskema_svar");
  assert.equal(gemt.length, 1);
  assert.deepEqual(JSON.parse(gemt[0].svar), { brug: ["mandagsmail", "soeg"], hyppighed: "hver_uge", rammer: 4, mangler: "Flere kommuner", kontakt: true });
  const igen = await post("spoergeskema.php", { id: lid, t, svar: { anbefal: 9, mangler: "Kort over sager" } });
  assert.equal((await igen.json()).igen, true);
  assert.equal(sql("SELECT COUNT(*) n FROM spoergeskema_svar")[0].n, 1);
  assert.deepEqual(JSON.parse(sql("SELECT svar FROM spoergeskema_svar")[0].svar), { anbefal: 9, mangler: "Kort over sager" });
});

test("udfyldt usynligt felt: ser ud til at virke, men intet gemmes", async () => {
  const [, lid, t] = linkTil("gammel-andre@example.test");
  const r = await post("spoergeskema.php", { id: lid, t, svar: { rammer: 2 }, sv_felt: "http://spam" });
  assert.equal(r.status, 200);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id = ${lid}`)[0].n, 0);
});

test("redaktionen ser svarene talt op, NPS og e-mail kun ved ja til kontakt", async () => {
  const [, lid, t] = linkTil("gammel-andre@example.test");
  await post("spoergeskema.php", { id: lid, t, svar: { anbefal: 3, rolle: "journalist", mangler: "Hurtigere mails", kontakt: true } });
  const s = await admin({ handling: "status" });
  assert.equal(s.svar, 2);
  assert.deepEqual(s.optalt.anbefal, { 9: 1, 3: 1 });
  assert.equal(s.nps, 0); // én 9'er og én 3'er
  const tekster = Object.fromEntries(s.tekster.map((x) => [x.mangler, x.email]));
  assert.equal(tekster["Kort over sager"], ""); // svarede igen uden flueben
  assert.equal(tekster["Hurtigere mails"], "gammel-andre@example.test");
  assert.equal((await post("admin/spoergeskema.php", { handling: "status" }).then(() => fetch(URL_ + "api/admin/spoergeskema.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: "{}" }))).status, 403, "kun redaktionen");
});

test("sletter man sin konto, beholdes svarene uden person, og udsendelsen slettes", async () => {
  saetKode("gammel-andre@example.test", "laeser-kode-1");
  const lid = id("gammel-andre@example.test");
  const ind = await fetch(URL_ + "api/login.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: JSON.stringify({ email: "gammel-andre@example.test", adgangskode: "laeser-kode-1" }) });
  const c = ind.headers.get("set-cookie").split(";")[0];
  const r = await fetch(URL_ + "api/slet-konto.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api", cookie: c }, body: JSON.stringify({ adgangskode: "laeser-kode-1" }) });
  assert.equal(r.status, 200);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id = ${lid}`)[0].n, 0);
  assert.equal(sql("SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id IS NULL")[0].n, 1);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_sendt WHERE abonnent_id = ${lid}`)[0].n, 0);
  const s = await admin({ handling: "status" });
  assert.equal(s.svar, 2); assert.equal(s.tekster.find((x) => x.mangler === "Hurtigere mails").email, "");
});
