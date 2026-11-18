<?php
// Finder en adresse til radaren i Min avis ("Nær dig" under Mine sager). Opslaget sker her på serveren hos OpenStreetMap
// (Nominatim), så læserens browser ikke selv kontakter en tredjepart. Nominatim modtager kun den skrevne adresse, ikke hvem
// der spørger. Højst ét opslag i sekundet for hele siden (Nominatims regler) og 30 i timen pr. læser.
// Adressen gemmes først, når læseren trykker Gem (api/profil.php).
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
$q = trim(preg_replace('/\s+/u', ' ', (string)($d['q'] ?? '')));
if (mb_strlen($q) < 4 || mb_strlen($q) > 120) fejl(400, 'Skriv vejnavn, husnummer og gerne postnummer.');

// 30 opslag i timen pr. læser
$time = gmdate('YmdH');
$noegle = 'adresse:' . $b['id'];
[$t, $n] = array_pad(explode(':', indst_hent($noegle) ?? ''), 2, '0');
$n = $t === $time ? (int)$n : 0;
if ($n >= 30) fejl(429, 'Du har søgt mange gange. Prøv igen om lidt.');
indst_saet($noegle, $time . ':' . ($n + 1));

// Ét opslag i sekundet for hele siden
for ($i = 0; $i < 3 && !indst_laas('nominatim', 1); $i++) usleep(700000);

global $K;
$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
    'q' => $q, 'format' => 'jsonv2', 'countrycodes' => 'dk', 'limit' => 5, 'addressdetails' => 1, 'accept-language' => 'da',
]);
$ctx = stream_context_create(['http' => [
    'header' => "User-Agent: Sagsvagt/1.0 (+" . rtrim($K['site_url'], '/') . "/om.html)\r\nAccept: application/json\r\n",
    'timeout' => 8, 'ignore_errors' => true,
]]);
$raa = @file_get_contents($url, false, $ctx);
$l = $raa ? json_decode($raa, true) : null;
if (!is_array($l)) fejl(502, 'Adressesøgningen svarer ikke lige nu. Prøv igen om lidt.');

$ud = [];
foreach ($l as $r) {
    $a = $r['address'] ?? [];
    if (($a['country_code'] ?? '') !== 'dk') continue;
    $vej = $a['road'] ?? $a['pedestrian'] ?? $a['square'] ?? $a['neighbourhood'] ?? ($r['name'] ?? '');
    $by = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? '';
    $tekst = trim($vej . (isset($a['house_number']) ? ' ' . $a['house_number'] : '') . ', ' . trim(($a['postcode'] ?? '') . ' ' . $by), ', ');
    if ($tekst === '') continue;
    $ud[] = [
        'tekst' => mb_substr($tekst, 0, 120),
        'lat' => round((float)$r['lat'], 5), 'lon' => round((float)$r['lon'], 5),
        'bydel' => $a['suburb'] ?? $a['city_district'] ?? $a['quarter'] ?? null,
        'kommune' => $a['municipality'] ?? null,
        'praecis' => isset($a['house_number']),
    ];
}
// Samme adresse kan komme flere gange (bygning og indgang)
$set = [];
$ud = array_values(array_filter($ud, function ($x) use (&$set) { if (isset($set[$x['tekst']])) return false; return $set[$x['tekst']] = true; }));
svar(200, ['resultater' => $ud, 'kilde' => '© OpenStreetMap-bidragydere']);
