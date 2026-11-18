<?php
// Gemmer Min avis-profilen (navn, emner, egne ord, bydel, adresse, gemte sager og ikon) på serveren.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
$tekster = fn($v, $max, $len) => array_values(array_slice(array_filter(array_map(fn($x) => mb_substr(trim((string)$x), 0, $len), is_array($v) ? $v : []), 'strlen'), 0, $max));
$profil = [
    'navn' => mb_substr(trim((string)($d['navn'] ?? '')), 0, 40),
    'emner' => $tekster($d['emner'] ?? [], 20, 20),
    'ord' => $tekster($d['ord'] ?? [], 12, 60),
    'bydel' => mb_substr(trim((string)($d['bydel'] ?? '')), 0, 100),
    'gemte' => $tekster($d['gemte'] ?? [], 300, 120),
    'velkommen' => !empty($d['velkommen']),
    // Kommunerne gemmes ikke her: de står i tilmeldingen og ændres kun af redaktionen (Plus og Pro, se priser.html).
    // Profilikonet (id i Min avis): kun bogstaver, tal og bindestreg
    'ikon' => substr(preg_replace('/[^a-z0-9-]/', '', (string)($d['ikon'] ?? '')), 0, 20),
    // Adressen til radaren under Mine sager (fundet med api/adresse.php). Kun en adresse i Danmark; ellers ingen.
    'adresse' => (function ($a) {
        if (!is_array($a)) return null;
        $lat = (float)($a['lat'] ?? 0); $lon = (float)($a['lon'] ?? 0); $tekst = mb_substr(trim((string)($a['tekst'] ?? '')), 0, 120);
        if ($tekst === '' || $lat < 54.4 || $lat > 57.9 || $lon < 7.8 || $lon > 15.3) return null;
        return ['tekst' => $tekst, 'lat' => round($lat, 5), 'lon' => round($lon, 5), 'bydel' => mb_substr(trim((string)($a['bydel'] ?? '')), 0, 60) ?: null,
            'radius' => in_array((int)($a['radius'] ?? 1000), [500, 1000, 2000], true) ? (int)$a['radius'] : 1000];
    })($d['adresse'] ?? null),
];
db()->prepare('UPDATE abonnenter SET profil = ? WHERE id = ?')->execute([json_encode($profil, JSON_UNESCAPED_UNICODE), $b['id']]);
svar(200, ['ok' => true]);
