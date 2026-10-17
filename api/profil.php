<?php
// Gemmer Min avis-profilen (navn, emner, egne ord, bydel, gemte sager, kommune og ikon) på serveren.
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
    // Kommunerne (slugs fra kommune/aabne.json) og profilikonet (id i Min avis); kun bogstaver, tal og bindestreg
    'kommuner' => array_values(array_unique(array_filter(array_map(fn($x) => substr(preg_replace('/[^a-z0-9-]/', '', (string)$x), 0, 40), is_array($d['kommuner'] ?? null) ? array_slice($d['kommuner'], 0, 20) : []), 'strlen'))),
    'ikon' => substr(preg_replace('/[^a-z0-9-]/', '', (string)($d['ikon'] ?? '')), 0, 20),
];
db()->prepare('UPDATE abonnenter SET profil = ? WHERE id = ?')->execute([json_encode($profil, JSON_UNESCAPED_UNICODE), $b['id']]);
svar(200, ['ok' => true]);
