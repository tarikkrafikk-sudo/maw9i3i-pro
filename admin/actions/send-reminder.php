<?php
/**
 * admin/actions/send-reminder.php
 * كيبعث تذكير تجديد للزبون ديال L-KRA (بالإيميل مباشرة + رابط واتساب جاهز).
 */

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../includes/functions.php';
require_once __DIR__ . '/../../includes/auth.php';

admin_require_login();

$subId = (int) ($_GET['subscription_id'] ?? 0);
$pdo = db();

$stmt = $pdo->prepare('
    SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    WHERE s.id = :id LIMIT 1
');
$stmt->execute(['id' => $subId]);
$sub = $stmt->fetch();

if (!$sub) {
    http_response_code(404);
    die('الاشتراك غير موجود.');
}

$expireLabel = $sub['expire_date'] ?? 'غير محدد';

$waMessage = "سلام {$sub['customer_name']} 👋\n"
    . "كنذكروك أن اشتراكك (Pack L-KRA) غادي ينتهي فـ {$expireLabel}.\n"
    . "باش يبقى موقعك خدام بلا انقطاع، جدد الاشتراك (199 DH/الشهر) من هنا:\n"
    . SITE_URL . '/#packs';

$waLink = whatsapp_link($sub['customer_phone'], $waMessage);

// إرسال إيميل تذكير مباشرة من اللوحة
$emailSent = send_email($sub['customer_email'], 'تذكير: تجديد اشتراك موقعك — Pack L-KRA', email_template(
    'تذكير بالتجديد ⏰',
    '<p>سلام ' . h($sub['customer_name']) . '،</p>
     <p>اشتراكك غادي ينتهي فـ <strong>' . h($expireLabel) . '</strong>.</p>
     <p>جدد دابا باش يبقى موقعك خدام بلا انقطاع (199 DH/الشهر).</p>
     <p><a href="' . h(SITE_URL) . '/#packs" style="color:#D4AF37">جدد الاشتراك</a></p>'
));

$upd = $pdo->prepare('UPDATE subscriptions SET renewal_reminder_sent_at = NOW() WHERE id = :id');
$upd->execute(['id' => $subId]);
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تذكير تجديد — MAW9I3I.PRO</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a}
  body{margin:0;background:var(--black);color:#f0f0f0;font-family:'Tajawal',Arial,sans-serif;padding:30px}
  .wrap{max-width:520px;margin:0 auto}
  h1{color:var(--gold);font-size:19px}
  .card{background:#141414;border:1px solid rgba(212,175,55,.25);border-radius:12px;padding:20px;margin-bottom:16px}
  .ok{color:#48c774;font-size:14px;margin-bottom:14px}
  textarea{width:100%;min-height:110px;background:#1c1c1c;border:1px solid #333;color:#fff;border-radius:8px;padding:10px;font-family:inherit;font-size:13px}
  .btn{display:inline-block;padding:12px 18px;border-radius:9px;font-weight:800;text-decoration:none;margin-top:10px;background:var(--gold);color:#111}
  a.back{color:#888;font-size:13px;display:inline-block;margin-top:20px}
</style>
</head>
<body>
<div class="wrap">
  <h1>تذكير تجديد — <?= h($sub['customer_name']) ?></h1>
  <div class="card">
    <p class="ok"><?= $emailSent ? '✓ تم إرسال إيميل التذكير.' : '⚠ ما تصيفطش الإيميل (تحقق من إعدادات mail() فالاستضافة).' ?></p>
    <label style="display:block;color:#999;font-size:12px;margin-bottom:6px">رسالة واتساب جاهزة</label>
    <textarea readonly onclick="this.select()"><?= h($waMessage) ?></textarea>
    <a class="btn" href="<?= h($waLink) ?>" target="_blank" rel="noopener">فتح فواتساب وإرسال 📱</a>
  </div>
  <a class="back" href="../index.php">← الرجوع للوحة التحكم</a>
</div>
</body>
</html>
