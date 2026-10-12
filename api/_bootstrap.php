<?php
// Fælles fundament for Sagsvagts API: konfiguration, database, sessioner, sikkerhed og mail.
// Filer, der starter med _, kan ikke hentes udefra (se api/.htaccess).
declare(strict_types=1);

$K = require __DIR__ . '/_konfig.php';

// ---------- Svar ----------
function svar(int $kode, array $data = []): never {
    http_response_code($kode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fejl(int $kode, string $besked): never { svar($kode, ['fejl' => $besked]); }
function nu(): string { return gmdate('Y-m-d\TH:i:s\Z'); }

// ---------- Sikkerhed ----------
// Alle ændringer kræver headeren X-Sagsvagt og JSON. Andre hjemmesider kan ikke sende en egen header uden CORS,
// så det beskytter mod falske formularer (CSRF). Origin skal desuden være vores egen side, hvis den er sat.
function kraev_post(): array {
    global $K;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fejl(405, 'Kun POST');
    if (($_SERVER['HTTP_X_SAGSVAGT'] ?? '') !== 'api') fejl(403, 'Ikke tilladt');
    $origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');
    if ($origin !== '' && !in_array($origin, tilladte_origins(), true)) fejl(403, 'Ikke tilladt');
    $raa = file_get_contents('php://input', false, null, 0, 65536) ?: '';
    $data = json_decode($raa, true);
    if (!is_array($data)) fejl(400, 'Ugyldige data');
    return $data;
}
// Sidens egen adresse (fx https://sagsvagt.dk) plus eventuelle ekstra fra konfigurationen
function tilladte_origins(): array {
    global $K;
    $u = parse_url($K['site_url']);
    $egen = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    return array_merge([$egen], $K['ekstra_origins'] ?? []);
}
function ren_email(mixed $e): string {
    $e = mb_strtolower(trim((string)$e));
    return (strlen($e) <= 254 && filter_var($e, FILTER_VALIDATE_EMAIL)) ? $e : '';
}
function ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '?'; }

// ---------- Database ----------
// Lokalt bruges SQLite, hos Simply MySQL. Tabellerne oprettes automatisk første gang.
function db(): PDO {
    static $pdo = null;
    global $K;
    if ($pdo) return $pdo;
    $d = $K['db'];
    if ($d['driver'] === 'sqlite') {
        if (!is_dir(dirname($d['fil']))) mkdir(dirname($d['fil']), 0700, true);
        $pdo = new PDO('sqlite:' . $d['fil']);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $id = 'INTEGER PRIMARY KEY AUTOINCREMENT'; $tekst = 'TEXT';
    } else {
        // Klar besked ved opsætningen, uden at vise adgangskoden: hvilken af oplysningerne i _konfig.php er forkert?
        try {
            $pdo = new PDO("mysql:host={$d['vaert']};dbname={$d['navn']};charset=utf8mb4", $d['bruger'], $d['adgangskode']);
        } catch (PDOException $e) {
            $kode = (int)($e->errorInfo[1] ?? 0) ?: (preg_match('/\[(\d{4})\]/', $e->getMessage(), $m) ? (int)$m[1] : 0);
            fejl(500, match ($kode) {
                1049 => 'Databasen: databasenavnet i _konfig.php findes ikke.',
                1044 => 'Databasen: brugeren i _konfig.php har ikke adgang til databasen (forkert databasenavn eller bruger).',
                1045 => 'Databasen: brugernavn eller adgangskode i _konfig.php er forkert.',
                2002, 2005 => 'Databasen: serveren (vaert) i _konfig.php kan ikke nås.',
                default => "Databasen svarer ikke (fejl $kode).",
            });
        }
        $id = 'INT AUTO_INCREMENT PRIMARY KEY'; $tekst = 'MEDIUMTEXT';
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec("CREATE TABLE IF NOT EXISTS abonnenter (
        id $id, email VARCHAR(254) NOT NULL UNIQUE, kommuner VARCHAR(500) NOT NULL DEFAULT '', emner $tekst, rolle VARCHAR(100) NOT NULL DEFAULT '',
        kilde VARCHAR(100) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'tilmeldt', oprettet VARCHAR(25) NOT NULL,
        inviteret VARCHAR(25) NULL, adgangskode VARCHAR(255) NULL, profil $tekst NULL, sidst_inde VARCHAR(25) NULL)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS tokens (
        id $id, abonnent_id INT NOT NULL, type VARCHAR(10) NOT NULL, hash CHAR(64) NOT NULL UNIQUE, udloeber VARCHAR(25) NOT NULL, brugt VARCHAR(25) NULL)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS forsoeg (noegle VARCHAR(200) NOT NULL, tid INT NOT NULL)");
    // Feedback fra testpersonerne i Min avis. Sletter en bruger sin konto, beholdes teksten uden e-mail.
    $pdo->exec("CREATE TABLE IF NOT EXISTS feedback (
        id $id, abonnent_id INT NULL, email VARCHAR(254) NOT NULL DEFAULT '', vurdering VARCHAR(20) NOT NULL DEFAULT '',
        tekst $tekst NOT NULL, side VARCHAR(100) NOT NULL DEFAULT '', kontakt TINYINT NOT NULL DEFAULT 0, oprettet VARCHAR(25) NOT NULL)");
    return $pdo;
}

// Begrænser forsøg: højst $max pr. $sek sekunder pr. nøgle (fx login pr. e-mail og pr. IP)
function begraens(string $noegle, int $max, int $sek): void {
    $db = db(); $t = time();
    $db->prepare('DELETE FROM forsoeg WHERE tid < ?')->execute([$t - 86400]);
    $q = $db->prepare('SELECT COUNT(*) FROM forsoeg WHERE noegle = ? AND tid > ?'); $q->execute([$noegle, $t - $sek]);
    if ((int)$q->fetchColumn() >= $max) fejl(429, 'For mange forsøg. Vent lidt, og prøv igen.');
    $db->prepare('INSERT INTO forsoeg (noegle, tid) VALUES (?, ?)')->execute([$noegle, $t]);
}

// ---------- Sessioner ----------
function start_session(): void {
    global $K;
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = str_starts_with($K['site_url'], 'https://');
    session_name($https ? '__Host-sagsvagt' : 'sagsvagt');
    session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 60, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 60));
    session_start();
}
function log_ind(int $id): void {
    start_session();
    session_regenerate_id(true);
    $_SESSION['id'] = $id;
    db()->prepare('UPDATE abonnenter SET sidst_inde = ? WHERE id = ?')->execute([nu(), $id]);
}
function bruger(): ?array {
    start_session();
    if (empty($_SESSION['id'])) return null;
    $q = db()->prepare("SELECT * FROM abonnenter WHERE id = ? AND status = 'aktiv'"); $q->execute([$_SESSION['id']]);
    return $q->fetch() ?: null;
}
function er_admin(?array $b): bool { global $K; return $b && in_array($b['email'], $K['admins'], true); }
function kraev_admin(): array { $b = bruger(); if (!er_admin($b)) fejl(403, 'Kun for redaktionen'); return $b; }

// ---------- Tokens til links i mails ----------
// Linket indeholder en tilfældig nøgle; databasen gemmer kun dens SHA-256, så en lækket database ikke giver adgang.
function lav_token(int $abonnent, string $type, int $timer): string {
    $noegle = bin2hex(random_bytes(32));
    db()->prepare('UPDATE tokens SET brugt = ? WHERE abonnent_id = ? AND type = ? AND brugt IS NULL')->execute([nu(), $abonnent, $type]);
    db()->prepare('INSERT INTO tokens (abonnent_id, type, hash, udloeber) VALUES (?, ?, ?, ?)')
        ->execute([$abonnent, $type, hash('sha256', $noegle), gmdate('Y-m-d\TH:i:s\Z', time() + $timer * 3600)]);
    return $noegle;
}
function find_token(string $noegle): ?array {
    if (!preg_match('/^[a-f0-9]{64}$/', $noegle)) return null;
    $q = db()->prepare('SELECT t.*, a.email FROM tokens t JOIN abonnenter a ON a.id = t.abonnent_id WHERE t.hash = ? AND t.brugt IS NULL AND t.udloeber > ?');
    $q->execute([hash('sha256', $noegle), nu()]);
    return $q->fetch() ?: null;
}

// ---------- Mail ----------
// 'smtp' sender via Simplys mailserver til hjemmesider (websmtp.simply.com:587) med login til en rigtig mailkonto.
// Det er nødvendigt, fordi sagsvagt.dk har en streng DMARC-regel (p=reject): mails fra PHP's mail() bliver ikke godkendt
// med SPF/DKIM og bliver derfor afvist af fx Outlook. 'php' bruger mail() (kun som nødløsning), 'fil' gemmer mailen som
// .eml-fil (til lokal test).
function send_mail(string $til, string $emne, string $html, string $tekst): bool {
    global $K;
    $m = $K['mail'];
    $graense = 'sv' . bin2hex(random_bytes(12));
    $emneKodet = '=?UTF-8?B?' . base64_encode($emne) . '?=';
    $fraNavn = '=?UTF-8?B?' . base64_encode($m['fra_navn']) . '?=';
    $domaene = substr(strrchr($m['fra'], '@'), 1);
    $hoveder = "From: $fraNavn <{$m['fra']}>\r\nReply-To: {$m['svar_til']}\r\nDate: " . date('r') . "\r\nMessage-ID: <" . bin2hex(random_bytes(16)) . "@$domaene>\r\n"
             . "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$graense\"\r\n";
    $krop = "--$graense\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($tekst))
          . "--$graense\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$graense--\r\n";
    if ($m['metode'] === 'fil') {
        if (!is_dir($m['mappe'])) mkdir($m['mappe'], 0700, true);
        $navn = gmdate('Ymd-His') . '-' . preg_replace('/[^a-z0-9]+/', '-', $til) . '.eml';
        return (bool)file_put_contents($m['mappe'] . '/' . $navn, "To: $til\r\nSubject: $emneKodet\r\n$hoveder\r\n$krop");
    }
    if ($m['metode'] === 'smtp') {
        try {
            smtp_send($m['smtp'], $m['fra'], $til, "To: $til\r\nSubject: $emneKodet\r\n$hoveder\r\n$krop");
            return true;
        } catch (Throwable $e) {
            error_log('Sagsvagt: mail til ' . $til . ' fejlede: ' . $e->getMessage());
            return false;
        }
    }
    return mail($til, $emneKodet, $krop, $hoveder, '-f' . $m['fra']);
}

// Lille SMTP-klient: STARTTLS, AUTH LOGIN, MAIL FROM, RCPT TO og DATA. Kaster en fejl med serverens svar, hvis noget går galt.
function smtp_send(array $s, string $fra, string $til, string $data): void {
    $f = @stream_socket_client("tcp://{$s['vaert']}:" . ($s['port'] ?? 587), $nr, $besked, 20);
    if (!$f) throw new RuntimeException("Kan ikke forbinde til {$s['vaert']}: $besked");
    stream_set_timeout($f, 20);
    $laes = function () use ($f): string {
        $svar = '';
        while (($l = fgets($f, 1024)) !== false) { $svar .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; }
        return $svar;
    };
    // $navn står i fejlbeskeden i stedet for selve kommandoen, så brugernavn og adgangskode aldrig havner i loggen
    $kald = function (?string $kommando, array $ok, ?string $navn = null) use ($f, $laes): string {
        if ($kommando !== null) fwrite($f, $kommando . "\r\n");
        $svar = $laes();
        if (!in_array((int)substr($svar, 0, 3), $ok, true)) throw new RuntimeException(trim(($navn ?? strtok($kommando ?? 'hilsen', ' ')) . ': ' . $svar));
        return $svar;
    };
    try {
        $kald(null, [220]);
        $kald('EHLO sagsvagt.dk', [250]);
        if ($s['tls'] ?? true) {
            $kald('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($f, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('TLS kunne ikke startes');
            $kald('EHLO sagsvagt.dk', [250]);
        }
        $kald('AUTH LOGIN', [334]);
        $kald(base64_encode($s['bruger']), [334], 'login (brugernavn)');
        $kald(base64_encode($s['adgangskode']), [235], 'login (adgangskode)');
        $kald("MAIL FROM:<$fra>", [250]);
        $kald("RCPT TO:<$til>", [250, 251]);
        $kald('DATA', [354]);
        // Linjer, der starter med punktum, fordobles (SMTP), og mailen afsluttes med en linje med ét punktum
        $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
        $kald(rtrim($data, "\r\n") . "\r\n.", [250], 'DATA (selve mailen)');
        fwrite($f, "QUIT\r\n");
    } finally {
        fclose($f);
    }
}

// Mail med Sagsvagts udseende og én knap
function mail_skabelon(string $overskrift, string $tekst, string $knap, string $link, string $fod): array {
    $e = fn($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $html = '<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
      . '<body style="margin:0;padding:0;background:#E6DFD3;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#E6DFD3"><tr><td align="center" style="padding:24px 12px 40px;">'
      . '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#EEE8DE;border-radius:10px;overflow:hidden;">'
      . '<tr><td bgcolor="#0E0F14" style="background:#0E0F14;background-image:linear-gradient(115deg,#28377A 0%,#0C1430 30%,#0E0F14 55%,#3E0E14 80%,#8A2430 100%);padding:20px 28px;font:700 22px Montserrat,Arial,sans-serif;color:#E6DFD3;">Sagsvagt</td></tr>'
      . '<tr><td style="padding:28px 28px 8px;"><h1 style="margin:0 0 12px;font:600 24px/1.2 Georgia,serif;color:#0E0F14;">' . $e($overskrift) . '</h1>'
      . '<p style="margin:0 0 22px;font:16px/1.6 Georgia,serif;color:#3E3B40;">' . nl2br($e($tekst)) . '</p>'
      . '<a href="' . $e($link) . '" style="display:inline-block;background:#0E0F14;color:#E6DFD3;font:700 15px Arial,sans-serif;text-decoration:none;padding:13px 24px;border-radius:99px;">' . $e($knap) . '</a>'
      . '<p style="margin:22px 0 0;font:13px/1.5 Arial,sans-serif;color:#56535A;">Virker knappen ikke, så kopiér linket:<br><span style="word-break:break-all;">' . $e($link) . '</span></p></td></tr>'
      . '<tr><td style="padding:20px 28px 24px;font:12px/1.6 Arial,sans-serif;color:#56535A;">' . $e($fod) . '<br>Sagsvagt · CVR 46841514 · Ørestads Boulevard 59C, 2. 226, 2300 København S</td></tr>'
      . '</table></td></tr></table></body></html>';
    return [$html, "$overskrift\n\n$tekst\n\n$knap: $link\n\n--\n$fod\nSagsvagt · CVR 46841514"];
}
