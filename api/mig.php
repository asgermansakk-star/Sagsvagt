<?php
// Hvem er logget ind? Min avis spørger her, når siden åbnes. 401 betyder: vis login.
declare(strict_types=1);
require __DIR__ . '/_pakker.php';

$db = db(); // Tjekker forbindelsen til databasen, så fejl i _konfig.php viser sig her, også når man ikke er logget ind
pakker_tabeller($db);
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
svar(200, [
    'email' => $b['email'],
    'profil' => $b['profil'] ? json_decode($b['profil'], true) : null,
    'tilmelding' => ['kommuner' => $b['kommuner'], 'emner' => $b['emner'], 'rolle' => $b['rolle']],
    'admin' => er_admin($b),
    // Plus og Pro (priser.html): læserens pakke, og om bestilling er åben
    'pakke' => pakke_af($b),
    'fortryd_til' => pakke_kan_fortryde($b) ? pakke_fortryd_til($b['pakke_fra']) : null,
    'pakker' => ['aaben' => pakker_aaben($db), 'liste' => PAKKER],
]);
