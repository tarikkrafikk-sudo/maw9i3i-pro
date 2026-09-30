<?php
/**
 * pay/csrf.php
 * -----------------------------------------------------------------------
 * الصفحة الرئيسية (index.html) صفحة HTML ثابتة (ماشي PHP)، فهاد الحالة
 * ماعندناش طريقة نولدو ليها رمز CSRF من السيرفر مباشرة. هاد الملف كيرجع
 * رمز CSRF جاهز (JSON) + كيبدا جلسة PHP فمتصفح الزبون، باش نقدرو
 * نتحققو منه من بعد فـ checkout.php.
 *
 * كيتقرا عبر JavaScript (assets/payment-modal.js) قبل ما نفتحو المودال.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

header('Access-Control-Allow-Origin: ' . SITE_URL);
header('Access-Control-Allow-Credentials: true');

json_response(['csrf_token' => csrf_token()]);
