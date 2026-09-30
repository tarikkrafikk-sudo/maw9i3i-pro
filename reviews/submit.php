<?php
/**
 * reviews/submit.php
 * -----------------------------------------------------------------------
 * استقبال رأي جديد من زوار الموقع (الاسم، النجوم، التعليق). كل رأي كيتسجل
 * "pending" وما كيبانش فالموقع حتى تصادق عليه من /admin/reviews.php —
 * هادشي باش نمنعو السبام أو تعليقات مسيئة.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

// ملاحظة: 'message' هنا بالعربية غير كـ fallback/للـ logs. الواجهة (reviews.js)
// كتبني الرسالة المعروضة للزائر بلغة الصفحة انطلاقا من 'code'، ماشي من 'message'.

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'code' => 'invalid_request', 'message' => 'طلب غير صالح.'], 405);
}

if (!csrf_verify($_POST['csrf_token'] ?? null)) {
    json_response(['ok' => false, 'code' => 'invalid_csrf', 'message' => 'انتهت صلاحية الجلسة. عاود تحميل الصفحة وجرب مرة أخرى.'], 400);
}

// Honeypot: حقل مخفي بـ CSS، الزوار الحقيقيين ما كيعمروه، البوتات كيعمروه غالبا
if (trim((string) ($_POST['website'] ?? '')) !== '') {
    // نرجعو نجاح مزيف باش ما نعطيوش للبوت معلومة أنو تعرف عليه
    json_response(['ok' => true, 'code' => 'success', 'message' => 'شكرا ليك!']);
}

$name    = trim((string) ($_POST['name'] ?? ''));
$rating  = (int) ($_POST['rating'] ?? 0);
$comment = trim((string) ($_POST['comment'] ?? ''));
$pack    = trim((string) ($_POST['pack_slug'] ?? ''));

if ($name === '' || mb_strlen($name) > 150) {
    json_response(['ok' => false, 'code' => 'invalid_name', 'message' => 'خاصك تكتب الاسم ديالك.'], 400);
}
if ($rating < 1 || $rating > 5) {
    json_response(['ok' => false, 'code' => 'invalid_rating', 'message' => 'اختار تقييم من 1 إلى 5 نجوم.'], 400);
}
if (mb_strlen($comment) < 10) {
    json_response(['ok' => false, 'code' => 'comment_too_short', 'message' => 'خاص التعليق يكون 10 أحرف على الأقل.'], 400);
}
if (mb_strlen($comment) > 2000) {
    json_response(['ok' => false, 'code' => 'comment_too_long', 'message' => 'التعليق طويل بزاف (2000 حرف الأقصى).'], 400);
}

$validPackSlugs = ['bdaya', 'mo9awala', 'lkra'];
if ($pack !== '' && !in_array($pack, $validPackSlugs, true)) {
    $pack = null;
}
if ($pack === '') {
    $pack = null;
}

$ip = get_client_ip();
if (!review_rate_limit_ok($ip)) {
    json_response(['ok' => false, 'code' => 'rate_limited', 'message' => 'بعثتي رأي من قبل. تقدر تبعث رأي جديد بعد 24 ساعة.'], 429);
}

$stmt = db()->prepare('INSERT INTO reviews (customer_name, rating, comment, pack_slug, ip_address, status)
                        VALUES (:name, :rating, :comment, :pack, :ip, "pending")');
$stmt->execute([
    'name'    => $name,
    'rating'  => $rating,
    'comment' => $comment,
    'pack'    => $pack,
    'ip'      => $ip,
]);

$reviewId = db()->lastInsertId();

// إشعار للإدارة باش تصادق أو ترفض الرأي
send_email(ADMIN_EMAIL, '⭐ رأي جديد فالانتظار — ' . $name, email_template(
    'رأي جديد يحتاج مصادقة',
    '<p>' . h($name) . ' — ' . str_repeat('⭐', $rating) . ' (' . $rating . '/5)</p>
     <p>' . nl2br(h($comment)) . '</p>
     <p><a href="' . h(SITE_URL) . '/admin/reviews.php" style="color:#D4AF37">راجع الآراء فلوحة التحكم</a></p>'
));

json_response(['ok' => true, 'code' => 'success', 'message' => 'شكرا ليك! رأيك غادي يبان فالموقع من بعد ما نصادقو عليه.', 'id' => $reviewId]);
