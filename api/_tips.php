<?php
// Tipalarm til redaktioner: en mail, så snart robotten har lagt nye sager op fra redaktionens kommune, med de nye sager,
// der har en grund til at være et tip (høring, penge, uenighed, noget folk mærker, et sted eller et kommende møde).
// Robotten vurderer sagerne (avis/tipliste.mjs --indeks → api/_tips.json); her findes det, redaktionen ikke har fået før.
// Redaktionerne oprettes på admin-siden (Tipalarm) efter aftale, fx med Folketidende. Mailen er til redaktionen og ikke til
// offentliggørelse; den følger mandagsmailens design (api/_mandagsmail_lav.php).
declare(strict_types=1);
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_mandagsmail.php';
require_once __DIR__ . '/_mandagsmail_lav.php';

function tip_tabeller(PDO $db): void {
    $id = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $db->exec("CREATE TABLE IF NOT EXISTS tip_redaktioner (id $id, navn VARCHAR(120) NOT NULL, kommune VARCHAR(60) NOT NULL,
        modtagere VARCHAR(1000) NOT NULL, aktiv INT NOT NULL DEFAULT 1, oprettet VARCHAR(25) NOT NULL, sidst_sendt VARCHAR(25) NULL, sendt INT NOT NULL DEFAULT 0)");
    // De sager, redaktionen har fået (eller som fandtes, da den blev oprettet)
    $db->exec('CREATE TABLE IF NOT EXISTS tip_set (redaktion_id INT NOT NULL, sag_id VARCHAR(190) NOT NULL, PRIMARY KEY (redaktion_id, sag_id))');
}
function tip_indeks(): array {
    static $i = null;
    return $i ??= (json_decode((string)@file_get_contents(__DIR__ . '/_tips.json'), true) ?: ['kommuner' => []]);
}
function tip_modtagere(array $r): array { return array_values(array_unique(array_filter(array_map('ren_email', explode(',', (string)$r['modtagere']))))); }
function tip_stop_link(int $id): string { global $K; return $K['site_url'] . "api/tip-stop.php?id=$id&t=" . signatur("tip-stop:$id"); }

// Sagerne fra de seneste 14 dage og kommende møder, uden rutinesager, med tippet fra robotten, hvis sagen har et
function tip_sager(string $slug): array {
    $idag = (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->format('Y-m-d');
    $fra = date('Y-m-d', strtotime($idag) - 14 * 86400);
    $tips = array_column(tip_indeks()['kommuner'][$slug]['tips'] ?? [], null, 'id');
    $ud = [];
    foreach (mm_hent_kommune($slug)['sager'] ?? [] as $s) {
        $kommer = ($s['st'] ?? '') === 'kommer';
        if (!empty($s['r']) || ($kommer ? $s['dato'] < $idag : ($s['dato'] < $fra || $s['dato'] > $idag))) continue;
        $ud[] = $s + ['tip' => $tips[$s['id']] ?? null];
    }
    return $ud;
}

// ---------- Mailen ----------
function tip_mail(array $r, string $kommuneNavn, array $tips, int $andre, string $slug): array {
    $C = MM_C; $S = MM_SANS; $e = 'mm_esc';
    $idag = (new DateTimeImmutable('now', new DateTimeZone('Europe/Copenhagen')))->format('Y-m-d');
    $n = count($tips);
    $emne = $n === 1 ? "Nyt tip fra $kommuneNavn: " . ($tips[0]['kt'] ?? $tips[0]['t']) : "$n nye tips fra $kommuneNavn";
    $link = fn(array $s) => MM_SITE . $s['url'];
    $pil = fn(string $href, string $t) => '<a href="' . $e($href) . "\" style=\"font:700 14px/1.4 {$S};color:{$C['indigo']};text-decoration:none;\">{$t} ›</a>";
    $pille = ['uenig' => [$C['vin'], $C['kalk']], 'maerkes' => [$C['vin'], $C['kalk']], 'hoering' => [$C['indigo'], $C['kalk']], 'kommer' => [$C['indigo'], $C['kalk']]];
    $kort = function (array $s) use ($C, $S, $e, $link, $pil, $pille): string {
        $t = $s['tip'];
        $piller = implode('', array_map(function ($g) use ($C, $S, $e, $pille) {
            [$bg, $fg] = $pille[$g['id']] ?? [$C['rule'], $C['nat']];
            return "<span style=\"display:inline-block;margin:0 4px 6px 0;padding:4px 9px;border-radius:99px;background:{$bg};color:{$fg};font:700 11px/1.2 {$S};letter-spacing:.06em;text-transform:uppercase;\">" . $e($g['navn']) . '</span>';
        }, $t['g']));
        $kommer = ($s['st'] ?? '') === 'kommer';
        $meta = ($s['u'] ?? '') . ' · ' . ($kommer ? 'møde ' . mm_dato($s['dato'], true) : 'behandlet ' . mm_dato($s['dato'])) . (!empty($t['ogsaa']) ? ' · også i ' . implode(' og ', $t['ogsaa']) : '');
        return "<tr><td style=\"padding:10px 22px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:{$C['kalkLys']};border-radius:16px;\"><tr><td style=\"padding:22px 24px 24px;\">\n"
          . "  <p style=\"margin:0 0 4px;\">{$piller}</p>\n"
          . '  <a href="' . $e($link($s)) . "\" style=\"font:800 20px/1.3 {$S};color:{$C['nat']};text-decoration:none;\">" . $e($s['kt'] ?? $s['t']) . "</a>\n"
          . "  <p style=\"margin:6px 0 0;font:600 12px/1.45 {$S};color:{$C['muted']};\">" . $e($meta) . "</p>\n"
          . (!empty($s['d']) ? "  <p style=\"margin:10px 0 0;font:15px/1.55 {$S};color:{$C['brod']};\">" . $e(mm_klip($s['d'], 300)) . "</p>\n" : '')
          . "  <p style=\"margin:10px 0 0;font:14px/1.6 {$S};color:{$C['brod']};\">" . implode('<br>', array_map(fn($g) => "<b style=\"color:{$C['nat']};\">" . $e($g['navn']) . ':</b> ' . $e($g['tekst']), $t['g'])) . "</p>\n"
          . "  <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:14px 0 0;\"><tr><td style=\"padding:10px 14px;border-radius:10px;background:{$C['lyng']};font:15px/1.5 {$S};color:{$C['blaek']};\"><b>Spørg:</b> " . $e($t['spm']) . "</td></tr></table>\n"
          . '  <p style="margin:14px 0 0;">' . $pil($link($s), 'Sagen på Sagsvagt') . "</p>\n"
          . (!empty($s['k']) ? '  <p style="margin:6px 0 0;">' . $pil($s['k'], 'Kommunens dokument') . "</p>\n" : '')
          . '</td></tr></table></td></tr>';
    };
    $kommuneSide = $slug === 'koebenhavn' ? MM_SITE : MM_SITE . "kommune/$slug/";
    $stop = tip_stop_link((int)$r['id']);
    $lnk = fn($href, $tekst) => '<a href="' . $e($href) . "\" style=\"display:inline-block;padding:12px 9px;line-height:20px;font-weight:600;color:{$C['indigo']};\">{$tekst}</a>";
    $html = mm_mail_top($emne, ($tips[0]['kt'] ?? $tips[0]['t']) . ($n > 1 ? ' og ' . ($n - 1) . ($n === 2 ? ' tip mere' : ' tips mere') : '') . '.', mm_ugenr($idag), $idag, MM_MAIL . 'logo.png')
      . "<tr><td align=\"center\" style=\"padding:12px 28px 0;\">\n"
      . "  <h1 style=\"margin:0;font:800 34px/1.12 {$S};color:{$C['nat']};\">" . ($n === 1 ? 'Nyt tip' : "$n nye tips") . '<br>fra ' . $e($kommuneNavn) . ".</h1>\n"
      . "  <p style=\"margin:14px 0 0;font:600 13px/1.5 {$S};color:{$C['muted']};\">Lige kommet på kommunens hjemmeside · Til " . $e($r['navn']) . "</p>\n"
      . "</td></tr>\n"
      . '<tr><td style="padding:22px 0 8px;font-size:0;line-height:0;"><img src="' . MM_MAIL . "boelge-lyng.png\" width=\"600\" height=\"70\" alt=\"\" style=\"display:block;width:100%;height:auto;border:0;\"></td></tr>\n"
      . implode("\n", array_map($kort, $tips))
      . ($andre > 0 ? "<tr><td align=\"center\" style=\"padding:22px 28px 0;font:14px/1.55 {$S};color:{$C['brod']};\">Og {$andre} " . ($andre === 1 ? 'anden ny sag' : 'andre nye sager') . ' uden en tydelig grund. ' . $pil($kommuneSide, 'Se ' . $kommuneNavn . ' på Sagsvagt') . '</td></tr>' : '')
      . '<tr><td style="padding:34px 0 0;font-size:0;line-height:0;"><img src="' . MM_MAIL . "boelge-rosen.png\" width=\"600\" height=\"70\" alt=\"\" style=\"display:block;width:100%;height:auto;border:0;\"></td></tr>\n"
      . "<tr><td align=\"center\" style=\"padding:18px 32px 30px;font:12px/1.6 {$S};color:{$C['muted']};\">\n"
      . '  <img src="' . MM_MAIL . "symbol.png\" width=\"23\" height=\"28\" alt=\"\" style=\"display:block;border:0;margin:0 auto 14px;\">\n"
      . '  Til ' . $e($r['navn']) . ' efter aftale. Ikke til offentliggørelse. Sagerne er fundet automatisk i ' . $e($kommuneNavn) . " Kommunes egne dagsordener og referater; tal, datoer og navne står i kommunens dokument. Grundene er Sagsvagts læsning af teksten, ikke en vurdering af, hvad der er en historie. Bilag er ikke gengivet.<br>\n"
      . '  ' . $lnk('mailto:' . MM_REDAKTION . '?subject=' . rawurlencode("Tipalarm for $kommuneNavn"), 'Skriv til os') . $lnk($stop, 'Stop tipalarmen') . $lnk(MM_SITE . 'privatliv.html', 'Privatliv') . "\n"
      . "  <br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S\n"
      . "</td></tr>\n</table>\n</td></tr></table>\n</body></html>";
    $tekst = ($n === 1 ? 'Nyt tip' : "$n nye tips") . " fra $kommuneNavn · til {$r['navn']}\n\n"
      . implode("\n\n", array_map(fn($s) => '- ' . ($s['kt'] ?? $s['t']) . "\n  " . ($s['u'] ?? '') . ' · ' . mm_dato($s['dato']) . "\n  "
          . implode(' · ', array_map(fn($g) => "{$g['navn']}: {$g['tekst']}", $s['tip']['g'])) . "\n  Spørg: {$s['tip']['spm']}\n  " . $link($s), $tips))
      . ($andre > 0 ? "\n\nOg $andre andre nye sager: $kommuneSide" : '')
      . "\n\n--\nTil {$r['navn']} efter aftale. Ikke til offentliggørelse.\nStop tipalarmen: $stop\nSagsvagt · CVR 46841514\n";
    return ['emne' => $emne, 'html' => mm_moerk($html), 'tekst' => $tekst];
}

// De nye sager til én redaktion. $tjekSider: kun sager, hvis side er lagt op (uploaden af sagssider tager tid); en side,
// der stadig mangler, venter til et senere besøg. Første gang huskes alt kun.
function tip_nye(PDO $db, array $r, bool $tjekSider = true): array {
    $q = $db->prepare('SELECT sag_id FROM tip_set WHERE redaktion_id = ?'); $q->execute([(int)$r['id']]);
    $kendte = array_flip($q->fetchAll(PDO::FETCH_COLUMN));
    $rod = dirname(__DIR__) . '/';
    $nye = []; $husk = []; $venter = false;
    foreach (tip_sager((string)$r['kommune']) as $s) {
        if (isset($kendte[$s['id']])) continue;
        if ($tjekSider && !is_file($rod . $s['url'])) { $venter = true; continue; }
        $husk[] = $s['id']; $nye[] = $s;
    }
    $tips = array_values(array_filter($nye, fn($s) => $s['tip']));
    usort($tips, fn($a, $b) => $b['tip']['p'] <=> $a['tip']['p'] ?: strcmp($b['dato'], $a['dato']));
    return ['tips' => $tips, 'andre' => count($nye) - count($tips), 'husk' => $husk, 'foerste' => !$kendte, 'venter' => $venter];
}

// Kaldes ved besøg (api/besoeg.php), ligesom erhvervsvarslerne: kører, når robotten har lagt nye sager op (api/_tips.json
// skifter), højst hver halve time og med en lås, så to besøg ikke sender to gange
function tip_maaske_koer(bool $tving = false): array {
    $db = db(); tip_tabeller($db);
    $mtime = (string)@filemtime(__DIR__ . '/_tips.json');
    if (!$tving && indst_hent('tip:mtime') === $mtime && indst_hent('tip:venter') !== '1') return ['koert' => false];
    if (!$tving && time() - (int)indst_hent('tip:sidst') < 1800) return ['koert' => false, 'venter' => true];
    if (!indst_laas('tip:laas')) return ['koert' => false, 'laast' => true];
    try {
        @set_time_limit(90);
        indst_saet('tip:sidst', (string)time());
        $navne = array_column(mm_aabne(), 'navn', 'slug');
        $ins = $db->prepare('INSERT INTO tip_set (redaktion_id, sag_id) VALUES (?, ?)');
        $sendt = 0; $venter = false;
        foreach ($db->query('SELECT * FROM tip_redaktioner WHERE aktiv = 1 ORDER BY id')->fetchAll() as $r) {
            // Sider, der stadig mangler 6 timer efter robottens kørsel, venter vi ikke længere på
            $v = tip_nye($db, $r, time() - (int)$mtime < 6 * 3600);
            $venter = $venter || $v['venter'];
            $db->beginTransaction();
            foreach ($v['husk'] as $id) { try { $ins->execute([(int)$r['id'], $id]); } catch (PDOException $e) {} }
            $db->commit();
            if ($v['foerste'] || !$v['tips']) continue;
            $m = tip_mail($r, $navne[$r['kommune']] ?? $r['kommune'], array_slice($v['tips'], 0, 10), $v['andre'] + max(0, count($v['tips']) - 10), (string)$r['kommune']);
            $hoveder = ['List-Unsubscribe' => '<' . tip_stop_link((int)$r['id']) . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click'];
            $ok = 0;
            foreach (tip_modtagere($r) as $til) if (send_mail($til, $m['emne'], $m['html'], $m['tekst'], MM_REDAKTION, $hoveder)) $ok++;
            if ($ok) { $sendt++; $db->prepare('UPDATE tip_redaktioner SET sidst_sendt = ?, sendt = sendt + 1 WHERE id = ?')->execute([nu(), (int)$r['id']]); }
        }
        indst_saet('tip:mtime', $mtime);
        indst_saet('tip:venter', $venter ? '1' : '0');
        return ['koert' => true, 'sendt' => $sendt, 'venter' => $venter];
    } finally { indst_slip('tip:laas'); }
}
