<?php
// Redaktionen: mandagsmailen. "modtagere" giver de tilmeldte, der kan få ugens mail; "send" sender én mail, som
// admin-siden har lavet med assets/mandagsmail.js, og husker det, så ingen får samme uges mail to gange.
// "planlaeg" lægger mailen i kø til et senere tidspunkt (sendes ved første besøg derefter, se api/_mandagsmail.php),
// og "fortryd" tømmer ugens kø. Intet sendes af sig selv: redaktionen trykker Send eller planlægger på admin-siden.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_mandagsmail.php';

$d = kraev_post();
kraev_admin();
$db = db();
mm_tabeller($db);

// Ugen kendes på mandagens dato (2026-10-19)
$uge = (string)($d['uge'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $uge)) fejl(400, 'Vælg mandagens dato.');
$KAN = MM_KAN;

$handling = (string)($d['handling'] ?? '');
if ($handling === 'modtagere') {
    $q = $db->prepare("SELECT a.id, a.email, a.kommuner, a.emner, a.status, a.profil, m.sendt, k.send_efter AS planlagt
        FROM abonnenter a LEFT JOIN mandagsmail_sendt m ON m.abonnent_id = a.id AND m.uge = ?
        LEFT JOIN mandagsmail_koe k ON k.abonnent_id = a.id AND k.uge = ? WHERE $KAN ORDER BY a.oprettet");
    $q->execute([$uge, $uge]);
    svar(200, ['modtagere' => $q->fetchAll()]);
}

if ($handling === 'fortryd') {
    $q = $db->prepare('DELETE FROM mandagsmail_koe WHERE uge = ?'); $q->execute([$uge]);
    svar(200, ['ok' => true, 'fjernet' => $q->rowCount()]);
}

if ($handling === 'send' || $handling === 'planlaeg') {
    $id = (int)($d['id'] ?? 0);
    $emne = trim(mb_substr((string)($d['emne'] ?? ''), 0, 200));
    $html = (string)($d['html'] ?? ''); $tekst = (string)($d['tekst'] ?? '');
    if ($emne === '' || $html === '' || strlen($html) > 300000 || strlen($tekst) > 100000) fejl(400, 'Mailen mangler eller er for stor.');
    $q = $db->prepare("SELECT id, email FROM abonnenter WHERE id = ? AND $KAN"); $q->execute([$id]);
    $a = $q->fetch();
    if (!$a) fejl(404, 'Den tilmeldte kan ikke få mails.');
    $q = $db->prepare('SELECT sendt FROM mandagsmail_sendt WHERE abonnent_id = ? AND uge = ?'); $q->execute([$id, $uge]);
    if ($q->fetchColumn()) svar(200, ['ok' => true, 'allerede' => true]);

    if ($handling === 'planlaeg') {
        // Tidspunktet i UTC som nu() ("2026-10-19T06:00:00Z"), så det kan sammenlignes som tekst
        $tid = (string)($d['tid'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $tid) || $tid <= nu()) fejl(400, 'Vælg et tidspunkt, der ikke er passeret.');
        // Planlægges samme uge igen (fx efter en rettelse), erstattes den gamle mail
        $db->prepare('DELETE FROM mandagsmail_koe WHERE abonnent_id = ? AND uge = ?')->execute([$id, $uge]);
        $db->prepare('INSERT INTO mandagsmail_koe (abonnent_id, uge, emne, html, tekst, send_efter) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$id, $uge, $emne, $html, $tekst, $tid]);
        svar(200, ['ok' => true, 'planlagt' => $tid]);
    }

    $svar = mm_send_en($db, $id, $a['email'], $uge, $emne, $html, $tekst);
    if ($svar === 'allerede') svar(200, ['ok' => true, 'allerede' => true]);
    if ($svar === 'fejl') fejl(502, 'Mailen til ' . $a['email'] . ' kunne ikke sendes.');
    // Sendt nu: en planlagt udgave af samme mail skal ikke også ud
    $db->prepare('DELETE FROM mandagsmail_koe WHERE abonnent_id = ? AND uge = ?')->execute([$id, $uge]);
    svar(200, ['ok' => true]);
}

fejl(400, 'Ukendt handling');
