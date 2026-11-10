<?php
// Er bestilling af Plus og Pro åben, og hvad koster de? priser.html spørger her og viser "Bestil" eller "Skriv til os".
declare(strict_types=1);
require __DIR__ . '/_pakker.php';

svar(200, ['aaben' => pakker_aaben(db()), 'pakker' => PAKKER]);
