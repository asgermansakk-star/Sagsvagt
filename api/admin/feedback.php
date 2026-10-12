<?php
// Redaktionen: al feedback fra Min avis, nyeste først.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

kraev_post();
kraev_admin();
svar(200, ['feedback' => db()->query('SELECT id, email, vurdering, tekst, side, kontakt, oprettet FROM feedback ORDER BY oprettet DESC LIMIT 500')->fetchAll()]);
