<?php
// Redaktionen: send invitation til de valgte (ids), der ikke har oprettet en adgangskode endnu.
// Linket virker i 7 dage. Højst 200 pr. gang, så serveren ikke sender for mange mails på én gang.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

$d = kraev_post();
kraev_admin();
$db = db();
$ids = array_values(array_filter(array_map('intval', is_array($d['ids'] ?? null) ? $d['ids'] : [])));
if (!$ids) fejl(400, 'Vælg mindst én.');
$q = $db->prepare('SELECT id, email FROM abonnenter WHERE status IN (\'tilmeldt\', \'inviteret\') AND mail_fejl IS NULL AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') LIMIT 200');
$q->execute(array_slice($ids, 0, 200)); $l = $q->fetchAll();
$sendt = []; $fejlede = [];
foreach ($l as $a) {
    $link = $K['site_url'] . 'min/adgang.html?token=' . lav_token((int)$a['id'], 'opret', 24 * 7);
    [$html, $tekst] = mail_skabelon('Din adgang til Sagsvagt er klar',
        "Tak, fordi du skrev dig op. Nu kan du få din egen udgave af Sagsvagt: de sager fra byråd, udvalg og lokaludvalg, der handler om dine emner, og hvad politikerne skal tage stilling til.\n\nVælg en adgangskode for at komme i gang. Linket virker i 7 dage.",
        'Opret din adgangskode', $link, "Du får denne mail, fordi {$a['email']} er skrevet op til Sagsvagt.");
    if (send_mail($a['email'], 'Din adgang til Sagsvagt er klar', $html, $tekst)) {
        $db->prepare("UPDATE abonnenter SET status = 'inviteret', inviteret = ? WHERE id = ?")->execute([nu(), $a['id']]);
        $sendt[] = $a['email'];
    } else {
        $fejlede[] = $a['email'];
    }
}
svar(200, ['sendt' => count($sendt), 'fejlede' => $fejlede]);
