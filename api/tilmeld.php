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
// Gratis følger man én kommune; flere (Plus og Pro, se priser.html) sætter redaktionen på admin-siden
if (count(array_filter(array_map('trim', preg_split('/,|\/|\s+og\s+/iu', $kommuner)))) > 1) fejl(400, 'Du kan følge én kommune gratis. Vil du følge flere, så skriv til mansa@sagsvagt.dk.');
$emner = $felt('emner', 2000); $valgte = $felt('valgte_emner', 1000);
$alleEmner = trim(implode(', ', array_filter([$valgte, $emner])), ', ');
// Fluebenet "Ja tak, Sagsvagt må sende mig mandagsmailen og andre informationer": valgfrit, for man må ikke skulle sige ja til
// reklame for at få en konto. Sender siden ikke feltet (en gammel side i browseren), sagde man kun ja til mandagsmailen.
$samtykke = array_key_exists('samtykke', $d) ? (filter_var($d['samtykke'], FILTER_VALIDATE_BOOLEAN) ? 'ja' : 'nej') : null;
// Fornavn og efternavn står i hver sin boks; navn er dem samlet (ældre sider sender kun navn). Fornavnet bliver Min avis' og mandagsmailens hilsen.
$fornavn = $felt('fornavn', 40); $efternavn = $felt('efternavn', 60);
$navn = mb_substr(trim("$fornavn $efternavn"), 0, 100) ?: $felt('navn', 100);
if ($fornavn === '' && $navn !== '') $fornavn = mb_substr(explode(' ', $navn)[0], 0, 40);
$profil = $fornavn !== '' ? json_encode(['navn' => $fornavn], JSON_UNESCAPED_UNICODE) : null;
// Højst tre mails om dagen til samme adresse, så formularen ikke kan bruges til at fylde en andens indbakke
begraens('tilmeld-mail:' . $email, 3, 86400);

$db = db();
$q = $db->prepare('SELECT id, status, bekraeftet, mail_afmeldt FROM abonnenter WHERE email = ?'); $q->execute([$email]);
$fandtes = $q->fetch();

// Adgangskode ved tilmelding: påkrævet, når mindst én af kommunerne er åben, så ingen ender med en tilmelding uden konto.
// Kravet gælder også en e-mail, der findes i forvejen, så svaret ikke afslører, hvem der er skrevet op. Kun en ny e-mail får koden gemt:
// en eksisterende tilmelding eller konto får aldrig en ny adgangskode herfra (så ingen kan overtage en andens); den bruger "Glemt adgangskode".
$kode = (string)($d['adgangskode'] ?? '');
$konto = false;
$aabne = array_column(json_decode((string)@file_get_contents(__DIR__ . '/../kommune/aabne.json'), true) ?: [], 'navn');
$iAaben = (bool)array_intersect(array_map('trim', explode(',', $kommuner)), $aabne);
if ($kode === '' && $iAaben) svar(400, ['fejl' => 'Vælg en adgangskode på mindst 10 tegn, så du kan logge ind på Min avis.', 'kraever_kode' => true]);
if ($kode !== '') {
    if (mb_strlen($kode) < 10) fejl(400, 'Adgangskoden skal være på mindst 10 tegn.');
    if (mb_strlen($kode) > 200) fejl(400, 'Adgangskoden er for lang.');
    if (mb_strtolower($kode) === $email) fejl(400, 'Adgangskoden må ikke være din e-mail.');
    if (!$iAaben) fejl(400, 'Du kan vælge en adgangskode, når en af dine kommuner er åben.');
    $konto = !$fandtes;
}
// Ny på Sagsvagt: ingen række, eller en række, der indtil nu kun var foreningsmedlem
$ny = !$fandtes || $fandtes['status'] === 'medlem';
// En bekræftet, aktiv tilmelding røres ikke
$laast = $fandtes && $fandtes['bekraeftet'] !== null && $fandtes['mail_afmeldt'] === null && !in_array($fandtes['status'], ['afmeldt', 'medlem'], true);
if ($laast) {
    // Intet ændres
} elseif ($fandtes) {
    // bekraeftet står først: MySQL bruger de nye værdier i resten af SET, så status og mail_afmeldt skal læses, før de ændres
    $db->prepare("UPDATE abonnenter SET bekraeftet = CASE WHEN status IN ('afmeldt', 'medlem') OR mail_afmeldt IS NOT NULL THEN NULL ELSE bekraeftet END, mail_afmeldt = NULL,
        kommuner = ?, emner = ?, rolle = ?, navn = COALESCE(NULLIF(?, ''), navn), profil = COALESCE(profil, ?),
        status = CASE WHEN status IN ('afmeldt', 'medlem') THEN 'tilmeldt' ELSE status END WHERE id = ?")
       ->execute([$kommuner, $alleEmner, $rolle, $navn, $profil, $fandtes['id']]);
} elseif ($konto) {
    // Ny konto i en åben kommune: adgangskoden gemmes, men kontoen bliver først aktiv, når e-mailen er bekræftet (bekraeft.php)
    $db->prepare("INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet, status, adgangskode, navn, profil) VALUES (?, ?, ?, ?, ?, ?, 'tilmeldt', ?, ?, ?)")
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu(), password_hash($kode, PASSWORD_DEFAULT), $navn ?: null, $profil]);
} else {
    $db->prepare('INSERT INTO abonnenter (email, kommuner, emner, rolle, kilde, oprettet, navn, profil) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
       ->execute([$email, $kommuner, $alleEmner, $rolle, $kilde, nu(), $navn ?: null, $profil]);
}
$q = $db->prepare('SELECT id, bekraeftet FROM abonnenter WHERE email = ?'); $q->execute([$email]);
$raekke = $q->fetch();
// Samtykket gælder først, når linket i mailen er brugt, for ellers kan enhver sige ja på en andens vegne
if (!$laast) gem_samtykke($db, (int)$raekke['id'], $samtykke ?? 'mandag', $samtykke === null ? 'gammel side' : 'tilmelding');

// Besked til redaktionen og mail til den tilmeldte. Fejler mailen, er tilmeldingen stadig gemt.
if (!$laast) {
    $linjer = ($navn !== '' ? "Navn: $navn\n" : '') . "E-mail: $email\nKommuner: $kommuner\nEmner: $alleEmner\nJeg er: $rolle\nKilde: $kilde\n"
            . 'Må få mandagsmailen og andre informationer: ' . ($samtykke ?? 'kun mandagsmailen') . "\n" . ($ny ? '' : "(Var skrevet op før og har opdateret sine valg.)\n") . "E-mailen er ikke bekræftet endnu.\n";
    @send_mail(TILMELDINGER_TIL, ($ny ? 'Ny tilmelding' : 'Opdateret tilmelding') . " til Sagsvagt: $email",
        '<pre style="font:14px/1.5 Arial,sans-serif">' . htmlspecialchars($linjer, ENT_QUOTES, 'UTF-8') . '</pre>', $linjer, $email); // "Besvar" går til den tilmeldte
}
if ($raekke['bekraeftet'] === null) {
    // Ny eller tilbage efter afmelding: mail med bekræftelseslinket (og velkomst til en ny konto)
    @send_bekraeftelse((int)$raekke['id'], $email, $konto);
} else {
    [$html, $tekst] = mail_skabelon('Du er allerede skrevet op',
        "Nogen (sikkert dig selv) har skrevet $email op til Sagsvagt igen. Du er allerede skrevet op, så intet er ændret.\n\nVil du ændre dine kommuner, emner eller mails, så log ind på Min avis, eller svar på denne mail.",
        'Gå til Min avis', $K['site_url'] . 'min/', "Du får denne mail, fordi $email er skrevet op til Sagsvagt.");
    @send_mail($email, 'Du er allerede skrevet op til Sagsvagt', $html, $tekst);
}
// bekraeft: der er sendt en mail; svaret er det samme, uanset hvad der stod i databasen i forvejen
svar(200, ['ok' => true, 'bekraeft' => true]);
