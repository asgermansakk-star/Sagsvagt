<?php
// Bekræftelse af en tilmelding (dobbelt opt-in) via linket fra send_bekraeftelse(). Først derefter får man mandagsmailen.
// GET viser en side med én knap, så sikkerhedsscannere, der åbner links i mails, ikke bekræfter på andres vegne.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$noegle = (string)($_GET['t'] ?? '');
$t = find_token($noegle);
if (!$t || $t['type'] !== 'bekraeft') {
    http_response_code(400);
    vis_side('Linket virker ikke', 'Linket er udløbet eller allerede brugt. Har du allerede bekræftet, er du skrevet op. Ellers kan du skrive dig op igen på sagsvagt.dk, så får du et nyt link.');
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db = db();
    $db->prepare('UPDATE tokens SET brugt = ? WHERE id = ?')->execute([nu(), $t['id']]);
    $db->prepare('UPDATE abonnenter SET bekraeftet = COALESCE(bekraeftet, ?), mail_afmeldt = NULL WHERE id = ?')->execute([nu(), $t['abonnent_id']]);
    $q = $db->prepare('SELECT status FROM abonnenter WHERE id = ?'); $q->execute([$t['abonnent_id']]);
    $konto = $q->fetchColumn() === 'aktiv';
    vis_side('Tak, du er skrevet op', "Du får Sagsvagts mail hver mandag kl. 7 med de sager, der handler om dine emner."
        . ($konto ? '' : ' Er din kommune ikke åben endnu, giver vi besked, når den er klar.')
        . "\n\nKan du ikke finde mailen mandag, så kig i mappen med uønsket mail, og markér den som \"Ikke uønsket\".",
        $konto ? '<p><a href="../min/" style="color:#28377A;font-weight:600;">Gå til Min avis</a></p>' : '');
}
vis_side('Bekræft din tilmelding', "Tryk på knappen for at bekræfte, at {$t['email']} skal have Sagsvagts mandagsmail.", knap_form('Bekræft'));
