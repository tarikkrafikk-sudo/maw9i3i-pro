<?php
/**
 * config/config.php
 * -----------------------------------------------------------------------
 * كيقرا ملف .env ويحدد الثوابت ديال المشروع (قاعدة البيانات، YouCan Pay، الموقع).
 * Charge le fichier .env et définit toutes les constantes globales du projet.
 *
 * هاد الملف خاصو يتدرج (require_once) فراس كل صفحة PHP قبل أي حاجة أخرى.
 * -----------------------------------------------------------------------
 */

// ما نعرضوش الأخطاء للزوار (أمان) — كنسجلوهم فملف log عوض ذلك
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

define('ROOT_PATH', dirname(__DIR__));
ini_set('error_log', ROOT_PATH . '/storage/error.log');

// نتأكدو أن مجلد storage/ كاين (للـ logs)
if (!is_dir(ROOT_PATH . '/storage')) {
    @mkdir(ROOT_PATH . '/storage', 0755, true);
}

/**
 * قارئ .env بسيط بلا Composer — باش الملفات يبقاو خفاف ويتبعتو بالـ FTP بلا مشاكل.
 * Simple .env parser (no Composer dependency needed).
 */
function maw9i3i_load_env(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value);

        // كنحيدو '' أو "" إلا كانت محيطة بالقيمة
        if (strlen($value) >= 2) {
            $first = $value[0];
            $last  = $value[strlen($value) - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $value = substr($value, 1, -1);
            }
        }

        if ($key === '') {
            continue;
        }
        putenv("{$key}={$value}");
        $_ENV[$key]    = $value;
        $_SERVER[$key] = $value;
    }
}

maw9i3i_load_env(ROOT_PATH . '/.env');

/**
 * env() — كيرجع قيمة متغير من .env، أو القيمة الافتراضية $default إلا ماكانتش موجودة.
 */
function env(string $key, $default = null)
{
    $value = $_ENV[$key] ?? getenv($key);
    if ($value === false || $value === null) {
        return $default;
    }
    // تحويل النصوص الشائعة لـ boolean حقيقي
    $lower = strtolower((string) $value);
    if (in_array($lower, ['true', '(true)'], true)) {
        return true;
    }
    if (in_array($lower, ['false', '(false)'], true)) {
        return false;
    }
    if ($lower === 'null' || $lower === '(null)') {
        return null;
    }
    return $value;
}

// -----------------------------------------------------------------------
// قاعدة البيانات — Database
// -----------------------------------------------------------------------
define('DB_HOST', env('DB_HOST', 'localhost'));
define('DB_PORT', env('DB_PORT', '3306'));
define('DB_NAME', env('DB_NAME', 'maw9i3i_payments'));
define('DB_USER', env('DB_USER', 'root'));
define('DB_PASS', env('DB_PASS', ''));
define('DB_CHARSET', 'utf8mb4');

// -----------------------------------------------------------------------
// الموقع — Site
// -----------------------------------------------------------------------
define('SITE_URL', rtrim((string) env('SITE_URL', 'https://www.maw9i3i-pro.com'), '/'));
define('SITE_NAME', 'MAW9I3I.PRO');
define('ADMIN_EMAIL', env('ADMIN_EMAIL', 'contact@maw9i3i-pro.com'));
define('ADMIN_WHATSAPP_NUMBER', env('ADMIN_WHATSAPP_NUMBER', '212695062076'));
define('MAIL_FROM', env('MAIL_FROM', 'no-reply@maw9i3i-pro.com'));
define('MAIL_FROM_NAME', env('MAIL_FROM_NAME', 'MAW9I3I.PRO'));

// -----------------------------------------------------------------------
// YouCan Pay — https://developer.youcan.shop/youcan-pay
// -----------------------------------------------------------------------
define('YOUCAN_PRIVATE_KEY', env('YOUCAN_PRIVATE_KEY', ''));
define('YOUCAN_PUBLIC_KEY', env('YOUCAN_PUBLIC_KEY', ''));
define('YOUCAN_SANDBOX', (bool) env('YOUCAN_SANDBOX', true));
define('YOUCAN_CURRENCY', 'MAD');

// -----------------------------------------------------------------------
// لوحة التحكم — Admin panel
// -----------------------------------------------------------------------
define('ADMIN_USERNAME', env('ADMIN_USERNAME', 'admin'));
define('ADMIN_PASSWORD', env('ADMIN_PASSWORD', '')); // نص عادي أو bcrypt hash (يبدا بـ $2y$)
define('ADMIN_SESSION_NAME', 'maw9i3i_admin_session');

// -----------------------------------------------------------------------
// CRON
// -----------------------------------------------------------------------
define('CRON_SECRET', env('CRON_SECRET', ''));

// -----------------------------------------------------------------------
// مفتاح سري داخلي (لتوقيع روابط أداء الـ70% الباقية...) — غير YOUCAN_PRIVATE_KEY
// -----------------------------------------------------------------------
define('APP_SECRET', env('APP_SECRET', '') ?: hash('sha256', DB_NAME . ADMIN_USERNAME . 'maw9i3i-fallback-secret'));

// المنطقة الزمنية ديال المغرب
date_default_timezone_set('Africa/Casablanca');
