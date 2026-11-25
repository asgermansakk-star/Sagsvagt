<?php
// Spørgeskema til dem, der har brugt Sagsvagt i over en måned (spoergeskema.html). Hver modtager får et personligt, signeret
// link på mail fra redaktionen (api/admin/spoergeskema.php), så kun de inviterede kan svare, og hver kun én gang pr. runde
// (svarer man igen, erstattes svaret). Svarene beholdes uden kobling til personen, hvis kontoen slettes (som feedback).
declare(strict_types=1);

// Runden: skift den, når et nyt spørgeskema sendes ud. Svar og udsendelser gemmes pr. runde.
const SPOERG_RUNDE = '2026-11';
// Hvem kan få spørgeskemaet: har sagt ja til andre informationer end mandagsmailen og bekræftet for mindst 30 dage siden
const SPOERG_DAGE = 30;

// Spørgsmålene. Serveren gemmer kun de svar, der står her; tekster er valgfri og forkortes.
const SPOERG = [
    'brug'      => ['type' => 'flere', 'valg' => ['mandagsmail', 'minavis', 'forside', 'soeg', 'kort', 'push', 'andet']],
    'hyppighed' => ['type' => 'et', 'valg' => ['hver_uge', 'par_gange', 'sjaeldent', 'aldrig']],
    'rammer'    => ['type' => 'tal', 'fra' => 1, 'til' => 5],
    'hjulpet'   => ['type' => 'et', 'valg' => ['ja', 'nej', 'ved_ikke']],
    'hjulpet_tekst' => ['type' => 'tekst', 'max' => 1000],
    'anbefal'   => ['type' => 'tal', 'fra' => 0, 'til' => 10],
    'mangler'   => ['type' => 'tekst', 'max' => 2000],
    'rolle'     => ['type' => 'et', 'valg' => ['borger', 'politiker', 'journalist', 'forening', 'kommune', 'erhverv', 'andet']],
    'betale'    => ['type' => 'et', 'valg' => ['nej', 'under_30', '30_59', '60_99', '100_plus']],
    'kontakt'   => ['type' => 'ja'],
];

function spoerg_tabeller(PDO $db): void {
    static $klar = false; if ($klar) return; $klar = true;
    $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $id = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $tekst = $mysql ? 'MEDIUMTEXT' : 'TEXT';
    $db->exec("CREATE TABLE IF NOT EXISTS spoergeskema_svar (id $id, abonnent_id INT NULL, runde VARCHAR(20) NOT NULL, svar $tekst NOT NULL, oprettet VARCHAR(25) NOT NULL, opdateret VARCHAR(25) NOT NULL)");
    $db->exec('CREATE TABLE IF NOT EXISTS spoergeskema_sendt (abonnent_id INT NOT NULL, runde VARCHAR(20) NOT NULL, tid VARCHAR(25) NOT NULL)');
}

function spoerg_link(int $id): string {
    global $K;
    return $K['site_url'] . "spoergeskema.html?id=$id&t=" . signatur('spoerg:' . SPOERG_RUNDE . ":$id");
}
function spoerg_link_ok(int $id, string $t): bool { return $id > 0 && signatur_ok('spoerg:' . SPOERG_RUNDE . ":$id", $t); }

// Rydder svarene: kun kendte spørgsmål og valg. Returnerer [] hvis intet er besvaret.
function spoerg_rens(array $ind): array {
    $ud = [];
    foreach (SPOERG as $navn => $s) {
        if (!array_key_exists($navn, $ind)) continue;
        $v = $ind[$navn];
        if ($s['type'] === 'flere') {
            $l = array_values(array_unique(array_filter(is_array($v) ? $v : [], fn($x) => is_string($x) && in_array($x, $s['valg'], true))));
            if ($l) $ud[$navn] = $l;
        } elseif ($s['type'] === 'et') {
            if (is_string($v) && in_array($v, $s['valg'], true)) $ud[$navn] = $v;
        } elseif ($s['type'] === 'tal') {
            if ((is_int($v) || (is_string($v) && preg_match('/^\d{1,2}$/', $v))) && (int)$v >= $s['fra'] && (int)$v <= $s['til']) $ud[$navn] = (int)$v;
        } elseif ($s['type'] === 'tekst') {
            $t = mb_substr(trim((string)(is_scalar($v) ? $v : '')), 0, $s['max']);
            if ($t !== '') $ud[$navn] = $t;
        } elseif ($s['type'] === 'ja') {
            if ($v === true || $v === 1 || $v === '1') $ud[$navn] = true;
        }
    }
    return array_keys($ud) === ['kontakt'] ? [] : $ud;
}

// Hvem der kan få spørgeskemaet, og som ikke har fået det i denne runde
function spoerg_kan_sql(): string {
    return ANDRE_KAN . " AND bekraeftet <= ? AND id NOT IN (SELECT abonnent_id FROM spoergeskema_sendt WHERE runde = ?)";
}
function spoerg_graense(): string { return gmdate('Y-m-d\TH:i:s\Z', time() - SPOERG_DAGE * 86400); }

// Mailen med linket. Returnerer [emne, html, tekst].
function spoerg_mail(int $id, string $email): array {
    $emne = 'Hvad synes du om Sagsvagt? (3 minutter)';
    [$html, $tekst] = mail_skabelon('Hvad synes du om Sagsvagt?',
        "Du har brugt Sagsvagt i over en måned, og vi vil gerne høre, hvad der virker, og hvad der mangler, så vi kan gøre avisen bedre.\n\nDet er 9 korte spørgsmål og tager ca. 3 minutter. Du kan springe alle spørgsmål over.",
        'Svar på spørgsmålene', spoerg_link($id),
        "Du får denne mail, fordi $email har sagt ja til andre mails fra Sagsvagt end mandagsmailen. Du kan sige nej til dem under Tilpas i Min avis. Vil du ikke have nogen mails fra os, så afmeld her: " . afmeld_link($id));
    return [$emne, $html, $tekst];
}
