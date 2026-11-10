<?php
// Avisens tre prisklasser (priser.html). Gratis følger den ene kommune fra tilmeldingen og kan kun få den skiftet af
// redaktionen; Plus og Pro vælger selv deres kommuner op til grænsen i Min avis og kan selv opsige.
// Bestilling er lukket, indtil redaktionen åbner den på admin-siden (indstillingen "pakker:aaben"), fx når erhvervskontoen
// er oprettet. Betalingen sker med faktura fra redaktionens regnskabsprogram: en bestilling eller opsigelse giver
// redaktionen en mail, og admin-siden viser, hvem der skal faktureres. Kommunerne står i tilmeldingen (abonnenter.kommuner),
// som Min avis og mandagsmailen læser.
declare(strict_types=1);
require_once __DIR__ . '/_bootstrap.php';

// Pris pr. måned inkl. moms og det største antal kommuner
const PAKKER = [
    'gratis' => ['navn' => 'Gratis', 'pris' => 0, 'kommuner' => 1],
    'plus' => ['navn' => 'Plus', 'pris' => 29, 'kommuner' => 3],
    'pro' => ['navn' => 'Pro', 'pris' => 99, 'kommuner' => 10],
];

function pakker_tabeller(PDO $db): void {
    // pakke: NULL er Gratis. pakke_fra: første dag i pakken (fakturaen regnes derfra). faktura_til: navn, firma eller CVR på fakturaen
    foreach (['pakke' => 'VARCHAR(10) NULL', 'pakke_fra' => 'VARCHAR(10) NULL', 'faktura_til' => 'VARCHAR(200) NULL'] as $kol => $type) {
        try { $db->query("SELECT $kol FROM abonnenter LIMIT 1"); } catch (PDOException $e) { $db->exec("ALTER TABLE abonnenter ADD COLUMN $kol $type"); }
    }
}
function pakker_aaben(PDO $db): bool {
    $q = $db->prepare("SELECT vaerdi FROM indstillinger WHERE noegle = 'pakker:aaben'"); $q->execute();
    return $q->fetchColumn() === '1';
}
function pakker_saet_aaben(PDO $db, bool $til): void {
    $db->prepare("DELETE FROM indstillinger WHERE noegle = 'pakker:aaben'")->execute();
    $db->prepare("INSERT INTO indstillinger (noegle, vaerdi) VALUES ('pakker:aaben', ?)")->execute([$til ? '1' : '0']);
}
function pakke_af(array $b): string { return isset(PAKKER[$b['pakke'] ?? '']) ? (string)$b['pakke'] : 'gratis'; }
// De åbne kommuner som slug => navn (kommune/aabne.json, som avis/kommuner.mjs skriver)
function pakker_kommuner(): array {
    return array_column(json_decode((string)@file_get_contents(__DIR__ . '/../kommune/aabne.json'), true) ?: [], 'navn', 'slug');
}
