<?php
// Sagsvagt Erhverv på serveren: kunderne, deres private rapportlink, signalerne pr. kunde og den ugentlige erhvervsmail.
// Kunderne ligger kun i databasen (aldrig i repoet). Signalerne kommer fra api/_erhverv-signaler.json, som robotten bygger
// hver dag (node avis/signaler.mjs --indeks). Kundens egne søgeord findes i kommunernes sager.json, som avisen lægger på siden.
//
// Rapportlinket er erhverv/rapport.html#k=<id>-<version>-<signatur>. Nøglen står efter #, så den aldrig sendes til serveren
// i adressen (og ikke havner i logfiler); siden sender den i et POST. "Nyt link" på admin-siden hæver versionen, så gamle
// links holder op med at virke. Mailen kan altid lave linket, fordi det er signeret og ikke gemt.
//
// Mailen følger mandagsmailens mønster (api/_mandagsmail.php): søndag fra kl. 18 lægges ugens mails i kø til mandag kl. 7,
// og redaktionen får en prøvemail med en stop-knap. Køen sendes ved besøg, fordi Simply spærrer for robotter.
declare(strict_types=1);
require_once __DIR__ . '/_mandagsmail.php';
require_once __DIR__ . '/_mandagsmail_lav.php';

const ER_PRODUKTER = ['signaler' => 'Tidlige signaler', 'energi' => 'Energiradar', 'begge' => 'Tidlige signaler og Energiradar'];
const ER_STATUS = ['venter' => 'Venter på bekræftelse', 'proeve' => 'Pilot', 'aktiv' => 'Aktiv', 'pause' => 'Pause', 'stoppet' => 'Stoppet'];
// Kundens pipeline: hvor langt de er med et signal eller et udbud
// Kundens brancher; samme liste som projektkortets "muligheder" (avis/erhverv-fakta.mjs), som Claude Haiku udfylder pr. signal
const ER_BRANCHER = ['entreprenør', 'håndværker', 'rådgiver', 'arkitekt', 'developer', 'investor', 'mægler', 'leverandør', 'energi', 'drift og service'];
const ER_PIPELINE = ['undersoeger' => 'Undersøger', 'kontakt' => 'I kontakt', 'byder' => 'Byder', 'vundet' => 'Vundet', 'tabt' => 'Tabt', 'droppet' => 'Droppet'];
// Kun piloter og aktive kunder kan åbne rapporten og få mail; en pilot kun til og med sin slutdato (admin kan forlænge den)
function er_kan(): string { $idag = (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->format('Y-m-d'); return "(status = 'aktiv' OR (status = 'proeve' AND (proeve_slut IS NULL OR proeve_slut >= '$idag')))"; }
const ER_PROEVE_DAGE = 30;

function er_tabeller(PDO $db): void {
    $id = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $tekst = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'TEXT' : 'MEDIUMTEXT';
    $db->exec("CREATE TABLE IF NOT EXISTS erhverv_kunder (
        id $id, firma VARCHAR(120) NOT NULL, kontakt VARCHAR(100) NOT NULL DEFAULT '', email VARCHAR(254) NOT NULL,
        modtagere VARCHAR(1000) NOT NULL DEFAULT '', produkt VARCHAR(20) NOT NULL DEFAULT 'signaler', kommuner VARCHAR(1500) NOT NULL DEFAULT '',
        ord VARCHAR(1000) NOT NULL DEFAULT '', status VARCHAR(12) NOT NULL DEFAULT 'proeve', proeve_slut VARCHAR(10) NULL, pris INT NULL,
        noter $tekst NULL, mail INT NOT NULL DEFAULT 1, version INT NOT NULL DEFAULT 1, oprettet VARCHAR(25) NOT NULL,
        sidst_set VARCHAR(25) NULL, forrige_set VARCHAR(25) NULL, besoeg INT NOT NULL DEFAULT 0)");
    // Kom til senere: CVR og hvornår kunden blev betalende (til fakturalisten)
    foreach (['cvr' => 'VARCHAR(8) NULL', 'aktiv_fra' => 'VARCHAR(10) NULL', 'brancher' => 'VARCHAR(300) NULL'] as $kol => $type) {
        try { $db->query("SELECT $kol FROM erhverv_kunder LIMIT 1"); } catch (PDOException $e) { $db->exec("ALTER TABLE erhverv_kunder ADD COLUMN $kol $type"); }
    }
    // Kundens vurdering af hvert signal (relevant eller ej): det, piloten skal lære os
    $db->exec('CREATE TABLE IF NOT EXISTS erhverv_vurderinger (kunde_id INT NOT NULL, signal_id VARCHAR(160) NOT NULL, vurdering VARCHAR(4) NOT NULL,
        tid VARCHAR(25) NOT NULL, PRIMARY KEY (kunde_id, signal_id))');
    // Sager, kunden følger: nøglen er kommune|titel (som robottens n), dato er den behandling, kunden sidst så
    $db->exec('CREATE TABLE IF NOT EXISTS erhverv_foelger (kunde_id INT NOT NULL, noegle VARCHAR(200) NOT NULL, titel VARCHAR(300) NOT NULL,
        dato VARCHAR(10) NOT NULL, tid VARCHAR(25) NOT NULL, PRIMARY KEY (kunde_id, noegle))');
    // Pipelinen: ref er "s:<sagsnøgle>" for et signal eller "u:<TED-nummer>" for et udbud
    $db->exec("CREATE TABLE IF NOT EXISTS erhverv_pipeline (kunde_id INT NOT NULL, ref VARCHAR(220) NOT NULL, titel VARCHAR(300) NOT NULL,
        status VARCHAR(20) NOT NULL, note $tekst NULL, ansvarlig VARCHAR(80) NOT NULL DEFAULT '', opdateret VARCHAR(25) NOT NULL, PRIMARY KEY (kunde_id, ref))");
    $db->exec('CREATE TABLE IF NOT EXISTS erhverv_sendt (kunde_id INT NOT NULL, uge VARCHAR(10) NOT NULL, sendt VARCHAR(25) NOT NULL, antal INT NOT NULL DEFAULT 0,
        PRIMARY KEY (kunde_id, uge))');
    $db->exec("CREATE TABLE IF NOT EXISTS erhverv_koe (kunde_id INT NOT NULL, uge VARCHAR(10) NOT NULL, emne VARCHAR(255) NOT NULL, html $tekst NOT NULL,
        tekst $tekst NOT NULL, antal INT NOT NULL DEFAULT 0, send_efter VARCHAR(25) NOT NULL, forsoeg INT NOT NULL DEFAULT 0, PRIMARY KEY (kunde_id, uge))");
    // "Book en gennemgang" fra salgssiden (api/erhverv-book.php)
    $db->exec("CREATE TABLE IF NOT EXISTS erhverv_henvendelser (id $id, firma VARCHAR(120) NOT NULL, navn VARCHAR(100) NOT NULL DEFAULT '',
        email VARCHAR(254) NOT NULL, tlf VARCHAR(30) NOT NULL DEFAULT '', produkt VARCHAR(40) NOT NULL, besked $tekst NULL, oprettet VARCHAR(25) NOT NULL)");
    $db->exec('CREATE TABLE IF NOT EXISTS erhverv_uger (uge VARCHAR(10) NOT NULL PRIMARY KEY, planlagt VARCHAR(25) NOT NULL, antal INT NOT NULL DEFAULT 0, stoppet VARCHAR(25) NULL)');
}

// ---------- Link og adgang ----------
function er_noegle(array $kunde): string { $id = (int)$kunde['id']; $v = (int)$kunde['version']; return "$id-$v-" . signatur("erhverv:$id:$v"); }
function er_link(array $kunde): string { global $K; return $K['site_url'] . 'erhverv/rapport.html#k=' . er_noegle($kunde); }
// Kunden bag en nøgle, hvis nøglen er gyldig og ikke erstattet af et nyere link. Stoppede kunder og kunder på pause får null.
function er_kunde(PDO $db, string $noegle, bool $kunAktive = true): ?array {
    if (!preg_match('/^(\d{1,9})-(\d{1,6})-([a-f0-9]{32})$/', $noegle, $m) || !signatur_ok("erhverv:{$m[1]}:{$m[2]}", $m[3])) return null;
    $q = $db->prepare('SELECT * FROM erhverv_kunder WHERE id = ? AND version = ?' . ($kunAktive ? ' AND ' . er_kan() : '')); $q->execute([(int)$m[1], (int)$m[2]]);
    return $q->fetch() ?: null;
}
function er_afmeld_link(int $id): string { global $K; return $K['site_url'] . "api/erhverv-afmeld.php?id=$id&t=" . signatur("erhverv-afmeld:$id"); }
function er_liste(string $s): array { return array_values(array_filter(array_map('trim', explode(',', $s)), fn($x) => $x !== '')); }
function er_brancher(array $kunde): array { return array_values(array_intersect(er_liste((string)($kunde['brancher'] ?? '')), ER_BRANCHER)); }
function er_rens_brancher($v): string { return implode(',', array_values(array_intersect(array_map('strval', is_array($v) ? $v : explode(',', (string)$v)), ER_BRANCHER))); }
// "Til jer": projektkortet siger, at kundens branche kan få forretning ud af signalet
function er_til_jer(array $kunde, array $s): bool { return (bool)array_intersect($s['f']['muligheder'] ?? [], er_brancher($kunde)); }
function er_modtagere(array $kunde): array { return array_values(array_unique(array_filter(array_map('ren_email', array_merge([$kunde['email']], er_liste((string)$kunde['modtagere'])))))); }

// ---------- Signalerne ----------
function er_indeks(): array {
    static $i = null;
    return $i ??= (json_decode((string)@file_get_contents(__DIR__ . '/_erhverv-signaler.json'), true) ?: ['signaler' => [], 'typer' => [], 'stadier' => [], 'kommuner' => [], 'raekke' => []]);
}
function er_segmenter(string $produkt): array { return $produkt === 'begge' ? ['signaler', 'energi'] : [$produkt === 'energi' ? 'energi' : 'signaler']; }
function er_idag(): string { return (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->format('Y-m-d'); }

// Kundens signaler: indeksets signaler i kundens kommuner og segmenter, plus sager med kundens egne ord ("ord" i ty)
function er_signaler_til(array $kunde): array {
    $i = er_indeks();
    $kommuner = array_flip(er_liste((string)$kunde['kommuner']));
    $seg = er_segmenter((string)$kunde['produkt']);
    $ud = [];
    foreach ($i['signaler'] as $s) {
        if (!isset($kommuner[$s['k']])) continue;
        $ty = array_intersect_key($s['ty'], array_flip($seg));
        if (!$ty) continue;
        $ud[$s['id']] = ['ty' => $ty] + $s;
    }
    $ord = er_liste(mb_strtolower((string)$kunde['ord']));
    // Samme sag behandles ofte i flere udvalg: én linje pr. sag (kommune + titel uden "Forslag til" o.l.), den nyeste behandling
    $noegle = fn(string $k, string $t) => $k . '|' . mb_substr(preg_replace('/^(forslag til|endelig vedtagelse af|vedtagelse af)\s+/u', '', preg_replace('/\s+/u', ' ', mb_strtolower($t))), 0, 90);
    $prSag = [];
    foreach ($ud as $id => $s) $prSag[$noegle($s['k'], $s['t'])] = $id;
    if ($ord) {
        $idag = er_idag();
        $navne = array_column($i['kommuner'], 'navn', 'slug');
        $graense = date('Y-m-d', strtotime($idag) - (($i['dage'] ?? 90) * 86400));
        foreach (array_keys($kommuner) as $slug) {
            foreach ((mm_hent_kommune((string)$slug)['sager'] ?? []) as $s) {
                $kommer = ($s['st'] ?? '') === 'kommer';
                if ($kommer ? $s['dato'] < $idag : $s['dato'] < $graense) continue;
                $tekst = mb_strtolower(($s['t'] ?? '') . ' ' . ($s['kt'] ?? '') . ' ' . ($s['d'] ?? ''));
                $fundet = null;
                foreach ($ord as $o) if (mb_strpos($tekst, $o) !== false) { $fundet = $o; break; }
                if ($fundet === null) continue;
                $id = $s['id'] ?? $s['url'];
                $n = $noegle((string)$slug, (string)($s['kt'] ?? $s['t']));
                if (isset($prSag[$n])) $id = $prSag[$n];
                if (isset($ud[$id])) {
                    $ud[$id]['ty']['ord'] = $fundet;
                    // Et rent søgeordsfund flyttes til den nyeste behandling; de andre står som sagens vej
                    if (count($ud[$id]['ty']) === 1 && $s['dato'] !== $ud[$id]['dato']) {
                        $vej = $ud[$id]['vej'] ?: [[$ud[$id]['u'], $ud[$id]['dato'], $ud[$id]['url']]];
                        $vej[] = [$s['u'] ?? '', $s['dato'], $s['url']];
                        usort($vej, fn($a, $b) => strcmp($a[1], $b[1]));
                        if ($s['dato'] > $ud[$id]['dato']) $ud[$id] = ['dato' => $s['dato'], 'u' => $s['u'] ?? '', 'url' => $s['url'], 'kom' => $kommer ? 1 : 0, 'kl' => $s['k'] ?? ''] + $ud[$id];
                        $ud[$id]['vej'] = $vej;
                    }
                    continue;
                }
                $prSag[$n] = $id;
                $d = (string)($s['d'] ?? '');
                // Dagsordener kommer typisk en uge før mødet; uden robottens "første gang set" bruges det som bud
                $set = $kommer ? min($idag, date('Y-m-d', strtotime($s['dato']) - 7 * 86400)) : $s['dato'];
                $ud[$id] = ['id' => $id, 'k' => $slug, 'kn' => $navne[$slug] ?? $slug, 't' => $s['kt'] ?? $s['t'], 'u' => $s['u'] ?? '', 'dato' => $s['dato'],
                    'kom' => $kommer ? 1 : 0, 'd' => mm_klip($d, 320), 'ud' => $kommer ? '' : mm_klip((string)($s['ud'] ?? ''), 140), 'url' => $s['url'],
                    'kl' => $s['k'] ?? '', 'b' => $s['b'] ?? 'assets/emner/generel.svg', 'sd' => '', 'ty' => ['ord' => $fundet], 'vej' => [], 'set' => $set];
            }
        }
    }
    $ud = array_values($ud);
    usort($ud, fn($a, $b) => strcmp($b['dato'], $a['dato']));
    return $ud;
}

// Kommunernes EU-udbud (TED) i kundens kommuner, nyeste først. "grupper" er de udbudsgrupper, der passer til produktet,
// så siden og mailen kan vise dem først (Tidlige signaler: bygge, rådgivning og ejendomme; Energiradar: energi).
function er_udbud_til(array $kunde): array {
    $kommuner = array_flip(er_liste((string)$kunde['kommuner']));
    return array_values(array_filter(er_indeks()['udbud'] ?? [], fn($u) => (bool)array_intersect_key(array_flip($u['k']), $kommuner)));
}
function er_udbud_grupper(string $produkt): array {
    return match ($produkt) { 'energi' => ['energi'], 'begge' => ['bygge', 'raadgivning', 'ejendom', 'energi'], default => ['bygge', 'raadgivning', 'ejendom'] };
}

// De sager, kunden følger, med den nyeste behandling robotten kender. "ny" = behandlet eller på dagsordenen efter den
// behandling, kunden fulgte (eller sidst så).
function er_foelger(PDO $db, array $kunde, ?array $signaler = null): array {
    $q = $db->prepare('SELECT noegle, titel, dato, tid FROM erhverv_foelger WHERE kunde_id = ? ORDER BY tid DESC'); $q->execute([(int)$kunde['id']]);
    $nyeste = [];
    foreach ($signaler ?? er_signaler_til($kunde) as $s) if (isset($s['n']) && (!isset($nyeste[$s['n']]) || $s['dato'] > $nyeste[$s['n']]['dato'])) $nyeste[$s['n']] = $s;
    return array_map(function ($f) use ($nyeste) {
        $s = $nyeste[$f['noegle']] ?? null;
        return $f + ['id' => $s['id'] ?? null, 'seneste' => $s['dato'] ?? null, 'ny' => $s && $s['dato'] > $f['dato']];
    }, $q->fetchAll());
}

// Navnene på typer og stadier fra indekset (som robotten skrev dem), så siden og mailen bruger de samme ord
// Typerne har nøglen "segment:id" ("energi:plan" er energiplaner, "signaler:plan" lokalplaner)
function er_navne(): array {
    $i = er_indeks(); $typer = ['ord' => 'Dine søgeord'];
    foreach ($i['typer'] as $seg => $l) foreach ($l as $t) $typer["$seg:{$t['id']}"] = $t['navn'];
    return ['typer' => $typer, 'stadier' => array_column($i['stadier'], 'navn', 'id')];
}

// ---------- Mailen ----------
function er_kr(float $kr): string {
    if ($kr >= 1e9) return str_replace('.', ',', (string)round($kr / 1e9, 1)) . ' mia. kr.';
    if ($kr >= 1e6) return str_replace('.', ',', (string)round($kr / 1e6, 1)) . ' mio. kr.';
    return number_format($kr, 0, ',', '.') . ' kr.';
}
// De vigtigste tal fra projektkortet som korte mærker: beløb, boliger, areal og frist
function er_fakta_chips(array $f): array {
    return [
        !empty($f['beloeb_kr']) ? er_kr((float)$f['beloeb_kr']) : '',
        !empty($f['boliger']) ? (int)$f['boliger'] . ' boliger' : '',
        !empty($f['areal_m2']) ? number_format((float)$f['areal_m2'], 0, ',', '.') . ' m²' : (!empty($f['areal_ha']) ? str_replace('.', ',', (string)$f['areal_ha']) . ' ha' : ''),
        !empty($f['frist']) ? 'frist ' . mm_dato($f['frist']) : '',
    ];
}
// Ugens mail til en kunde: nye signaler i ugen op til mandag $uge (efter stadie, tidligste først) og kommende møder de næste
// 14 dage. Svarer null, hvis der intet er at sende.
function er_mail_til(array $kunde, string $uge): ?array {
    global $K;
    $site = $K['site_url'];
    $alle = er_signaler_til($kunde);
    $fra = date('Y-m-d', strtotime($uge) - 7 * 86400);
    $til14 = date('Y-m-d', strtotime($uge) + 14 * 86400);
    $raekke = array_flip(er_indeks()['raekke'] ?: []);
    // Relevansen (rv, 1–3) er Claude Haiku 5.5's bedømmelse. Mailen tager kun 2–3 med; signaler, der ikke er bedømt endnu,
    // og kundens egne søgeord kommer altid med.
    $relevant = fn($s) => isset($s['ty']['ord']) || !isset($s['rv']) || $s['rv'] >= 2;
    $tilJer = fn($s) => er_til_jer($kunde, $s);
    $nye = array_values(array_filter($alle, fn($s) => $s['set'] >= $fra && $s['set'] < $uge && !$s['kom'] && $relevant($s)));
    // De største projekter først (projektkortets relevans), derefter de tidligste stadier
    usort($nye, fn($a, $b) => ($tilJer($b) <=> $tilJer($a)) ?: (($b['rv'] ?? 2) <=> ($a['rv'] ?? 2)) ?: (($raekke[$a['sd']] ?? 9) <=> ($raekke[$b['sd']] ?? 9)) ?: strcmp($b['dato'], $a['dato']));
    $kommer = array_values(array_filter($alle, fn($s) => $s['kom'] && $s['dato'] >= $uge && $s['dato'] < $til14 && $relevant($s)));
    usort($kommer, fn($a, $b) => strcmp($a['dato'], $b['dato']) ?: (($b['rv'] ?? 2) <=> ($a['rv'] ?? 2)));
    // Sager, kunden følger, der er kommet på en dagsorden eller er behandlet igen siden sidste mandag
    $foelgerNye = array_values(array_filter(er_foelger(db(), $kunde, $alle), fn($f) => $f['ny'] && $f['seneste'] >= $fra));
    $fulgte = array_column($foelgerNye, 'id');
    $foelger = array_values(array_filter($alle, fn($s) => in_array($s['id'], $fulgte, true)));
    // Nye udbud i ugen fra kundens kommuner, de udbudsgrupper, der passer til produktet
    $grupper = er_udbud_grupper((string)$kunde['produkt']);
    $udbud = array_values(array_filter(er_udbud_til($kunde), fn($u) => $u['dato'] >= $fra && $u['dato'] < $uge && array_intersect($u['g'], $grupper)));
    if (!$nye && !$kommer && !$foelger && !$udbud) return null;
    // Ugens tre vigtigste: relevans 3 med projektkort, kundens brancher først, derefter det største beløb og de kommende møder.
    // De står øverst og tages ud af listerne nedenfor, så intet står to gange.
    $vigtige = array_values(array_filter(array_merge($nye, $kommer), fn($s) => ($s['rv'] ?? 0) === 3 && !empty($s['f']['hvad'])));
    usort($vigtige, fn($a, $b) => ($tilJer($b) <=> $tilJer($a)) ?: ((float)($b['f']['beloeb_kr'] ?? 0) <=> (float)($a['f']['beloeb_kr'] ?? 0)) ?: ($b['kom'] <=> $a['kom']));
    $vigtige = array_slice($vigtige, 0, 3);
    $vigtigeId = array_column($vigtige, 'id');
    $udenVigtige = fn(array $l) => array_values(array_filter($l, fn($s) => !in_array($s['id'], $vigtigeId, true)));

    $n = er_navne(); $C = MM_C; $F = MM_SANS; $e = 'mm_esc';
    $kommuner = array_values(array_unique(array_map(fn($s) => $s['kn'], $alle)));
    $hvor = count($kommuner) > 3 ? count($kommuner) . ' kommuner' : preg_replace('/, ([^,]*)$/u', ' og $1', implode(', ', $kommuner));
    $ugenr = mm_ugenr($uge);
    $emne = 'Sagsvagt Erhverv uge ' . $ugenr . ': ' . (count($nye) ? count($nye) . (count($nye) === 1 ? ' nyt signal' : ' nye signaler') : (count($udbud) ? count($udbud) . (count($udbud) === 1 ? ' nyt udbud' : ' nye udbud') : 'kommende møder')) . ($hvor ? " i $hvor" : '');
    $rapport = er_link($kunde);

    // Samme form som mandagsmailen (api/_mandagsmail_lav.php): logo og uge øverst, lyngbølgen, de vigtigste som store kort
    // med emnetegningen, resten centreret med en blød streg imellem og rosenbølgen i bunden
    $kicker = function (array $s) use ($n): string {
        $ty = array_map(fn($seg, $t) => $seg === 'ord' ? 'Dine søgeord' : ($n['typer']["$seg:$t"] ?? $t), array_keys($s['ty']), $s['ty']);
        $dele = [$s['kn'], implode(' / ', array_unique($ty))];
        if ($s['sd'] !== '') $dele[] = $n['stadier'][$s['sd']] ?? $s['sd'];
        return implode(' · ', $dele);
    };
    $mere = fn(string $href, string $t) => '<p style="margin:12px 0 0;"><a href="' . $e($href) . '" style="font:700 14px/1.4 ' . $F . ';color:' . $C['indigo'] . ';text-decoration:none;">' . $t . ' ›</a></p>';
    $skille = '<tr><td style="padding:0 70px;font-size:0;line-height:0;"><img src="' . MM_MAIL . 'skille.png" width="460" height="12" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>';
    // Linjen over overskriften: "Til jer" i vin, derefter kommune, type, stadie og hvornår
    $over = function (array $s) use ($C, $e, $kicker, $kunde): string {
        $k = $kicker($s);
        // Stadiet "Behandlet" står allerede i linjen, så kun datoen
        $naar = $s['kom'] ? 'møde ' . mm_dato($s['dato'], true) : (str_ends_with($k, 'Behandlet') ? '' : 'behandlet ') . mm_dato($s['dato']);
        return (er_til_jer($kunde, $s) ? '<b style="color:' . $C['vin'] . ';">Til jer</b> · ' : '') . $e($k . ' · ' . $naar);
    };
    $stor = function (array $s) use ($site, $C, $F, $e, $over, $mere): string {
        $f = $s['f'] ?? [];
        $chips = implode(' · ', array_filter(er_fakta_chips($f)));
        $hvad = ($f['hvad'] ?? '') !== '' ? $f['hvad'] : $s['d'];
        // Emnetegningen fra sagssiden (assets/emner/<emne>.svg) i mailens jpg-udgave
        $billede = mm_billede(['id' => $s['id'], 'e' => [pathinfo((string)($s['b'] ?? ''), PATHINFO_FILENAME)]]);
        return '<tr><td style="padding:14px 22px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' . $C['kalkLys'] . ';border-radius:16px;"><tr><td align="center" style="padding:22px 22px 26px;">'
            . '<a href="' . $e($site . $s['url']) . '" style="text-decoration:none;"><img src="' . $billede . '" width="512" height="288" alt="" style="display:block;width:100%;max-width:512px;height:auto;margin:0 auto;border:0;border-radius:14px;"></a>'
            . '<p style="margin:18px 0 6px;font:600 12px/1.45 ' . $F . ';color:' . $C['muted'] . ';">' . $over($s) . '</p>'
            . '<a href="' . $e($site . $s['url']) . '" style="font:800 22px/1.25 ' . $F . ';color:' . $C['nat'] . ';text-decoration:none;">' . $e($s['t']) . '</a>'
            . ($chips !== '' ? '<p style="margin:10px 0 0;font:700 14px/1.5 ' . $F . ';color:' . $C['vin'] . ';">' . $e($chips) . '</p>' : '')
            . ($hvad !== '' ? '<p style="margin:10px 0 0;font:15px/1.55 ' . $F . ';color:' . $C['brod'] . ';">' . $e(mm_klip($hvad, 220)) . '</p>' : '')
            . (($f['naeste'] ?? '') !== '' ? '<p style="margin:10px 0 0;font:14px/1.5 ' . $F . ';color:' . $C['nat'] . ';"><b style="color:' . $C['indigo'] . ';">Næste skridt:</b> ' . $e($f['naeste']) . '</p>' : '')
            . $mere($site . $s['url'], 'Læs hele sagen')
            . '</td></tr></table></td></tr>';
    };
    $kort = function (array $s) use ($site, $C, $F, $e, $over, $mere): string {
        $f = $s['f'] ?? [];
        $chips = implode(' · ', array_filter(er_fakta_chips($f)));
        $hvad = ($f['hvad'] ?? '') !== '' ? $f['hvad'] : $s['d'];
        return '<tr><td align="center" style="padding:18px 36px;">'
            . '<p style="margin:0 0 6px;font:600 12px/1.45 ' . $F . ';color:' . $C['muted'] . ';">' . $over($s) . '</p>'
            . '<a href="' . $e($site . $s['url']) . '" style="font:700 17px/1.35 ' . $F . ';color:' . $C['nat'] . ';text-decoration:none;">' . $e($s['t']) . '</a>'
            . ($chips !== '' ? '<p style="margin:6px 0 0;font:700 13px/1.5 ' . $F . ';color:' . $C['vin'] . ';">' . $e($chips) . '</p>' : '')
            . ($hvad !== '' ? '<p style="margin:6px 0 0;font:14px/1.5 ' . $F . ';color:' . $C['brod'] . ';">' . $e(mm_klip($hvad, 160)) . '</p>' : '')
            . $mere($site . $s['url'], 'Læs mere')
            . '</td></tr>';
    };
    $mereIRapporten = fn(int $n) => $n > 0 ? '<tr><td align="center" style="padding:6px 28px;font:13px/1.5 ' . $F . ';color:' . $C['muted'] . ';">Og ' . $n . ' mere. <a href="' . $e($rapport) . '" style="color:' . $C['indigo'] . ';font-weight:600;">Se dem i rapporten</a></td></tr>' : '';
    $afsnit = function (string $titel, array $liste, int $max, bool $store = false) use ($C, $F, $e, $stor, $kort, $skille, $mereIRapporten): string {
        if (!$liste) return '';
        $h = '<tr><td align="center" style="padding:34px 28px 8px;"><h2 style="margin:0;font:800 22px/1.25 ' . $F . ';color:' . $C['nat'] . ';">' . $e($titel) . '</h2></td></tr>';
        foreach (array_slice($liste, 0, $max) as $i => $s) $h .= $store ? $stor($s) : (($i ? $skille : '') . $kort($s));
        return $h . $mereIRapporten(count($liste) - $max);
    };
    $dele = array_filter([count($nye) ? count($nye) . (count($nye) === 1 ? ' nyt signal' : ' nye signaler') : '',
        count($kommer) ? count($kommer) . (count($kommer) === 1 ? ' sag' : ' sager') . ' på møder de næste 14 dage' : '',
        count($udbud) ? count($udbud) . (count($udbud) === 1 ? ' nyt udbud' : ' nye udbud') : '',
        count($foelger) ? count($foelger) . (count($foelger) === 1 ? ' sag, I følger, er' : ' sager, I følger, er') . ' rykket' : '']);
    $intro = $dele ? mm_stor(preg_replace('/, ([^,]*)$/u', ' og $1', implode(', ', $dele))) . '.' : '';
    $udbudRk = '';
    foreach (array_slice($udbud, 0, 8) as $i => $u) {
        $art = ['kommer' => 'Udbud på vej', 'aaben' => 'Åbent udbud', 'vundet' => 'Tildelt'][$u['art']];
        $info = array_filter([$u['vaerdi'] ? er_kr((float)$u['vaerdi']) : '', $u['frist'] ? 'frist ' . mm_dato($u['frist']) : '', $u['vinder'] ? 'vundet af ' . implode(', ', $u['vinder']) : '']);
        $udbudRk .= ($i ? $skille : '') . '<tr><td align="center" style="padding:18px 36px;">'
            . '<p style="margin:0 0 6px;font:600 12px/1.45 ' . $F . ';color:' . $C['muted'] . ';"><b style="color:' . $C['indigo'] . ';">' . $art . '</b> · ' . $e(implode(', ', array_slice($u['ordregivere'], 0, 2))) . ' · ' . mm_dato($u['dato']) . '</p>'
            . '<a href="' . $e($u['url']) . '" style="font:700 17px/1.35 ' . $F . ';color:' . $C['nat'] . ';text-decoration:none;">' . $e($u['titel']) . '</a>'
            . ($info ? '<p style="margin:6px 0 0;font:700 13px/1.5 ' . $F . ';color:' . $C['vin'] . ';">' . $e(implode(' · ', $info)) . '</p>' : '')
            . '<p style="margin:6px 0 0;font:14px/1.5 ' . $F . ';color:' . $C['brod'] . ';">' . $e($u['kategori']) . '</p>'
            . $mere($u['url'], 'Se udbuddet')
            . '</td></tr>';
    }
    $afmeld = er_afmeld_link((int)$kunde['id']);
    $link = fn($href, $tekst) => '<a href="' . $e($href) . '" style="display:inline-block;padding:12px 9px;line-height:20px;font-weight:600;color:' . $C['indigo'] . ';">' . $tekst . '</a>';
    $foerste = $dele ? mm_stor(array_values($dele)[0]) : 'Ugens sager';
    $preheader = ($vigtige[0]['t'] ?? $nye[0]['t'] ?? $kommer[0]['t'] ?? $udbud[0]['titel'] ?? $intro);
    $html = mm_mail_top($emne, $preheader, $ugenr, $uge, MM_MAIL . 'logo.png')
        . '<tr><td align="center" style="padding:12px 28px 0;">'
        . '<h1 style="margin:0;font:800 34px/1.12 ' . $F . ';color:' . $C['nat'] . ';">God morgen.<br>' . $e($foerste) . '.</h1>'
        . '<p style="margin:14px 0 0;font:600 13px/1.5 ' . $F . ';color:' . $C['muted'] . ';">' . $e(implode(' · ', array_filter([ER_PRODUKTER[$kunde['produkt']] ?? 'Tidlige signaler', $hvor, $kunde['firma']]))) . '</p>'
        . '</td></tr>'
        . '<tr><td style="padding:22px 0 0;font-size:0;line-height:0;"><img src="' . MM_MAIL . 'boelge-lyng.png" width="600" height="70" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>'
        . $afsnit(er_brancher($kunde) ? 'Ugens vigtigste for jer' : 'Ugens vigtigste', $vigtige, 3, true)
        . $afsnit('Sager, I følger', $foelger, 10)
        . $afsnit('Nyt i ugen', $udenVigtige($nye), 12)
        . $afsnit('På kommende møder', $udenVigtige($kommer), 10)
        . ($udbud ? '<tr><td align="center" style="padding:34px 28px 8px;"><h2 style="margin:0;font:800 22px/1.25 ' . $F . ';color:' . $C['nat'] . ';">Nye udbud fra kommunerne</h2></td></tr>' . $udbudRk . $mereIRapporten(count($udbud) - 8) : '')
        . '<tr><td align="center" style="padding:34px 28px 0;"><a href="' . $e($rapport) . '" style="display:inline-block;background:' . $C['nat'] . ';color:' . $C['kalk'] . ';font:700 15px ' . $F . ';text-decoration:none;padding:14px 28px;border-radius:99px;">Åbn hele rapporten</a>'
        . '<p style="margin:14px 0 0;font:14px/1.55 ' . $F . ';color:' . $C['brod'] . ';">Filtrér, eksportér til regneark og markér, hvad der er relevant for jer.</p></td></tr>'
        . '<tr><td style="padding:34px 0 0;font-size:0;line-height:0;"><img src="' . MM_MAIL . 'boelge-rosen.png" width="600" height="70" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>'
        . '<tr><td align="center" style="padding:18px 32px 30px;font:12px/1.6 ' . $F . ';color:' . $C['muted'] . ';">'
        . '<img src="' . MM_MAIL . 'symbol.png" width="23" height="28" alt="" style="display:block;border:0;margin:0 auto 14px;">'
        . 'Til ' . $e($kunde['firma']) . '. Sagerne er fra kommunernes egne dagsordener og referater; Sagsvagt refererer kort og linker til kilden. Svar på mailen, hvis noget mangler.<br>'
        . $link('mailto:' . MM_REDAKTION . '?subject=' . rawurlencode('Sagsvagt Erhverv'), 'Skriv til os') . $link($afmeld, 'Stop de ugentlige mails') . $link($site . 'privatliv.html', 'Privatliv')
        . '<br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S</td></tr>'
        . "</table>\n</td></tr></table>\n</body></html>";

    $linje = fn(array $s) => '• ' . $s['t'] . "\n  " . $kicker($s) . ' · ' . ($s['kom'] ? 'møde ' : '') . mm_dato($s['dato']) . "\n  " . $site . $s['url'];
    $tekst = "Sagsvagt Erhverv uge $ugenr\n$intro\n\n"
        . ($vigtige ? "UGENS VIGTIGSTE\n" . implode("\n", array_map(fn($s) => $linje($s) . "\n  " . $s['f']['hvad'], $vigtige)) . "\n\n" : '')
        . ($foelger ? "SAGER, I FØLGER\n" . implode("\n", array_map($linje, array_slice($foelger, 0, 10))) . "\n\n" : '')
        . ($udenVigtige($nye) ? "NYT I UGEN\n" . implode("\n", array_map($linje, array_slice($udenVigtige($nye), 0, 12))) . "\n\n" : '')
        . ($udenVigtige($kommer) ? "PÅ KOMMENDE MØDER\n" . implode("\n", array_map($linje, array_slice($udenVigtige($kommer), 0, 10))) . "\n\n" : '')
        . ($udbud ? "NYE UDBUD\n" . implode("\n", array_map(fn($u) => '• ' . $u['titel'] . ($u['frist'] ? ' (frist ' . mm_dato($u['frist']) . ')' : '') . "\n  " . $u['url'], array_slice($udbud, 0, 8))) . "\n\n" : '')
        . "Hele rapporten: $rapport\n\n--\nTil {$kunde['firma']}. Stop de ugentlige mails: $afmeld\nSagsvagt · CVR 46841514";
    return ['emne' => $emne, 'html' => mm_moerk($html), 'tekst' => $tekst, 'antal' => count($nye) + count($kommer) + count($udbud) + count($foelger)];
}

// Sender én kundes mail til alle modtagere og husker det. Svarer 'sendt', 'allerede' eller 'fejl'.
function er_send_en(PDO $db, array $kunde, string $uge, array $mail): string {
    try { $db->prepare('INSERT INTO erhverv_sendt (kunde_id, uge, sendt, antal) VALUES (?, ?, ?, ?)')->execute([(int)$kunde['id'], $uge, nu(), (int)$mail['antal']]); }
    catch (PDOException $e) { return 'allerede'; }
    $hoveder = ['List-Unsubscribe' => '<' . er_afmeld_link((int)$kunde['id']) . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click'];
    $ok = 0;
    foreach (er_modtagere($kunde) as $til) if (send_mail($til, $mail['emne'], $mail['html'], $mail['tekst'], MM_REDAKTION, $hoveder)) $ok++;
    if ($ok) return 'sendt';
    $db->prepare('DELETE FROM erhverv_sendt WHERE kunde_id = ? AND uge = ?')->execute([(int)$kunde['id'], $uge]);
    return 'fejl';
}

// Kaldes ved besøg (api/besoeg.php): søndag fra kl. 18 lægges ugens erhvervsmails i kø én gang, og redaktionen får en prøvemail
function er_maaske_planlaeg(?DateTimeImmutable $nu = null): void {
    global $K;
    $uge = mm_planlaeg_uge($nu);
    if ($uge === null) return;
    $db = db(); er_tabeller($db);
    try { $db->prepare('INSERT INTO erhverv_uger (uge, planlagt) VALUES (?, ?)')->execute([$uge, nu()]); } catch (PDOException $e) { return; }
    @set_time_limit(120);
    $tid = max(mm_kl7($uge), nu());
    $q = $db->query('SELECT * FROM erhverv_kunder WHERE ' . er_kan() . ' AND mail = 1 ORDER BY firma');
    $ind = $db->prepare('INSERT INTO erhverv_koe (kunde_id, uge, emne, html, tekst, antal, send_efter) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $linjer = []; $antal = 0; $proeve = null;
    foreach ($q->fetchAll() as $k) {
        $m = er_mail_til($k, $uge);
        if (!$m) { $linjer[] = "• {$k['firma']}: intet nyt, ingen mail"; continue; }
        try { $ind->execute([(int)$k['id'], $uge, $m['emne'], $m['html'], $m['tekst'], $m['antal'], $tid]); } catch (PDOException $e) { continue; }
        $m['kunde_id'] = (int)$k['id'];
        $antal++; $linjer[] = "• {$k['firma']}: {$m['antal']} signaler til " . implode(', ', er_modtagere($k));
        if ($proeve === null || $m['antal'] > $proeve['antal']) $proeve = $m;
    }
    $db->prepare('UPDATE erhverv_uger SET antal = ? WHERE uge = ?')->execute([$antal, $uge]);
    if (!$linjer) return; // ingen kunder endnu: ingen prøvemail
    $kl = (new DateTimeImmutable(mm_kl7($uge)))->setTimezone(new DateTimeZone('Europe/Copenhagen'))->format('j/n') . ' kl. 7';
    $stop = $K['site_url'] . "api/erhverv-stop.php?uge=$uge&t=" . signatur("erhverv-stop:$uge");
    [$html, $txt] = mail_skabelon($antal ? "Erhvervsmailen er klar: $antal " . ($antal === 1 ? 'kunde' : 'kunder') : 'Ingen erhvervsmail i denne uge',
        ($antal ? "Mails sendes mandag $kl.\n\n" : '') . implode("\n", $linjer) . ($antal ? "\n\nDu behøver ikke gøre noget. Vil du stoppe ugens erhvervsmail, så tryk på knappen." . ($proeve ? "\n\nI næste mail ser du den største af ugens mails." : '') : ''),
        'Stop ugens erhvervsmail', $stop, 'Prøvemail til redaktionen fra Sagsvagt Erhverv.');
    foreach ($K['admins'] as $til) {
        @send_mail($til, $antal ? "Prøve: erhvervsmailen $kl ($antal)" : 'Prøve: ingen erhvervsmail i denne uge', $html, $txt);
        if ($proeve) { [$h, $t] = er_uden_afmeld($proeve); @send_mail($til, '[Prøve] ' . $proeve['emne'], $h, $t); }
    }
}

// Redaktionens kopi af en kundemail må ikke kunne stoppe kundens mail: afmeldingslinket peger på erhverv.html i stedet
function er_uden_afmeld(array $m): array {
    global $K;
    $l = er_afmeld_link((int)$m['kunde_id']); $ny = $K['site_url'] . 'erhverv.html';
    $erstat = [$l => $ny, htmlspecialchars($l, ENT_COMPAT, 'UTF-8') => $ny];
    return [strtr($m['html'], $erstat), strtr($m['tekst'], $erstat)];
}

// Kaldes ved besøg: sender op til 10 planlagte kundemails, når tiden er kommet. Fejler en tre gange, opgives den.
function er_maaske_send(): void {
    $db = db();
    try {
        $q = $db->prepare('SELECT k.uge, k.emne, k.html, k.tekst, k.antal, c.* FROM erhverv_koe k JOIN erhverv_kunder c ON c.id = k.kunde_id
            WHERE k.send_efter <= ? AND k.forsoeg < 3 ORDER BY k.send_efter LIMIT 10');
        $q->execute([nu()]);
        $raekker = $q->fetchAll();
    } catch (PDOException $e) { return; }
    if (!$raekker) return;
    $slet = $db->prepare('DELETE FROM erhverv_koe WHERE kunde_id = ? AND uge = ?');
    $fejlet = $db->prepare('UPDATE erhverv_koe SET forsoeg = forsoeg + 1 WHERE kunde_id = ? AND uge = ?');
    foreach ($raekker as $r) {
        // Sat på pause, stoppet eller afmeldt mailen siden planlægningen: mailen sendes ikke
        if (!in_array($r['status'], ['proeve', 'aktiv'], true) || !(int)$r['mail']) { $slet->execute([(int)$r['id'], $r['uge']]); continue; }
        $svar = er_send_en($db, $r, (string)$r['uge'], ['emne' => $r['emne'], 'html' => $r['html'], 'tekst' => $r['tekst'], 'antal' => (int)$r['antal']]);
        if ($svar === 'fejl') { $fejlet->execute([(int)$r['id'], $r['uge']]); error_log('Sagsvagt Erhverv: kunne ikke sende til kunde ' . $r['id']); }
        else $slet->execute([(int)$r['id'], $r['uge']]);
    }
}

function er_stop(PDO $db, string $uge): int {
    er_tabeller($db);
    $q = $db->prepare('DELETE FROM erhverv_koe WHERE uge = ?'); $q->execute([$uge]);
    try { $db->prepare('INSERT INTO erhverv_uger (uge, planlagt, stoppet) VALUES (?, ?, ?)')->execute([$uge, nu(), nu()]); }
    catch (PDOException $e) { $db->prepare('UPDATE erhverv_uger SET stoppet = ? WHERE uge = ?')->execute([nu(), $uge]); }
    return $q->rowCount();
}
