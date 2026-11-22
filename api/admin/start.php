<?php
// Første gang: sender en invitation til redaktionens egne adresser (admins i _konfig.php), hvis de ikke har en adgangskode.
// Kan ikke bruges til andre adresser, og linket havner i redaktionens egen indbakke. Så snart en i redaktionen har en
// konto, kan kun redaktionen selv invitere de andre; før det er siden åben, så den første kan komme ind.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

kraev_post();
begraens('admin-start:' . ip(), 3, 3600);
begraens('admin-start', 6, 86400);
$db = db();
$q = $db->prepare("SELECT 1 FROM abonnenter WHERE email = ? AND status = 'aktiv' AND adgangskode IS NOT NULL");
foreach ($K['admins'] as $email) { $q->execute([ren_email($email)]); if ($q->fetchColumn()) { kraev_admin(); break; } }
foreach ($K['admins'] as $email) {
    $email = ren_email($email);
    if ($email === '') continue;
    $q = $db->prepare('SELECT id, adgangskode FROM abonnenter WHERE email = ?'); $q->execute([$email]);
    $a = $q->fetch();
    if (!$a) { $db->prepare('INSERT INTO abonnenter (email, kilde, oprettet) VALUES (?, ?, ?)')->execute([$email, 'redaktion', nu()]); $a = ['id' => (int)$db->lastInsertId(), 'adgangskode' => null]; }
    if ($a['adgangskode']) continue;
    $link = $K['site_url'] . 'min/adgang.html?token=' . lav_token((int)$a['id'], 'opret', 24);
    [$html, $tekst] = mail_skabelon('Opret din redaktionskonto', "Vælg en adgangskode til Sagsvagts redaktion. Linket virker i 24 timer.", 'Opret adgangskode', $link, "Sendt til redaktionen på Sagsvagt.");
    @send_mail($email, 'Opret din redaktionskonto på Sagsvagt', $html, $tekst);
}
svar(200, ['ok' => true]);
