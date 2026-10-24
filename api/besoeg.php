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
// Push-beskeder: er sagerne opdateret siden sidst, sendes beskederne nu, efter at svaret til den besøgende er afsendt
// (robotten kan ikke kalde siden direkte, fordi Simply spærrer for robotter). Se api/_push.php.
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
    try { require_once __DIR__ . '/_push.php'; push_maaske_koer(); } catch (Throwable $e) { error_log('Sagsvagt push: ' . $e->getMessage()); }
    // Mandagsmailen (se api/_mandagsmail.php): søndag fra kl. 18 lægges ugens mails i kø én gang, og planlagte mails sendes,
    // når tiden er kommet
    try { require_once __DIR__ . '/_mandagsmail.php'; mm_maaske_planlaeg(); } catch (Throwable $e) { error_log('Sagsvagt mandagsmail (planlægning): ' . $e->getMessage()); }
    try { require_once __DIR__ . '/_mandagsmail.php'; mm_maaske_send(); } catch (Throwable $e) { error_log('Sagsvagt mandagsmail: ' . $e->getMessage()); }
}
