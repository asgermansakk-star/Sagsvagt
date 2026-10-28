<?php
// "Book en gennemgang" på salgssiden (erhverv.html). Gemmer henvendelsen og sender den til redaktionen med personens
// adresse som svar-til, så man bare kan trykke svar. Personen får ingen mail herfra: siden viser selv kvitteringen, og
// ingen kan bruge formularen til at sende mails til andres adresser. Hjemmeskærmens driftsalarm (api/admin/drift.php)
// giver push-besked om nye henvendelser.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

const ER_BOOK_PRODUKTER = ['Tidlige signaler', 'Energiradar', 'Åbner snart', 'Organisation', 'Pro'];

$d = kraev_post();
begraens('erhverv-book:' . ip(), 5, 3600);
$firma = trim(mb_substr((string)($d['firma'] ?? ''), 0, 120));
$navn = trim(mb_substr((string)($d['navn'] ?? ''), 0, 100));
$email = ren_email($d['email'] ?? '');
$tlf = trim(mb_substr(preg_replace('/[^\d +()-]/', '', (string)($d['tlf'] ?? '')), 0, 30));
$besked = trim(mb_substr((string)($d['besked'] ?? ''), 0, 1500));
$produkt = in_array($d['produkt'] ?? '', ER_BOOK_PRODUKTER, true) ? $d['produkt'] : ER_BOOK_PRODUKTER[0];
if ($firma === '') fejl(400, 'Skriv navnet på virksomheden.');
if ($email === '') fejl(400, 'Skriv en gyldig arbejdsmail, så vi kan svare dig.');
begraens('erhverv-book:' . $email, 3, 86400);

$db = db(); er_tabeller($db);
$db->prepare('INSERT INTO erhverv_henvendelser (firma, navn, email, tlf, produkt, besked, oprettet) VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([$firma, $navn, $email, $tlf, $produkt, $besked, nu()]);
$t = "Firma: $firma\nNavn: $navn <$email>\nTelefon: " . ($tlf ?: '-') . "\nProdukt: $produkt\n\n$besked\n";
@send_mail(TILMELDINGER_TIL, "Erhverv: gennemgang ønsket af $firma", '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($t, ENT_QUOTES, 'UTF-8') . '</pre>', $t, $email);
svar(200, ['ok' => true]);
