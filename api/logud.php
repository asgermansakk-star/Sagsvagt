<?php
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

kraev_post();
start_session();
$_SESSION = [];
$p = session_get_cookie_params();
setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => $p['samesite']]);
session_destroy();
svar(200, ['ok' => true]);
