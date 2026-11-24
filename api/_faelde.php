<?php
// Fælde-adresse (honeypot). Filerne /wp-login.php, /xmlrpc.php, /phpinfo.php og /wp-admin/*.php findes kun, fordi robotter leder
// efter dem for at finde huller; Sagsvagt bruger ikke WordPress. Besøget logges (IP, adresse, browser, tid; slettes efter to døgn),
// og efter FAELDE_MAX besøg på et døgn afvises IP-adressen på formularer og login (se tjek_faelder i _bootstrap.php).
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
try {
    noter_faelde('adresse:' . (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH));
    noter_forsoeg('faelde:' . ip());
} catch (Throwable $e) { /* en fejl i loggen må ikke afsløre noget */ }
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo '<!doctype html><meta charset="utf-8"><title>Siden findes ikke</title><p>Siden findes ikke.</p>';
