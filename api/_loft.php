<?php
// Loft over antal kald til de åbne sider (søgning, priser, besøgstæller), så mange kald ikke kan lægge serveren ned.
// Privatlivspolitikken lover, at vi kun gemmer IP-adressen ved login, tilmelding og indsendelse. Derfor bruges hverken
// databasen eller IP-adressen her, men 4096 tællere i en lille fil. Adressen peger på en af tællerne gennem en tilfældig
// nøgle, som skiftes, hver gang tiden er gået. Rundt regnet en million adresser deler hver tæller, så den kan ikke føres tilbage.
// Kan filen ikke bruges, slippes kaldet igennem: loftet må aldrig selv tage siden ned.
declare(strict_types=1);

// Er der plads til et kald mere? $hvem: adressen, eller '' når alle deler den samme tæller. $max er højst 65535.
function loft_ok(string $navn, int $max, int $sek, string $hvem = ''): bool {
    $mappe = __DIR__ . '/_loft';
    if (!is_dir($mappe)) @mkdir($mappe, 0700, true);
    if (!is_file("$mappe/.htaccess")) @file_put_contents("$mappe/.htaccess", "Require all denied\n");
    $f = @fopen("$mappe/_$navn.bin", 'c+b');
    if (!$f) return true;
    if (!flock($f, LOCK_EX)) { fclose($f); return true; }
    $t = time();
    $h = (string)fread($f, 24); // 8 byte starttid, 16 byte nøgle
    $start = strlen($h) === 24 ? unpack('J', $h)[1] : 0;
    if ($start > $t || $t - $start >= $sek) {
        $h = pack('J', $t) . random_bytes(16);
        ftruncate($f, 0); rewind($f); fwrite($f, $h); ftruncate($f, 24 + 8192);
    }
    // En IPv6-bruger har et helt /64-net, så kun den første halvdel af adressen tæller
    $b = @inet_pton($hvem);
    if ($b !== false && strlen($b) === 16) $hvem = substr($b, 0, 8);
    $plads = 24 + 2 * (unpack('n', hash_hmac('sha256', $hvem, substr($h, 8), true))[1] & 4095);
    fseek($f, $plads);
    $antal = unpack('n', str_pad((string)fread($f, 2), 2, "\0"))[1];
    if ($antal < $max) { fseek($f, $plads); fwrite($f, pack('n', $antal + 1)); }
    fflush($f); flock($f, LOCK_UN); fclose($f);
    return $antal < $max;
}
