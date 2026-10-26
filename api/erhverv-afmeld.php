<?php
// "Stop de ugentlige mails" i erhvervsmailen (?id=…&t=…, signeret). GET viser en side med én knap, så sikkerhedsscannere,
// der åbner links i mails, ikke afmelder nogen; POST afmelder (knappen og mailprogrammets afmeldingsknap, RFC 8058).
// Rapportlinket virker stadig; mailen kan slås til igen på rapportsiden.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0 || !signatur_ok("erhverv-afmeld:$id", (string)($_GET['t'] ?? ''))) { http_response_code(400); vis_side('Linket virker ikke', 'Linket er ugyldigt. Skriv til mansa@sagsvagt.dk, så stopper vi mailen.'); }
$db = db(); er_tabeller($db);
$q = $db->prepare('SELECT firma, mail FROM erhverv_kunder WHERE id = ?'); $q->execute([$id]);
$k = $q->fetch();
if (!$k || !(int)$k['mail']) vis_side('Mailen er stoppet', 'I får ikke flere ugentlige mails fra Sagsvagt Erhverv. Rapporten kan stadig åbnes fra jeres link.');
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db->prepare('UPDATE erhverv_kunder SET mail = 0 WHERE id = ?')->execute([$id]);
    $db->prepare('DELETE FROM erhverv_koe WHERE kunde_id = ?')->execute([$id]);
    $t = "Firma: {$k['firma']}\nStoppede de ugentlige erhvervsmails via linket i en mail.\n";
    @send_mail(TILMELDINGER_TIL, "Erhverv: {$k['firma']} stoppede mailen", '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($t, ENT_QUOTES, 'UTF-8') . '</pre>', $t);
    vis_side('Mailen er stoppet', "{$k['firma']} får ikke flere ugentlige mails. Rapporten kan stadig åbnes fra jeres link, og der kan mailen slås til igen.");
}
vis_side('Stop de ugentlige mails?', "Vil du stoppe de ugentlige mails fra Sagsvagt Erhverv til {$k['firma']}?", knap_form('Ja, stop mailen'));
