<?php
// Login med e-mail og adgangskode. Samme fejlbesked uanset om e-mailen findes, så man ikke kan teste, hvem der er tilmeldt.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$email = ren_email($d['email'] ?? '');
$kode = (string)($d['adgangskode'] ?? '');
begraens('login-ip:' . ip(), 30, 900);
begraens('login:' . $email, 10, 900);

$q = db()->prepare("SELECT id, adgangskode FROM abonnenter WHERE email = ? AND status = 'aktiv'"); $q->execute([$email]);
$b = $q->fetch();
// Kører password_verify, også når brugeren ikke findes, så svartiden ikke afslører det
$hash = $b['adgangskode'] ?? password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
$ok = password_verify($kode, $hash) && $b;
if (!$ok) fejl(401, 'E-mail eller adgangskode er forkert.');
if (password_needs_rehash($b['adgangskode'], PASSWORD_DEFAULT)) {
    db()->prepare('UPDATE abonnenter SET adgangskode = ? WHERE id = ?')->execute([password_hash($kode, PASSWORD_DEFAULT), $b['id']]);
}
log_ind((int)$b['id']);
svar(200, ['ok' => true]);
