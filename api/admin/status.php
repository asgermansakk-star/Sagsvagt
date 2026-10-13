<?php
// Redaktionen: afmeld en tilmeldt (beholdes, men får ingen mails og kan ikke logge ind) eller slet helt (GDPR).
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

$d = kraev_post();
$admin = kraev_admin();
$id = (int)($d['id'] ?? 0);
$db = db();
if (($d['handling'] ?? '') === 'slet') {
    $db->prepare('DELETE FROM tokens WHERE abonnent_id = ?')->execute([$id]);
    try { $db->prepare('DELETE FROM push_abonnementer WHERE abonnent_id = ?')->execute([$id]); } catch (PDOException $e) {}
    $db->prepare('DELETE FROM abonnenter WHERE id = ? AND email <> ?')->execute([$id, $admin['email']]);
} elseif (($d['handling'] ?? '') === 'afmeld') {
    $db->prepare("UPDATE abonnenter SET status = 'afmeldt', adgangskode = NULL WHERE id = ? AND email <> ?")->execute([$id, $admin['email']]);
    $db->prepare('UPDATE tokens SET brugt = ? WHERE abonnent_id = ? AND brugt IS NULL')->execute([nu(), $id]);
    try { $db->prepare('DELETE FROM push_abonnementer WHERE abonnent_id = ?')->execute([$id]); } catch (PDOException $e) {}
} else {
    fejl(400, 'Ukendt handling');
}
svar(200, ['ok' => true]);
