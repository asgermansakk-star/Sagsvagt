<?php
// Kortbilleder (fliser) til radaren i Min avis. Læserens browser henter dem her hos os, og vores server henter dem
// hos OpenStreetMap, så OpenStreetMap hverken ser læserens IP-adresse eller hvilket område, læseren bor i.
// Kun for loggede ind læsere og kun for Danmark, så det ikke bliver en åben genvej til OpenStreetMaps servere.
// Fliserne gemmes i en uge (OpenStreetMaps regler for brug af fliser: gem dem, og angiv hvem I er).
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$b = bruger();
if (!$b) { http_response_code(401); exit; }
session_write_close(); // ellers venter browserens fliser på hinanden

$z = filter_input(INPUT_GET, 'z', FILTER_VALIDATE_INT);
$x = filter_input(INPUT_GET, 'x', FILTER_VALIDATE_INT);
$y = filter_input(INPUT_GET, 'y', FILTER_VALIDATE_INT);
if (!is_int($z) || !is_int($x) || !is_int($y) || $z < 10 || $z > 18) { http_response_code(400); exit; }

// Danmark: 54,4–57,9° N og 7,8–15,3° Ø
$n = 2 ** $z;
$fx = fn(float $lon): int => (int)floor(($lon + 180) / 360 * $n);
$fy = fn(float $lat): int => (int)floor((1 - log(tan(deg2rad($lat)) + 1 / cos(deg2rad($lat))) / M_PI) / 2 * $n);
if ($x < $fx(7.8) || $x > $fx(15.3) || $y < $fy(57.9) || $y > $fy(54.4)) { http_response_code(404); exit; }

global $K;
$mappe = $K['flise_mappe'] ?? sys_get_temp_dir() . '/sagsvagt-fliser';
$fil = "$mappe/$z/$x/$y.png";
$UGE = 7 * 86400;

if (!is_file($fil) || filemtime($fil) < time() - $UGE) {
    // Nye fliser hentes højst 300 gange i timen pr. læser
    if (for_mange('flise:' . $b['id'], 300, 3600)) { http_response_code(429); exit; }
    noter_forsoeg('flise:' . $b['id']);
    $ctx = stream_context_create(['http' => [
        'header' => "User-Agent: Sagsvagt/1.0 (+" . rtrim($K['site_url'], '/') . "/om.html)\r\n",
        'timeout' => 8, 'ignore_errors' => true,
    ]]);
    $png = @file_get_contents("https://tile.openstreetmap.org/$z/$x/$y.png", false, $ctx);
    $ok = $png !== false && str_starts_with($png, "\x89PNG");
    if (!$ok) {
        if (!is_file($fil)) { http_response_code(502); exit; }
    } else {
        if (!is_dir(dirname($fil))) @mkdir(dirname($fil), 0700, true);
        @file_put_contents("$fil.tmp", $png) && @rename("$fil.tmp", $fil);
        if (!is_file($fil)) { header('Content-Type: image/png'); header('Cache-Control: private, max-age=86400'); echo $png; exit; }
    }
}

header('Content-Type: image/png');
header('Cache-Control: private, max-age=' . $UGE);
header('Content-Length: ' . filesize($fil));
readfile($fil);
