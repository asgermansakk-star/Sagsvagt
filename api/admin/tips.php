<?php
// Redaktionen: tipalarmen til lokale medier (api/_tips.php).
//   liste (standard): redaktionerne og de åbne kommuner
//   gem:      opret eller ret en redaktion ({id (0 opretter), navn, kommune, modtagere, aktiv})
//   forhaand: den mail, redaktionen ville få med tipsene fra de seneste 14 dage (uden at sende); proeve sender den til redaktionen
//   slet:     sletter redaktionen og det, den har fået
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_tips.php';

$d = kraev_post();
kraev_admin();
$db = db(); tip_tabeller($db);
$handling = (string)($d['handling'] ?? 'liste');
$id = (int)($d['id'] ?? 0);
$hent = function (int $id) use ($db): array {
    $q = $db->prepare('SELECT * FROM tip_redaktioner WHERE id = ?'); $q->execute([$id]);
    return $q->fetch() ?: fejl(404, 'Redaktionen findes ikke.');
};
$navne = array_column(mm_aabne(), 'navn', 'slug');

if ($handling === 'gem') {
    $navn = trim(mb_substr((string)($d['navn'] ?? ''), 0, 120));
    $kommune = (string)($d['kommune'] ?? '');
    $modtagere = array_values(array_unique(array_filter(array_map('ren_email', explode(',', (string)($d['modtagere'] ?? ''))))));
    if ($navn === '') fejl(400, 'Skriv redaktionens navn.');
    if (!isset($navne[$kommune])) fejl(400, 'Vælg en åben kommune.');
    if (!$modtagere) fejl(400, 'Skriv mindst én gyldig mailadresse.');
    $felter = [$navn, $kommune, implode(', ', array_slice($modtagere, 0, 20)), empty($d['aktiv']) ? 0 : 1];
    if ($id > 0) {
        $gammel = $hent($id);
        $db->prepare('UPDATE tip_redaktioner SET navn = ?, kommune = ?, modtagere = ?, aktiv = ? WHERE id = ?')->execute([...$felter, $id]);
        // Ny kommune: begynd forfra, så den ikke får alle kommunens gamle sager
        if ($gammel['kommune'] !== $kommune) $db->prepare('DELETE FROM tip_set WHERE redaktion_id = ?')->execute([$id]);
    } else {
        $db->prepare('INSERT INTO tip_redaktioner (navn, kommune, modtagere, aktiv, oprettet) VALUES (?, ?, ?, ?, ?)')->execute([...$felter, nu()]);
        $id = (int)$db->lastInsertId();
    }
    // Husk de sager, der findes nu, så den første alarm kun har det, der kommer efter
    $v = tip_nye($db, $hent($id), false);
    $ins = $db->prepare('INSERT INTO tip_set (redaktion_id, sag_id) VALUES (?, ?)');
    $db->beginTransaction();
    foreach ($v['husk'] as $s) { try { $ins->execute([$id, $s]); } catch (PDOException $e) {} }
    $db->commit();
}
if ($handling === 'slet') {
    $db->prepare('DELETE FROM tip_set WHERE redaktion_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM tip_redaktioner WHERE id = ?')->execute([$id]);
}
if ($handling === 'forhaand' || $handling === 'proeve') {
    global $K;
    $r = $hent($id);
    $alle = tip_sager((string)$r['kommune']);
    $tips = array_values(array_filter($alle, fn($s) => $s['tip']));
    usort($tips, fn($a, $b) => $b['tip']['p'] <=> $a['tip']['p'] ?: strcmp($b['dato'], $a['dato']));
    if (!$tips) svar(200, ['mail' => null]);
    $m = tip_mail($r, $navne[$r['kommune']] ?? $r['kommune'], array_slice($tips, 0, 10), count($alle) - min(10, count($tips)), (string)$r['kommune']);
    if ($handling === 'proeve') {
        // Redaktionens kopi må ikke kunne stoppe alarmen
        $erstat = [tip_stop_link($id) => $K['site_url'], mm_esc(tip_stop_link($id)) => $K['site_url']];
        foreach ($K['admins'] as $til) send_mail($til, '[Prøve] ' . $m['emne'], strtr($m['html'], $erstat), strtr($m['tekst'], $erstat));
        svar(200, ['ok' => true, 'sendt_til' => $K['admins']]);
    }
    svar(200, ['mail' => $m, 'modtagere' => tip_modtagere($r)]);
}
$redaktioner = $db->query('SELECT * FROM tip_redaktioner ORDER BY aktiv DESC, navn')->fetchAll();
svar(200, ['ok' => true, 'id' => $id, 'redaktioner' => $redaktioner, 'kommuner' => $navne, 'genereret' => tip_indeks()['genereret'] ?? null]);
