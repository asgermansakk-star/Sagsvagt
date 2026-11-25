<?php
// Redaktionen: spørgeskemaet til dem, der har brugt Sagsvagt i over en måned. Linket kommer som en boks i mandagsmailen.
// handling 'status' (standard): om runden er slået til, hvor mange der kan få boksen, har fået den og har svaret,
//   og svarene talt op. handling 'aktiv' (til: true/false): slår boksen i mandagsmailen til eller fra.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_mandagsmail.php';
require __DIR__ . '/../_spoergeskema.php';

$d = kraev_post();
kraev_admin();
$db = db(); spoerg_tabeller($db);
if (($d['handling'] ?? 'status') === 'aktiv') spoerg_saet_aktiv($db, !empty($d['til']));

$tael = function (string $sql, array $p = []) use ($db): int { $q = $db->prepare($sql); $q->execute($p); return (int)$q->fetchColumn(); };
// Kan få boksen i næste mandagsmail: får mandagsmailen, bekræftet for over en måned siden, har ikke svaret og ikke fået den for mange gange
$kan = $tael('SELECT COUNT(*) FROM abonnenter WHERE ' . MM_KAN . ' AND bekraeftet <= ?
    AND id NOT IN (SELECT abonnent_id FROM spoergeskema_svar WHERE runde = ? AND abonnent_id IS NOT NULL)
    AND (SELECT COUNT(*) FROM spoergeskema_sendt s WHERE s.abonnent_id = abonnenter.id AND s.runde = ?) < ' . SPOERG_GANGE, [spoerg_graense(), SPOERG_RUNDE, SPOERG_RUNDE]); // tallet står i SQL'en: SQLite sammenligner ellers tal med tekst
$vist = $tael('SELECT COUNT(DISTINCT abonnent_id) FROM spoergeskema_sendt WHERE runde = ?', [SPOERG_RUNDE]);

$q = $db->prepare('SELECT s.svar, s.opdateret, a.email FROM spoergeskema_svar s LEFT JOIN abonnenter a ON a.id = s.abonnent_id WHERE s.runde = ? ORDER BY s.opdateret DESC');
$q->execute([SPOERG_RUNDE]);
$alle = $q->fetchAll();
$optalt = []; $tekster = [];
foreach (SPOERG as $navn => $s) if (in_array($s['type'], ['flere', 'et', 'tal'], true)) $optalt[$navn] = [];
foreach ($alle as $r) {
    $s = json_decode($r['svar'], true) ?: [];
    foreach ($optalt as $navn => $_) {
        if (!isset($s[$navn])) continue;
        foreach ((array)$s[$navn] as $v) { $k = (string)$v; $optalt[$navn][$k] = ($optalt[$navn][$k] ?? 0) + 1; }
    }
    if (!empty($s['mangler']) || !empty($s['hjulpet_tekst'])) {
        $tekster[] = ['mangler' => $s['mangler'] ?? '', 'hjulpet' => $s['hjulpet_tekst'] ?? '', 'rolle' => $s['rolle'] ?? '',
            'email' => !empty($s['kontakt']) ? (string)($r['email'] ?? '') : '', 'tid' => $r['opdateret']];
    }
}
// Anbefaling (0-10) som NPS: andelen 9-10 minus andelen 0-6
$a = $optalt['anbefal']; $n = array_sum($a);
$nps = $n ? (int)round(100 * (array_sum(array_intersect_key($a, array_flip(['9', '10']))) - array_sum(array_filter($a, fn($k) => (int)$k <= 6, ARRAY_FILTER_USE_KEY))) / $n) : null;

svar(200, ['runde' => SPOERG_RUNDE, 'aktiv' => spoerg_aktiv($db), 'dage' => SPOERG_DAGE, 'gange' => SPOERG_GANGE, 'kan_faa' => $kan, 'vist' => $vist,
    'svar' => count($alle), 'optalt' => $optalt, 'nps' => $nps, 'tekster' => $tekster]);
