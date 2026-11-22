// Sikkerheden i PHP-API'et: billeder renses for sted og tid (api/_foto.php), loftet over antal kald (api/_loft.php) virker
// uden at gemme IP-adresser, og redaktionens "første gang" lukker, når der er en konto. Kører på en kopi af api/ med sin
// egen SQLite-database, så intet i repoet ændres. Kræver php på stien.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fotoSideIndhold } from "../../avis/grafik.mjs";

const ROD = join(import.meta.dirname, "..", "..");
const PORT = 4411;
const API = `http://127.0.0.1:${PORT}/api/`;
const SITE = mkdtempSync(join(tmpdir(), "sagsvagt-sik-"));
let php;

const kaldPhp = (kode, ind) => execFileSync("php", ["-r", kode], { cwd: join(SITE, "api"), input: ind, maxBuffer: 1 << 26 });
const sql = (s) => JSON.parse(kaldPhp(`$p = new PDO('sqlite:' . __DIR__ . '/../db.sqlite'); echo json_encode($p->query(${JSON.stringify(s)})->fetchAll(PDO::FETCH_ASSOC));`.replace("__DIR__", "getcwd()")).toString());
const post = (sti, data = {}) => fetch(API + sti, { method: "POST", headers: { "Content-Type": "application/json", "X-Sagsvagt": "api" }, body: JSON.stringify(data) });

before(async () => {
  cpSync(join(ROD, "api"), join(SITE, "api"), { recursive: true, filter: (f) => !/\/_(konfig\.php|ord-[^/]*|loft|fotos)$/.test(f) });
  writeFileSync(join(SITE, "side.html"), "<!doctype html>");
  writeFileSync(join(SITE, "api", "_konfig.php"), `<?php return ['site_url' => 'http://127.0.0.1:${PORT}/', 'admins' => ['a@example.test', 'b@example.test'], 'tilmeldinger_til' => 'a@example.test', 'db' => ['driver' => 'sqlite', 'fil' => __DIR__ . '/../db.sqlite'], 'mail' => ['metode' => 'fil', 'mappe' => __DIR__ . '/../mails', 'fra' => 'post@example.test', 'fra_navn' => 'Test', 'svar_til' => 'a@example.test']];`);
  php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", SITE], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(API); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("php -S startede ikke");
});
after(() => { php?.kill(); rmSync(SITE, { recursive: true, force: true }); });

// ---------- Billeder ----------
const u16 = (n) => Buffer.from([n >> 8, n & 255]);
const seg = (m, d) => Buffer.concat([Buffer.from([0xff, m]), u16(d.length + 2), d]);
const exif = Buffer.concat([Buffer.from("Exif\0\0II*\0"), Buffer.from([8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]), Buffer.from("GPS-55.6761N")]);
// Billeddata med FF00 og et genstartsmærke (FFD0), som ikke må opfattes som slut
const skan = Buffer.concat([seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([1, 2, 0xff, 0, 3, 0xff, 0xd0, 4, 5])]);
const dele = [seg(0xdb, Buffer.alloc(65, 1)), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]))];
const icc = seg(0xe2, Buffer.from("ICC_PROFILE\0farver"));
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")), seg(0xe1, exif),
  seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0HEMMELIGT-XMP")), icc, seg(0xed, Buffer.from("HEMMELIGT-IPTC")), ...dele,
  seg(0xfe, Buffer.from("HEMMELIGT-NOTE")), skan, Buffer.from([0xff, 0xd9]), Buffer.from("HEMMELIGT-VIDEO-GPS")]);
const rens = (type, d) => kaldPhp(`require '_foto.php'; $r = foto_rens(stream_get_contents(STDIN), '${type}'); echo $r ?? 'NULL';`, d);

test("JPEG: sted, tid og noter fjernes, men billedet, farverne og retningen er uændrede", () => {
  const r = rens("image/jpeg", jpeg);
  for (const s of ["GPS", "HEMMELIGT", "xap", "Photoshop"]) assert.ok(!r.includes(s), s);
  for (const d of [icc, ...dele, skan]) assert.ok(r.includes(d));
  assert.deepEqual([...r.subarray(-2)], [0xff, 0xd9]);
  assert.ok(r.includes(Buffer.concat([Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\x01", "latin1"), Buffer.from([1, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])])), "retningen 6 skal være bevaret");
  assert.deepEqual(rens("image/jpeg", r), r, "rensning af et renset billede ændrer intet");
});
const bid = (navn, d) => { const k = Buffer.concat([Buffer.from(navn), d]); const l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(k)); return Buffer.concat([l, k, c]); };
const riff = (...b) => { const d = Buffer.concat([Buffer.from("WEBP"), ...b]); const l = Buffer.alloc(4); l.writeUInt32LE(d.length); return Buffer.concat([Buffer.from("RIFF"), l, d]); };
const wb = (navn, d) => { const l = Buffer.alloc(4); l.writeUInt32LE(d.length); return Buffer.concat([Buffer.from(navn), l, d, Buffer.alloc(d.length & 1)]); };

test("PNG og WebP: skjulte oplysninger fjernes", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const ihdr = bid("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])), idat = bid("IDAT", deflateSync(Buffer.from([0, 0]))), iend = bid("IEND", Buffer.alloc(0));
  const p = rens("image/png", Buffer.concat([sig, ihdr, bid("eXIf", Buffer.from("GPS")), bid("tEXt", Buffer.from("HEMMELIGT")), idat, iend, Buffer.from("HEMMELIGT")]));
  assert.deepEqual(p, Buffer.concat([sig, ihdr, idat, iend]));
  const x = Buffer.alloc(10); x[0] = 0x2c;
  const y = Buffer.alloc(10); y[0] = 0x20;
  const w = rens("image/webp", riff(wb("VP8X", x), wb("ICCP", Buffer.from("abc")), wb("VP8L", Buffer.from("billede")), wb("EXIF", Buffer.from("GPS")), wb("XMP ", Buffer.from("HEMMELIGT"))));
  assert.deepEqual(w, riff(wb("VP8X", y), wb("ICCP", Buffer.from("abc")), wb("VP8L", Buffer.from("billede"))));
});
test("ødelagte billeder afvises i stedet for at blive gemt", () => {
  for (const [t, d] of [["image/jpeg", Buffer.from("GIF89a")], ["image/jpeg", jpeg.subarray(0, 60)], ["image/png", Buffer.from("\x89PNG")], ["image/webp", Buffer.from("RIFFxxxxWEBP")], ["image/heic", jpeg]])
    assert.equal(rens(t, d).toString(), "NULL");
});
const send = (blob, navn) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ navn: "Test", email: "t@example.test", egen: "1", ret: "1", personer: "1" })) f.set(k, v);
  f.set("foto", blob, navn);
  return fetch(API + "foto.php", { method: "POST", headers: { "X-Sagsvagt": "api" }, body: f });
};
test("et sendt billede gemmes renset, og HEIC afvises", async () => {
  const svar = await send(new Blob([jpeg]), "foto.jpg");
  assert.equal(svar.status, 200, await svar.text());
  const mappe = join(SITE, "api", "_fotos");
  const gemt = readdirSync(mappe).filter((f) => f.endsWith(".jpg"));
  assert.equal(gemt.length, 1);
  assert.deepEqual(readFileSync(join(mappe, gemt[0])), rens("image/jpeg", jpeg));
  const heic = await send(new Blob([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0mif1heic")])]), "foto.heic");
  assert.equal(heic.status, 400);
  assert.equal(readdirSync(mappe).filter((f) => !f.startsWith(".")).length, 1);
});

test("formularen beder kun om de billedtyper, serveren tager imod (så sender iPhones JPEG i stedet for HEIC)", () => {
  assert.match(fotoSideIndhold(), /accept="image\/jpeg,image\/png,image\/webp"/);
});

// ---------- Loft ----------
test("loftet stopper ved grænsen, åbner igen bagefter og skelner mellem adresser", () => {
  const ud = kaldPhp(`require '_loft.php';
    $a = []; for ($i = 0; $i < 4; $i++) $a[] = loft_ok('proeve', 3, 2, '192.0.2.1');
    $a[] = loft_ok('proeve', 3, 2, '192.0.2.2');
    $a[] = loft_ok('proeve', 3, 2, '2001:db8::1'); $a[] = loft_ok('proeve', 3, 2, '2001:db8::2'); $a[] = loft_ok('proeve', 3, 2, '2001:db8::3'); $a[] = loft_ok('proeve', 3, 2, '2001:db8::4');
    sleep(3); $a[] = loft_ok('proeve', 3, 2, '192.0.2.1'); echo json_encode($a);`).toString();
  assert.deepEqual(JSON.parse(ud), [true, true, true, false, true, true, true, true, false, true]);
  const fil = join(SITE, "api", "_loft", "_proeve.bin");
  assert.equal(readFileSync(fil).length, 24 + 8192, "fast størrelse, uanset hvor mange der kalder");
  assert.ok(existsSync(join(SITE, "api", "_loft", ".htaccess")));
});
test("priser, søgning og besøg svarer, og priser stopper efter 120 kald", async () => {
  assert.equal((await fetch(API + "soeg.php?k=findes-ikke&q=skole")).status, 404);
  const b = await fetch(API + "besoeg.php", { method: "POST", headers: { "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ s: "/side.html" }) });
  assert.equal(b.status, 204);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sql("SELECT SUM(antal) AS n FROM besoeg")[0].n, 1);
  for (let i = 0; i < 120; i++) assert.equal((await fetch(API + "pakker.php")).status, 200);
  const stop = await fetch(API + "pakker.php");
  assert.equal(stop.status, 429);
  assert.equal(stop.headers.get("retry-after"), "600");
});
test("søgning, priser og besøg gemmer ingen IP-adresse", () => {
  for (const r of sql("SELECT noegle FROM forsoeg")) assert.ok(!/^(soeg|pakker|besoeg)/.test(r.noegle), r.noegle);
  for (const f of readdirSync(join(SITE, "api", "_loft"))) assert.ok(!readFileSync(join(SITE, "api", "_loft", f)).includes("127.0.0.1"), f);
});

// ---------- Redaktionen ----------
test("redaktionens første invitation lukker, når en i redaktionen har en konto", async () => {
  assert.equal((await post("admin/start.php")).status, 200);
  assert.ok(readdirSync(join(SITE, "mails")).length >= 2);
  kaldPhp(`$p = new PDO('sqlite:' . getcwd() . '/../db.sqlite'); $p->exec("UPDATE abonnenter SET status = 'aktiv', adgangskode = 'x' WHERE email = 'a@example.test'");`);
  const foer = readdirSync(join(SITE, "mails")).length;
  assert.equal((await post("admin/start.php")).status, 403);
  assert.equal(readdirSync(join(SITE, "mails")).length, foer, "ingen mail, når siden er lukket");
});
