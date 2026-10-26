<?php
// Stop-knappen i redaktionens prøvemail for erhvervsmailen (?uge=2026-10-26&t=…, signeret). Som api/mandagsmail-stop.php.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

$uge = (string)($_GET['uge'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $uge) || !signatur_ok("erhverv-stop:$uge", (string)($_GET['t'] ?? ''))) { http_response_code(400); vis_side('Linket virker ikke', 'Linket er ugyldigt. Brug admin-siden for at stoppe ugens erhvervsmail.'); }
$db = db(); er_tabeller($db);
$q = $db->prepare('SELECT COUNT(*) FROM erhverv_koe WHERE uge = ?'); $q->execute([$uge]); $koe = (int)$q->fetchColumn();
$dato = (new DateTimeImmutable($uge))->format('j/n');
if ($_SERVER['REQUEST_METHOD'] === 'POST') { $n = er_stop($db, $uge); vis_side('Ugens erhvervsmail er stoppet', "$n " . ($n === 1 ? 'mail' : 'mails') . " til mandag $dato er fjernet fra køen."); }
if (!$koe) vis_side('Intet at stoppe', "Der ligger ingen erhvervsmails i køen til mandag $dato.");
vis_side('Stop ugens erhvervsmail?', "$koe " . ($koe === 1 ? 'mail' : 'mails') . " ligger klar til mandag $dato kl. 7.", knap_form('Stop ugens erhvervsmail'));
