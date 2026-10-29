<?php
// Driftsstatus til alarmen på Mac'en: kører opgaverne efter besøg, er mandagsmailen (og Erhvervsmailen) planlagt og sendt,
// og hvor gamle er datafilerne. Kræver headeren X-Dashboard-Key (samme nøgle som dashboard.php). Ingen e-mailadresser.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

const NOEGLE_SHA256 = 'b7668301e894baa4c11c32f9d43bd80e662a76b221e0daab6875f113cd3649cc';
if (!hash_equals(NOEGLE_SHA256, hash('sha256', (string)($_SERVER['HTTP_X_DASHBOARD_KEY'] ?? '')))) {
    begraens('drift:' . ip(), 20, 3600);
    fejl(403, 'Ikke tilladt');
}

$db = db();
$rk = function (string $sql, array $p = []) use ($db): array { try { $q = $db->prepare($sql); $q->execute($p); return $q->fetchAll(); } catch (PDOException $e) { return []; } };
$en = fn(string $sql, array $p = []) => $rk($sql, $p)[0] ?? null;
$ind = [];
foreach ($rk("SELECT noegle, vaerdi FROM indstillinger WHERE noegle LIKE 'drift:%' OR noegle LIKE 'fejl:%'") as $r) $ind[$r['noegle']] = $r['vaerdi'];

// Ugerne kendes på mandagens dato: denne uges og næste uges mandag (dansk tid)
$nu = new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen'));
$denne = $nu->modify('monday this week')->format('Y-m-d');
$naeste = $nu->modify('monday next week')->format('Y-m-d');
$uge = function (string $prefix, string $uge) use ($en): array {
    $u = $en("SELECT * FROM {$prefix}_uger WHERE uge = ?", [$uge]);
    $koe = $en("SELECT COUNT(*) n FROM {$prefix}_koe WHERE uge = ?", [$uge]);
    $sendt = $en("SELECT COUNT(*) n, MIN(sendt) foerste, MAX(sendt) sidste FROM {$prefix}_sendt WHERE uge = ?", [$uge]);
    return ['uge' => $uge, 'planlagt' => $u['planlagt'] ?? null, 'faerdig' => $u['faerdig'] ?? null, 'antal' => isset($u['antal']) ? (int)$u['antal'] : null,
        'stoppet' => $u['stoppet'] ?? null, 'i_koe' => (int)($koe['n'] ?? 0), 'sendt' => (int)($sendt['n'] ?? 0), 'foerste_sendt' => $sendt['foerste'] ?? null, 'sidste_sendt' => $sendt['sidste'] ?? null];
};
$rod = dirname(__DIR__, 2);
$alder = function (string $fil) use ($rod): ?string { $t = @filemtime("$rod/$fil"); return $t ? gmdate('Y-m-d\TH:i:s\Z', $t) : null; };
$besoeg = $en('SELECT MAX(dato) d, SUM(CASE WHEN dato = ? THEN antal ELSE 0 END) i_dag FROM besoeg', [$nu->format('Y-m-d')]);

svar(200, [
    'nu' => nu(),
    'php' => ['version' => PHP_VERSION, 'fastcgi_finish_request' => function_exists('fastcgi_finish_request'), 'litespeed_finish_request' => function_exists('litespeed_finish_request')],
    'opgaver' => ['sidst_koert' => array_filter($ind, fn($k) => str_starts_with($k, 'drift:'), ARRAY_FILTER_USE_KEY),
        'seneste_fejl' => array_filter($ind, fn($k) => str_starts_with($k, 'fejl:'), ARRAY_FILTER_USE_KEY)],
    'mandagsmail' => ['denne' => $uge('mandagsmail', $denne), 'naeste' => $uge('mandagsmail', $naeste)],
    'erhverv' => ['denne' => $uge('erhverv', $denne), 'naeste' => $uge('erhverv', $naeste),
        'kunder' => (int)($en("SELECT COUNT(*) n FROM erhverv_kunder WHERE status IN ('proeve', 'aktiv')")['n'] ?? 0),
        // Bookinger fra salgssiden de sidste 7 dage, så alarmen kan give besked om hver ny (firma og produkt, ingen adresser)
        'henvendelser' => $rk('SELECT id, firma, produkt, oprettet FROM erhverv_henvendelser WHERE oprettet >= ? ORDER BY id', [gmdate('Y-m-d\TH:i:s\Z', time() - 7 * 86400)])],
    'filer' => ['sager' => $alder('assets/sager.json'), 'aabne' => $alder('kommune/aabne.json'), 'erhverv_signaler' => $alder('api/_erhverv-signaler.json'), 'udbud' => $alder('data/udbud.json')],
    'besoeg' => ['seneste_dag' => $besoeg['d'] ?? null, 'i_dag' => (int)($besoeg['i_dag'] ?? 0)],
]);
