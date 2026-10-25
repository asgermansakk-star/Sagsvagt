<?php
// Mandagsmailen lavet på serveren: samme udvælgelse og samme mail som assets/mandagsmail.js og assets/profil.js
// (linje for linje oversat), så den automatiske udsendelse ikke kræver en browser, og profilerne aldrig forlader serveren.
// Ændrer du mailen, så ret begge filer; avis/tjek-mandagsmail.mjs sammenligner dem.
//
//   mm_profil($abonnent, $EMNER, $aabneSlugs)                          → profilen (som profilFor)
//   mm_lav_mandagsmail($data, $profil, $idag, $modtager, $afmeld)      → ['emne', 'preheader', 'html', 'tekst', 'antal']
//   mm_lav_ventemail($kommuner, $aabne, $idag, $navn, $modtager, $afmeld)
declare(strict_types=1);

const MM_C = [
    'nat' => '#0E0F14', 'kalk' => '#E6DFD3', 'kalkLys' => '#EEE8DE', 'muted' => '#56535A', 'rule' => '#CFC6B8', 'brod' => '#3E3B40',
    'vin' => '#8A2430', 'bordeaux' => '#3E0E14', 'rosen' => '#DCA9A5', 'indigo' => '#28377A', 'blaek' => '#0C1430', 'lyng' => '#B7BBD8',
];
const MM_SANS = "Montserrat, 'Segoe UI', Arial, sans-serif";
const MM_SITE = 'https://sagsvagt.dk/';
const MM_REDAKTION = 'mansa@sagsvagt.dk';
// Mailens billeder (toppen i Mødet-gradienten, sektionsikoner og symbolet i bunden). Mailen skal give mening uden dem.
const MM_MAIL = MM_SITE . 'assets/mail/';
const MM_VIS = 4;

// ---------- Små hjælpere (som i JS) ----------
function mm_esc(?string $s): string { return htmlspecialchars((string)$s, ENT_COMPAT | ENT_SUBSTITUTE, 'UTF-8'); }
function mm_dag(string $iso): int { return (int)gmmktime(12, 0, 0, (int)substr($iso, 5, 2), (int)substr($iso, 8, 2), (int)substr($iso, 0, 4)); }
function mm_dato(string $iso, bool $ugedag = false): string {
    static $dage = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
    static $mdr = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
    $t = mm_dag($iso);
    return ($ugedag ? $dage[(int)gmdate('w', $t)] . ' ' : '') . (int)gmdate('j', $t) . '. ' . $mdr[(int)gmdate('n', $t) - 1];
}
function mm_kort(string $iso): string { return mm_dato($iso); }
function mm_stor(string $t): string { return mb_strtoupper(mb_substr($t, 0, 1)) . mb_substr($t, 1); }
function mm_alder(string $idag, string $iso): float { return (mm_dag($idag) - mm_dag($iso)) / 86400; }
function mm_ugenr(string $iso): int { return (int)gmdate('W', mm_dag($iso)); }
function mm_klip(?string $t, int $n): string {
    $t = (string)$t;
    return mb_strlen($t) > $n ? preg_replace('/\s+\S*$/u', '', mb_substr($t, 0, $n)) . ' …' : $t;
}
function mm_hvor(string $u): string { return preg_match('/Lokaludvalg$/u', $u) ? preg_replace('/\s*Lokaludvalg$/u', '', $u) . ' Lokaludvalg' : $u; }
function mm_lower(string $s): string { return mb_strtolower($s, 'UTF-8'); }

// ---------- Profilen (assets/profil.js) ----------
const MM_NOEGLEORD = ['trafik' => '/trafik|cykl|parkering/u', 'klima' => '/klima|grøn|miljø|solcelle/u', 'affald' => '/affald|genbrug/u', 'bolig' => '/bolig/u',
    'byggeri' => '/bygg|lokalplan|byplan/u', 'skole' => '/skole|børn|dagtilbud|uddannelse/u', 'aeldre' => '/ældre|sundhed|pleje/u', 'social' => '/social|udsat|hjemløs/u',
    'budget' => '/budget|økonomi/u', 'kultur' => '/kultur|fritid|idræt|bibliotek/u', 'erhverv' => '/erhverv|job|arbejdsmarked/u'];
function mm_emner_fra_tekst(?string $tekst, array $EMNER): array {
    $t = mm_lower((string)$tekst);
    return array_values(array_filter(array_keys($EMNER), fn($id) => str_contains($t, mm_lower($EMNER[$id]['navn'])) || (isset(MM_NOEGLEORD[$id]) && preg_match(MM_NOEGLEORD[$id], $t))));
}
function mm_slug_af(string $t): string {
    $t = preg_replace('/\s+kommunes?$/u', '', mm_lower($t));
    $t = str_replace(['æ', 'ø', 'å'], ['ae', 'oe', 'aa'], $t);
    return trim(preg_replace('/[^a-z0-9]+/', '-', $t), '-');
}
function mm_kommuner_fra_tekst(?string $tekst, array $aabne): array {
    static $alias = ['kbh' => 'koebenhavn', 'koebenhavns' => 'koebenhavn', 'lyngby' => 'lyngby-taarbaek', 'taastrup' => 'hoeje-taastrup'];
    $ud = [];
    foreach (preg_split('/,|\/|\s+og\s+/iu', (string)$tekst) as $t) {
        $s = mm_slug_af($t); $s = $alias[$s] ?? $s;
        if (in_array($s, $aabne, true) && !in_array($s, $ud, true)) $ud[] = $s;
    }
    return $ud;
}
function mm_profil(array $a, array $EMNER, array $aabne): array {
    $p = json_decode((string)($a['profil'] ?? ''), true);
    if (!is_array($p)) $p = [];
    $valgte = is_array($p['kommuner'] ?? null) ? $p['kommuner'] : (!empty($p['kommune']) ? [$p['kommune']] : []);
    $valgte = array_values(array_filter($valgte, fn($s) => in_array($s, $aabne, true)));
    $emner = array_values(array_filter((array)($p['emner'] ?? []), fn($id) => is_string($id) && isset($EMNER[$id])));
    return [
        'navn' => trim((string)($p['navn'] ?? '')),
        'emner' => $emner ?: mm_emner_fra_tekst($a['emner'] ?? '', $EMNER),
        'ord' => is_array($p['ord'] ?? null) ? array_values($p['ord']) : [],
        'bydel' => (string)($p['bydel'] ?? ''),
        'kommuner' => $valgte ?: mm_kommuner_fra_tekst($a['kommuner'] ?? '', $aabne),
    ];
}
// De kommuner, en tilmeldt skrev, med pænt navn ("aarhus kommune" → "Aarhus"), som skrevne() på admin-siden
function mm_skrevne(?string $t): array {
    $ud = [];
    foreach (preg_split('/,|\/|\s+og\s+/iu', (string)$t) as $x) {
        $x = preg_replace('/\s+kommunes?$/iu', '', trim($x));
        if ($x !== '') $ud[] = mm_stor($x);
    }
    return $ud;
}

// ---------- Udvælgelse (vaelgSager) ----------
function mm_vaelg_sager(array $data, array $profil, string $idag): array {
    $ord = array_values(array_filter(array_map('trim', $profil['ord'] ?? []), fn($o) => $o !== ''));
    $emner = array_values(array_filter($profil['emner'] ?? [], fn($id) => isset($data['emner'][$id])));
    $vurder = function (array $s) use ($ord, $emner, $idag): array {
        $tekst = mm_lower(($s['t'] ?? '') . ' ' . ($s['d'] ?? ''));
        $titel = mm_lower($s['t'] ?? '');
        $mE = array_values(array_filter($emner, fn($id) => in_array($id, $s['e'] ?? [], true)));
        $mO = array_values(array_filter($ord, fn($o) => str_contains($tekst, mm_lower($o))));
        $iTitel = count(array_filter($emner, fn($id) => in_array($id, $s['et'] ?? [], true))) + count(array_filter($ord, fn($o) => str_contains($titel, mm_lower($o))));
        $hits = count($mE) + count($mO) * 2;
        return $s + ['mE' => $mE, 'mO' => $mO, 'hits' => $hits,
            'score' => ($s['v'] ?? 0) * 6 + $hits * 4 + $iTitel * 8 - max(0, mm_alder($idag, $s['dato'])) * 0.35 - ($s['r'] ?? 0) * 25];
    };
    $mine = [];
    foreach ($data['sager'] as $s) { if (!empty($s['r'])) continue; $v = $vurder($s); if ($v['hits'] > 0) $mine[] = $v; }
    $sketI = fn(int $dage) => array_values(array_filter($mine, fn($s) => $s['st'] !== 'kommer' && mm_alder($idag, $s['dato']) >= 0 && mm_alder($idag, $s['dato']) <= $dage));
    $dage = 7; $sket = $sketI($dage);
    if (count($sket) < 3) { $dage = 14; $sket = $sketI($dage); }
    usort($sket, fn($a, $b) => $b['score'] <=> $a['score']);
    $orient = fn($s) => preg_match('/^(?:[A-Z]-sag\s*-\s*)?orientering/iu', $s['t']) ? 1 : 0;
    $kommer = array_values(array_filter($mine, fn($s) => $s['st'] === 'kommer' && -mm_alder($idag, $s['dato']) >= 0 && -mm_alder($idag, $s['dato']) <= 14));
    usort($kommer, fn($a, $b) => ($orient($a) - $orient($b)) ?: (strcmp($a['dato'], $b['dato']) ?: $b['score'] <=> $a['score']));
    $brugt = array_column(array_merge(array_slice($sket, 0, MM_VIS), array_slice($kommer, 0, MM_VIS)), 'id');
    $bydel = [];
    if (!empty($profil['bydel'])) {
        foreach ($data['sager'] as $s) {
            if (($s['u'] ?? '') === $profil['bydel'] && empty($s['r']) && !in_array($s['id'], $brugt, true) && abs(mm_alder($idag, $s['dato'])) <= 14) $bydel[] = $vurder($s);
            if (count($bydel) === 2) break;
        }
    }
    return ['besluttet' => array_slice($sket, 0, MM_VIS), 'flereBesluttet' => max(0, count($sket) - MM_VIS),
        'kommer' => array_slice($kommer, 0, MM_VIS), 'flereKommer' => max(0, count($kommer) - MM_VIS),
        'bydel' => $bydel, 'dage' => $dage, 'emner' => $emner, 'ord' => $profil['ord'] ?? []];
}

// ---------- Top og bund ----------
function mm_mail_top(string $emne, string $preheader, int $uge, string $idag, string $logo): string {
    $C = MM_C; $S = MM_SANS;
    return "<!doctype html>\n"
      . '<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no, date=no, address=no"><title>' . mm_esc($emne) . "</title></head>\n"
      . "<body style=\"margin:0;padding:0;background:{$C['kalk']};\">\n"
      . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' . mm_esc($preheader) . "</div>\n"
      . "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"{$C['kalk']}\" style=\"background:{$C['kalk']};\"><tr><td align=\"center\" style=\"padding:24px 12px 40px;\">\n"
      . "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:600px;background:{$C['kalkLys']};border-radius:10px;overflow:hidden;\">\n"
      . "<tr><td bgcolor=\"{$C['nat']}\" background=\"" . MM_MAIL . "top.jpg\" style=\"background-color:{$C['nat']};background-image:url(" . MM_MAIL . "top.jpg);background-size:cover;background-position:center;padding:22px 28px;\">\n"
      . "  <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>\n"
      . '    <td style="line-height:0;"><a href="' . MM_SITE . '" style="text-decoration:none;"><img src="' . mm_esc($logo) . "\" width=\"150\" height=\"35\" alt=\"Sagsvagt\" style=\"display:block;border:0;color:{$C['kalk']};font:700 22px {$S};\"></a></td>\n"
      . "    <td align=\"right\" style=\"font:600 12px/1.5 {$S};color:{$C['kalk']};\">Uge {$uge}<br><span style=\"opacity:.75;font-weight:500;\">" . mm_esc(mm_stor(mm_dato($idag, true))) . "</span></td>\n"
      . "  </tr></table>\n"
      . "</td></tr>\n";
}
// $afmeld: personligt link til afmelding (api/afmeld.php). Uden link (fx forhåndsvisning) står redaktionens mail.
function mm_mail_bund(string $modtager, string $afmeld = ''): string {
    $C = MM_C; $S = MM_SANS;
    $link = fn($href, $tekst, $pad = '12px 18px 12px 0') => '<a href="' . $href . "\" style=\"display:inline-block;padding:{$pad};line-height:20px;font-weight:600;color:{$C['indigo']};\">{$tekst}</a>";
    return "<tr><td style=\"padding:24px 28px 26px;border-top:2px solid {$C['nat']};font:12px/1.6 {$S};color:{$C['muted']};\">\n"
      . '  <img src="' . MM_MAIL . "symbol.png\" width=\"23\" height=\"28\" alt=\"\" style=\"display:block;border:0;margin:0 0 14px;\">\n"
      . "  Sagsvagt er partineutral og bygger på kommunens egne dagsordener og referater. Læs altid den originale sag, før du handler på den.<br><br>\n"
      . '  Du får denne mail, fordi du har skrevet dig op til Sagsvagt' . ($modtager !== '' ? ' med ' . mm_esc($modtager) : '') . ".\n"
      . "  <!-- Linkene på deres egen linje med luft, så de er nemme at ramme med en finger -->\n"
      . '  <br>' . $link('mailto:' . MM_REDAKTION . '?subject=' . rawurlencode('Ret mine emner'), 'Ret dine emner')
      . $link($afmeld !== '' ? mm_esc($afmeld) : 'mailto:' . MM_REDAKTION . '?subject=' . rawurlencode('Afmeld Sagsvagt'), 'Afmeld')
      . $link(MM_SITE . 'privatliv.html', 'Privatliv', '12px 0') . "\n"
      . "</td></tr>\n</table>\n</td></tr></table>\n</body></html>";
}
function mm_tekst_bund(string $afmeld, bool $ret = true): string {
    if ($afmeld !== '') return "\n\n--\nDu får denne mail, fordi du har skrevet dig op til Sagsvagt.\nAfmeld: {$afmeld}" . ($ret ? "\nRet dine emner: " . MM_REDAKTION : '') . "\n";
    return "\n\n--\nDu får denne mail, fordi du har skrevet dig op til Sagsvagt. " . ($ret ? 'Afmeld eller ret dine emner: ' : 'Afmeld: ') . MM_REDAKTION . "\n";
}

// ---------- Mailen (lavMandagsmail) ----------
function mm_lav_mandagsmail(array $data, array $profil, string $idag, string $modtager = '', string $afmeld = '', string $logo = MM_SITE . 'assets/mail-logo.png'): array {
    $C = MM_C; $S = MM_SANS;
    $v = mm_vaelg_sager($data, $profil, $idag);
    $uge = mm_ugenr($idag);
    $linkTil = fn($s) => MM_SITE . $s['url'];
    $ks = [];
    foreach ($data['sager'] as $s) if (!empty($s['ks'])) $ks[$s['ks']] = true;
    $flere = count($ks) > 1;
    $hvorSag = fn($s) => mm_hvor($s['u']) . ($flere && !empty($s['kn']) && !str_contains($s['u'], $s['kn']) ? ', ' . $s['kn'] : '');
    $nB = count($v['besluttet']) + $v['flereBesluttet']; $nK = count($v['kommer']) + $v['flereKommer'];
    $navn = trim((string)($profil['navn'] ?? ''));
    $tal = fn(int $n, string $en, string $fl) => ($n === 0 ? 'Ingen' : (string)$n) . ' ' . ($n === 1 ? $en : $fl);
    $dele = array_values(array_filter([$nB ? $tal($nB, 'beslutning', 'beslutninger') : '', $nK ? $tal($nK, 'sag', 'sager') . ' på vej' : '']));
    $emne = $dele ? "Uge {$uge}: " . implode(' og ', $dele) . ' om dine emner' : "Uge {$uge}: Ingen nye sager om dine emner";
    $top = $v['besluttet'][0] ?? $v['kommer'][0] ?? null;
    $preheader = $top ? $top['t'] . ($nB + $nK > 1 ? ' og ' . ($nB + $nK - 1) . ' sager mere' : '') . '.' : 'Der er ingen nye sager om dine emner i denne uge.';

    $tag = function (string $id) use ($data, $C, $S): string {
        $e = $data['emner'][$id]; $r = ($e['f'] ?? '') === 'r';
        return "<span style=\"display:inline-block;margin:8px 6px 0 0;padding:3px 9px;border-radius:6px;background:" . ($r ? $C['rosen'] : $C['lyng']) . ';color:' . ($r ? $C['bordeaux'] : $C['blaek']) . ";font:700 12px/1.4 {$S};\">" . mm_esc($e['navn']) . '</span>';
    };
    $ordTag = fn(string $o) => "<span style=\"display:inline-block;margin:8px 6px 0 0;padding:3px 9px;border-radius:6px;background:{$C['kalk']};box-shadow:inset 0 0 0 1px {$C['rule']};color:{$C['nat']};font:700 12px/1.4 {$S};\">" . mm_esc($o) . '</span>';
    $stemmer = fn($s) => !empty($s['tal']['undlod']) ? ' <b style="white-space:nowrap;">' . $s['tal']['undlod'] . ' undlod.</b>' : '';

    $kortSag = function (array $s) use ($C, $S, $linkTil, $hvorSag, $stemmer): string {
        $status = $s['st'] === 'besluttet' ? "<span style=\"color:{$C['vin']};font-weight:700;\">Besluttet " . mm_kort($s['dato']) . '</span>'
            : ($s['st'] === 'kommer' ? "<span style=\"color:{$C['indigo']};font-weight:700;\">" . mm_esc(mm_stor(mm_dato($s['dato'], true))) . '</span>'
            : '<span style="font-weight:700;">Behandlet ' . mm_kort($s['dato']) . '</span>');
        $ud = $s['ud'] ?? ''; $kb = $s['kb'] ?? '';
        return "<tr><td style=\"padding:14px 28px 15px;border-top:1px solid {$C['rule']};\">\n"
          . "  <p style=\"margin:0 0 4px;font:600 12px/1.45 {$S};color:{$C['muted']};\">{$status} · " . mm_esc($hvorSag($s)) . "</p>\n"
          . '  <a href="' . mm_esc($linkTil($s)) . "\" style=\"font:600 16px/1.35 {$S};color:{$C['nat']};text-decoration:none;\">" . mm_esc($s['t']) . "</a>\n"
          . '  ' . ($s['st'] === 'besluttet' && ($ud || $kb) ? "<p style=\"margin:5px 0 0;font:14px/1.5 {$S};color:{$C['brod']};\">" . mm_esc(mm_klip($ud ?: $kb, 140)) . ($ud ? $stemmer($s) : '') . '</p>' : '') . "\n"
          . '</td></tr>';
    };
    $sag = function (array $s) use ($C, $S, $linkTil, $hvorSag, $stemmer, $tag, $ordTag): string {
        $status = $s['st'] === 'besluttet' ? "<span style=\"color:{$C['vin']};font-weight:700;\">Besluttet " . mm_kort($s['dato']) . '</span>'
            : ($s['st'] === 'kommer' ? "<span style=\"color:{$C['indigo']};font-weight:700;\">På dagsordenen " . mm_esc(mm_dato($s['dato'], true)) . '</span>'
            : '<span style="font-weight:700;">Behandlet ' . mm_kort($s['dato']) . '</span>');
        $ud = $s['ud'] ?? ''; $kb = $s['kb'] ?? '';
        $besl = $s['st'] === 'besluttet' && ($ud || $kb)
            ? "<p style=\"margin:14px 0 0;padding:8px 0 0;border-top:2px solid {$C['vin']};font:14px/1.5 {$S};color:{$C['nat']};\"><b style=\"display:block;margin-bottom:2px;font:700 12px/1.4 {$S};letter-spacing:.06em;text-transform:uppercase;color:{$C['vin']};\">Beslutning</b>" . mm_esc($ud ?: mm_klip($kb, 220)) . ($ud ? $stemmer($s) : '') . '</p>' : '';
        return "<tr><td style=\"padding:18px 28px 20px;border-top:1px solid {$C['rule']};\">\n"
          . "  <p style=\"margin:0 0 6px;font:600 12px/1.45 {$S};color:{$C['muted']};\">{$status} · " . mm_esc($hvorSag($s)) . "</p>\n"
          . '  <a href="' . mm_esc($linkTil($s)) . "\" style=\"font:600 19px/1.3 {$S};color:{$C['nat']};text-decoration:none;\">" . mm_esc($s['t']) . "</a>\n"
          . '  ' . (!empty($s['d']) ? "<p style=\"margin:8px 0 0;font:15px/1.55 {$S};color:{$C['brod']};\">" . mm_esc(mm_klip($s['d'], 170)) . '</p>' : '') . "\n"
          . "  {$besl}\n"
          . '  <div>' . implode('', array_map($tag, $s['mE'] ?? [])) . implode('', array_map($ordTag, $s['mO'] ?? [])) . "</div>\n"
          . '</td></tr>';
    };
    // Hver sektion har sin farve og sit ikon, som i talrækken: vin = besluttet, indigo = på vej, nat = bydelen
    $sektion = function (string $titel, string $under, array $liste, int $flere, bool $fuld = true, string $ikon = '', string $farve = MM_C['nat']) use ($C, $S, $sag, $kortSag): string {
        if (!$liste) return '';
        $h = "<tr><td style=\"padding:22px 28px 8px;border-top:3px solid {$farve};\">\n"
          . '  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' . ($ikon !== '' ? '<td valign="middle" style="padding:0 8px 0 0;line-height:0;"><img src="' . MM_MAIL . $ikon . '.png" width="20" height="20" alt="" style="display:block;border:0;"></td>' : '')
          . "<td valign=\"middle\"><h2 style=\"margin:0;font:700 12px/1.4 {$S};letter-spacing:.08em;text-transform:uppercase;color:{$farve};\">" . mm_esc($titel) . "</h2></td></tr></table>\n"
          . '  ' . ($under !== '' ? "<p style=\"margin:4px 0 0;font:13px/1.5 {$S};color:{$C['muted']};\">" . mm_esc($under) . '</p>' : '') . "\n"
          . '</td></tr>';
        foreach ($liste as $i => $s) $h .= ($i === 0 && $fuld) ? $sag($s) : $kortSag($s);
        if ($flere) $h .= "<tr><td style=\"padding:12px 28px 6px;border-top:1px solid {$C['rule']};font:13px/1.5 {$S};color:{$C['muted']};\">Og {$flere} " . ($flere === 1 ? 'sag' : 'sager') . ' mere om dine emner. <a href="' . MM_SITE . "min/#sager\" style=\"color:{$C['indigo']};font-weight:600;\">Se dem i Min avis</a></td></tr>";
        return $h;
    };

    $dineEmner = implode(', ', array_merge(array_map(fn($id) => $data['emner'][$id]['navn'], $v['emner']), $v['ord']));
    $ingen = !$v['besluttet'] && !$v['kommer'] && !$v['bydel'];
    $bydelNavn = mm_hvor((string)($profil['bydel'] ?? ''));
    // Ugens tal er det vigtigste i mailen: store tal i sektionernes farver, med luft imellem
    $talCelle = fn(int $n, string $en, string $fl, string $under, string $farve, int $b) => "<td width=\"{$b}%\" valign=\"top\" style=\"padding:10px 0 0;border-top:3px solid {$farve};\">\n"
      . "    <p style=\"margin:0;font:700 34px/1.1 {$S};color:" . ($n ? $farve : $C['muted']) . ";\">{$n}</p>\n"
      . "    <p style=\"margin:4px 0 0;font:700 13px/1.35 {$S};color:{$C['nat']};\">" . ($n === 1 ? $en : $fl) . "</p>\n"
      . "    <p style=\"margin:2px 0 0;font:12px/1.4 {$S};color:{$C['muted']};\">" . mm_esc($under) . "</p>\n"
      . '  </td>';
    $b = !empty($profil['bydel']) ? 30 : 47;
    $celler = [$talCelle($nB, 'beslutning', 'beslutninger', $v['dage'] === 7 ? 'i ugen der gik' : 'de seneste to uger', $C['vin'], $b), $talCelle($nK, 'sag på vej', 'sager på vej', 'de næste to uger', $C['indigo'], $b)];
    if (!empty($profil['bydel'])) $celler[] = $talCelle(count($v['bydel']), 'sag i bydelen', 'sager i bydelen', $bydelNavn, $C['nat'], $b);
    $talRaekke = "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:20px 0 0;\"><tr>\n"
      . '  ' . implode('<td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>', $celler) . "\n"
      . '</tr></table>';
    $html = mm_mail_top($emne, $preheader, $uge, $idag, $logo) . "<tr><td style=\"padding:28px 28px 4px;\">\n"
      . "  <h1 style=\"margin:0;font:600 26px/1.15 {$S};color:{$C['nat']};\">God morgen" . ($navn !== '' ? ', ' . mm_esc($navn) : '') . ".</h1>\n"
      . '  ' . ($ingen ? "<p style=\"margin:10px 0 0;font:16px/1.55 {$S};color:{$C['brod']};\">Der er ingen nye sager om dine emner i denne uge. Vi holder øje og skriver, når der sker noget.</p>" : $talRaekke) . "\n"
      . '  ' . ($dineEmner !== '' ? "<p style=\"margin:16px 0 0;font:13px/1.5 {$S};color:{$C['muted']};\">Du følger: " . mm_esc($dineEmner) . (!empty($profil['bydel']) ? ' · ' . mm_esc($bydelNavn) : '') . '</p>' : '') . "\n"
      . "</td></tr>\n"
      . $sektion($v['dage'] === 7 ? 'Besluttet i ugen der gik' : 'Besluttet de seneste to uger', '', $v['besluttet'], $v['flereBesluttet'], true, 'besluttet', $C['vin']) . "\n"
      . $sektion('Det skal de tage stilling til', 'De næste to uger.', $v['kommer'], $v['flereKommer'], true, 'paa-vej', $C['indigo']) . "\n"
      . $sektion('Fra ' . $bydelNavn, 'Det sker i din bydel.', $v['bydel'], 0, false, 'bydel', $C['nat']) . "\n"
      . mm_mail_bund($modtager, $afmeld);

    // Ren tekst til mailprogrammer, der ikke viser HTML
    $linje = function (array $s) use ($hvorSag, $linkTil): string {
        $ud = $s['ud'] ?? ''; $kb = $s['kb'] ?? '';
        return '- ' . $s['t'] . "\n  " . ($s['st'] === 'besluttet' ? 'Besluttet ' . mm_kort($s['dato']) : ($s['st'] === 'kommer' ? 'På dagsordenen ' . mm_kort($s['dato']) : 'Behandlet ' . mm_kort($s['dato'])))
          . ', ' . $hvorSag($s)
          . ($s['st'] === 'besluttet' && ($ud || $kb) ? "\n  " . ($ud ?: mm_klip($kb, 220)) . ($ud && !empty($s['tal']) ? " {$s['tal']['for']} for, {$s['tal']['imod']} imod." : '') : '')
          . "\n  " . $linkTil($s);
    };
    $del = fn(string $t, array $l) => $l ? "\n\n" . mb_strtoupper($t) . "\n\n" . implode("\n\n", array_map($linje, $l)) : '';
    $tekst = "Sagsvagt, uge {$uge}\n\nGod morgen" . ($navn !== '' ? ", {$navn}" : '') . '.' . ($ingen ? ' Der er ingen nye sager om dine emner i denne uge.' : '')
      . $del('Besluttet', $v['besluttet']) . $del('Det skal de tage stilling til', $v['kommer']) . $del('Fra ' . $bydelNavn, $v['bydel'])
      . mm_tekst_bund($afmeld);

    return ['emne' => $emne, 'preheader' => $preheader, 'html' => $html, 'tekst' => $tekst,
        'antal' => ['besluttet' => $nB, 'kommer' => $nK, 'bydel' => count($v['bydel'])]];
}

// ---------- Ventelistemailen (lavVentemail) ----------
function mm_lav_ventemail(array $kommuner, array $aabne, string $idag, string $navn = '', string $modtager = '', string $afmeld = '', string $logo = MM_SITE . 'assets/mail-logo.png'): array {
    $C = MM_C; $S = MM_SANS;
    $uge = mm_ugenr($idag);
    $liste = fn(array $l) => count($l) > 1 ? implode(', ', array_slice($l, 0, -1)) . ' og ' . end($l) : ($l[0] ?? '');
    $hvem = $liste($kommuner);
    $emne = $hvem !== '' ? "Uge {$uge}: Sagsvagt er på vej til {$hvem}" : "Uge {$uge}: Hvilken kommune vil du følge?";
    $preheader = $hvem !== '' ? "Vi giver besked, så snart {$hvem} er åben." : 'Svar på mailen med din kommune, så kommer den i køen.';
    $delLink = MM_SITE . 'vagt.html?fra=mandagsmail' . (isset($kommuner[0]) ? '&kommune=' . rawurlencode($kommuner[0]) : '') . '#tilmeld';
    $p = fn(string $t) => "<p style=\"margin:12px 0 0;font:16px/1.55 {$S};color:{$C['brod']};\">{$t}</p>";
    // Hvor langt vi er: et stort tal og en bjælke i stedet for en liste, der vokser med hver ny kommune
    $IALT = 98; $n = count($aabne); $pct = (int)round(100 * $n / $IALT);
    $fremdrift = $aabne ? "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:22px 0 0;\">\n"
      . "  <tr><td style=\"padding:0 0 8px;font:700 13px/1.4 {$S};color:{$C['nat']};\"><span style=\"font:700 34px/1.1 {$S};color:{$C['vin']};\">{$n}</span> af {$IALT} kommuner er åbne</td></tr>\n"
      . "  <tr><td style=\"font-size:0;line-height:0;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"border-radius:5px;overflow:hidden;\"><tr><td width=\"{$pct}%\" height=\"10\" bgcolor=\"{$C['vin']}\" style=\"background:{$C['vin']};font-size:0;line-height:0;\">&nbsp;</td><td height=\"10\" bgcolor=\"{$C['rule']}\" style=\"background:{$C['rule']};font-size:0;line-height:0;\">&nbsp;</td></tr></table></td></tr>\n"
      . "  <tr><td style=\"padding:8px 0 0;font:13px/1.5 {$S};color:{$C['muted']};\"><a href=\"" . MM_SITE . "kommune/\" style=\"color:{$C['indigo']};font-weight:600;\">Se de åbne kommuner</a></td></tr>\n"
      . '</table>' : '';
    $html = mm_mail_top($emne, $preheader, $uge, $idag, $logo) . "<tr><td style=\"padding:28px 28px 26px;\">\n"
      . "  <h1 style=\"margin:0;font:600 26px/1.15 {$S};color:{$C['nat']};\">God morgen" . ($navn !== '' ? ', ' . mm_esc($navn) : '') . ".</h1>\n"
      . '  ' . ($hvem !== ''
        ? $p("Sagsvagt er endnu ikke åben i <b style=\"color:{$C['nat']};\">" . mm_esc($hvem) . '</b>. Vi åbner kommune for kommune, der hvor flest skriver sig op, og du får besked, så snart ' . mm_esc($hvem) . ' er med.')
        : $p('Du har ikke skrevet, hvilken kommune du vil følge. Svar på denne mail med navnet på din kommune, så sætter vi den i køen.')) . "\n"
      . "  {$fremdrift}\n"
      . '  ' . ($hvem !== '' ? '<p style="margin:20px 0 0;"><a href="' . mm_esc($delLink) . "\" style=\"display:inline-block;padding:12px 20px;border-radius:8px;background:{$C['nat']};color:{$C['kalk']};font:700 15px/1.2 {$S};text-decoration:none;\">Del Sagsvagt med en nabo</a></p>\n"
        . "  <p style=\"margin:10px 0 0;font:13px/1.5 {$S};color:{$C['muted']};\">Jo flere fra " . mm_esc($hvem) . ', der skriver sig op, jo før åbner vi.</p>' : '') . "\n"
      . '</td></tr>' . mm_mail_bund($modtager, $afmeld);
    $tekst = "Sagsvagt, uge {$uge}\n\nGod morgen" . ($navn !== '' ? ", {$navn}" : '') . ".\n\n"
      . ($hvem !== '' ? "Sagsvagt er endnu ikke åben i {$hvem}. Vi åbner kommune for kommune, der hvor flest skriver sig op, og du får besked, så snart {$hvem} er med.\n\nDel Sagsvagt med en nabo: {$delLink}"
        : 'Du har ikke skrevet, hvilken kommune du vil følge. Svar på denne mail med navnet på din kommune, så sætter vi den i køen.')
      . ($aabne ? "\n\nLige nu følger vi byrådene i {$n} af {$IALT} kommuner: " . MM_SITE . 'kommune/' : '')
      . mm_tekst_bund($afmeld, false);
    return ['emne' => $emne, 'preheader' => $preheader, 'html' => $html, 'tekst' => $tekst, 'antal' => ['besluttet' => 0, 'kommer' => 0, 'bydel' => 0], 'vente' => true];
}

// ---------- Ugens mail til én tilmeldt (som forbered() på admin-siden) ----------
// $hent: fn(slug) → kommunens sager-fil som array. Giver ['type' => 'Sager' | 'Sager (alle emner)' | 'Venteliste', 'mail' => …, 'profil' => …].
function mm_mail_til(array $a, string $uge, array $aabne, callable $hent, string $afmeld = ''): array {
    $slugs = array_column($aabne, 'slug'); $navnPaa = array_column($aabne, 'navn', 'slug');
    $EMNER = $hent('koebenhavn')['emner'];
    $p = mm_profil($a, $EMNER, $slugs);
    if (!$p['kommuner']) {
        return ['type' => 'Venteliste', 'profil' => $p,
            'mail' => mm_lav_ventemail(mm_skrevne($a['kommuner'] ?? ''), array_column($aabne, 'navn'), $uge, $p['navn'], (string)$a['email'], $afmeld)];
    }
    $udenEmner = !$p['emner'] && !$p['ord'];
    $sager = []; $emner = null;
    foreach ($p['kommuner'] as $slug) {
        $x = $hent($slug); $emner ??= $x['emner'];
        foreach ($x['sager'] as $s) $sager[] = array_merge(['et' => [], 'v' => 0, 'r' => 0], $s, ['ks' => $slug, 'kn' => $navnPaa[$slug] ?? $slug]);
    }
    $mail = mm_lav_mandagsmail(['emner' => $emner, 'sager' => $sager], $udenEmner ? ['emner' => array_keys($EMNER)] + $p : $p, $uge, (string)$a['email'], $afmeld);
    if ($udenEmner) $mail['emne'] = preg_replace('/ om dine emner$/u', ' i din kommune', $mail['emne']);
    return ['type' => $udenEmner ? 'Sager (alle emner)' : 'Sager', 'profil' => $p, 'mail' => $mail];
}
