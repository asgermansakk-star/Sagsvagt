<?php
// Redaktionen: Sagsvagt Erhvervs kunder (min/erhverv-admin.html).
//   liste:    alle kunder med besøg, vurderinger, antal signaler og sidst sendte mail, plus de åbne kommuner
//   gem:      opret eller ret en kunde (id = 0 opretter)
//   link:     kundens rapportlink; nyt_link laver et nyt, så det gamle holder op med at virke
//   forhaand: kundens mail til en given mandag (uden at sende); proeve sender den til redaktionen
//   slet:     sletter kunden og kundens vurderinger
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_erhverv.php';

$d = kraev_post();
kraev_admin();
$db = db(); er_tabeller($db);
$handling = (string)($d['handling'] ?? 'liste');
$id = (int)($d['id'] ?? 0);
$hent = function (int $id) use ($db): array {
    $q = $db->prepare('SELECT * FROM erhverv_kunder WHERE id = ?'); $q->execute([$id]);
    return $q->fetch() ?: fejl(404, 'Kunden findes ikke.');
};
$mandag = function () use ($d): string {
    $u = (string)($d['uge'] ?? '');
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $u)) return $u;
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->modify('monday next week')->format('Y-m-d');
};

if ($handling === 'liste') {
    $kunder = $db->query('SELECT * FROM erhverv_kunder ORDER BY status = \'stoppet\', firma')->fetchAll();
    $v = []; foreach ($db->query('SELECT kunde_id, vurdering, COUNT(*) AS n FROM erhverv_vurderinger GROUP BY kunde_id, vurdering') as $r) $v[$r['kunde_id']][$r['vurdering']] = (int)$r['n'];
    $s = []; foreach ($db->query('SELECT kunde_id, MAX(sendt) AS sendt, COUNT(*) AS n FROM erhverv_sendt GROUP BY kunde_id') as $r) $s[$r['kunde_id']] = $r;
    $f = []; foreach ($db->query('SELECT kunde_id, COUNT(*) AS n FROM erhverv_foelger GROUP BY kunde_id') as $r) $f[$r['kunde_id']] = (int)$r['n'];
    $pl = []; foreach ($db->query('SELECT kunde_id, COUNT(*) AS n FROM erhverv_pipeline GROUP BY kunde_id') as $r) $pl[$r['kunde_id']] = (int)$r['n'];
    $ud = array_map(function ($k) use ($v, $s, $f, $pl) {
        $sig = er_signaler_til($k);
        return $k + ['ja' => $v[$k['id']]['ja'] ?? 0, 'nej' => $v[$k['id']]['nej'] ?? 0, 'signaler' => count($sig),
            'ord_hits' => count(array_filter($sig, fn($x) => isset($x['ty']['ord']))), 'sidst_mail' => $s[$k['id']]['sendt'] ?? null, 'mails' => (int)($s[$k['id']]['n'] ?? 0), 'foelger' => $f[$k['id']] ?? 0, 'pipeline' => $pl[$k['id']] ?? 0, 'udbud' => count(er_udbud_til($k))];
    }, $kunder);
    $i = er_indeks();
    svar(200, ['kunder' => $ud, 'kommuner' => $i['kommuner'], 'genereret' => $i['genereret'] ?? null, 'produkter' => ER_PRODUKTER, 'status' => ER_STATUS]);
}

if ($handling === 'gem') {
    $firma = trim(mb_substr((string)($d['firma'] ?? ''), 0, 120));
    $email = ren_email($d['email'] ?? '');
    if ($firma === '') fejl(400, 'Skriv firmaets navn.');
    if ($email === '') fejl(400, 'Skriv en gyldig e-mail til kontaktpersonen.');
    $modtagere = array_slice(array_values(array_filter(array_map('ren_email', preg_split('/[\s,;]+/', (string)($d['modtagere'] ?? '')) ?: []))), 0, 8);
    $aabne = array_column(er_indeks()['kommuner'], 'slug');
    $kommuner = array_values(array_intersect(array_map('strval', (array)($d['kommuner'] ?? [])), $aabne));
    if (!$kommuner) fejl(400, 'Vælg mindst én åben kommune.');
    $ord = implode(', ', array_slice(array_values(array_filter(array_map(fn($o) => trim(mb_substr($o, 0, 60)), explode(',', (string)($d['ord'] ?? ''))), fn($o) => mb_strlen($o) >= 3)), 0, 25));
    $produkt = array_key_exists($d['produkt'] ?? '', ER_PRODUKTER) ? $d['produkt'] : 'signaler';
    $status = array_key_exists($d['status'] ?? '', ER_STATUS) ? $d['status'] : 'proeve';
    $slut = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($d['proeve_slut'] ?? '')) ? $d['proeve_slut'] : null;
    $pris = is_numeric($d['pris'] ?? null) ? max(0, min(100000, (int)$d['pris'])) : null;
    $felter = [$firma, trim(mb_substr((string)($d['kontakt'] ?? ''), 0, 100)), $email, implode(', ', $modtagere), $produkt, implode(',', $kommuner), $ord,
        $status, $slut, $pris, mb_substr((string)($d['noter'] ?? ''), 0, 4000), empty($d['mail']) ? 0 : 1];
    if ($id > 0) {
        $hent($id);
        $db->prepare('UPDATE erhverv_kunder SET firma = ?, kontakt = ?, email = ?, modtagere = ?, produkt = ?, kommuner = ?, ord = ?, status = ?, proeve_slut = ?, pris = ?, noter = ?, mail = ? WHERE id = ?')
            ->execute([...$felter, $id]);
    } else {
        $db->prepare('INSERT INTO erhverv_kunder (firma, kontakt, email, modtagere, produkt, kommuner, ord, status, proeve_slut, pris, noter, mail, oprettet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([...$felter, nu()]);
        $id = (int)$db->lastInsertId();
    }
    svar(200, ['ok' => true, 'id' => $id, 'link' => er_link($hent($id))]);
}

if ($handling === 'link') svar(200, ['link' => er_link($hent($id))]);
if ($handling === 'nyt_link') {
    $hent($id);
    $db->prepare('UPDATE erhverv_kunder SET version = version + 1 WHERE id = ?')->execute([$id]);
    svar(200, ['link' => er_link($hent($id))]);
}

if ($handling === 'forhaand' || $handling === 'proeve') {
    global $K;
    $k = $hent($id); $uge = $mandag();
    $m = er_mail_til($k, $uge);
    if (!$m) svar(200, ['mail' => null, 'uge' => $uge]);
    if ($handling === 'proeve') {
        [$h, $t] = er_uden_afmeld($m + ['kunde_id' => $id]);
        foreach ($K['admins'] as $til) send_mail($til, '[Prøve] ' . $m['emne'], $h, $t);
        svar(200, ['ok' => true, 'sendt_til' => $K['admins']]);
    }
    svar(200, ['mail' => $m, 'uge' => $uge, 'modtagere' => er_modtagere($k)]);
}

if ($handling === 'slet') {
    $hent($id);
    foreach (['erhverv_vurderinger', 'erhverv_koe', 'erhverv_sendt', 'erhverv_foelger', 'erhverv_pipeline'] as $t) $db->prepare("DELETE FROM $t WHERE kunde_id = ?")->execute([$id]);
    $db->prepare('DELETE FROM erhverv_kunder WHERE id = ?')->execute([$id]);
    svar(200, ['ok' => true]);
}
fejl(400, 'Ukendt handling.');
