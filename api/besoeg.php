<?php
// Anonym besøgstæller: lægger 1 til (dato, side, kilde). Gemmer ingen IP-adresse, ingen cookies og intet om den besøgende,
// så den kræver ikke samtykke. Kaldes af et lille script på hver offentlig side (fetch med keepalive, text/plain).
// Robotter (søgemaskiner, forhåndsvisninger) tælles ikke.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }
$ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
if ($ua === '' || preg_match('/bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|curl|wget|python|node-fetch/i', $ua)) { http_response_code(204); exit; }
$d = json_decode((string)file_get_contents('php://input', false, null, 0, 600), true);
if (!is_array($d)) { http_response_code(400); exit; }
// Kun stier på vores egen side, uden query og fragment
$sti = (string)($d['s'] ?? '/');
$sti = '/' . ltrim(preg_replace('/[?#].*$/', '', $sti), '/');
if (!preg_match('~^/[A-Za-z0-9/_.%\-æøåÆØÅ]{0,190}$~u', $sti) || str_contains($sti, '..')) { http_response_code(204); exit; }
if (preg_match('~/index\.html$~', $sti)) $sti = substr($sti, 0, -10);
// Kun sider, der findes som fil på siden, så ingen kan fylde tabellen med opdigtede stier
$rod = rtrim((string)realpath(dirname(__DIR__)), '/\\');
$fil = $rod . rawurldecode(str_ends_with($sti, '/') ? $sti . 'index.html' : $sti);
if ($rod === '' || !is_file($fil) || !str_ends_with($fil, '.html')) { http_response_code(204); exit; }
// Kilde: domænet man kom fra eller ?fra=…, uden resten af adressen
$kilde = mb_strtolower(preg_replace('/[^a-z0-9.\-_]/i', '', (string)($d['k'] ?? '')));
$kilde = $kilde === '' ? 'direkte' : mb_substr(preg_replace('/^www\./', '', $kilde), 0, 60);

$db = db();
$db->exec('CREATE TABLE IF NOT EXISTS besoeg (dato VARCHAR(10) NOT NULL, sti VARCHAR(200) NOT NULL, kilde VARCHAR(60) NOT NULL, antal INT NOT NULL DEFAULT 0, PRIMARY KEY (dato, sti, kilde))');
$dato = (new DateTime('now', new DateTimeZone('Europe/Copenhagen')))->format('Y-m-d');
// Højst 40 forskellige kilder pr. dag; resten samles i "andet"
if ($kilde !== 'direkte') {
    $q = $db->prepare('SELECT COUNT(DISTINCT kilde) FROM besoeg WHERE dato = ? AND kilde <> ?'); $q->execute([$dato, $kilde]);
    $kendt = $db->prepare('SELECT 1 FROM besoeg WHERE dato = ? AND kilde = ? LIMIT 1'); $kendt->execute([$dato, $kilde]);
    if (!$kendt->fetchColumn() && (int)$q->fetchColumn() >= 40) $kilde = 'andet';
}
$up = $db->prepare('UPDATE besoeg SET antal = antal + 1 WHERE dato = ? AND sti = ? AND kilde = ?');
$up->execute([$dato, $sti, $kilde]);
if ($up->rowCount() === 0) {
    try { $db->prepare('INSERT INTO besoeg (dato, sti, kilde, antal) VALUES (?, ?, ?, 1)')->execute([$dato, $sti, $kilde]); }
    catch (PDOException $e) { $up->execute([$dato, $sti, $kilde]); } // to samtidige første besøg
}
http_response_code(204);
// Opgaverne efter svaret: push-beskeder (api/_push.php) og mandagsmailen (api/_mandagsmail.php: søndag fra kl. 18 lægges ugens
// mails i kø én gang, og planlagte mails sendes, når tiden er kommet). Robotten kan ikke kalde siden direkte, fordi Simply
// spærrer for robotter, så de kører, når nogen besøger siden. Svaret sendes færdigt først, så den besøgende ikke venter.
// Har PHP hverken fastcgi_finish_request eller litespeed_finish_request, lukkes forbindelsen med Content-Length: 0 i stedet.
if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
else { ignore_user_abort(true); header('Connection: close'); header('Content-Length: 0'); while (ob_get_level() > 0) ob_end_flush(); flush(); }
@set_time_limit(240);
// Hver opgave husker, hvornår den sidst kørte, og den seneste fejl, så api/admin/drift.php kan vise det
$opgave = function (string $navn, callable $f) use ($db): void {
    $gem = function (string $noegle, string $vaerdi) use ($db): void {
        $vaerdi = mb_substr($vaerdi, 0, 250);
        $q = $db->prepare('UPDATE indstillinger SET vaerdi = ? WHERE noegle = ?'); $q->execute([$vaerdi, $noegle]);
        if ($q->rowCount() === 0) { try { $db->prepare('INSERT INTO indstillinger (noegle, vaerdi) VALUES (?, ?)')->execute([$noegle, $vaerdi]); } catch (PDOException $e) {} }
    };
    try { $f(); $gem("drift:$navn", nu()); }
    catch (Throwable $e) { error_log("Sagsvagt $navn: " . $e->getMessage()); $gem("fejl:$navn", nu() . ' ' . $e->getMessage()); }
};
$opgave('push', function () { require_once __DIR__ . '/_push.php'; push_maaske_koer(); });
$opgave('mm-plan', function () { require_once __DIR__ . '/_mandagsmail.php'; mm_maaske_planlaeg(); });
$opgave('mm-send', function () { require_once __DIR__ . '/_mandagsmail.php'; mm_maaske_send(); });
// Sagsvagt Erhverv (api/_erhverv.php): samme mønster som mandagsmailen, med egen kø og egen prøvemail
$opgave('erhverv', function () { require_once __DIR__ . '/_erhverv.php'; er_maaske_planlaeg(); er_maaske_send(); });
