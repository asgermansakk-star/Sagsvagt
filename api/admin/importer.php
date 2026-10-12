<?php
// Redaktionen: læg tilmeldte ind, der kom med mail før databasen fandtes.
// Forstår tabellen fra tilmeldingsmailene (kilde, email, kommuner, emner, rolle, valgte_emner), kopieret fra én eller flere
// mails, og almindelige lister med e-mailadresser. Findes en adresse allerede, udfyldes kun de felter, der er tomme.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

$d = kraev_post();
kraev_admin();
$tekst = mb_substr((string)($d['tekst'] ?? ''), 0, 500000);

// 1. Tabeller: linjer som "email<tab>navn@eksempel.dk" eller "kommuner: Brønderslev". Et felt, der allerede er udfyldt,
//    betyder, at en ny tilmelding begynder.
$NOEGLER = 'kilde|email|kommuner|emner|rolle|valgte_emner';
$poster = []; $cur = [];
foreach (preg_split('/\R/u', $tekst) as $l) {
    if (!preg_match("/^\\s*($NOEGLER)\\b[\\t: ]*(.*)$/iu", $l, $m)) continue;
    $k = mb_strtolower($m[1]);
    if (isset($cur[$k])) { $poster[] = $cur; $cur = []; }
    $cur[$k] = trim($m[2]);
}
if ($cur) $poster[] = $cur;
$poster = array_values(array_filter($poster, fn($p) => ren_email($p['email'] ?? '') !== ''));

// 2. Løse e-mailadresser, der ikke stod i en tabel
$iTabel = array_map(fn($p) => ren_email($p['email']), $poster);
preg_match_all('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $tekst, $m);
foreach (array_unique(array_map('ren_email', $m[0])) as $e) {
    if ($e !== '' && !in_array($e, $iTabel, true)) $poster[] = ['email' => $e];
}

$db = db(); $nye = 0; $opdateret = 0; $fandtes = 0;
$find = $db->prepare('SELECT id, kommuner, emner, rolle, kilde FROM abonnenter WHERE email = ?');
$ins = $db->prepare('INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet) VALUES (?, ?, ?, ?, ?, ?)');
$opd = $db->prepare('UPDATE abonnenter SET kommuner = ?, emner = ?, rolle = ?, kilde = ? WHERE id = ?');
foreach ($poster as $p) {
    $e = ren_email($p['email']);
    $felt = fn($k, $max) => mb_substr(trim((string)($p[$k] ?? '')), 0, $max);
    $kommuner = $felt('kommuner', 500); $rolle = $felt('rolle', 100); $kilde = $felt('kilde', 100) ?: 'import';
    $emner = trim(implode(', ', array_filter([$felt('valgte_emner', 1000), $felt('emner', 2000)])), ', ');
    $find->execute([$e]); $a = $find->fetch();
    if (!$a) { $ins->execute([$e, $kommuner, $emner, $rolle, $kilde, nu()]); $nye++; continue; }
    // Findes allerede: udfyld kun tomme felter, så intet nyere bliver overskrevet
    $ny = [$a['kommuner'] ?: $kommuner, $a['emner'] ?: $emner, $a['rolle'] ?: $rolle, $a['kilde'] ?: $kilde];
    if ($ny !== [$a['kommuner'], $a['emner'], $a['rolle'], $a['kilde']]) { $opd->execute([...$ny, $a['id']]); $opdateret++; } else { $fandtes++; }
}
svar(200, ['nye' => $nye, 'opdateret' => $opdateret, 'fandtes' => $fandtes]);
