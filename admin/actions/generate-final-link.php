<?php
/**
 * admin/actions/generate-final-link.php
 * كيولد رابط أداء الـ70% الباقية + رسالة واتساب جاهزة للنسخ/الإرسال المباشر.
 */

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../includes/functions.php';
require_once __DIR__ . '/../../includes/auth.php';

admin_require_login();

$paymentId = (int) ($_GET['payment_id'] ?? 0);
$pdo = db();

$stmt = $pdo->prepare('
    SELECT p.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM payments p JOIN customers c ON c.id = p.customer_id
    WHERE p.id = :id AND p.payment_type = "deposit_30" AND p.status = "paid"
    LIMIT 1
');
$stmt->execute(['id' => $paymentId]);
$deposit = $stmt->fetch();

if (!$deposit) {
    http_response_code(404);
    die('الدفعة غير موجودة أو ماشي 30% مؤدّاة.');
}

$pack = get_pack($deposit['pack_slug']);
$link = build_final_payment_link($paymentId);

$waMessage = "سلام {$deposit['customer_name']} 👋\n"
    . "شكرا على ثقتك فـ MAW9I3I.PRO 🙏\n"
    . "مشروعك \"{$pack['name']}\" وصل لمرحلة التسليم.\n"
    . "باقي عليك أداء الـ70% المتبقية (" . number_format((float) $pack['final_price'], 2) . " DH) باش نسلموك الموقع:\n"
    . $link;

$waLink = whatsapp_link($deposit['customer_phone'], $waMessage);
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>رابط أداء 70% — MAW9I3I.PRO</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a}
  body{margin:0;background:var(--black);color:#f0f0f0;font-family:'Tajawal',Arial,sans-serif;padding:30px}
  .wrap{max-width:560px;margin:0 auto}
  h1{color:var(--gold);font-size:19px}
  .card{background:#141414;border:1px solid rgba(212,175,55,.25);border-radius:12px;padding:20px;margin-bottom:16px}
  label{display:block;color:#999;font-size:12px;margin-bottom:6px}
  textarea,input{width:100%;background:#1c1c1c;border:1px solid #333;color:#fff;border-radius:8px;padding:10px;font-family:inherit;font-size:13px}
  textarea{min-height:130px;resize:vertical}
  .btn{display:inline-block;padding:12px 18px;border-radius:9px;font-weight:800;text-decoration:none;margin-top:10px;margin-left:8px}
  .btn-gold{background:var(--gold);color:#111}
  .btn-outline{border:1px solid #444;color:#eee}
  a.back{color:#888;font-size:13px;display:inline-block;margin-top:20px}
</style>
</head>
<body>
<div class="wrap">
  <h1>رابط أداء 70% الباقية</h1>
  <div class="card">
    <label>الزبون</label>
    <p><?= h($deposit['customer_name']) ?> — <?= h($deposit['customer_email']) ?> — <span dir="ltr"><?= h($deposit['customer_phone']) ?></span></p>
    <label>رابط الأداء</label>
    <input type="text" readonly value="<?= h($link) ?>" onclick="this.select()">
    <label style="margin-top:14px">رسالة واتساب جاهزة</label>
    <textarea readonly onclick="this.select()"><?= h($waMessage) ?></textarea>
    <div>
      <a class="btn btn-gold" href="<?= h($waLink) ?>" target="_blank" rel="noopener">فتح فواتساب وإرسال 📱</a>
      <a class="btn btn-outline" href="<?= h($link) ?>" target="_blank" rel="noopener">معاينة رابط الأداء</a>
    </div>
  </div>
  <a class="back" href="../index.php">← الرجوع للوحة التحكم</a>
</div>
</body>
</html>
