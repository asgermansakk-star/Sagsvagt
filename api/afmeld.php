<?php
// Afmelding fra mandagsmailen via det personlige link i hver mail (?id=…&t=…, signeret, se afmeld_link()).
// GET viser en side med én knap, så sikkerhedsscannere, der åbner links i mails, ikke afmelder nogen.
// POST afmelder: knappen på siden og afmeldingsknappen i mailprogrammet (List-Unsubscribe-Post, RFC 8058).
// Konti beholdes, så man stadig kan logge ind på Min avis; tilmeldte uden konto får status 'afmeldt' som på admin-siden.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$id = (int)($_GET['id'] ?? 0);
$t = (string)($_GET['t'] ?? '');
if ($id <= 0 || !signatur_ok("afmeld:$id", $t)) { http_response_code(400); vis_side('Linket virker ikke', 'Linket til afmelding er ugyldigt. Skriv til mansa@sagsvagt.dk, så afmelder vi dig.'); }
$db = db();
$q = $db->prepare('SELECT email, status, mail_afmeldt FROM abonnenter WHERE id = ?'); $q->execute([$id]);
$a = $q->fetch();
if (!$a || $a['mail_afmeldt'] || $a['status'] === 'afmeldt') vis_side('Du er afmeldt', 'Du får ikke flere mandagsmails fra Sagsvagt.');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db->prepare("UPDATE abonnenter SET mail_afmeldt = ?, status = CASE WHEN status IN ('tilmeldt', 'inviteret') THEN 'afmeldt' ELSE status END WHERE id = ?")->execute([nu(), $id]);
    // En allerede planlagt mail til ugen sendes ikke (mm_maaske_send springer den over), så den fjernes
    try { $db->prepare('DELETE FROM mandagsmail_koe WHERE abonnent_id = ?')->execute([$id]); } catch (PDOException $e) {}
    $linjer = "E-mail: {$a['email']}\nAfmeldt via linket i en mail.\n";
    @send_mail(TILMELDINGER_TIL, "Afmeldt Sagsvagt: {$a['email']}", '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer);
    vis_side('Du er afmeldt', "{$a['email']} får ikke flere mandagsmails fra Sagsvagt."
        . ($a['status'] === 'aktiv' ? "\n\nDin konto findes stadig, så du kan logge ind på Min avis. Vil du slette den, så gør det under Min avis." : '')
        . "\n\nFortryder du, så skriv dig op igen på sagsvagt.dk.");
}
vis_side('Afmeld Sagsvagt?', "Vil du afmelde {$a['email']} fra Sagsvagts mandagsmail?", knap_form('Ja, afmeld mig'));
