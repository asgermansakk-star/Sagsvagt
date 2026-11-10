<?php
// "Stop tipalarmen" i mailen til redaktionen (?id=…&t=…, signeret). GET viser en side med én knap, så sikkerhedsscannere,
// der åbner links i mails, ikke stopper noget; POST stopper (knappen og mailprogrammets afmeldingsknap, RFC 8058).
// Redaktionen får besked, og tipalarmen kan slås til igen på admin-siden.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_tips.php';

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0 || !signatur_ok("tip-stop:$id", (string)($_GET['t'] ?? ''))) { http_response_code(400); vis_side('Linket virker ikke', 'Linket er ugyldigt. Skriv til mansa@sagsvagt.dk, så stopper vi tipalarmen.'); }
$db = db(); tip_tabeller($db);
$q = $db->prepare('SELECT navn, kommune, aktiv FROM tip_redaktioner WHERE id = ?'); $q->execute([$id]);
$r = $q->fetch();
if (!$r || !(int)$r['aktiv']) vis_side('Tipalarmen er stoppet', 'I får ikke flere tipalarmer fra Sagsvagt. Skriv til mansa@sagsvagt.dk, hvis I vil have dem igen.');
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db->prepare('UPDATE tip_redaktioner SET aktiv = 0 WHERE id = ?')->execute([$id]);
    $t = "Redaktion: {$r['navn']} ({$r['kommune']})\nStoppede tipalarmen via linket i en mail.\n";
    @send_mail(TILMELDINGER_TIL, "Tipalarm: {$r['navn']} stoppede", '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($t, ENT_QUOTES, 'UTF-8') . '</pre>', $t);
    vis_side('Tipalarmen er stoppet', "{$r['navn']} får ikke flere tipalarmer. Skriv til mansa@sagsvagt.dk, hvis I vil have dem igen.");
}
vis_side('Stop tipalarmen?', "Vil du stoppe tipalarmen fra Sagsvagt til {$r['navn']}?", knap_form('Ja, stop tipalarmen'));
