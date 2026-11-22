<?php
// Er bestilling af Plus og Pro åben, og hvad koster de? priser.html spørger her og viser "Bestil" eller "Skriv til os".
declare(strict_types=1);
require __DIR__ . '/_pakker.php';
require __DIR__ . '/_loft.php';

if (!loft_ok('pakker', 120, 600, ip())) { header('Retry-After: 600'); fejl(429, 'For mange forsøg. Vent lidt, og prøv igen.'); }
svar(200, ['aaben' => pakker_aaben(db()), 'pakker' => PAKKER]);
