<?php
// Svar fra spoergeskema.html. Kræver det personlige link fra mailen (id og t). Svarer man igen, erstattes svaret.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_spoergeskema.php';

$d = kraev_post();
$id = (int)($d['id'] ?? 0);
if (!spoerg_link_ok($id, (string)($d['t'] ?? ''))) fejl(400, 'Linket virker ikke. Brug linket i mailen fra Sagsvagt.');
begraens('spoerg:' . $id, 20, 3600);
$db = db(); spoerg_tabeller($db);
$q = $db->prepare('SELECT id FROM abonnenter WHERE id = ?'); $q->execute([$id]);
if (!$q->fetch()) fejl(400, 'Linket virker ikke længere.');
$svar = spoerg_rens(is_array($d['svar'] ?? null) ? $d['svar'] : []);
if (!$svar) fejl(400, 'Svar på mindst ét spørgsmål.');
$json = json_encode($svar, JSON_UNESCAPED_UNICODE);

$q = $db->prepare('SELECT id FROM spoergeskema_svar WHERE abonnent_id = ? AND runde = ?'); $q->execute([$id, SPOERG_RUNDE]);
$fandt = $q->fetchColumn();
if ($fandt) $db->prepare('UPDATE spoergeskema_svar SET svar = ?, opdateret = ? WHERE id = ?')->execute([$json, nu(), $fandt]);
else $db->prepare('INSERT INTO spoergeskema_svar (abonnent_id, runde, svar, oprettet, opdateret) VALUES (?, ?, ?, ?, ?)')->execute([$id, SPOERG_RUNDE, $json, nu(), nu()]);
svar(200, ['ok' => true, 'igen' => (bool)$fandt]);
