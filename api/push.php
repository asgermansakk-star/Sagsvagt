<?php
// Push-beskeder fra appen (Min avis): hent serverens offentlige nøgle, slå beskeder til eller fra på denne enhed,
// eller send en testbesked til sig selv. Kun for den, der er logget ind.
declare(strict_types=1);
require __DIR__ . '/_push.php';

// Den offentlige nøgle må alle se (den bruges af telefonen til at oprette abonnementet)
if ($_SERVER['REQUEST_METHOD'] === 'GET') svar(200, ['noegle' => vapid()['offentlig']]);

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
$db = push_db();
$handling = (string)($d['handling'] ?? '');

if ($handling === 'til') {
    begraens('push-til:' . $b['id'], 20, 3600);
    $a = $d['abonnement'] ?? [];
    $endpoint = (string)($a['endpoint'] ?? ''); $p256dh = (string)($a['keys']['p256dh'] ?? ''); $auth = (string)($a['keys']['auth'] ?? '');
    // Kun browsernes egne push-tjenester (https, standardport), og nøglerne skal have den rigtige længde. Ellers kunne
    // serveren bruges til at sende forespørgsler til adresser, den ikke burde kontakte.
    if (strlen($endpoint) > 1000 || !preg_match('~^https://([a-z0-9.-]+)/~i', $endpoint, $m) || !push_vaert_ok(strtolower($m[1]))) fejl(400, 'Ugyldigt abonnement');
    if (strlen(b64u_dec($p256dh)) !== 65 || strlen(b64u_dec($auth)) !== 16) fejl(400, 'Ugyldigt abonnement');
    $h = hash('sha256', $endpoint);
    $db->prepare('DELETE FROM push_abonnementer WHERE endpoint_hash = ?')->execute([$h]);
    $db->prepare('INSERT INTO push_abonnementer (abonnent_id, endpoint_hash, endpoint, p256dh, auth, oprettet) VALUES (?, ?, ?, ?, ?, ?)')
       ->execute([$b['id'], $h, $endpoint, $p256dh, $auth, nu()]);
    svar(200, ['ok' => true]);
}
if ($handling === 'fra') {
    $endpoint = (string)($d['endpoint'] ?? '');
    $db->prepare('DELETE FROM push_abonnementer WHERE endpoint_hash = ? AND abonnent_id = ?')->execute([hash('sha256', $endpoint), $b['id']]);
    svar(200, ['ok' => true]);
}
if ($handling === 'test') {
    begraens('push-test:' . $b['id'], 5, 3600);
    $r = push_til_abonnent((int)$b['id'], [
        'title' => 'Beskeder er slået til',
        'body' => 'Du får besked her, når der kommer nye sager om det, du følger. Højst én gang pr. opdatering.',
        'url' => '/min/', 'tag' => 'sagsvagt-test',
    ]);
    svar(200, $r);
}
fejl(400, 'Ukendt handling');
