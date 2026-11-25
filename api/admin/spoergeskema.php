<?php
// Redaktionen: spørgeskemaet til dem, der har brugt Sagsvagt i over en måned.
// handling 'status' (standard): hvor mange der kan få det, er sendt til og har svaret, og svarene talt op.
// handling 'proeve': sender mailen til redaktørens egen adresse (tæller ikke som sendt).
// handling 'send': sender til dem, der kan få det og ikke har fået det i denne runde. Højst 200 pr. gang.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_spoergeskema.php';

$d = kraev_post();
$admin = kraev_admin();
$db = db(); spoerg_tabeller($db);
$h = (string)($d['handling'] ?? 'status');
$graense = spoerg_graense();

if ($h === 'proeve') {
    [$emne, $html, $tekst] = spoerg_mail((int)$admin['id'], $admin['email']);
    if (!send_mail($admin['email'], "[Prøve] $emne", $html, $tekst)) fejl(500, 'Mailen kunne ikke sendes.');
    svar(200, ['ok' => true, 'sendt_til' => $admin['email']]);
}

if ($h === 'send') {
    $q = $db->prepare('SELECT id, email FROM abonnenter WHERE ' . spoerg_kan_sql() . ' ORDER BY id LIMIT 200');
    $q->execute([$graense, SPOERG_RUNDE]);
    $sendt = 0; $fejlede = [];
    foreach ($q->fetchAll() as $a) {
        [$emne, $html, $tekst] = spoerg_mail((int)$a['id'], $a['email']);
        $hoveder = ['List-Unsubscribe' => '<' . afmeld_link((int)$a['id']) . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click'];
        if (send_mail($a['email'], $emne, $html, $tekst, '', $hoveder)) {
            $db->prepare('INSERT INTO spoergeskema_sendt (abonnent_id, runde, tid) VALUES (?, ?, ?)')->execute([$a['id'], SPOERG_RUNDE, nu()]);
            $sendt++;
        } else {
            $fejlede[] = $a['email'];
        }
    }
    $h = 'status';
    $resultat = ['sendt_nu' => $sendt, 'fejlede' => $fejlede];
}

$tael = function (string $sql, array $p = []) use ($db): int { $q = $db->prepare($sql); $q->execute($p); return (int)$q->fetchColumn(); };
$kan = $tael('SELECT COUNT(*) FROM abonnenter WHERE ' . spoerg_kan_sql(), [$graense, SPOERG_RUNDE]);
// Over en måned, men kun ja til mandagsmailen (eller ja til alt fra før 22/11-2026): får det ikke uden et nyt ja
$kunMandag = $tael("SELECT COUNT(*) FROM abonnenter WHERE status IN ('tilmeldt', 'inviteret', 'aktiv') AND mail_fejl IS NULL AND bekraeftet IS NOT NULL AND bekraeftet <= ? AND mail_afmeldt IS NULL AND (samtykke IS NULL OR samtykke = 'mandag')", [$graense]);
$sendtIalt = $tael('SELECT COUNT(*) FROM spoergeskema_sendt WHERE runde = ?', [SPOERG_RUNDE]);

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

svar(200, ($resultat ?? []) + ['runde' => SPOERG_RUNDE, 'dage' => SPOERG_DAGE, 'kan_faa' => $kan, 'kun_mandag' => $kunMandag, 'sendt' => $sendtIalt,
    'svar' => count($alle), 'optalt' => $optalt, 'nps' => $nps, 'tekster' => $tekster]);
