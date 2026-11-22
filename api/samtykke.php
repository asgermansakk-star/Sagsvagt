<?php
// Læserens valg af mails i Min avis (Tilpas): mandagsmailen og andre informationer hver for sig. Det skal være lige så let at
// sige nej som ja. Slår man noget til igen efter en afmelding, ophæves afmeldingen. Hvert svar gemmes i tabellen samtykker.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
$b = bruger();
if (!$b) fejl(401, 'Ikke logget ind');
begraens('samtykke:' . $b['id'], 30, 3600);
if (!is_bool($d['mandag'] ?? null) || !is_bool($d['andre'] ?? null)) fejl(400, 'Valget mangler.');
$db = db();
$svar = $d['mandag'] ? ($d['andre'] ? 'ja' : 'mandag') : ($d['andre'] ? 'andre' : 'nej');
gem_samtykke($db, (int)$b['id'], $svar, 'min avis');
if ($svar !== 'nej') $db->prepare('UPDATE abonnenter SET mail_afmeldt = NULL WHERE id = ?')->execute([$b['id']]);
// En mandagsmail, der allerede er planlagt til ugen, sendes ikke
if (!$d['mandag']) try { $db->prepare('DELETE FROM mandagsmail_koe WHERE abonnent_id = ?')->execute([$b['id']]); } catch (PDOException $e) {} // findes kun, når den er brugt
svar(200, ['mails' => ['mandag' => $d['mandag'], 'andre' => $d['andre']]]);
