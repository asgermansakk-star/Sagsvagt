<?php
// Min avis: bestil Plus eller Pro, skift kommuner inden for pakken, eller opsig og gå tilbage til Gratis.
// Gratis kan ikke selv skifte kommune (det gør redaktionen). Nye bestillinger kræver, at bestilling er åben (_pakker.php);
// skift inden for pakken og opsigelse virker altid. Ved bestilling og opsigelse får redaktionen en mail om fakturaen,
// og læseren får en kvittering.
declare(strict_types=1);
require __DIR__ . '/_pakker.php';

$d = kraev_post();
$db = db(); pakker_tabeller($db);
$b = bruger();
if (!$b) fejl(401, 'Log ind først.');
$ny = (string)($d['pakke'] ?? '');
if (!isset(PAKKER[$ny])) fejl(400, 'Ukendt pakke.');
$nu = pakke_af($b);
if ($nu === 'gratis' && $ny === 'gratis') fejl(403, 'Vil du skifte kommune, så skriv til mansa@sagsvagt.dk.');
if ($ny !== 'gratis' && $ny !== $nu && !pakker_aaben($db)) fejl(403, 'Du kan ikke bestille endnu. Skriv til mansa@sagsvagt.dk.');
begraens('pakke:' . $b['id'], 30, 3600);

$aabne = pakker_kommuner();
$slugs = array_values(array_unique(array_filter(array_map('strval', is_array($d['kommuner'] ?? null) ? $d['kommuner'] : []), fn($s) => isset($aabne[$s]))));
$maks = PAKKER[$ny]['kommuner'];
if (!$slugs) fejl(400, 'Vælg mindst én kommune.');
if (count($slugs) > $maks) fejl(400, PAKKER[$ny]['navn'] . " giver op til $maks " . ($maks === 1 ? 'kommune' : 'kommuner') . '.');
$kommuner = implode(', ', array_map(fn($s) => $aabne[$s], $slugs));
$fakturaTil = mb_substr(trim((string)($d['faktura_til'] ?? '')), 0, 200);

if ($ny === 'gratis') {
    // Fakturaoplysningerne slettes; de sendte fakturaer ligger i regnskabet (privatliv.html)
    $db->prepare('UPDATE abonnenter SET pakke = NULL, pakke_fra = NULL, faktura_til = NULL, kommuner = ? WHERE id = ?')->execute([$kommuner, $b['id']]);
} else {
    // pakke_fra sættes kun ved en ny pakke (står før pakke, fordi MySQL bruger de nye værdier i resten af SET)
    $db->prepare("UPDATE abonnenter SET pakke_fra = CASE WHEN pakke = ? THEN pakke_fra ELSE ? END, pakke = ?, faktura_til = COALESCE(NULLIF(?, ''), faktura_til), kommuner = ? WHERE id = ?")
       ->execute([$ny, gmdate('Y-m-d'), $ny, $fakturaTil, $kommuner, $b['id']]);
}

// Mails kun, når pakken skifter (ikke når en betalende bare skifter kommuner)
if ($ny !== $nu) {
    $P = PAKKER[$ny]; $F = PAKKER[$nu];
    $linjer = $ny === 'gratis'
        ? "{$b['email']} har opsagt {$F['navn']} ({$F['pris']} kr. pr. måned) og følger nu {$kommuner} gratis.\nStop faktureringen fra næste måned.\n"
        : "{$b['email']} har bestilt {$P['navn']} til {$P['pris']} kr. pr. måned inkl. moms" . ($nu !== 'gratis' ? " (før {$F['navn']})" : '') . ".\n"
          . "Kommuner: {$kommuner}\nFaktura til: " . ($fakturaTil !== '' ? $fakturaTil : (($b['faktura_til'] ?? '') ?: $b['email'])) . "\n"
          . "Send en faktura fra i dag. Admin-siden viser alle, der skal faktureres.\n";
    @send_mail(TILMELDINGER_TIL, ($ny === 'gratis' ? 'Opsagt' : 'Ny bestilling') . ": {$P['navn']} til {$b['email']}",
        '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer, $b['email']);
    [$html, $tekst] = $ny === 'gratis'
        ? mail_skabelon('Du har opsagt ' . $F['navn'], "Du følger nu {$kommuner} gratis. Du betaler ikke mere fra næste måned.\n\nVil du have flere kommuner igen, kan du bestille under Tilpas i Min avis.",
            'Gå til Min avis', $K['site_url'] . 'min/', "Du får denne mail, fordi du har opsagt {$F['navn']} på Sagsvagt.")
        : mail_skabelon('Tak for din bestilling', "Du har nu Sagsvagt {$P['navn']} med {$kommuner}. Du får en faktura på {$P['pris']} kr. pr. måned inkl. moms på mail.\n\nDu kan skifte kommuner og opsige når som helst under Tilpas i Min avis.",
            'Gå til Min avis', $K['site_url'] . 'min/', "Du får denne mail, fordi du har bestilt {$P['navn']} på Sagsvagt.");
    @send_mail($b['email'], $ny === 'gratis' ? "Du har opsagt Sagsvagt {$F['navn']}" : "Tak for din bestilling af Sagsvagt {$P['navn']}", $html, $tekst);
}
svar(200, ['ok' => true, 'pakke' => $ny, 'kommuner' => $kommuner]);
