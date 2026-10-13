<?php
// Tilmelding fra sagsvagt.dk: gemmer den tilmeldte, giver redaktionen besked og sender en kvittering.
// Tilmelder samme e-mail sig igen, opdateres kommuner, emner og rolle.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
begraens('tilmeld:' . ip(), 20, 3600);
// Det usynlige felt "_honey" udfyldes kun af robotter: svar "ok", men gem intet og send ingen mails
if (trim((string)($d['_honey'] ?? '')) !== '') svar(200, ['ok' => true]);
$email = ren_email($d['email'] ?? '');
if ($email === '') fejl(400, 'Skriv en gyldig e-mailadresse.');
$felt = fn($k, $max) => mb_substr(trim((string)($d[$k] ?? '')), 0, $max);
$kommuner = $felt('kommuner', 500); $rolle = $felt('rolle', 100); $kilde = $felt('kilde', 100);
$emner = $felt('emner', 2000); $valgte = $felt('valgte_emner', 1000);
$alleEmner = trim(implode(', ', array_filter([$valgte, $emner])), ', ');

$db = db();
$q = $db->prepare('SELECT id, status FROM abonnenter WHERE email = ?'); $q->execute([$email]);
$fandtes = $q->fetch();
if ($fandtes) {
    $db->prepare("UPDATE abonnenter SET kommuner = ?, emner = ?, rolle = ?, status = CASE WHEN status = 'afmeldt' THEN 'tilmeldt' ELSE status END WHERE id = ?")
       ->execute([$kommuner, $alleEmner, $rolle, $fandtes['id']]);
} else {
    $db->prepare('INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet) VALUES (?, ?, ?, ?, ?, ?)')
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu()]);
}

// Besked til redaktionen og kvittering til den tilmeldte. Fejler mailen, er tilmeldingen stadig gemt.
$linjer = "E-mail: $email\nKommuner: $kommuner\nEmner: $alleEmner\nJeg er: $rolle\nKilde: $kilde\n" . ($fandtes ? "(Var allerede tilmeldt og har opdateret sine valg.)\n" : '');
@send_mail($K['tilmeldinger_til'], ($fandtes ? 'Opdateret tilmelding' : 'Ny tilmelding') . " til Sagsvagt: $email",
    '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer);
if (!$fandtes) {
    [$html, $tekst] = mail_skabelon('Tak, fordi du har skrevet dig op',
        "Vi giver besked, når din kommune er klar. Derefter får du én mail hver mandag med de sager fra byråd, udvalg og lokaludvalg, der handler om dine emner.\n\nVil du ændre dine emner eller afmelde dig, så svar på denne mail.",
        'Læs, hvordan vi behandler dine oplysninger', $K['site_url'] . 'privatliv.html',
        "Du får denne mail, fordi $email er skrevet op til Sagsvagt.");
    @send_mail($email, 'Du er skrevet op til Sagsvagt', $html, $tekst);
}
svar(200, ['ok' => true]);
