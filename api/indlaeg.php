<?php
// Debatindlæg fra Min avis til redaktionen. Erstatter FormSubmit (USA): indlægget sendes via Simplys mailserver til
// redaktionen med skribenten som svaradresse, og skribenten får en kvittering. Indlægget gemmes ikke i databasen; kun
// grænsen for antal forsøg (IP og e-mail, slettes efter et døgn) som ved login.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
begraens('indlaeg:' . ip(), 5, 3600);
$felt = fn(string $n, int $max) => trim(mb_substr(str_replace("\r", '', (string)($d[$n] ?? '')), 0, $max));
$overskrift = $felt('overskrift', 200); $tekst = $felt('tekst', 2000); $navn = $felt('navn', 100);
$titel = $felt('titel', 120); $by = $felt('by', 80); $email = ren_email($d['email'] ?? '');
$sag = $felt('sag', 400); $sagLink = $felt('sag_link', 300);
if ($overskrift === '') fejl(400, 'Giv indlægget en overskrift.');
if (mb_strlen($tekst) < 200) fejl(400, 'Indlægget skal være på mindst 200 tegn.');
if (!preg_match('/\S\s+\S/u', $navn)) fejl(400, 'Skriv dit fulde navn. Vi bringer kun indlæg under fuldt navn.');
if ($email === '') fejl(400, 'Skriv en gyldig e-mail, så vi kan kontakte dig.');
if (empty($d['bekraeftet'])) fejl(400, 'Sæt kryds for at bekræfte, at indlægget må bringes.');
if ($sagLink !== '' && !str_starts_with($sagLink, $K['site_url'])) $sagLink = '';
begraens('indlaeg:' . $email, 3, 86400);

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$raekker = [['Overskrift', $overskrift], ['Navn', $navn], ['Titel', $titel], ['By', $by], ['E-mail', $email], ['Sag', $sag], ['Link til sagen', $sagLink], ['Tegn', (string)mb_strlen($tekst)]];
$html = '<div style="font:15px/1.6 Arial,sans-serif;color:#0E0F14"><table style="border-collapse:collapse">'
    . implode('', array_map(fn($r) => $r[1] === '' ? '' : '<tr><td style="padding:4px 12px 4px 0;color:#56535A;vertical-align:top">' . $e($r[0]) . '</td><td style="padding:4px 0">' . $e($r[1]) . '</td></tr>', $raekker))
    . '</table><h2 style="font-size:19px;margin:20px 0 8px">' . $e($overskrift) . '</h2><p style="white-space:pre-wrap;margin:0">' . $e($tekst) . '</p></div>';
$txt = implode("\n", array_map(fn($r) => "{$r[0]}: {$r[1]}", array_filter($raekker, fn($r) => $r[1] !== ''))) . "\n\n$overskrift\n\n$tekst\n";
if (!send_mail($K['mail']['svar_til'], 'Nyt indlæg: ' . $overskrift, $html, $txt, $email)) fejl(502, 'Indlægget kunne ikke sendes lige nu.');

[$kh, $kt] = mail_skabelon('Tak for dit indlæg',
    "Redaktionen har modtaget dit indlæg \"$overskrift\". Vi læser alle indlæg og skriver til dig, hvis vi bringer dit. Vi kan forkorte indlægget og vælge en anden overskrift.\n\nHar du spørgsmål, så svar på denne mail.",
    'Sådan behandler vi dine oplysninger', $K['site_url'] . 'privatliv.html', "Du får denne mail, fordi $email har sendt et indlæg til Sagsvagt.");
@send_mail($email, 'Tak for dit indlæg til Sagsvagt', $kh, $kt);
svar(200, ['ok' => true]);
