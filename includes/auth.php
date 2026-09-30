<?php
/**
 * includes/auth.php
 * -----------------------------------------------------------------------
 * حماية بسيطة بكلمة سر للوحة التحكم /admin.
 * Protection par mot de passe simple pour le panneau admin.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/functions.php';

function admin_session_start(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_name(ADMIN_SESSION_NAME);
        session_start();
    }
}

function admin_is_logged_in(): bool
{
    admin_session_start();
    return !empty($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true;
}

/**
 * التحقق من كلمة السر: كتقبل نص عادي فملف .env، أو bcrypt hash (كيبدا بـ $2y$)
 * إلا بغيتي أمان زيادة.
 */
function admin_check_password(string $inputPassword): bool
{
    if (ADMIN_PASSWORD === '') {
        return false;
    }
    if (str_starts_with(ADMIN_PASSWORD, '$2y$') || str_starts_with(ADMIN_PASSWORD, '$argon2')) {
        return password_verify($inputPassword, ADMIN_PASSWORD);
    }
    return hash_equals(ADMIN_PASSWORD, $inputPassword);
}

/**
 * خاصها تندعى فراس كل صفحة admin محمية — كتردو لصفحة login إلا ماكانش داخل.
 */
function admin_require_login(): void
{
    admin_session_start();
    if (!admin_is_logged_in()) {
        header('Location: login.php');
        exit;
    }
    // تجديد بسيط لمدة الجلسة
    $_SESSION['last_activity'] = time();
}
