<?php
// Søgning i hele sagsteksten for én kommune (indekset fra avis/ordindeks.mjs, opslaget i api/_ord.php).
// Svaret er sagernes plads i kommunens sager.json, som søgesiden og Min avis allerede har hentet.
//
//   GET soeg.php?k=koebenhavn&q=varmeø               → { "n": 1999, "i": [79, 236, …] }
//   GET soeg.php?k=koebenhavn&o=Lersøparken|varmeø   → { "n": 1999, "o": { "Lersøparken": [ … ], "varmeø": [ … ] } }
// n er antallet af sager i indekset; passer det ikke med sager.json, er de fra hver sin kørsel, og svaret skal ikke bruges.
declare(strict_types=1);
require __DIR__ . '/_ord.php';

function ud(int $kode, array $data): never {
    http_response_code($kode);
    header('Content-Type: application/json; charset=utf-8');
    // Indekset skifter kun, når robotten kører (to gange om dagen)
    header('Cache-Control: ' . ($kode === 200 ? 'public, max-age=900' : 'no-store'));
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$k = (string)($_GET['k'] ?? '');
if (!ord_fil($k)) ud(404, ['fejl' => 'Ukendt kommune']);

if (isset($_GET['o'])) {
    $ud = ['n' => 0, 'o' => []];
    foreach (array_slice(array_unique(array_filter(array_map('trim', explode('|', mb_substr((string)$_GET['o'], 0, 600))))), 0, 12) as $o) {
        $r = ord_find($k, $o);
        $ud['n'] = $r['n'];
        $ud['o'][$o] = $r['i'];
    }
    ud(200, $ud);
}

$q = trim(mb_substr((string)($_GET['q'] ?? ''), 0, 200));
if ($q === '') ud(400, ['fejl' => 'Skriv et søgeord']);
ud(200, ord_find($k, $q));
