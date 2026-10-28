<?php
// Selvbetjent prøve på Sagsvagt Erhverv fra salgssiden (erhverv.html). Opretter kunden med status 'venter' og sender en mail
// med et bekræftelseslink (api/erhverv-bekraeft.php); først når adressen er bekræftet, starter prøven på 30 dage, og kunden
// får sit rapportlink. Mailen sendes kun, fordi personen selv har bedt om prøven (som tilmeldingen til avisen).
// Samme svar, uanset om adressen findes i forvejen, så ingen kan teste, hvem der er kunde.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

$d = kraev_post();
begraens('erhverv-proeve:' . ip(), 5, 3600);
$email = ren_email($d['email'] ?? '');
$firma = trim(mb_substr((string)($d['firma'] ?? ''), 0, 120));
$navn = trim(mb_substr((string)($d['navn'] ?? ''), 0, 100));
if ($firma === '') fejl(400, 'Skriv navnet på virksomheden.');
if ($email === '') fejl(400, 'Skriv en gyldig e-mail.');
if (empty($d['samtykke'])) fejl(400, 'Sæt kryds, så vi må sende rapporten og den ugentlige mail i prøveperioden.');
begraens('erhverv-proeve:' . $email, 3, 86400);
$aabne = array_column(er_indeks()['kommuner'], 'slug');
$kommuner = array_slice(array_values(array_unique(array_intersect(array_map('strval', (array)($d['kommuner'] ?? [])), $aabne))), 0, 5);
if (!$kommuner) fejl(400, 'Vælg mindst én kommune (højst fem i prøven).');
$produkt = array_key_exists($d['produkt'] ?? '', ER_PRODUKTER) ? $d['produkt'] : 'signaler';
$ord = implode(', ', array_slice(array_values(array_filter(array_map(fn($o) => trim(mb_substr($o, 0, 60)), explode(',', (string)($d['ord'] ?? ''))), fn($o) => mb_strlen($o) >= 3)), 0, 10));

$db = db(); er_tabeller($db);
$q = $db->prepare("SELECT * FROM erhverv_kunder WHERE email = ? AND status IN ('venter', 'proeve', 'aktiv') ORDER BY id DESC LIMIT 1"); $q->execute([$email]);
$k = $q->fetch();
if (!$k) {
    $db->prepare('INSERT INTO erhverv_kunder (firma, kontakt, email, produkt, kommuner, ord, status, noter, mail, oprettet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        ->execute([$firma, $navn, $email, $produkt, implode(',', $kommuner), $ord, 'venter', 'Selvbetjent prøve fra erhverv.html' . (trim((string)($d['tlf'] ?? '')) !== '' ? '. Tlf. ' . mb_substr(trim((string)$d['tlf']), 0, 30) : ''), nu()]);
    $k = $db->query('SELECT * FROM erhverv_kunder WHERE id = ' . (int)$db->lastInsertId())->fetch();
}
if ($k['status'] === 'venter') {
    $id = (int)$k['id']; $v = (int)$k['version'];
    $link = $K['site_url'] . "api/erhverv-bekraeft.php?id=$id&t=" . signatur("erhverv-bekraeft:$id:$v");
    [$html, $tekst] = mail_skabelon('Bekræft jeres prøve på Sagsvagt Erhverv',
        "Tryk på knappen for at starte " . ER_PROEVE_DAGE . " dages gratis prøve for {$k['firma']}. Så får I med det samme et link til jeres rapport, og hver mandag kl. 7 en mail med ugens nye signaler og udbud.\n\nPrøven stopper af sig selv. Der kommer ingen regning.",
        'Start prøven', $link, "Du får denne mail, fordi $email har bedt om en prøve på sagsvagt.dk/erhverv.html. Har du ikke det, så gør ingenting.");
    send_mail($email, 'Bekræft jeres prøve på Sagsvagt Erhverv', $html, $tekst);
} else {
    // Allerede kunde eller i prøve: linket sendes igen
    [$html, $tekst] = mail_skabelon('Jeres rapport på Sagsvagt Erhverv', "Her er linket til rapporten for {$k['firma']} igen.", 'Åbn rapporten', er_link($k),
        "Du får denne mail, fordi $email bad om en prøve på sagsvagt.dk/erhverv.html.");
    send_mail($email, 'Jeres rapport på Sagsvagt Erhverv', $html, $tekst);
}
svar(200, ['ok' => true]);
