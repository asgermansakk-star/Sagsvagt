<?php
// Fjerner de skjulte oplysninger i et billede (GPS-sted, tidspunkt, kamera, navn, kommentarer), før det gemmes.
// Filen skrives igen med kun de dele, der skal til for at vise billedet; selve billedet røres ikke og mister ingen kvalitet.
// Alt andet springes over, også det, nogle telefoner lægger efter billedet (fx en lille video med sit eget sted).
// Giver null, hvis filen ikke kan læses. Så må den ikke gemmes.
declare(strict_types=1);

const FOTO_TYPER = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

function foto_rens(string $data, string $type): ?string {
    return match ($type) {
        'image/jpeg' => foto_rens_jpeg($data),
        'image/png' => foto_rens_png($data),
        'image/webp' => foto_rens_webp($data),
        default => null,
    };
}

// ---------- JPEG ----------
function foto_rens_jpeg(string $d): ?string {
    $n = strlen($d);
    if (substr($d, 0, 2) !== "\xFF\xD8") return null;
    $hoved = ''; $krop = ''; $retning = 1; $skan = false; $p = 2;
    while ($p < $n) {
        if ($d[$p] !== "\xFF") return null;
        while ($p < $n && $d[$p] === "\xFF") $p++; // fyld
        if ($p >= $n) break;
        $m = ord($d[$p++]);
        if ($m === 0xD9) return $skan ? foto_jpeg_saml($hoved . $krop, $retning) : null;
        if ($m === 0x01 || ($m >= 0xD0 && $m <= 0xD8)) return null; // hører ikke til her
        if ($p + 2 > $n) break;
        $l = unpack('n', substr($d, $p, 2))[1];
        if ($l < 2 || $p + $l > $n) return null;
        $ind = substr($d, $p + 2, $l - 2);
        $del = "\xFF" . chr($m) . substr($d, $p, $l);
        $p += $l;
        if (($m >= 0xE0 && $m <= 0xEF) || $m === 0xFE) {
            // Kun JFIF, farveprofil og Adobes farvemærke beholdes. Retningen (hvordan telefonen blev holdt) læses og sættes
            // ind igen for sig selv, så billedet ikke ligger ned.
            if ($m === 0xE1 && str_starts_with($ind, "Exif\0")) $retning = foto_retning(substr($ind, 6)) ?: $retning;
            $behold = ($m === 0xE0 && str_starts_with($ind, "JFIF\0")) || ($m === 0xE2 && str_starts_with($ind, "ICC_PROFILE\0"))
                || ($m === 0xEE && str_starts_with($ind, 'Adobe'));
            if ($m === 0xE0 && $behold && strlen($ind) > 14) $del = "\xFF\xE0" . pack('n', 16) . substr($ind, 0, 12) . "\0\0"; // uden miniature
            if ($behold) $hoved .= $del;
            continue;
        }
        if ($m < 0xC0 || $m > 0xDF) continue; // kun de dele, der beskriver billedet
        $krop .= $del;
        if ($m === 0xDA) { // billeddata til næste mærke (FF00 og FFD0–D7 hører til billedet)
            $skan = true; $fra = $p;
            do {
                $p = strpos($d, "\xFF", $p);
                if ($p === false || $p + 1 >= $n) { $p = $n; break; }
                $b = ord($d[$p + 1]);
                $slut = !($b === 0x00 || $b === 0xFF || ($b >= 0xD0 && $b <= 0xD7));
                if (!$slut) $p += $b === 0xFF ? 1 : 2;
            } while (!$slut);
            $krop .= substr($d, $fra, $p - $fra);
        }
    }
    return $skan ? foto_jpeg_saml($hoved . $krop, $retning) : null; // afsluttet uden slutmærke
}
function foto_jpeg_saml(string $dele, int $retning): string {
    // Exif med ét felt, retningen (0x0112), når billedet ikke allerede vender rigtigt
    $exif = $retning < 2 ? '' : "Exif\0\0MM\0*" . pack('N', 8) . pack('n', 1) . pack('nnN', 0x0112, 3, 1) . pack('nn', $retning, 0) . pack('N', 0);
    return "\xFF\xD8" . ($exif === '' ? '' : "\xFF\xE1" . pack('n', strlen($exif) + 2) . $exif) . $dele . "\xFF\xD9";
}
// Retningen (1–8) fra en Exif-blok, 0 hvis den ikke står der
function foto_retning(string $t): int {
    $n2 = match (substr($t, 0, 2)) { 'II' => 'v', 'MM' => 'n', default => null };
    if ($n2 === null || strlen($t) < 14) return 0;
    $n4 = $n2 === 'v' ? 'V' : 'N';
    $o = unpack($n4, substr($t, 4, 4))[1];
    if ($o + 2 > strlen($t)) return 0;
    $antal = unpack($n2, substr($t, $o, 2))[1];
    for ($i = 0; $i < $antal; $i++) {
        $f = substr($t, $o + 2 + 12 * $i, 12);
        if (strlen($f) < 12) return 0;
        if (unpack($n2, $f)[1] === 0x0112) { $r = unpack($n2, substr($f, 8, 2))[1]; return $r >= 1 && $r <= 8 ? $r : 0; }
    }
    return 0;
}

// ---------- PNG ----------
function foto_rens_png(string $d): ?string {
    $ud = "\x89PNG\r\n\x1a\n";
    if (!str_starts_with($d, $ud)) return null;
    $behold = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'bKGD', 'pHYs'];
    for ($p = 8, $n = strlen($d); $p + 12 <= $n; $p += 12 + $l) {
        $l = unpack('N', substr($d, $p, 4))[1];
        if ($p + 12 + $l > $n) return null;
        $navn = substr($d, $p + 4, 4);
        if (in_array($navn, $behold, true)) $ud .= substr($d, $p, 12 + $l);
        if ($navn === 'IEND') return $ud;
    }
    return null;
}

// ---------- WebP ----------
function foto_rens_webp(string $d): ?string {
    if (strlen($d) < 20 || !str_starts_with($d, 'RIFF') || substr($d, 8, 4) !== 'WEBP') return null;
    $slut = min(strlen($d), 8 + unpack('V', substr($d, 4, 4))[1]);
    $ud = ''; $billede = false;
    for ($p = 12; $p + 8 <= $slut; $p += 8 + $l + ($l & 1)) {
        $navn = substr($d, $p, 4); $l = unpack('V', substr($d, $p + 4, 4))[1];
        if ($p + 8 + $l > $slut) return null;
        $ind = substr($d, $p + 8, $l);
        if ($navn === 'ANIM' || $navn === 'ANMF') return null; // et foto er ikke en animation
        if ($navn === 'VP8X') { if ($l < 10) return null; $ind[0] = chr(ord($ind[0]) & ~0x0C); } // ingen Exif, ingen XMP
        elseif ($navn === 'VP8 ' || $navn === 'VP8L') $billede = true;
        elseif ($navn !== 'ALPH' && $navn !== 'ICCP') continue;
        $ud .= $navn . pack('V', $l) . $ind . ($l & 1 ? "\0" : '');
    }
    return $billede ? 'RIFF' . pack('V', strlen($ud) + 4) . 'WEBP' . $ud : null;
}
