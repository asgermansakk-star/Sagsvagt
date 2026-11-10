<?php
// Redaktionen: Plus og Pro. Åbn eller luk for bestilling, sæt en læsers pakke i hånden, og se dem, der skal faktureres.
//   status (standard): om bestilling er åben, og alle med Plus eller Pro (til fakturagrundlaget)
//   aaben:  åbn ({til: true}) eller luk for bestilling i Min avis og på priser.html
//   saet:   sæt en læsers pakke ({id, pakke: gratis|plus|pro}); går de til Gratis, beholdes kun den første kommune
declare(strict_types=1);
require __DIR__ . '/../_pakker.php';

$d = kraev_post();
kraev_admin();
$db = db(); pakker_tabeller($db);
$handling = (string)($d['handling'] ?? 'status');

if ($handling === 'aaben') pakker_saet_aaben($db, !empty($d['til']));
if ($handling === 'saet') {
    $id = (int)($d['id'] ?? 0); $pakke = (string)($d['pakke'] ?? '');
    if (!isset(PAKKER[$pakke])) fejl(400, 'Ukendt pakke.');
    if ($pakke === 'gratis') {
        $q = $db->prepare('SELECT kommuner FROM abonnenter WHERE id = ?'); $q->execute([$id]);
        $foerste = trim((string)(preg_split('/,|\/|\s+og\s+/iu', (string)$q->fetchColumn())[0] ?? ''));
        $db->prepare('UPDATE abonnenter SET pakke = NULL, pakke_fra = NULL, faktura_til = NULL, kommuner = ? WHERE id = ?')->execute([$foerste, $id]);
    } else {
        $db->prepare('UPDATE abonnenter SET pakke_fra = CASE WHEN pakke = ? THEN pakke_fra ELSE ? END, pakke = ? WHERE id = ?')->execute([$pakke, gmdate('Y-m-d'), $pakke, $id]);
    }
}
$betalende = $db->query("SELECT id, email, pakke, pakke_fra, faktura_til, kommuner FROM abonnenter WHERE pakke IS NOT NULL AND status <> 'afmeldt' ORDER BY pakke_fra")->fetchAll();
foreach ($betalende as &$r) $r['pris'] = PAKKER[$r['pakke']]['pris'] ?? 0;
svar(200, ['aaben' => pakker_aaben($db), 'pakker' => PAKKER, 'betalende' => $betalende]);
