<?php
// Redaktionen: læserfotos. handling "liste" (standard), "vis" (billedet som data-URL) og "status" (godkendt/afvist).
// Et godkendt foto vises først på siden, når det er lagt i assets/laeserfotos/<sag-id>.jpg med en linje i
// assets/laeserfotos/index.json (fotograf og tekst); avisen bygges på GitHub og kan ikke se serverens _fotos/.
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';

$d = kraev_post();
kraev_admin();
$db = db();
$h =$d['handling'] ?? 'liste';
if ($h === 'vis' || $h === 'status') {
    $q = $db->prepare('SELECT * FROM fotos WHERE id = ?'); $q->execute([(int)($d['id'] ?? 0)]);
    $f = $q->fetch() ?: fejl(404, 'Findes ikke');
    if ($h === 'status') {
        $st = in_array($d['status'] ?? '', ['godkendt', 'afvist', 'ny'], true) ? $d['status'] : fejl(400, 'Ukendt status');
        $db->prepare('UPDATE fotos SET status = ? WHERE id = ?')->execute([$st, $f['id']]);
        svar(200, ['ok' => true]);
    }
    $sti = __DIR__ . '/../_fotos/' . basename($f['fil']);
    if (!is_file($sti)) fejl(404, 'Filen mangler');
    $type = (new finfo(FILEINFO_MIME_TYPE))->file($sti);
    svar(200, ['data' => "data:$type;base64," . base64_encode(file_get_contents($sti)), 'fil' => $f['fil']]);
}
svar(200, ['fotos' => $db->query('SELECT id, navn, email, sag, sted, tekst, fil, status, oprettet FROM fotos ORDER BY oprettet DESC LIMIT 300')->fetchAll()]);
