<?php
// Redaktionen: mandagsmailen. "forhaand" laver ugens mail til hver tilmeldt på serveren (api/_mandagsmail_lav.php, den
// samme mail som den automatiske udsendelse) og fortæller, om ugen er planlagt eller stoppet. "modtagere" giver de
// tilmeldte, der kan få ugens mail. "send" sender én mail og husker det, så ingen får samme uges mail to gange.
// "planlaeg" lægger mailen i kø til et senere tidspunkt (sendes ved første besøg derefter, se api/_mandagsmail.php),
// og "fortryd" stopper ugens mail: tømmer køen, også den automatiske, og planlægger den ikke igen.
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

if ($handling === 'forhaand') {
    $q = $db->prepare('SELECT planlagt, antal, stoppet FROM mandagsmail_uger WHERE uge = ?'); $q->execute([$uge]);
    $mails = array_map(fn($m) => ['a' => array_intersect_key($m['a'], array_flip(['id', 'email', 'kommuner', 'sendt', 'planlagt'])), 'type' => $m['type'],
        'kommuner' => $m['profil']['kommuner'], 'spring' => $m['spring'], 'mail' => array_intersect_key($m['mail'], array_flip(['emne', 'html', 'tekst']))], mm_ugens_mails($db, $uge));
    svar(200, ['mails' => $mails, 'uge' => $q->fetch() ?: null, 'auto' => mm_kl7($uge)]);
}

if ($handling === 'fortryd') {
    svar(200, ['ok' => true, 'fjernet' => mm_stop($db, $uge)]);
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
