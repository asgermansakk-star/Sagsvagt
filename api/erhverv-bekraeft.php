<?php
// Bekræftelseslinket i mailen fra den selvbetjente prøve (?id=…&t=…, signeret). GET viser en side med én knap, så
// sikkerhedsscannere, der åbner links i mails, ikke starter prøven; POST starter prøven på 14 dage, viser rapportlinket,
// sender det på mail og giver redaktionen besked.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

$id = (int)($_GET['id'] ?? 0);
$db = db(); er_tabeller($db);
$q = $db->prepare('SELECT * FROM erhverv_kunder WHERE id = ?'); $q->execute([$id]);
$k = $q->fetch();
if (!$k || !signatur_ok("erhverv-bekraeft:$id:{$k['version']}", (string)($_GET['t'] ?? ''))) { http_response_code(400); vis_side('Linket virker ikke', 'Linket er ugyldigt eller brugt. Bed om en ny prøve på sagsvagt.dk/erhverv.html, eller skriv til mansa@sagsvagt.dk.'); }
$aabn = fn(array $k) => '<p><a href="' . htmlspecialchars(er_link($k), ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;background:#0E0F14;color:#E6DFD3;font:700 15px Montserrat,Arial,sans-serif;text-decoration:none;padding:13px 24px;border-radius:8px;">Åbn rapporten</a></p>';
if ($k['status'] !== 'venter') vis_side('Prøven er allerede i gang', "Rapporten for {$k['firma']} er klar. Linket står også i jeres mail.", $aabn($k));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $slut = (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->modify('+' . ER_PROEVE_DAGE . ' days')->format('Y-m-d');
    $db->prepare("UPDATE erhverv_kunder SET status = 'proeve', proeve_slut = ? WHERE id = ? AND status = 'venter'")->execute([$slut, $id]);
    $q->execute([$id]); $k = $q->fetch();
    [$html, $tekst] = mail_skabelon('Jeres rapport på Sagsvagt Erhverv er klar',
        "Prøven for {$k['firma']} kører til og med " . mm_dato($slut) . ". Gem linket: det er jeres adgang til rapporten. Hver mandag kl. 7 får I også en mail med ugens nye signaler, kommende møder og udbud.\n\nSvar på denne mail, hvis noget mangler, eller I vil have flere kommuner med.",
        'Åbn rapporten', er_link($k), "Linket er personligt. Del det kun i jeres egen virksomhed.");
    send_mail((string)$k['email'], 'Jeres rapport på Sagsvagt Erhverv er klar', $html, $tekst);
    $navne = array_column(er_indeks()['kommuner'], 'navn', 'slug');
    $t = "Firma: {$k['firma']}\nKontakt: {$k['kontakt']} <{$k['email']}>\nProdukt: " . (ER_PRODUKTER[$k['produkt']] ?? '') . "\nKommuner: "
       . implode(', ', array_map(fn($s) => $navne[$s] ?? $s, er_liste((string)$k['kommuner']))) . "\nSøgeord: {$k['ord']}\nPrøve til: $slut\n{$k['noter']}\n";
    @send_mail(TILMELDINGER_TIL, "Erhverv: ny prøve fra {$k['firma']}", '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($t, ENT_QUOTES, 'UTF-8') . '</pre>', $t, (string)$k['email']);
    vis_side('Prøven er startet', "Rapporten for {$k['firma']} er klar og kører til og med " . mm_dato($slut) . ". Vi har også sendt linket på mail.", $aabn($k));
}
vis_side('Start prøven?', "Start 14 dages gratis prøve på Sagsvagt Erhverv for {$k['firma']}.", knap_form('Start prøven'));
