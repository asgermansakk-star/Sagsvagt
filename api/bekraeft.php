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
    // En konto, der blev oprettet med adgangskode ved tilmeldingen, bliver først aktiv nu, hvor adressen er bekræftet.
    // Det står først, fordi det kræver, at adressen ikke var bekræftet før (en konto, redaktionen har lukket, åbnes ikke igen).
    $aktiveret = $db->prepare("UPDATE abonnenter SET status = 'aktiv' WHERE id = ? AND status = 'tilmeldt' AND adgangskode IS NOT NULL AND bekraeftet IS NULL");
    $aktiveret->execute([$t['abonnent_id']]);
    $db->prepare('UPDATE abonnenter SET bekraeftet = COALESCE(bekraeftet, ?), mail_afmeldt = NULL WHERE id = ?')->execute([nu(), $t['abonnent_id']]);
    // Bad man også om at blive medlem af Sæt Dagsordenen, er man det nu
    $db->prepare('UPDATE abonnenter SET medlem = COALESCE(medlem, medlem_venter), medlem_venter = NULL WHERE id = ? AND medlem_venter IS NOT NULL')->execute([$t['abonnent_id']]);
    $q = $db->prepare('SELECT status FROM abonnenter WHERE id = ?'); $q->execute([$t['abonnent_id']]);
    $konto = $q->fetchColumn() === 'aktiv';
    // Logget ind via linket (Asger 21/11-2026): bliver kontoen aktiv netop nu, og er linket brugt inden for et døgn efter
    // tilmeldingen, logges man ind og sendes direkte til Min avis. Linket kan kun bruges én gang, og kun med knappen
    // (POST), så sikkerhedsscannere i mailprogrammer ikke logger nogen ind. Et ældre link (det virker i 14 dage og kan
    // ligge i andres mailfiltre) bekræfter stadig adressen, men så logger man selv ind med sin adgangskode.
    $udstedt = strtotime((string)$t['udloeber']) - 24 * 14 * 3600;
    if ($konto && $aktiveret->rowCount() === 1 && time() - $udstedt <= 24 * 3600) {
        log_ind((int)$t['abonnent_id']);
        header('Location: ../min/', true, 303);
        exit;
    }
    vis_side('Tak, du er skrevet op', "Du får Sagsvagts mail hver mandag kl. 7 med de sager, der handler om dine emner."
        . ($konto ? '' : ' Er din kommune ikke åben endnu, giver vi besked, når den er klar.')
        . "\n\nKan du ikke finde mailen mandag, så kig i mappen med uønsket mail, og markér den som \"Ikke uønsket\".",
        $konto ? '<p><a href="../min/" style="color:#28377A;font-weight:600;">Log ind på Min avis</a></p>' : '');
}
vis_side('Bekræft din tilmelding', "Tryk på knappen for at bekræfte, at {$t['email']} skal have Sagsvagts mandagsmail.", knap_form('Bekræft'));
