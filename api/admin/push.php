<?php
// Redaktionen: status for push-beskeder, slå udsendelsen til eller fra, og kør en udsendelse nu.
// Udsendelsen er slået fra, indtil redaktionen slår den til her.
declare(strict_types=1);
require __DIR__ . '/../_push.php';

$d = kraev_post();
kraev_admin();
$db = push_db();
$handling = (string)($d['handling'] ?? 'status');

if ($handling === 'aktiv') push_saet('aktiv', !empty($d['til']) ? '1' : '0');
$koersel = $handling === 'koer' ? push_maaske_koer(true) : null;

svar(200, [
    'aktiv' => push_aktiv(),
    'abonnementer' => (int)$db->query('SELECT COUNT(*) FROM push_abonnementer')->fetchColumn(),
    'personer' => (int)$db->query('SELECT COUNT(DISTINCT abonnent_id) FROM push_abonnementer')->fetchColumn(),
    'sidst_sendt' => $db->query('SELECT MAX(sidst_sendt) FROM push_abonnementer')->fetchColumn() ?: null,
    'koersel' => $koersel,
]);
