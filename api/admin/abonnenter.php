<?php
// Redaktionen: liste over alle tilmeldte med status. Adgangskoder og profiler sendes aldrig med.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

kraev_post();
kraev_admin();
$l = db()->query('SELECT id, email, kommuner, emner, rolle, kilde, status, oprettet, inviteret, sidst_inde, mail_fejl FROM abonnenter ORDER BY oprettet DESC')->fetchAll();
$tael = array_count_values(array_column($l, 'status'));
svar(200, ['abonnenter' => $l, 'antal' => $tael]);
