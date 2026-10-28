<?php
// Tilmelding fra sagsvagt.dk: gemmer den tilmeldte, giver redaktionen besked og sender en mail med et link, der bekræfter
// adressen (dobbelt opt-in). Mandagsmailen sendes, og en konto med adgangskode åbnes, først når linket er brugt (api/bekraeft.php).
// Tilmelder samme e-mail sig igen, før den er bekræftet, gælder de nye valg. En bekræftet tilmelding ændres aldrig herfra
// (ellers kunne enhver, der kender en e-mail, ændre en andens valg); man får i stedet en mail om, hvordan man retter dem.
// Svaret er det samme i alle tilfælde, så ingen kan teste, hvem der er skrevet op.
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
// Højst tre mails om dagen til samme adresse, så formularen ikke kan bruges til at fylde en andens indbakke
begraens('tilmeld-mail:' . $email, 3, 86400);

$db = db();
$q = $db->prepare('SELECT id, status, medlem, bekraeftet, mail_afmeldt FROM abonnenter WHERE email = ?'); $q->execute([$email]);
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
// En bekræftet, aktiv tilmelding røres ikke
$laast = $fandtes && $fandtes['bekraeftet'] !== null && $fandtes['mail_afmeldt'] === null && !in_array($fandtes['status'], ['afmeldt', 'medlem'], true);
if ($laast) {
    // Intet ændres
} elseif ($fandtes) {
    // bekraeftet står først: MySQL bruger de nye værdier i resten af SET, så status og mail_afmeldt skal læses, før de ændres
    $db->prepare("UPDATE abonnenter SET bekraeftet = CASE WHEN status IN ('afmeldt', 'medlem') OR mail_afmeldt IS NOT NULL THEN NULL ELSE bekraeftet END, mail_afmeldt = NULL,
        kommuner = ?, emner = ?, rolle = ?, status = CASE WHEN status IN ('afmeldt', 'medlem') THEN 'tilmeldt' ELSE status END WHERE id = ?")
       ->execute([$kommuner, $alleEmner, $rolle, $fandtes['id']]);
} elseif ($konto) {
    // Ny konto i en åben kommune: adgangskoden gemmes, men kontoen bliver først aktiv, når e-mailen er bekræftet (bekraeft.php)
    $db->prepare("INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet, status, adgangskode) VALUES (?, ?, ?, ?, ?, ?, 'tilmeldt', ?)")
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu(), password_hash($kode, PASSWORD_DEFAULT)]);
} else {
    $db->prepare('INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet) VALUES (?, ?, ?, ?, ?, ?)')
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu()]);
}
if ($nytMedlem) {
    // Medlemskabet af Sæt Dagsordenen venter, til linket i mailen er brugt (bekraeft.php), så ingen kan melde en anden ind
    $db->prepare('UPDATE abonnenter SET medlem_venter = COALESCE(medlem_venter, ?), navn = ?, alder = ? WHERE email = ? AND medlem IS NULL')->execute([nu(), $navn, $alder, $email]);
}

// Besked til redaktionen og mail til den tilmeldte. Fejler mailen, er tilmeldingen stadig gemt.
if (!$laast) {
    $linjer = "E-mail: $email\nKommuner: $kommuner\nEmner: $alleEmner\nJeg er: $rolle\nKilde: $kilde\n"
            . ($medlem ? "Vil være medlem af Sæt Dagsordenen: $navn, $alder år\n" : '') . ($ny ? '' : "(Var skrevet op før og har opdateret sine valg.)\n") . "E-mailen er ikke bekræftet endnu.\n";
    @send_mail(TILMELDINGER_TIL, ($ny ? 'Ny tilmelding' : 'Opdateret tilmelding') . " til Sagsvagt: $email",
        '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer, $email); // "Besvar" går til den tilmeldte
}
if ($nytMedlem) {
    $tekstF = "Ny tilmelding via sagsvagt.dk (bliver medlem, når e-mailen er bekræftet)\n\nNavn: $navn\nAlder: $alder\nE-mail: $email\nKommuner: $kommuner\n";
    @send_mail('kontakt@saetdagsordenen.dk', "Ny tilmelding til Sæt Dagsordenen: $navn",
        '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($tekstF, ENT_QUOTES, 'UTF-8') . '</pre>', $tekstF, $email);
}
$q = $db->prepare('SELECT id, bekraeftet FROM abonnenter WHERE email = ?'); $q->execute([$email]);
$raekke = $q->fetch();
if ($raekke['bekraeftet'] === null || $nytMedlem) {
    // Ny, tilbage efter afmelding eller vil være medlem: mail med bekræftelseslinket (og velkomst til en ny konto)
    @send_bekraeftelse((int)$raekke['id'], $email, $konto, $nytMedlem);
} else {
    [$html, $tekst] = mail_skabelon('Du er allerede skrevet op',
        "Nogen (sikkert dig selv) har skrevet $email op til Sagsvagt igen. Du er allerede skrevet op, så intet er ændret.\n\nVil du ændre dine kommuner eller emner, så log ind på Min avis, eller svar på denne mail.",
        'Gå til Min avis', $K['site_url'] . 'min/', "Du får denne mail, fordi $email er skrevet op til Sagsvagt.");
    @send_mail($email, 'Du er allerede skrevet op til Sagsvagt', $html, $tekst);
}
// bekraeft: der er sendt en mail; svaret er det samme, uanset hvad der stod i databasen i forvejen
svar(200, ['ok' => true, 'bekraeft' => true]);
