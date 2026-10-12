<?php
// Glemt adgangskode: sender et link, der virker i én time. Svarer altid det samme, så man ikke kan teste, hvem der er tilmeldt.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$email = ren_email($d['email'] ?? '');
begraens('glemt-ip:' . ip(), 10, 3600);
if ($email !== '') {
    begraens('glemt:' . $email, 3, 3600);
    $q = db()->prepare("SELECT id FROM abonnenter WHERE email = ? AND status = 'aktiv'"); $q->execute([$email]);
    if ($id = $q->fetchColumn()) {
        $link = $K['site_url'] . 'min/adgang.html?token=' . lav_token((int)$id, 'nulstil', 1);
        [$html, $tekst] = mail_skabelon('Vælg en ny adgangskode',
            "Nogen har bedt om at nulstille adgangskoden til din Sagsvagt-konto. Var det dig, så tryk på knappen. Linket virker i én time.\n\nVar det ikke dig, kan du se bort fra mailen. Din adgangskode er ikke ændret.",
            'Vælg ny adgangskode', $link, "Du får denne mail, fordi der er bedt om en ny adgangskode til $email.");
        @send_mail($email, 'Ny adgangskode til Sagsvagt', $html, $tekst);
    }
}
svar(200, ['ok' => true]);
