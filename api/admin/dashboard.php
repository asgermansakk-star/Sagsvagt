<?php
// Tal til hjemmeskærmen på Mac'en (fuld/sagsvagt.js): tilmeldte, konti og besøg, uden e-mailadresser i klartekst.
// Kræver headeren X-Dashboard-Key. Nøglen ligger i Mac'ens nøglering (Sagsvagt-dashboard / live-noegle); her står kun dens SHA-256.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

const NOEGLE_SHA256 = 'b7668301e894baa4c11c32f9d43bd80e662a76b221e0daab6875f113cd3649cc';

if (!hash_equals(NOEGLE_SHA256, hash('sha256', (string)($_SERVER['HTTP_X_DASHBOARD_KEY'] ?? '')))) {
    begraens('dashboard:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 20, 3600);
    fejl(403, 'Ikke tilladt');
}

$db = db();
// Redaktionens egne konti tæller ikke med
$admins = $K['admins'] ?? [];
$uden = $admins ? ' AND email NOT IN (' . implode(',', array_fill(0, count($admins), '?')) . ')' : '';
$rk = function (string $sql, array $p = []) use ($db): array { $q = $db->prepare($sql); $q->execute($p); return $q->fetchAll(); };

$antal = [];
foreach ($rk("SELECT status, COUNT(*) n FROM abonnenter WHERE 1=1$uden GROUP BY status", $admins) as $r) $antal[$r['status']] = (int)$r['n'];
// En konto = en adgangskode (afmelding fjerner den). Rækker med status 'medlem' er kun foreningsmedlemmer uden login.
$konti = (int)$rk("SELECT COUNT(*) n FROM abonnenter WHERE adgangskode IS NOT NULL AND status NOT IN ('afmeldt', 'medlem')$uden", $admins)[0]['n'];
$prDag = $kontiPrDag = [];
foreach ($rk("SELECT SUBSTR(oprettet, 1, 10) d, COUNT(*) n, SUM(CASE WHEN adgangskode IS NOT NULL AND status NOT IN ('afmeldt', 'medlem') THEN 1 ELSE 0 END) k FROM abonnenter WHERE 1=1$uden GROUP BY d", $admins) as $r) {
    $prDag[$r['d']] = (int)$r['n'];
    if ((int)$r['k']) $kontiPrDag[$r['d']] = (int)$r['k'];
}
$maske = fn(string $e) => preg_replace('/^(.)[^@]*(@.*)$/', '$1•••$2', $e);
$seneste = array_map(fn($r) => ['email' => $maske($r['email']), 'kommuner' => $r['kommuner'], 'status' => $r['status'], 'oprettet' => $r['oprettet'], 'konto' => (bool)$r['konto']],
    $rk("SELECT email, kommuner, status, oprettet, adgangskode IS NOT NULL konto FROM abonnenter WHERE 1=1$uden ORDER BY oprettet DESC LIMIT 8", $admins));

// Besøg fra den anonyme tæller (api/besoeg.php); tabellen findes først efter første besøg
$besoeg = null;
try {
    $fra30 = gmdate('Y-m-d', time() - 29 * 86400); $fra7 = gmdate('Y-m-d', time() - 6 * 86400);
    $b = ['prDag' => []];
    foreach ($rk('SELECT dato, SUM(antal) n FROM besoeg WHERE dato >= ? GROUP BY dato', [$fra30]) as $r) $b['prDag'][$r['dato']] = (int)$r['n'];
    $b['sider'] = $rk('SELECT sti, SUM(antal) n FROM besoeg WHERE dato >= ? GROUP BY sti ORDER BY n DESC LIMIT 8', [$fra7]);
    $b['kilder'] = $rk('SELECT kilde, SUM(antal) n FROM besoeg WHERE dato >= ? GROUP BY kilde ORDER BY n DESC LIMIT 6', [$fra7]);
    $besoeg = $b;
} catch (PDOException $e) {}

svar(200, ['antal' => $antal, 'ialt' => array_sum($antal), 'konti' => $konti, 'kontiPrDag' => $kontiPrDag, 'prDag' => $prDag, 'seneste' => $seneste, 'besoeg' => $besoeg]);
