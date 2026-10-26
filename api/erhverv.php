<?php
// Sagsvagt Erhverv: kundens rapportside (erhverv/rapport.html) henter sine signaler her med nøglen fra linket.
//   rapport: kunden, signalerne og kundens vurderinger. Tæller besøget (sidst set og forrige besøg, så siden kan vise "nyt").
//   vurder:  kunden markerer et signal som relevant (ja), ikke relevant (nej) eller fjerner markeringen ('').
//   mail:    kunden slår den ugentlige mail til eller fra.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_erhverv.php';

$d = kraev_post();
begraens('erhverv:' . ip(), 120, 600);
$db = db(); er_tabeller($db);
$kunde = er_kunde($db, (string)($d['k'] ?? ''));
if (!$kunde) {
    // Udløbet prøve eller ikke bekræftet endnu: sig det, i stedet for at linket ikke virker
    $k = er_kunde($db, (string)($d['k'] ?? ''), false);
    if ($k && $k['status'] === 'proeve') fejl(403, 'Prøveperioden sluttede ' . mm_dato((string)$k['proeve_slut']) . '. Skriv til mansa@sagsvagt.dk, hvis I vil fortsætte; så åbner vi rapporten igen med det samme.');
    if ($k && $k['status'] === 'venter') fejl(403, 'Bekræft først jeres e-mail med linket i mailen fra Sagsvagt.');
    if ($k && $k['status'] === 'pause') fejl(403, 'Rapporten er sat på pause. Skriv til mansa@sagsvagt.dk for at åbne den igen.');
    fejl(404, 'Linket virker ikke længere. Skriv til mansa@sagsvagt.dk, så sender vi et nyt.');
}
$id = (int)$kunde['id'];

$handling = (string)($d['handling'] ?? 'rapport');
if ($handling === 'vurder') {
    $sid = (string)($d['id'] ?? ''); $v = (string)($d['v'] ?? '');
    if (!preg_match('/^[a-z0-9\/._-]{1,160}$/', $sid) || !in_array($v, ['ja', 'nej', ''], true)) fejl(400, 'Ugyldig vurdering.');
    $db->prepare('DELETE FROM erhverv_vurderinger WHERE kunde_id = ? AND signal_id = ?')->execute([$id, $sid]);
    if ($v !== '') $db->prepare('INSERT INTO erhverv_vurderinger (kunde_id, signal_id, vurdering, tid) VALUES (?, ?, ?, ?)')->execute([$id, $sid, $v, nu()]);
    svar(200, ['ok' => true]);
}
if ($handling === 'foelg') {
    $sid = (string)($d['id'] ?? '');
    $s = null; foreach (er_signaler_til($kunde) as $x) if ($x['id'] === $sid) { $s = $x; break; }
    if (!$s || empty($s['n'])) fejl(404, 'Signalet findes ikke længere.');
    $db->prepare('DELETE FROM erhverv_foelger WHERE kunde_id = ? AND noegle = ?')->execute([$id, $s['n']]);
    if (!empty($d['til'])) $db->prepare('INSERT INTO erhverv_foelger (kunde_id, noegle, titel, dato, tid) VALUES (?, ?, ?, ?, ?)')->execute([$id, $s['n'], mb_substr($s['t'], 0, 300), $s['dato'], nu()]);
    svar(200, ['ok' => true]);
}
if ($handling === 'pipeline') {
    // Status, note og ansvarlig på et signal (ref s:<nøgle>) eller et udbud (ref u:<TED-nummer>). Status '' fjerner det.
    $ref = (string)($d['ref'] ?? ''); $status = (string)($d['status'] ?? '');
    if (!preg_match('/^(s:[^\x00-\x1f]{3,215}|u:\d{1,8}-\d{4})$/u', $ref) || ($status !== '' && !isset(ER_PIPELINE[$status]))) fejl(400, 'Ugyldig pipeline.');
    if ($status === '') { $db->prepare('DELETE FROM erhverv_pipeline WHERE kunde_id = ? AND ref = ?')->execute([$id, $ref]); svar(200, ['ok' => true]); }
    $titel = mb_substr(trim((string)($d['titel'] ?? '')), 0, 300) ?: $ref;
    $note = mb_substr((string)($d['note'] ?? ''), 0, 4000); $ansv = mb_substr(trim((string)($d['ansvarlig'] ?? '')), 0, 80);
    $db->prepare('DELETE FROM erhverv_pipeline WHERE kunde_id = ? AND ref = ?')->execute([$id, $ref]);
    $db->prepare('INSERT INTO erhverv_pipeline (kunde_id, ref, titel, status, note, ansvarlig, opdateret) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([$id, $ref, $titel, $status, $note, $ansv, nu()]);
    // Et signal i pipelinen følges automatisk, så kunden får besked i mandagsmailen, når sagen rykker
    if (str_starts_with($ref, 's:') && in_array($status, ['undersoeger', 'kontakt', 'byder'], true)) {
        $n = substr($ref, 2);
        $q = $db->prepare('SELECT 1 FROM erhverv_foelger WHERE kunde_id = ? AND noegle = ?'); $q->execute([$id, $n]);
        if (!$q->fetchColumn()) {
            $sd = ''; foreach (er_signaler_til($kunde) as $x) if (($x['n'] ?? '') === $n && $x['dato'] > $sd) $sd = $x['dato'];
            if ($sd !== '') $db->prepare('INSERT INTO erhverv_foelger (kunde_id, noegle, titel, dato, tid) VALUES (?, ?, ?, ?, ?)')->execute([$id, $n, $titel, $sd, nu()]);
        }
    }
    svar(200, ['ok' => true]);
}
if ($handling === 'mail') {
    $db->prepare('UPDATE erhverv_kunder SET mail = ? WHERE id = ?')->execute([empty($d['til']) ? 0 : 1, $id]);
    svar(200, ['ok' => true, 'mail' => empty($d['til']) ? 0 : 1]);
}

// Et besøg tæller, når der er gået over en halv time siden sidst; "forrige" er det besøg før, så nyt siden sidst giver mening
$forrige = $kunde['sidst_set'];
if (!$forrige || strtotime($forrige) < time() - 1800) {
    $db->prepare('UPDATE erhverv_kunder SET forrige_set = sidst_set, sidst_set = ?, besoeg = besoeg + 1 WHERE id = ?')->execute([nu(), $id]);
} else {
    $forrige = $kunde['forrige_set'];
    $db->prepare('UPDATE erhverv_kunder SET sidst_set = ? WHERE id = ?')->execute([nu(), $id]);
}
$p = $db->prepare('SELECT ref, titel, status, note, ansvarlig, opdateret FROM erhverv_pipeline WHERE kunde_id = ? ORDER BY opdateret DESC'); $p->execute([$id]);
$q = $db->prepare('SELECT signal_id, vurdering FROM erhverv_vurderinger WHERE kunde_id = ?'); $q->execute([$id]);
$i = er_indeks();
$navne = array_column($i['kommuner'], 'navn', 'slug');
svar(200, [
    'kunde' => ['firma' => $kunde['firma'], 'produkt' => $kunde['produkt'], 'produktnavn' => ER_PRODUKTER[$kunde['produkt']] ?? '',
        'kommuner' => array_map(fn($s) => ['slug' => $s, 'navn' => $navne[$s] ?? $s], er_liste((string)$kunde['kommuner'])),
        'ord' => er_liste((string)$kunde['ord']), 'status' => $kunde['status'], 'proeve_slut' => $kunde['proeve_slut'], 'mail' => (int)$kunde['mail'],
        'modtagere' => er_modtagere($kunde), 'forrige' => $forrige],
    'meta' => ['genereret' => $i['genereret'] ?? null, 'dage' => $i['dage'] ?? 90, 'raekke' => $i['raekke'], 'stadier' => $i['stadier'], 'typer' => er_navne()['typer']],
    'signaler' => $signaler = er_signaler_til($kunde),
    'foelger' => er_foelger($db, $kunde, $signaler),
    'udbud' => er_udbud_til($kunde),
    'pipeline' => $p->fetchAll(), 'pipelineStatus' => ER_PIPELINE,
    'udbudGrupper' => ['alle' => $i['udbudGrupper'] ?? [], 'produkt' => er_udbud_grupper((string)$kunde['produkt']), 'hentet' => $i['udbudHentet'] ?? null],
    'vurderinger' => array_column($q->fetchAll(), 'vurdering', 'signal_id'),
]);
