<?php
// Mandagsmailen: tabellerne og udsendelsen af planlagte mails. Admin-siden lægger de færdige mails i køen
// (api/admin/mandagsmail.php, "planlaeg"); de sendes ved første besøg efter tidspunktet (api/besoeg.php),
// fordi Simply spærrer for robotter, så intet udefra kan starte udsendelsen.
declare(strict_types=1);

// Kun dem, der stadig er skrevet op, og hvis adresse ikke er markeret som fejlende
const MM_KAN = "status IN ('tilmeldt', 'inviteret', 'aktiv') AND mail_fejl IS NULL";

function mm_tabeller(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_sendt (abonnent_id INT NOT NULL, uge VARCHAR(10) NOT NULL, sendt VARCHAR(25) NOT NULL, PRIMARY KEY (abonnent_id, uge))');
    $db->exec('CREATE TABLE IF NOT EXISTS mandagsmail_koe (abonnent_id INT NOT NULL, uge VARCHAR(10) NOT NULL, emne VARCHAR(255) NOT NULL,
        html MEDIUMTEXT NOT NULL, tekst MEDIUMTEXT NOT NULL, send_efter VARCHAR(25) NOT NULL, forsoeg INT NOT NULL DEFAULT 0, PRIMARY KEY (abonnent_id, uge))');
}

// Sender én mail og husker det. Markerer først, så to samtidige kørsler ikke sender samme mail to gange.
// Svarer 'sendt', 'allerede' eller 'fejl' (så er markeringen fjernet igen).
function mm_send_en(PDO $db, int $id, string $email, string $uge, string $emne, string $html, string $tekst): string {
    try { $db->prepare('INSERT INTO mandagsmail_sendt (abonnent_id, uge, sendt) VALUES (?, ?, ?)')->execute([$id, $uge, nu()]); }
    catch (PDOException $e) { return 'allerede'; }
    if (send_mail($email, $emne, $html, $tekst)) return 'sendt';
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
