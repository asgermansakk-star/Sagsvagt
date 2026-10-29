<?php
// Mandagsmailen: tabellerne, den automatiske planlægning og udsendelsen. Ved første besøg efter søndag kl. 18
// (api/besoeg.php) laves ugens mails (api/_mandagsmail_lav.php) og lægges i kø til mandag kl. 7, og redaktionen får en
// prøvemail med et link, der stopper ugens mail. Køen sendes ved besøg efter tidspunktet, fordi Simply spærrer for
// robotter, så intet udefra kan starte udsendelsen. Admin-siden kan stadig sende eller planlægge i hånden.
declare(strict_types=1);

// Kun dem, der stadig er skrevet op, har bekræftet adressen, ikke har afmeldt mailen, og hvis adresse ikke fejler
const MM_KAN = "status IN ('tilmeldt', 'inviteret', 'aktiv') AND mail_fejl IS NULL AND bekraeftet IS NOT NULL AND mail_afmeldt IS NULL";

function mm_tabeller(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_sendt (abonnent_id INT NOT NULL, uge VARCHAR(10) NOT NULL, sendt VARCHAR(25) NOT NULL, PRIMARY KEY (abonnent_id, uge))');
    $db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_koe (abonnent_id INT NOT NULL, uge VARCHAR(10) NOT NULL, emne VARCHAR(255) NOT NULL,
        html MEDIUMTEXT NOT NULL, tekst MEDIUMTEXT NOT NULL, send_efter VARCHAR(25) NOT NULL, forsoeg INT NOT NULL DEFAULT 0, PRIMARY KEY (abonnent_id, uge))');
    // Én række pr. uge, den automatiske planlægning har kørt (så den kun kører én gang), og om redaktionen stoppede den
    $db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_uger (uge VARCHAR(10) NOT NULL PRIMARY KEY, planlagt VARCHAR(25) NOT NULL, antal INT NOT NULL DEFAULT 0, stoppet VARCHAR(25) NULL)');
    // faerdig: hvornår planlægningen blev færdig. Mangler den, døde planlægningen undervejs (kolonnen kom til senere)
    try { $db->query('SELECT faerdig FROM mandagsmail_uger LIMIT 1'); } catch (PDOException $e) { $db->exec('ALTER TABLE mandagsmail_uger ADD COLUMN faerdig VARCHAR(25) NULL'); }
}

// Sender én mail og husker det. Markerer først, så to samtidige kørsler ikke sender samme mail to gange.
// Svarer 'sendt', 'allerede' eller 'fejl' (så er markeringen fjernet igen).
function mm_send_en(PDO $db, int $id, string $email, string $uge, string $emne, string $html, string $tekst): string {
    try { $db->prepare('INSERT INTO mandagsmail_sendt (abonnent_id, uge, sendt) VALUES (?, ?, ?)')->execute([$id, $uge, nu()]); }
    catch (PDOException $e) { return 'allerede'; }
    // Afmeldingsknappen i Gmail, Apple Mail og Outlook (RFC 8058: ét klik sender en POST til linket)
    $hoveder = ['List-Unsubscribe' => '<' . afmeld_link($id) . '>, <mailto:' . TILMELDINGER_TIL . '?subject=Afmeld%20Sagsvagt>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click'];
    if (send_mail($email, $emne, $html, $tekst, '', $hoveder)) return 'sendt';
    $db->prepare('DELETE FROM mandagsmail_sendt WHERE abonnent_id = ? AND uge = ?')->execute([$id, $uge]);
    return 'fejl';
}

// Kaldes ved besøg: sender op til 25 planlagte mails, hvis tiden er kommet. Fejler en mail tre gange, opgives den.
function mm_maaske_send(): void {
    $db = db();
    try {
        $q = $db->prepare('SELECT k.abonnent_id, k.uge, k.emne, k.html, k.tekst, a.email, a.id AS kan FROM mandagsmail_koe k
            LEFT JOIN abonnenter a ON a.id = k.abonnent_id AND ' . MM_KAN . '
            WHERE k.send_efter <= ? AND k.forsoeg < 3 ORDER BY k.send_efter LIMIT 25');
        $q->execute([nu()]);
        $raekker = $q->fetchAll();
    } catch (PDOException $e) { return; } // tabellen findes ikke endnu: intet planlagt
    if (!$raekker) return;
    @set_time_limit(120);
    $slet = $db->prepare('DELETE FROM mandagsmail_koe WHERE abonnent_id = ? AND uge = ?');
    $fejlet = $db->prepare('UPDATE mandagsmail_koe SET forsoeg = forsoeg + 1 WHERE abonnent_id = ? AND uge = ?');
    foreach ($raekker as $r) {
        $id = (int)$r['abonnent_id'];
        // Afmeldt eller markeret som fejlende siden planlægningen: mailen sendes ikke
        if ($r['kan'] === null) { $slet->execute([$id, $r['uge']]); continue; }
        $svar = mm_send_en($db, $id, (string)$r['email'], (string)$r['uge'], (string)$r['emne'], (string)$r['html'], (string)$r['tekst']);
        if ($svar === 'fejl') { $fejlet->execute([$id, $r['uge']]); error_log('Sagsvagt mandagsmail: kunne ikke sende til abonnent ' . $id); }
        else $slet->execute([$id, $r['uge']]);
    }
}

// ---------- Automatisk planlægning ----------
// Mandagen, ugens mail hører til, hvis vi er i vinduet fra søndag kl. 18 til mandag aften (dansk tid); ellers null.
function mm_planlaeg_uge(?DateTimeImmutable $nu = null): ?string {
    $nu = ($nu ?? new DateTimeImmutable('now'))->setTimezone(new DateTimeZone('Europe/Copenhagen'));
    $dag = (int)$nu->format('N');
    if ($dag === 7 && (int)$nu->format('G') >= 18) return $nu->modify('+1 day')->format('Y-m-d');
    if ($dag === 1) return $nu->format('Y-m-d');
    return null;
}
// Mandag kl. 7 dansk tid, i UTC som nu() ("2026-10-26T06:00:00Z"), så det kan sammenlignes som tekst
function mm_kl7(string $uge): string {
    return (new DateTimeImmutable("$uge 07:00:00", new DateTimeZone('Europe/Copenhagen')))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}
// Kommunernes sager fra de filer, robotten lægger på siden (som Min avis henter dem)
function mm_hent_kommune(string $slug): array {
    static $cache = [];
    $rod = dirname(__DIR__);
    $fil = $slug === 'koebenhavn' ? "$rod/assets/sager.json" : "$rod/kommune/" . preg_replace('/[^a-z0-9-]/', '', $slug) . '/sager.json';
    return $cache[$slug] ??= (json_decode((string)@file_get_contents($fil), true) ?: ['emner' => [], 'sager' => []]);
}
function mm_aabne(): array { return json_decode((string)@file_get_contents(dirname(__DIR__) . '/kommune/aabne.json'), true) ?: []; }

// Ugens mail til hver tilmeldt, som admin-siden viser dem. Springer over: dem, der allerede har fået eller har en planlagt
// mail til ugen, mails uden sager, og ventelistemails til dem, der har fået en mail inden for 4 uger.
function mm_ugens_mails(PDO $db, string $uge): array {
    require_once __DIR__ . '/_mandagsmail_lav.php';
    $aabne = mm_aabne();
    if (!$aabne) return [];
    $q = $db->prepare('SELECT a.id, a.email, a.kommuner, a.emner, a.status, a.profil, m.sendt, k.send_efter AS planlagt,
        (SELECT MAX(s.sendt) FROM mandagsmail_sendt s WHERE s.abonnent_id = a.id) AS sidst
        FROM abonnenter a LEFT JOIN mandagsmail_sendt m ON m.abonnent_id = a.id AND m.uge = ?
        LEFT JOIN mandagsmail_koe k ON k.abonnent_id = a.id AND k.uge = ? WHERE ' . MM_KAN . ' ORDER BY a.oprettet');
    $q->execute([$uge, $uge]);
    $ud = [];
    $fireUger = gmdate('Y-m-d\TH:i:s\Z', strtotime("$uge 00:00:00 UTC") - 27 * 86400);
    foreach ($q->fetchAll() as $a) {
        $m = mm_mail_til($a, $uge, $aabne, 'mm_hent_kommune', afmeld_link((int)$a['id']));
        $n = $m['mail']['antal'];
        $m['spring'] = $a['sendt'] ? 'har fået ugens mail' : ($a['planlagt'] ? 'er allerede planlagt'
            : ($m['type'] === 'Venteliste' ? (($a['sidst'] ?? '') >= $fireUger ? 'ventelistemail inden for 4 uger' : '')
            : ($n['besluttet'] + $n['kommer'] + $n['bydel'] === 0 ? 'ingen sager i ugen' : '')));
        $ud[] = ['a' => $a] + $m;
    }
    return $ud;
}

// Kaldes ved besøg: i vinduet søndag kl. 18 til mandag lægges ugens mails i kø én gang, og redaktionen får prøvemailen.
// $nu bruges kun i test; ellers klokken lige nu.
function mm_maaske_planlaeg(?DateTimeImmutable $nu = null): void {
    global $K;
    $uge = mm_planlaeg_uge($nu);
    if ($uge === null) return;
    $db = db(); mm_tabeller($db);
    // Rækken for ugen er en lås: kun det første besøg i vinduet planlægger. Blev planlægningen aldrig færdig (fx fordi den
    // døde midt i en upload, hvor filerne på serveren ikke passede sammen), tager et besøg over efter 10 minutter.
    try { $db->prepare('INSERT INTO mandagsmail_uger (uge, planlagt) VALUES (?, ?)')->execute([$uge, nu()]); }
    catch (PDOException $e) {
        $q = $db->prepare('UPDATE mandagsmail_uger SET planlagt = ? WHERE uge = ? AND faerdig IS NULL AND stoppet IS NULL AND planlagt < ?');
        $q->execute([nu(), $uge, gmdate('Y-m-d\TH:i:s\Z', time() - 600)]);
        if ($q->rowCount() !== 1) return;
    }
    @set_time_limit(180);
    $tid = max(mm_kl7($uge), nu());
    $mails = mm_ugens_mails($db, $uge);
    $ind = $db->prepare('INSERT INTO mandagsmail_koe (abonnent_id, uge, emne, html, tekst, send_efter) VALUES (?, ?, ?, ?, ?, ?)');
    $antal = 0; $typer = []; $sprunget = []; $proeve = null;
    foreach ($mails as $m) {
        if ($m['spring'] !== '') { $sprunget[$m['spring']] = ($sprunget[$m['spring']] ?? 0) + 1; continue; }
        try { $ind->execute([(int)$m['a']['id'], $uge, $m['mail']['emne'], $m['mail']['html'], $m['mail']['tekst'], $tid]); } catch (PDOException $e) { continue; }
        $antal++; $typer[$m['type']] = ($typer[$m['type']] ?? 0) + 1;
        // Prøvemailen er redaktionens egen udgave, hvis redaktionen er skrevet op; ellers den første med flest sager
        $n = $m['mail']['antal']['besluttet'] + $m['mail']['antal']['kommer'];
        if (in_array($m['a']['email'], $K['admins'], true)) $proeve = $m + ['egen' => true];
        elseif (!($proeve['egen'] ?? false) && $m['type'] !== 'Venteliste' && $n > ($proeve['n'] ?? -1)) $proeve = $m + ['n' => $n];
    }
    // Færdig, før prøvemailen sendes, så en fejl derefter ikke giver en ny planlægning og en prøvemail mere
    $db->prepare('UPDATE mandagsmail_uger SET antal = ?, faerdig = ? WHERE uge = ?')->execute([$antal, nu(), $uge]);
    mm_send_proeve($uge, $antal, $typer, $sprunget, $proeve);
    mm_paamind_bekraeftelse($db);
}

// Prøvemailen til redaktionen: et overblik med stop-knap, og en kopi af én af ugens mails
function mm_send_proeve(string $uge, int $antal, array $typer, array $sprunget, ?array $proeve): void {
    global $K;
    $stop = $K['site_url'] . "api/mandagsmail-stop.php?uge=$uge&t=" . signatur("stop:$uge");
    $kl = (new DateTimeImmutable(mm_kl7($uge)))->setTimezone(new DateTimeZone('Europe/Copenhagen'))->format('j/n') . ' kl. 7';
    $liste = fn(array $x) => implode("\n", array_map(fn($k, $v) => "• $v: $k", array_keys($x), $x));
    $tekst = $antal
        ? "$antal " . ($antal === 1 ? 'mail' : 'mails') . " sendes mandag $kl.\n\n" . $liste($typer)
          . ($sprunget ? "\n\nSprunget over:\n" . $liste($sprunget) : '')
          . "\n\nDu behøver ikke gøre noget. Vil du stoppe ugens mail, så tryk på knappen. Det kan også gøres på admin-siden."
          . ($proeve ? "\n\nI næste mail ser du " . (!empty($proeve['egen']) ? 'din egen udgave.' : 'udgaven til ' . $proeve['a']['email'] . '.') : '')
        : "Ingen mails i køen til mandag $kl." . ($sprunget ? "\n\nSprunget over:\n" . $liste($sprunget) : '');
    [$html, $txt] = mail_skabelon($antal ? "Mandagsmailen er klar: $antal " . ($antal === 1 ? 'mail' : 'mails') : 'Ingen mandagsmail i denne uge',
        $tekst, 'Stop ugens mail', $stop, 'Prøvemail til redaktionen fra Sagsvagts automatiske mandagsmail.');
    foreach ($K['admins'] as $til) {
        @send_mail($til, $antal ? "Prøve: mandagsmailen $kl ($antal)" : 'Prøve: ingen mandagsmail i denne uge', $html, $txt);
        // Kopien må ikke kunne afmelde modtageren: afmeldingslinket peger på forsiden i stedet
        if ($proeve) {
            $l = afmeld_link((int)$proeve['a']['id']); $erstat = [$l => $K['site_url'], htmlspecialchars($l, ENT_COMPAT, 'UTF-8') => $K['site_url']];
            @send_mail($til, '[Prøve] ' . $proeve['mail']['emne'], strtr($proeve['mail']['html'], $erstat), strtr($proeve['mail']['tekst'], $erstat));
        }
    }
}

// Stopper ugens automatiske mail: tømmer køen for ugen og husker det, så den ikke planlægges igen. Giver antal fjernede.
function mm_stop(PDO $db, string $uge): int {
    mm_tabeller($db);
    $q = $db->prepare('DELETE FROM mandagsmail_koe WHERE uge = ?'); $q->execute([$uge]);
    try { $db->prepare('INSERT INTO mandagsmail_uger (uge, planlagt, stoppet) VALUES (?, ?, ?)')->execute([$uge, nu(), nu()]); }
    catch (PDOException $e) { $db->prepare('UPDATE mandagsmail_uger SET stoppet = ? WHERE uge = ?')->execute([nu(), $uge]); }
    return $q->rowCount();
}

// Tilmeldte, der ikke har bekræftet (fx skrevet op via Sæt Dagsordenen eller importeret), får linket igen,
// højst 3 gange i alt og højst én gang om ugen. Sendes søndag sammen med planlægningen.
function mm_paamind_bekraeftelse(PDO $db): void {
    $q = $db->prepare("SELECT a.id, a.email, a.adgangskode FROM abonnenter a WHERE a.status IN ('tilmeldt', 'inviteret', 'aktiv') AND a.bekraeftet IS NULL
        AND a.mail_fejl IS NULL AND a.mail_afmeldt IS NULL
        AND (SELECT COUNT(*) FROM tokens t WHERE t.abonnent_id = a.id AND t.type = 'bekraeft') < 3
        AND NOT EXISTS (SELECT 1 FROM tokens t WHERE t.abonnent_id = a.id AND t.type = 'bekraeft' AND t.udloeber > ?) LIMIT 50");
    // Et link udløber efter 14 dage; et link, der udløber senere end om 8 dage, er sendt inden for den sidste uge
    $q->execute([gmdate('Y-m-d\TH:i:s\Z', time() + 8 * 86400)]);
    foreach ($q->fetchAll() as $a) @send_bekraeftelse((int)$a['id'], (string)$a['email'], $a['adgangskode'] !== null);
}

