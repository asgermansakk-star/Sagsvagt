<?php
// Skabelon til api/_konfig.php. Kopiér filen til _konfig.php på serveren og udfyld den.
// _konfig.php må aldrig ligge i git eller i upload-zip'en, fordi den indeholder adgangskoden til databasen.
return [
    // Sidens adresse med / til sidst. Bruges i links i mails og til at tjekke, at forespørgsler kommer fra siden selv.
    'site_url' => 'https://sagsvagt.dk/',

    // Databasen fra Simplys kontrolpanel (Databaser → MySQL)
    'db' => [
        'driver' => 'mysql',
        'vaert' => 'mysql.simply.com',
        'navn' => 'DATABASENS_NAVN',
        'bruger' => 'DATABASENS_BRUGER',
        'adgangskode' => 'DATABASENS_ADGANGSKODE',
    ],

    // Mails sendes via Simplys mailserver til hjemmesider med login til mailkontoen noreply@sagsvagt.dk.
    // Opret kontoen under Mail hos Simply, og skriv dens adgangskode herunder.
    'mail' => [
        'metode' => 'smtp',
        'smtp' => [
            'vaert' => 'websmtp.simply.com',
            'port' => 587,
            'bruger' => 'noreply@sagsvagt.dk',
            'adgangskode' => 'SKRIV_MAILKONTOENS_ADGANGSKODE_HER',
        ],
        'fra' => 'noreply@sagsvagt.dk',
        'fra_navn' => 'Sagsvagt',
        'svar_til' => 'mansa@sagsvagt.dk',
    ],

    // Dem, der kan bruge admin-siden (min/admin.html). De skal selv have en konto.
    'admins' => ['mansa@sagsvagt.dk'],

];
