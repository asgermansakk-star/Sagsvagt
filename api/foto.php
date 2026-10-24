<?php
// Læserfotos: en læser sender et foto fra et sted i en sag. Billedet gemmes i _fotos/ (lukket for omverdenen),
// registreres i databasen og meldes til redaktionen. Intet vises på siden, før redaktionen har godkendt det og lagt det
// i assets/laeserfotos/ (se min/admin.html). Fotografen giver Sagsvagt ret til at bruge billedet med kreditering.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

// Upload er multipart, så kraev_post() (JSON) passer ikke; samme beskyttelse: POST, egen header og egen origin
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fejl(405, 'Kun POST');
if (($_SERVER['HTTP_X_SAGSVAGT'] ?? '') !== 'api') fejl(403, 'Ikke tilladt');
$origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');
if ($origin !== '' && !in_array($origin, tilladte_origins(), true)) fejl(403, 'Ikke tilladt');
begraens('foto:' . ip(), 6, 3600);

$navn = mb_substr(trim((string)($_POST['navn'] ?? '')), 0, 80);
$email = ren_email($_POST['email'] ?? '');
$sag = preg_replace('/[^a-z0-9æøå.-]/u', '', mb_strtolower((string)($_POST['sag'] ?? '')));
$sted = mb_substr(trim((string)($_POST['sted'] ?? '')), 0, 120);
$tekst = mb_substr(trim((string)($_POST['tekst'] ?? '')), 0, 1000);
$egen = !empty($_POST['egen']);
$ret = !empty($_POST['ret']);
$personer = !empty($_POST['personer']);
if ($navn === '' || !$email) fejl(400, 'Skriv dit navn og din e-mail, så vi kan kreditere dig og spørge, hvis noget er uklart.');
if (!$egen || !$ret || !$personer) fejl(400, 'Sæt alle tre flueben, før du sender.');

$f = $_FILES['foto'] ?? null;
if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) fejl(400, 'Vælg et billede (højst 10 MB).');
if ($f['size'] > 10 * 1024 * 1024) fejl(400, 'Billedet er for stort (højst 10 MB).');
$type = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
$EXT = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'image/heif' => 'heic'];
if (!isset($EXT[$type])) fejl(400, 'Billedet skal være JPEG, PNG, WEBP eller HEIC.');

$mappe = __DIR__ . '/_fotos';
if (!is_dir($mappe)) mkdir($mappe, 0700, true);
if (!is_file("$mappe/.htaccess")) file_put_contents("$mappe/.htaccess", "Require all denied\n");
$fil = gmdate('Ymd-His') . '-' . bin2hex(random_bytes(6)) . '.' . $EXT[$type];
if (!move_uploaded_file($f['tmp_name'], "$mappe/$fil")) fejl(500, 'Billedet kunne ikke gemmes. Prøv igen senere.');

$db = db();
$db->prepare('INSERT INTO fotos (navn, email, sag, sted, tekst, fil, oprettet) VALUES (?, ?, ?, ?, ?, ?, ?)')
   ->execute([$navn, $email, $sag, $sted, $tekst, $fil, nu()]);

$linjer = "Fra: $navn <$email>\nSag: " . ($sag ?: '(ingen)') . "\nSted: " . ($sted ?: '(ikke angivet)') . "\n\n$tekst\n\n"
        . "Fotografen har bekræftet: selv taget billedet, Sagsvagt må bruge det med kreditering, og ingen genkendelige personer uden deres ja.\n"
        . "Se og godkend det under Læserfotos i Min avis › Redaktion.";
@send_mail($K['feedback_til'] ?? $K['mail']['svar_til'] ?? $K['tilmeldinger_til'], 'Nyt læserfoto: ' . ($sted ?: $sag ?: $navn),
    '<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer, $email);
svar(200, ['ok' => true]);
