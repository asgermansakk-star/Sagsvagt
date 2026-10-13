<?php
// Brugeren sletter selv sin konto: tilmelding, profil, gemte sager og links fra mails slettes.
// Kræver adgangskoden, så en åben computer ikke er nok. Feedback beholdes uden e-mail.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
begraens('slet:' . $b['id'], 5, 900);
if (!password_verify((string)($d['adgangskode'] ?? ''), (string)$b['adgangskode'])) fejl(401, 'Adgangskoden er forkert.');
if (er_admin($b)) fejl(400, 'Redaktionens konto kan ikke slettes her.');

$db = db();
$db->prepare('DELETE FROM tokens WHERE abonnent_id = ?')->execute([$b['id']]);
try { $db->prepare('DELETE FROM push_abonnementer WHERE abonnent_id = ?')->execute([$b['id']]); } catch (PDOException $e) {} // findes kun, når push er brugt
$db->prepare("UPDATE feedback SET abonnent_id = NULL, email = '' WHERE abonnent_id = ?")->execute([$b['id']]);
$db->prepare('DELETE FROM abonnenter WHERE id = ?')->execute([$b['id']]);

// Log ud
$_SESSION = [];
$p = session_get_cookie_params();
setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => $p['samesite']]);
session_destroy();

// Redaktionen får besked, så adressen også kan fjernes andre steder (fx gamle tilmeldingsmails)
$linjer = "{$b['email']} har slettet sin konto i Min avis. Kontoen, profilen og tilmeldingen er slettet fra databasen.\n";
@send_mail($K['tilmeldinger_til'], "Konto slettet: {$b['email']}", '<p style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</p>', $linjer);
svar(200, ['ok' => true]);
