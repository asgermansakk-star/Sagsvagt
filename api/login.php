<?php
// Login med e-mail og adgangskode. Samme fejlbesked uanset om e-mailen findes, så man ikke kan teste, hvem der er tilmeldt.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$email = ren_email($d['email'] ?? '');
$kode = (string)($d['adgangskode'] ?? '');
begraens('login-ip:' . ip(), 30, 900);
// Forkerte adgangskoder tælles pr. e-mail og IP, så en fremmed ikke kan spærre en andens konto ved at prøve løs fra sin egen
// forbindelse. Loftet pr. e-mail alene er højt og stopper kun gæt fra mange adresser på én gang.
if (for_mange('login:' . $email . ':' . ip(), 10, 900) || for_mange('login:' . $email, 300, 3600)) fejl(429, 'For mange forsøg. Vent lidt, og prøv igen.');

$q = db()->prepare("SELECT id, adgangskode FROM abonnenter WHERE email = ? AND status = 'aktiv'"); $q->execute([$email]);
$b = $q->fetch();
// Kører password_verify, også når brugeren ikke findes, så svartiden ikke afslører det
$hash = $b['adgangskode'] ?? DUMMY_HASH;
$ok = password_verify($kode, $hash) && $b;
if (!$ok) { noter_forsoeg('login:' . $email . ':' . ip()); noter_forsoeg('login:' . $email); fejl(401, 'E-mail eller adgangskode er forkert.'); }
if (password_needs_rehash($b['adgangskode'], PASSWORD_DEFAULT)) {
    db()->prepare('UPDATE abonnenter SET adgangskode = ? WHERE id = ?')->execute([password_hash($kode, PASSWORD_DEFAULT), $b['id']]);
}
log_ind((int)$b['id']);
svar(200, ['ok' => true]);
