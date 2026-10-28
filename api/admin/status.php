<?php
// Redaktionen: afmeld en tilmeldt (beholdes, men får ingen mails og kan ikke logge ind), slet helt (GDPR),
// ret e-mailadressen eller markér, at mails til adressen kommer retur.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_sletning.php';

$d = kraev_post();
$admin = kraev_admin();
$id = (int)($d['id'] ?? 0);
$db = db();
if (($d['handling'] ?? '') === 'slet') {
    // Alt om personen (links, push, mailkø og -historik, e-mailen på feedback), som når afmeldte slettes efter 30 dage
    $q = $db->prepare('SELECT id FROM abonnenter WHERE id = ? AND email <> ?'); $q->execute([$id, $admin['email']]);
    if ($q->fetchColumn()) slet_abonnent($db, $id, false);
} elseif (($d['handling'] ?? '') === 'afmeld') {
    $db->prepare("UPDATE abonnenter SET status = 'afmeldt', adgangskode = NULL, mail_afmeldt = COALESCE(mail_afmeldt, ?) WHERE id = ? AND email <> ?")->execute([nu(), $id, $admin['email']]); // api/_sletning.php sletter 30 dage efter
    $db->prepare('UPDATE tokens SET brugt = ? WHERE abonnent_id = ? AND brugt IS NULL')->execute([nu(), $id]);
    try { $db->prepare('DELETE FROM push_abonnementer WHERE abonnent_id = ?')->execute([$id]); } catch (PDOException $e) {}
} elseif (($d['handling'] ?? '') === 'ret_email') {
    // Ret en forkert adresse (fx når mails kom retur); markeringen fjernes, så der kan sendes igen
    $ny = ren_email($d['email'] ?? '');
    if ($ny === '') fejl(400, 'Skriv en gyldig e-mailadresse.');
    // Redaktionens adresser giver admin-adgang (er_admin ser på e-mailen), så de må ikke sættes på en tilmeldt
    if (in_array($ny, $K['admins'], true)) fejl(400, 'Den adresse hører til redaktionen.');
    $q = $db->prepare('SELECT id FROM abonnenter WHERE email = ? AND id <> ?'); $q->execute([$ny, $id]);
    if ($q->fetch()) fejl(400, 'Den adresse er allerede skrevet op.');
    $db->prepare('UPDATE abonnenter SET email = ?, mail_fejl = NULL WHERE id = ? AND email <> ?')->execute([$ny, $id, $admin['email']]);
    // Links, der er sendt til den gamle adresse, må ikke virke længere (de hører til kontoen, ikke adressen)
    $db->prepare('UPDATE tokens SET brugt = ? WHERE abonnent_id = ? AND brugt IS NULL')->execute([nu(), $id]);
} elseif (($d['handling'] ?? '') === 'mail_fejl') {
    // Markér (eller fjern markeringen), at mails til adressen kommer retur; så springes den over ved invitationer
    $db->prepare('UPDATE abonnenter SET mail_fejl = ? WHERE id = ?')->execute([!empty($d['til']) ? nu() : null, $id]);
} else {
    fejl(400, 'Ukendt handling');
}
svar(200, ['ok' => true]);
