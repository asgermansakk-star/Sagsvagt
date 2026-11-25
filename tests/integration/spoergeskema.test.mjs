// Spørgeskemaet: linket kommer som en boks i mandagsmailen til dem, der har været med i over en måned, når redaktionen har
// slået runden til, højst to gange og ikke efter et svar; linket er personligt; svar gemmes kun for kendte spørgsmål og
// erstattes, hvis man svarer igen; sletter man kontoen, beholdes svarene uden person.
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
// Det personlige link, som serveren laver det (til læsere, der ikke får boksen mere)
const linkAf = (email) => kaldPhp(`require '_bootstrap.php'; require '_spoergeskema.php'; echo spoerg_link(${id(email)});`).match(/id=(\d+)&t=([a-f0-9]+)/).slice(1);
// Adgangskoden hashes i PHP og sættes med et forberedt kald (en hash indeholder $, som PHP ellers ville læse som variabler)
const saetKode = (email, kode) => kaldPhp(`${PDO} $p->prepare("UPDATE abonnenter SET status = 'aktiv', adgangskode = ? WHERE email = ?")->execute([password_hash(${JSON.stringify(kode)}, PASSWORD_DEFAULT), ${JSON.stringify(email)}]);`);
// Ugens mandagsmails, som serveren laver dem: e-mail → personligt link i boksen (eller null)
const ugensMails = () => JSON.parse(kaldPhp(`require '_bootstrap.php'; require '_mandagsmail.php'; mm_tabeller(db()); $u = []; foreach (mm_ugens_mails(db(), '2026-11-30') as $m) $u[$m['a']['email']] = preg_match('/spoergeskema\\.html\\?id=(\\d+)&(?:amp;)?t=([a-f0-9]+)/', $m['mail']['html'], $x) ? [$x[1], $x[2], str_contains($m['mail']['tekst'], 'HVAD SYNES DU OM SAGSVAGT?')] : null; echo json_encode($u);`));
// Sender ugens mail til én, som køen gør (mm_send_en), med en ny uge hver gang
let ugeNr = 0;
const sendMandag = (email) => kaldPhp(`require '_bootstrap.php'; require '_mandagsmail.php'; mm_tabeller(db()); foreach (mm_ugens_mails(db(), '2026-11-30') as $m) if ($m['a']['email'] === ${JSON.stringify(email)}) echo mm_send_en(db(), (int)$m['a']['id'], $m['a']['email'], 'test-${++ugeNr}', $m['mail']['emne'], $m['mail']['html'], $m['mail']['tekst']);`);
const dage = (n) => new Date(Date.now() - n * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
const id = (email) => sql(`SELECT id FROM abonnenter WHERE email = '${email}'`)[0].id;
// En læser: bekræftet for $alder dage siden med samtykke $samtykke
const laeser = (email, alder, samtykke, mere = "") =>
  koer(`INSERT INTO abonnenter (email, kommuner, status, oprettet, bekraeftet, samtykke${mere ? ", mail_afmeldt" : ""}) VALUES ('${email}', 'København', 'tilmeldt', '${dage(alder)}', '${dage(alder)}', ${samtykke === null ? "NULL" : `'${samtykke}'`}${mere ? `, '${dage(1)}'` : ""})`);

before(async () => {
  cpSync(join(ROD, "api"), join(SITE, "api"), { recursive: true, filter: (f) => !/\/_(konfig\.php|ord-[^/]*|loft|fotos)$/.test(f) });
  mkdirSync(join(SITE, "kommune")); writeFileSync(join(SITE, "kommune", "aabne.json"), JSON.stringify([{ navn: "København", slug: "koebenhavn" }]));
  mkdirSync(join(SITE, "assets")); cpSync(join(ROD, "assets", "sager.json"), join(SITE, "assets", "sager.json"));
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

test("slået fra som standard: ingen boks i mandagsmailen", async () => {
  const s = await admin({ handling: "status" });
  assert.equal(s.aktiv, false);
  // Får mandagsmailen og har været med i over en måned: redaktøren, gammel-ja og gammel-mandag (ikke 'andre', 'nej', afmeldt eller ny)
  assert.equal(s.kan_faa, 3); assert.equal(s.vist, 0); assert.equal(s.svar, 0);
  const u = ugensMails();
  assert.ok(Object.keys(u).length >= 3, "mandagsmailen laves stadig");
  assert.ok(Object.values(u).every((x) => x === null));
});

test("slået til: boksen kommer kun til dem over en måned, med deres eget link i HTML og tekst", async () => {
  assert.equal((await admin({ handling: "aktiv", til: true })).aktiv, true);
  const u = ugensMails();
  for (const m of ["a@example.test", "gammel-ja@example.test", "gammel-mandag@example.test"]) {
    assert.ok(u[m], m); assert.equal(+u[m][0], id(m)); assert.equal(u[m][2], true, "også i tekstudgaven");
  }
  assert.equal(u["ny-ja@example.test"], null, "under en måned");
  assert.equal("gammel-andre@example.test" in u, false, "får ikke mandagsmailen");
  assert.equal("gammel-afmeldt@example.test" in u, false);
});

test("boksen kommer højst to gange og tælles først, når mailen er sendt", async () => {
  assert.equal(sendMandag("gammel-mandag@example.test"), "sendt");
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_sendt WHERE abonnent_id = ${id("gammel-mandag@example.test")}`)[0].n, 1);
  assert.ok(ugensMails()["gammel-mandag@example.test"], "anden gang");
  assert.equal(sendMandag("gammel-mandag@example.test"), "sendt");
  assert.equal(ugensMails()["gammel-mandag@example.test"], null, "ikke en tredje gang");
  const s = await admin({ handling: "status" });
  assert.equal(s.vist, 1); assert.equal(s.kan_faa, 2);
});

test("svar: kræver det rigtige link, gemmer kun kendte valg og erstattes, hvis man svarer igen", async () => {
  const [lid, t] = ugensMails()["gammel-ja@example.test"];
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
  assert.equal(ugensMails()["gammel-ja@example.test"], null, "ingen boks efter et svar");
});

test("udfyldt usynligt felt: ser ud til at virke, men intet gemmes", async () => {
  const [lid, t] = ugensMails()["a@example.test"];
  const r = await post("spoergeskema.php", { id: lid, t, svar: { rammer: 2 }, sv_felt: "http://spam" });
  assert.equal(r.status, 200);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id = ${lid}`)[0].n, 0);
});

test("redaktionen ser svarene talt op, NPS og e-mail kun ved ja til kontakt", async () => {
  const [lid, t] = linkAf("gammel-mandag@example.test");
  assert.equal((await post("spoergeskema.php", { id: lid, t, svar: { anbefal: 3, rolle: "journalist", mangler: "Hurtigere mails", kontakt: true } })).status, 200);
  const s = await admin({ handling: "status" });
  assert.equal(s.svar, 2);
  assert.deepEqual(s.optalt.anbefal, { 9: 1, 3: 1 });
  assert.equal(s.nps, 0); // én 9'er og én 3'er
  const tekster = Object.fromEntries(s.tekster.map((x) => [x.mangler, x.email]));
  assert.equal(tekster["Kort over sager"], ""); // svarede igen uden flueben
  assert.equal(tekster["Hurtigere mails"], "gammel-mandag@example.test");
  assert.equal((await post("admin/spoergeskema.php", { handling: "status" }).then(() => fetch(URL_ + "api/admin/spoergeskema.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: "{}" }))).status, 403, "kun redaktionen");
});

test("sletter man sin konto, beholdes svarene uden person, og optællingen af boksen slettes", async () => {
  saetKode("gammel-mandag@example.test", "laeser-kode-1");
  const lid = id("gammel-mandag@example.test");
  const ind = await fetch(URL_ + "api/login.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: JSON.stringify({ email: "gammel-mandag@example.test", adgangskode: "laeser-kode-1" }) });
  const c = ind.headers.get("set-cookie").split(";")[0];
  const r = await fetch(URL_ + "api/slet-konto.php", { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api", cookie: c }, body: JSON.stringify({ adgangskode: "laeser-kode-1" }) });
  assert.equal(r.status, 200);
  assert.equal(sql(`SELECT COUNT(*) n FROM abonnenter WHERE id = ${lid}`)[0].n, 0);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id = ${lid}`)[0].n, 0);
  assert.equal(sql("SELECT COUNT(*) n FROM spoergeskema_svar WHERE abonnent_id IS NULL")[0].n, 1);
  assert.equal(sql(`SELECT COUNT(*) n FROM spoergeskema_sendt WHERE abonnent_id = ${lid}`)[0].n, 0);
  const s = await admin({ handling: "status" });
  assert.equal(s.svar, 2); assert.equal(s.tekster.find((x) => x.mangler === "Hurtigere mails").email, "");
});
