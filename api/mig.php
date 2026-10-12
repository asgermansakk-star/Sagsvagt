<?php
// Hvem er logget ind? Min avis spørger her, når siden åbnes. 401 betyder: vis login.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

db(); // Tjekker forbindelsen til databasen, så fejl i _konfig.php viser sig her, også når man ikke er logget ind
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
svar(200, [
    'email' => $b['email'],
    'profil' => $b['profil'] ? json_decode($b['profil'], true) : null,
    'tilmelding' => ['kommuner' => $b['kommuner'], 'emner' => $b['emner'], 'rolle' => $b['rolle']],
    'admin' => er_admin($b),
]);
