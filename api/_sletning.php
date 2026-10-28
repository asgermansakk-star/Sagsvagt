<?php
// Sletning af afmeldte, som privatliv.html lover: senest 30 dage efter afmeldingen. Kører én gang i døgnet fra api/besoeg.php.
// Afmeldt = status 'afmeldt' (via linket i en mail eller af redaktionen). mail_afmeldt er tidspunktet; mangler det (afmeldt,
// før redaktionen også satte det), begynder de 30 dage, første gang rutinen ser rækken.
// Er man også medlem af Sæt Dagsordenen, slettes kun Sagsvagt-delen (som i api/slet-konto.php), og rækken får status 'medlem'.
// Konti, der kun har slået mandagsmailen fra, beholdes, til man selv sletter dem under Min avis.
declare(strict_types=1);

const SLET_EFTER_DAGE = 30;

// Fjerner alt om en tilmeldt: links fra mails, push, mailkø og -historik. Feedback beholdes uden e-mail.
function slet_abonnent(PDO $db, int $id, bool $medlem): void {
    $db->prepare('DELETE FROM tokens WHERE abonnent_id = ?')->execute([$id]);
    foreach (['push_abonnementer', 'mandagsmail_koe', 'mandagsmail_sendt'] as $tabel) {
        try { $db->prepare("DELETE FROM $tabel WHERE abonnent_id = ?")->execute([$id]); } catch (PDOException $e) {} // findes kun, når de er brugt
    }
    $db->prepare("UPDATE feedback SET abonnent_id = NULL, email = '' WHERE abonnent_id = ?")->execute([$id]);
    if ($medlem) $db->prepare("UPDATE abonnenter SET status = 'medlem', profil = NULL, emner = '', rolle = '', kilde = '', mail_afmeldt = NULL WHERE id = ?")->execute([$id]);
    else $db->prepare('DELETE FROM abonnenter WHERE id = ?')->execute([$id]);
}

// Returnerer antallet af slettede
function slet_maaske_koer(): int {
    $db = db();
    $q = $db->prepare("SELECT vaerdi FROM indstillinger WHERE noegle = 'drift:sletning'"); $q->execute();
    if (substr((string)$q->fetchColumn(), 0, 10) === substr(nu(), 0, 10)) return 0; // kørt i dag
    // IP-adresser fra begraens() (tabellen forsoeg) ryddes også, når der kommer nye forsøg; her for en sikkerheds skyld
    $db->prepare('DELETE FROM forsoeg WHERE tid < ?')->execute([time() - 86400]);
    $db->exec("UPDATE abonnenter SET mail_afmeldt = '" . nu() . "' WHERE status = 'afmeldt' AND mail_afmeldt IS NULL");
    $graense = gmdate('Y-m-d\TH:i:s\Z', time() - SLET_EFTER_DAGE * 86400);
    $q = $db->prepare("SELECT id, medlem FROM abonnenter WHERE status = 'afmeldt' AND mail_afmeldt < ?"); $q->execute([$graense]);
    $n = 0;
    foreach ($q->fetchAll() as $a) { slet_abonnent($db, (int)$a['id'], !empty($a['medlem'])); $n++; }
    // Kun antallet, ikke adresserne, så de ikke bliver liggende i redaktionens indbakke
    if ($n) { $tekst = "$n afmeldte er slettet fra databasen " . SLET_EFTER_DAGE . " dage efter afmeldingen.\n"; @send_mail(TILMELDINGER_TIL, "Afmeldte slettet: $n", '<p style="font:14px/1.5 Arial,sans-serif">' . $tekst . '</p>', $tekst); }
    return $n;
}
