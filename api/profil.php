<?php
// Gemmer Min avis-profilen (navn, emner, egne ord, bydel og gemte sager) på serveren.
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
];
db()->prepare('UPDATE abonnenter SET profil = ? WHERE id = ?')->execute([json_encode($profil, JSON_UNESCAPED_UNICODE), $b['id']]);
svar(200, ['ok' => true]);
