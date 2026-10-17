<?php
// Feedback fra Min avis: gemmes i databasen og sendes som mail til redaktionen, så intet går tabt, hvis mailen fejler.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
begraens('feedback:' . $b['id'], 10, 3600);
$tekst = mb_substr(trim((string)($d['tekst'] ?? '')), 0, 3000);
if (mb_strlen($tekst) < 3) fejl(400, 'Skriv et par ord om, hvad du synes.');
$vurdering = in_array($d['vurdering'] ?? '', ['godt', 'blandet', 'daarligt'], true) ? $d['vurdering'] : '';
$side = mb_substr(trim((string)($d['side'] ?? '')), 0, 100);
$kontakt = !empty($d['kontakt']) ? 1 : 0;

db()->prepare('INSERT INTO feedback (abonnent_id, email, vurdering, tekst, side, kontakt, oprettet) VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([$b['id'], $b['email'], $vurdering, $tekst, $side, $kontakt, nu()]);

$NAVN = ['godt' => 'Godt', 'blandet' => 'Blandet', 'daarligt' => 'Dårligt'];
$linjer = "Fra: {$b['email']}" . ($kontakt ? ' (må gerne kontaktes)' : ' (vil ikke kontaktes)') . "\n"
    . ($vurdering ? "Samlet indtryk: {$NAVN[$vurdering]}\n" : '') . ($side ? "Side: $side\n" : '') . "\n$tekst\n";
@send_mail($K['feedback_til'] ?? $K['mail']['svar_til'] ?? $K['tilmeldinger_til'], 'Feedback fra Min avis: ' . $b['email'],
    '<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer,
    $kontakt ? $b['email'] : ''); // Må brugeren kontaktes, går "Besvar" direkte til dem
svar(200, ['ok' => true]);
