<?php
// Stop-knappen i redaktionens prøvemail (?uge=2026-10-26&t=…, signeret): tømmer ugens kø, så den automatiske
// mandagsmail ikke sendes. Virker uden login, så den kan bruges fra telefonen. GET viser en side med én knap.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_mandagsmail.php';

$uge = (string)($_GET['uge'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $uge) || !signatur_ok("stop:$uge", (string)($_GET['t'] ?? ''))) { http_response_code(400); vis_side('Linket virker ikke', 'Linket er ugyldigt. Brug admin-siden for at stoppe ugens mail.'); }
$db = db(); mm_tabeller($db);
$q = $db->prepare('SELECT COUNT(*) FROM mandagsmail_koe WHERE uge = ?'); $q->execute([$uge]); $koe = (int)$q->fetchColumn();
$q = $db->prepare('SELECT COUNT(*) FROM mandagsmail_sendt WHERE uge = ?'); $q->execute([$uge]); $sendt = (int)$q->fetchColumn();
$dato = (new DateTimeImmutable($uge))->format('j/n');
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $n = mm_stop($db, $uge);
    vis_side('Ugens mail er stoppet', "$n " . ($n === 1 ? 'mail' : 'mails') . " til mandag $dato er fjernet fra køen." . ($sendt ? " $sendt var allerede sendt." : '')
        . "\n\nVil du sende alligevel, så brug admin-siden.");
}
if (!$koe) vis_side('Intet at stoppe', "Der ligger ingen mails i køen til mandag $dato." . ($sendt ? " $sendt er allerede sendt." : ''));
vis_side('Stop ugens mandagsmail?', "$koe " . ($koe === 1 ? 'mail' : 'mails') . " ligger klar til mandag $dato kl. 7." . ($sendt ? " $sendt er allerede sendt." : ''), knap_form('Stop ugens mail'));
