<?php
// Push-beskeder til appen (Min avis på hjemmeskærmen): nøgler, kryptering og udsendelse.
// Web Push uden eksterne biblioteker: beskeden krypteres efter RFC 8291 (aes128gcm), og serveren viser,
// hvem den er, med en VAPID-signatur (RFC 8292). Nøglerne laves første gang og gemmes i databasen.
// Udsendelsen er slået fra, indtil redaktionen slår den til i admin (Tilmeldte → Push-beskeder).
declare(strict_types=1);
require_once __DIR__ . '/_bootstrap.php';

const PUSH_KONTAKT = 'mailto:mansa@sagsvagt.dk';

function b64u_enc(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); }

// ---------- Tabeller og indstillinger ----------
function push_db(): PDO {
    static $klar = false;
    $db = db();
    if ($klar) return $db;
    $id = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $db->exec("CREATE TABLE IF NOT EXISTS push_abonnementer (
        id $id, abonnent_id INT NOT NULL, endpoint_hash CHAR(64) NOT NULL UNIQUE, endpoint VARCHAR(1000) NOT NULL,
        p256dh VARCHAR(200) NOT NULL, auth VARCHAR(60) NOT NULL, oprettet VARCHAR(25) NOT NULL, sidst_sendt VARCHAR(25) NULL, fejl INT NOT NULL DEFAULT 0)");
    $db->exec("CREATE TABLE IF NOT EXISTS push_indstillinger (noegle VARCHAR(50) NOT NULL PRIMARY KEY, vaerdi TEXT NOT NULL)");
    $db->exec("CREATE TABLE IF NOT EXISTS push_set (sag_id VARCHAR(190) NOT NULL PRIMARY KEY)");
    $klar = true;
    return $db;
}
function push_hent(string $n, ?string $std = null): ?string {
    $q = push_db()->prepare('SELECT vaerdi FROM push_indstillinger WHERE noegle = ?'); $q->execute([$n]);
    $v = $q->fetchColumn();
    return $v === false ? $std : (string)$v;
}
function push_saet(string $n, string $v): void {
    $db = push_db();
    $u = $db->prepare('UPDATE push_indstillinger SET vaerdi = ? WHERE noegle = ?'); $u->execute([$v, $n]);
    if ($u->rowCount() === 0 && push_hent($n) === null) $db->prepare('INSERT INTO push_indstillinger (noegle, vaerdi) VALUES (?, ?)')->execute([$n, $v]);
}
function push_aktiv(): bool { return push_hent('aktiv', '0') === '1'; }

// ---------- VAPID-nøgler ----------
// Rå offentlig nøgle (65 byte, 0x04 || x || y) ud fra en OpenSSL-nøgle
function ec_raa_offentlig($noegle): string {
    $d = openssl_pkey_get_details($noegle)['ec'];
    return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}
// En rå offentlig P-256-nøgle som PEM, så OpenSSL kan bruge den
function ec_pem_fra_raa(string $raa) {
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raa;
    return openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n");
}
function ny_ec_noegle() {
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$k) throw new RuntimeException('Kan ikke lave en nøgle: ' . openssl_error_string());
    return $k;
}
// Serverens nøglepar; laves første gang og gemmes i databasen
function vapid(): array {
    $privat = push_hent('vapid_privat');
    if (!$privat) {
        $k = ny_ec_noegle();
        openssl_pkey_export($k, $privat);
        push_saet('vapid_privat', $privat);
        push_saet('vapid_offentlig', b64u_enc(ec_raa_offentlig($k)));
    }
    return ['privat' => $privat, 'offentlig' => (string)push_hent('vapid_offentlig')];
}

// VAPID: en kort JWT, signeret med ES256 (OpenSSL giver DER; JWT vil have r || s på 2 × 32 byte)
function vapid_hoved(string $endpoint): string {
    $v = vapid();
    $u = parse_url($endpoint);
    $data = b64u_enc('{"typ":"JWT","alg":"ES256"}') . '.' . b64u_enc(json_encode(['aud' => $u['scheme'] . '://' . $u['host'], 'exp' => time() + 12 * 3600, 'sub' => PUSH_KONTAKT], JSON_UNESCAPED_SLASHES));
    openssl_sign($data, $der, $v['privat'], OPENSSL_ALGO_SHA256);
    $pos = 2; $hel = function () use ($der, &$pos) { $l = ord($der[$pos + 1]); $x = substr($der, $pos + 2, $l); $pos += 2 + $l; return str_pad(ltrim($x, "\0"), 32, "\0", STR_PAD_LEFT); };
    $sig = $hel() . $hel();
    return 'vapid t=' . $data . '.' . b64u_enc($sig) . ', k=' . $v['offentlig'];
}

// ---------- Kryptering (RFC 8291, aes128gcm) ----------
function push_krypter(string $tekst, string $ua_offentlig_b64, string $auth_b64): string {
    $ua = b64u_dec($ua_offentlig_b64); $auth = b64u_dec($auth_b64);
    if (strlen($ua) !== 65 || strlen($auth) !== 16) throw new InvalidArgumentException('Ugyldigt abonnement');
    $as = ny_ec_noegle(); $as_raa = ec_raa_offentlig($as);
    $faelles = openssl_pkey_derive(ec_pem_fra_raa($ua), $as, 32);
    $prk_noegle = hash_hmac('sha256', $faelles, $auth, true);
    $ikm = hash_hmac('sha256', "WebPush: info\0" . $ua . $as_raa . "\x01", $prk_noegle, true);
    $salt = random_bytes(16);
    $prk = hash_hmac('sha256', $ikm, $salt, true);
    $cek = substr(hash_hmac('sha256', "Content-Encoding: aes128gcm\0\x01", $prk, true), 0, 16);
    $nonce = substr(hash_hmac('sha256', "Content-Encoding: nonce\0\x01", $prk, true), 0, 12);
    $krypto = openssl_encrypt($tekst . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $as_raa . $krypto . $tag;
}

// Sender én besked. Svarer med HTTP-koden fra push-tjenesten (201 = modtaget, 404/410 = abonnementet findes ikke mere)
function push_send(array $ab, array $besked): int {
    $krop = push_krypter(json_encode($besked, JSON_UNESCAPED_UNICODE), $ab['p256dh'], $ab['auth']);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'ignore_errors' => true, 'timeout' => 15,
        'header' => "Content-Type: application/octet-stream\r\nContent-Encoding: aes128gcm\r\nTTL: 86400\r\nUrgency: normal\r\n"
                  . 'Authorization: ' . vapid_hoved($ab['endpoint']) . "\r\nContent-Length: " . strlen($krop) . "\r\n",
        'content' => $krop,
    ]]);
    @file_get_contents($ab['endpoint'], false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $l) if (preg_match('~^HTTP/\S+\s+(\d{3})~', $l, $m)) $status = (int)$m[1];
    return $status;
}

// Sender til alle én abonnents enheder; fjerner abonnementer, som push-tjenesten siger er væk
function push_til_abonnent(int $abonnent_id, array $besked): array {
    $db = push_db(); $ok = 0; $fejl = 0;
    $q = $db->prepare('SELECT * FROM push_abonnementer WHERE abonnent_id = ?'); $q->execute([$abonnent_id]);
    foreach ($q->fetchAll() as $ab) {
        try { $s = push_send($ab, $besked); } catch (Throwable $e) { $s = 0; }
        if ($s >= 200 && $s < 300) { $ok++; $db->prepare('UPDATE push_abonnementer SET sidst_sendt = ?, fejl = 0 WHERE id = ?')->execute([nu(), $ab['id']]); }
        elseif ($s === 404 || $s === 410) { $db->prepare('DELETE FROM push_abonnementer WHERE id = ?')->execute([$ab['id']]); }
        else { $fejl++; $db->prepare('UPDATE push_abonnementer SET fejl = fejl + 1 WHERE id = ?')->execute([$ab['id']]); }
    }
    return ['sendt' => $ok, 'fejl' => $fejl];
}

// ---------- Udsendelse efter nye sager ----------
// Kaldes efter besøg (api/besoeg.php), så den kører kort efter, at robotten har lagt nye sager op.
// Sager, der ikke er set før, bliver husket; er udsendelsen slået fra, huskes de bare, så der ikke kommer
// en lavine af gamle sager, når den slås til. Hver abonnent får højst én besked pr. opdatering.
function push_maaske_koer(bool $tving = false): array {
    $fil = dirname(__DIR__) . '/assets/sager.json';
    $mtime = (string)@filemtime($fil);
    if (!$mtime || (!$tving && push_hent('sager_mtime') === $mtime)) return ['koert' => false];
    // Lås, så to samtidige besøg ikke sender to gange
    $db = push_db(); $nu = time();
    if (push_hent('laas') === null) push_saet('laas', '0');
    $l = $db->prepare('UPDATE push_indstillinger SET vaerdi = ? WHERE noegle = ? AND CAST(vaerdi AS INTEGER) < ?');
    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite') $l = $db->prepare('UPDATE push_indstillinger SET vaerdi = ? WHERE noegle = ? AND CAST(vaerdi AS UNSIGNED) < ?');
    $l->execute([(string)($nu + 120), 'laas', $nu]);
    if ($l->rowCount() === 0) return ['koert' => false, 'laast' => true];
    try {
        @set_time_limit(90);
        $data = json_decode((string)file_get_contents($fil), true);
        $sager = $data['sager'] ?? [];
        $kendte = array_flip($db->query('SELECT sag_id FROM push_set')->fetchAll(PDO::FETCH_COLUMN));
        $foerste = !$kendte;
        $nye = array_values(array_filter($sager, fn($s) => !isset($kendte[$s['id']])));
        $ins = $db->prepare('INSERT INTO push_set (sag_id) VALUES (?)');
        foreach ($nye as $s) { try { $ins->execute([$s['id']]); } catch (PDOException $e) {} }
        push_saet('sager_mtime', $mtime);
        // Første gang og mens udsendelsen er slået fra, huskes sagerne kun
        if ($foerste || !push_aktiv() || !$nye) return ['koert' => true, 'nye' => count($nye), 'sendt' => 0, 'aktiv' => push_aktiv()];
        // Kun nye sager fra den seneste måned, og ikke rutinesager
        $graense = gmdate('Y-m-d', time() - 30 * 86400);
        $nye = array_values(array_filter($nye, fn($s) => ($s['dato'] ?? '') >= $graense && empty($s['r'])));
        $modtagere = $db->query("SELECT DISTINCT a.id, a.profil FROM push_abonnementer p JOIN abonnenter a ON a.id = p.abonnent_id WHERE a.status = 'aktiv'")->fetchAll();
        $sendt = 0;
        foreach ($modtagere as $m) {
            $hits = push_match($nye, json_decode((string)$m['profil'], true) ?: []);
            if (!$hits) continue;
            $n = count($hits);
            $r = push_til_abonnent((int)$m['id'], [
                'title' => $n === 1 ? 'Ny sag om det, du følger' : "$n nye sager om det, du følger",
                'body' => $hits[0]['t'] . ($n > 1 ? ' og ' . ($n - 1) . ($n === 2 ? ' sag mere' : ' sager mere') : ''),
                'url' => '/min/#sager', 'tag' => 'sagsvagt-nye',
            ]);
            $sendt += $r['sendt'];
        }
        return ['koert' => true, 'nye' => count($nye), 'modtagere' => count($modtagere), 'sendt' => $sendt, 'aktiv' => true];
    } finally {
        push_saet('laas', '0');
    }
}

// Sager, der passer til profilen: et af emnerne, et af de egne ord eller ens bydel (lokaludvalg). Nyeste først.
function push_match(array $sager, array $profil): array {
    $emner = $profil['emner'] ?? []; $ord = array_filter(array_map('mb_strtolower', $profil['ord'] ?? [])); $bydel = $profil['bydel'] ?? '';
    $hits = array_filter($sager, function ($s) use ($emner, $ord, $bydel) {
        if (array_intersect($emner, $s['e'] ?? [])) return true;
        if ($bydel !== '' && ($s['u'] ?? '') === $bydel) return true;
        $tekst = mb_strtolower(($s['t'] ?? '') . ' ' . ($s['d'] ?? ''));
        foreach ($ord as $o) if ($o !== '' && str_contains($tekst, $o)) return true;
        return false;
    });
    usort($hits, fn($a, $b) => strcmp($b['dato'] ?? '', $a['dato'] ?? ''));
    return array_values($hits);
}
