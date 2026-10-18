<?php
// Redaktionen: mandagsmailen. "modtagere" giver de tilmeldte, der kan få ugens mail; "send" sender én mail, som
// admin-siden har lavet med assets/mandagsmail.js, og husker det, så ingen får samme uges mail to gange.
// Intet sendes af sig selv: redaktionen trykker Send på admin-siden.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

$d = kraev_post();
kraev_admin();
$db = db();
$db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_sendt (abonnent_id INT NOT NULL, uge VARCHAR(10) NOT NULL, sendt VARCHAR(25) NOT NULL, PRIMARY KEY (abonnent_id, uge))');

// Ugen kendes på mandagens dato (2026-10-19)
$uge = (string)($d['uge'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $uge)) fejl(400, 'Vælg mandagens dato.');
// Kun dem, der stadig er skrevet op, og hvis adresse ikke er markeret som fejlende
$KAN = "status IN ('tilmeldt', 'inviteret', 'aktiv') AND mail_fejl IS NULL";

$handling = (string)($d['handling'] ?? '');
if ($handling === 'modtagere') {
    $q = $db->prepare("SELECT a.id, a.email, a.kommuner, a.emner, a.status, a.profil, m.sendt
        FROM abonnenter a LEFT JOIN mandagsmail_sendt m ON m.abonnent_id = a.id AND m.uge = ? WHERE $KAN ORDER BY a.oprettet");
    $q->execute([$uge]);
    svar(200, ['modtagere' => $q->fetchAll()]);
}

if ($handling === 'send') {
    $id = (int)($d['id'] ?? 0);
    $emne = trim(mb_substr((string)($d['emne'] ?? ''), 0, 200));
    $html = (string)($d['html'] ?? ''); $tekst = (string)($d['tekst'] ?? '');
    if ($emne === '' || $html === '' || strlen($html) > 300000 || strlen($tekst) > 100000) fejl(400, 'Mailen mangler eller er for stor.');
    $q = $db->prepare("SELECT id, email FROM abonnenter WHERE id = ? AND $KAN"); $q->execute([$id]);
    $a = $q->fetch();
    if (!$a) fejl(404, 'Den tilmeldte kan ikke få mails.');
    $q = $db->prepare('SELECT sendt FROM mandagsmail_sendt WHERE abonnent_id = ? AND uge = ?'); $q->execute([$id, $uge]);
    if ($q->fetchColumn()) svar(200, ['ok' => true, 'allerede' => true]);
    // Markér først, så et dobbeltklik eller en ny fane ikke sender to gange; fejler mailen, fjernes markeringen igen
    try { $db->prepare('INSERT INTO mandagsmail_sendt (abonnent_id, uge, sendt) VALUES (?, ?, ?)')->execute([$id, $uge, nu()]); }
    catch (PDOException $e) { svar(200, ['ok' => true, 'allerede' => true]); }
    if (!send_mail($a['email'], $emne, $html, $tekst)) {
        $db->prepare('DELETE FROM mandagsmail_sendt WHERE abonnent_id = ? AND uge = ?')->execute([$id, $uge]);
        fejl(502, 'Mailen til ' . $a['email'] . ' kunne ikke sendes.');
    }
    svar(200, ['ok' => true]);
}

fejl(400, 'Ukendt handling');
