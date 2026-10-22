<?php
// Tilmelding fra sagsvagt.dk: gemmer den tilmeldte, giver redaktionen besked og sender en kvittering.
// Tilmelder samme e-mail sig igen, opdateres kommuner, emner og rolle.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$d = kraev_post();
begraens('tilmeld:' . ip(), 20, 3600);
// Det usynlige felt "_honey" udfyldes kun af robotter: svar "ok", men gem intet og send ingen mails
if (trim((string)($d['_honey'] ?? '')) !== '') svar(200, ['ok' => true]);
$email = ren_email($d['email'] ?? '');
if ($email === '') fejl(400, 'Skriv en gyldig e-mailadresse.');
$felt = fn($k, $max) => mb_substr(trim((string)($d[$k] ?? '')), 0, $max);
$kommuner = $felt('kommuner', 500); $rolle = $felt('rolle', 100); $kilde = $felt('kilde', 100);
$emner = $felt('emner', 2000); $valgte = $felt('valgte_emner', 1000);
$alleEmner = trim(implode(', ', array_filter([$valgte, $emner])), ', ');
// Fluebenet "vil også være medlem af Sæt Dagsordenen": navn og alder 16-30 (foreningens vedtægter § 3)
$medlem = filter_var($d['medlem'] ?? false, FILTER_VALIDATE_BOOLEAN);
$navn = $felt('navn', 100);
$alder = filter_var($d['alder'] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 16, 'max_range' => 30]]);
if ($medlem && $navn === '') fejl(400, 'Skriv dit navn for at blive medlem af Sæt Dagsordenen.');
if ($medlem && $alder === false) fejl(400, 'Man skal være mellem 16 og 30 år for at blive medlem af Sæt Dagsordenen.');

$db = db();
$q = $db->prepare('SELECT id, status, medlem FROM abonnenter WHERE email = ?'); $q->execute([$email]);
$fandtes = $q->fetch();

// Adgangskode ved tilmelding: kun når mindst én af kommunerne er åben, og kun for en ny e-mail. En eksisterende
// tilmelding eller konto får aldrig en ny adgangskode herfra (så ingen kan overtage en andens); den bruger "Glemt adgangskode".
$kode = (string)($d['adgangskode'] ?? '');
$konto = false;
if ($kode !== '') {
    if (mb_strlen($kode) < 10) fejl(400, 'Adgangskoden skal være på mindst 10 tegn.');
    if (mb_strlen($kode) > 200) fejl(400, 'Adgangskoden er for lang.');
    if (mb_strtolower($kode) === $email) fejl(400, 'Adgangskoden må ikke være din e-mail.');
    $aabne = array_column(json_decode((string)@file_get_contents(__DIR__ . '/../kommune/aabne.json'), true) ?: [], 'navn');
    if (!array_intersect(array_map('trim', explode(',', $kommuner)), $aabne)) fejl(400, 'Du kan vælge en adgangskode, når en af dine kommuner er åben.');
    $konto = !$fandtes;
}
// Ny på Sagsvagt: ingen række, eller en række, der indtil nu kun var foreningsmedlem
$ny = !$fandtes || $fandtes['status'] === 'medlem';
$nytMedlem = $medlem && empty($fandtes['medlem']);
if ($fandtes) {
    $db->prepare("UPDATE abonnenter SET kommuner = ?, emner = ?, rolle = ?, status = CASE WHEN status IN ('afmeldt', 'medlem') THEN 'tilmeldt' ELSE status END WHERE id = ?")
       ->execute([$kommuner, $alleEmner, $rolle, $fandtes['id']]);
} elseif ($konto) {
    // Ny konto i en åben kommune: aktiv med det samme, og logget ind
    $db->prepare("INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet, status, adgangskode) VALUES (?, ?, ?, ?, ?, ?, 'aktiv', ?)")
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu(), password_hash($kode, PASSWORD_DEFAULT)]);
    log_ind((int)$db->lastInsertId());
} else {
    $db->prepare('INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet) VALUES (?, ?, ?, ?, ?, ?)')
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu()]);
}
if ($medlem) {
    // Var man allerede medlem, beholdes tidspunktet for medlemskabet
    $db->prepare('UPDATE abonnenter SET medlem = COALESCE(medlem, ?), navn = ?, alder = ? WHERE email = ?')->execute([nu(), $navn, $alder, $email]);
}

// Besked til redaktionen og kvittering til den tilmeldte. Fejler mailen, er tilmeldingen stadig gemt.
$linjer = "E-mail: $email\nKommuner: $kommuner\nEmner: $alleEmner\nJeg er: $rolle\nKilde: $kilde\n"
        . ($medlem ? "Medlem af Sæt Dagsordenen: $navn, $alder år\n" : '') . ($ny ? '' : "(Var allerede tilmeldt og har opdateret sine valg.)\n");
@send_mail(TILMELDINGER_TIL, ($ny ? 'Ny tilmelding' : 'Opdateret tilmelding') . " til Sagsvagt: $email",
    '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer, $email); // "Besvar" går til den tilmeldte
if ($nytMedlem) {
    $tekstF = "Nyt medlem via sagsvagt.dk\n\nNavn: $navn\nAlder: $alder\nE-mail: $email\nKommuner: $kommuner\n";
    @send_mail('kontakt@saetdagsordenen.dk', "Nyt medlem af Sæt Dagsordenen: $navn",
        '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($tekstF, ENT_QUOTES, 'UTF-8') . '</pre>', $tekstF, $email);
}
if ($ny || $nytMedlem) {
    [$html, $tekst] = mail_skabelon($konto ? 'Velkommen til Sagsvagt' : 'Tak, fordi du har skrevet dig op',
        ($konto ? "Din konto er oprettet, og du kan logge ind på Min avis med din e-mail og den adgangskode, du valgte. Du får også én mail hver mandag med de sager fra byråd, udvalg og lokaludvalg, der handler om dine emner.\n\n"
                : "Vi giver besked, når din kommune er klar. Derefter får du én mail hver mandag med de sager fra byråd, udvalg og lokaludvalg, der handler om dine emner.\n\n")
        . ($medlem ? "Du er også blevet gratis medlem af foreningen Sæt Dagsordenen. Foreningen kan se dit navn, din alder, din e-mail og dine kommuner. Vil du melde dig ud, så skriv til kontakt@saetdagsordenen.dk.\n\n" : '')
        . "Vil du ændre dine emner eller afmelde dig, så svar på denne mail.",
        $konto ? 'Gå til Min avis' : 'Læs, hvordan vi behandler dine oplysninger', $K['site_url'] . ($konto ? 'min/' : 'privatliv.html'),
        "Du får denne mail, fordi $email er skrevet op til Sagsvagt.");
    @send_mail($email, $konto ? 'Din konto på Sagsvagt' : 'Du er skrevet op til Sagsvagt', $html, $tekst);
}
// konto: logget ind og kan gå til Min avis. harKonto: e-mailen fandtes, så en valgt adgangskode blev ikke brugt.
svar(200, ['ok' => true, 'konto' => $konto, 'harKonto' => $kode !== '' && !$konto]);
