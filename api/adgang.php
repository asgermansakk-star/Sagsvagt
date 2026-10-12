<?php
// Linket fra invitationen eller "glemt adgangskode": tjek linket (handling "tjek") eller sæt adgangskoden (handling "saet").
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
begraens('adgang:' . ip(), 30, 900);
$t = find_token((string)($d['token'] ?? ''));
if (!$t) fejl(410, 'Linket er udløbet eller allerede brugt. Bed om et nyt under "Glemt adgangskode".');

if (($d['handling'] ?? '') === 'tjek') svar(200, ['email' => $t['email'], 'type' => $t['type']]);

$kode = (string)($d['adgangskode'] ?? '');
if (mb_strlen($kode) < 10) fejl(400, 'Adgangskoden skal være på mindst 10 tegn.');
if (mb_strlen($kode) > 200) fejl(400, 'Adgangskoden er for lang.');
if (mb_strtolower($kode) === $t['email']) fejl(400, 'Adgangskoden må ikke være din e-mail.');

$db = db();
$db->prepare("UPDATE abonnenter SET adgangskode = ?, status = 'aktiv' WHERE id = ?")->execute([password_hash($kode, PASSWORD_DEFAULT), $t['abonnent_id']]);
$db->prepare('UPDATE tokens SET brugt = ? WHERE id = ?')->execute([nu(), $t['id']]);
log_ind((int)$t['abonnent_id']);
svar(200, ['ok' => true]);
