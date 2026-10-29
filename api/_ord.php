<?php
// Opslag i ordindekset (avis/ordindeks.mjs): hvilke af en kommunes sager nævner et ord et sted i hele teksten.
// Indekset er sorteret, så et opslag er en binær søgning i filen og læser kun de få linjer, der passer.
// Bruges af api/soeg.php (søgesiden og Min avis) og af mandagsmailen (api/_mandagsmail.php).
//
//   ord_find($slug, 'varmeø')                → ['n' => antal sager i indekset, 'i' => [3, 17, …]] eller null uden indeks
//   ord_fund($slug, ['Lersøparken', …], $ids) → ['lersøparken' => ['kk-…' => true, …], …] til mailens søgeord
declare(strict_types=1);

// Et ord på tre bogstaver eller mere passer også på længere ord ("varmeø" finder "varmeøer" og "varmeøeffekt").
// Højst så mange ord-linjer pr. søgeord, så et meget kort ord ikke læser hele filen.
const ORD_MAKS_LINJER = 3000;

// Samme opdeling som i avis/ordindeks.mjs. Rene tal er ikke i indekset og springes over.
function ord_af(string $tekst): array {
    $ord = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($tekst), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return array_values(array_unique(array_filter($ord, fn($o) => mb_strlen($o) > 1 && !ctype_digit($o))));
}

function ord_fil(string $slug): ?string {
    if (!preg_match('/^[a-z0-9-]{2,40}$/', $slug)) return null;
    $f = __DIR__ . "/_ord-$slug.txt";
    return is_file($f) ? $f : null;
}

// Første hele linje, der starter ved $pos eller efter
function ord_linje_efter($fh, int $pos): string|false {
    if ($pos === 0) { fseek($fh, 0); return fgets($fh); }
    fseek($fh, $pos - 1);
    fgets($fh); // resten af linjen, $pos-1 ligger i
    return fgets($fh);
}

// Sagerne (pladser i sager.json) for alle ord, der starter med $ord (eller er præcis $ord, hvis det er kort)
function ord_sager($fh, int $str, string $ord): array {
    $lo = 0; $hi = $str;
    while ($lo < $hi) {
        $mid = intdiv($lo + $hi, 2);
        $l = ord_linje_efter($fh, $mid);
        if ($l === false || strcmp(strstr($l, "\t", true) ?: rtrim($l), $ord) >= 0) $hi = $mid; else $lo = $mid + 1;
    }
    $l = ord_linje_efter($fh, $lo);
    $ud = []; $n = 0; $praecis = mb_strlen($ord) < 3;
    while ($l !== false && $n++ < ORD_MAKS_LINJER) {
        [$o, $tal] = array_pad(explode("\t", rtrim($l, "\n"), 2), 2, '');
        if ($praecis ? $o !== $ord : !str_starts_with($o, $ord)) break;
        foreach (explode(',', $tal) as $t) if ($t !== '') $ud[(int)$t] = true;
        $l = fgets($fh);
    }
    return $ud;
}

// Sager, hvor alle ordene i $soeg står et sted i teksten
function ord_find(string $slug, string $soeg): ?array {
    $f = ord_fil($slug);
    if (!$f || !($fh = fopen($f, 'rb'))) return null;
    $n = (int)substr((string)fgets($fh), 1);
    $str = (int)filesize($f);
    $fund = null;
    foreach (array_slice(ord_af($soeg), 0, 6) as $o) {
        $s = ord_sager($fh, $str, $o);
        $fund = $fund === null ? $s : array_intersect_key($fund, $s);
        if (!$fund) break;
    }
    fclose($fh);
    $i = array_keys($fund ?? []);
    sort($i);
    return ['n' => $n, 'i' => $i];
}

// Til mandagsmailen: for hvert søgeord de sager (efter id), der nævner det. $sager er kommunens sager fra sager.json,
// i samme rækkefølge som indekset. Passer antallet ikke, er indekset fra en anden kørsel, og så bruges det ikke.
function ord_fund(string $slug, array $soegeord, array $sager): array {
    $ud = [];
    foreach ($soegeord as $s) {
        $s = trim((string)$s);
        if ($s === '') continue;
        $r = ord_find($slug, $s);
        if (!$r || $r['n'] !== count($sager)) continue;
        foreach ($r['i'] as $i) if (isset($sager[$i]['id'])) $ud[mb_strtolower($s)][$sager[$i]['id']] = true;
    }
    return $ud;
}
