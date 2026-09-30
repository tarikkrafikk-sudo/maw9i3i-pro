<?php
/**
 * pay/success.php
 * -----------------------------------------------------------------------
 * صفحة "نجاح" الأداء — للعرض فقط. التفعيل الحقيقي ديال الدفعة كيتم فـ
 * webhook.php. هنا غير كنبينو للزبون حالة الطلب، ونستنّاو (JS polling)
 * إلا كان الـ webhook توصل قبل ما يبان الصفحة، باش ما نبقاوش نديرو "قيد
 * التأكيد" بلا داعي.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

$orderId = trim((string) ($_GET['order_id'] ?? ''));

$payment = null;
if ($orderId !== '') {
    $stmt = db()->prepare('SELECT * FROM payments WHERE order_id = :order_id LIMIT 1');
    $stmt->execute(['order_id' => $orderId]);
    $payment = $stmt->fetch() ?: null;
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تم الأداء بنجاح — MAW9I3I.PRO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=Cairo:wght@700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--gold-light:#e8c96a;--black:#0a0a0a}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0%, #1a1a1a, var(--black) 60%);
       color:#f5f5f5;font-family:'Tajawal',Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
  .wrap{max-width:460px;width:100%;text-align:center}
  .badge{width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-light));
         display:flex;align-items:center;justify-content:center;margin:0 auto 22px;font-size:42px;color:#111;
         box-shadow:0 0 40px rgba(212,175,55,.35)}
  h1{font-family:'Cairo',sans-serif;font-size:26px;color:var(--gold);margin:0 0 10px}
  .sub{color:#bbb;font-size:15px;line-height:1.8;margin-bottom:26px}
  .card{background:#141414;border:1px solid rgba(212,175,55,.3);border-radius:14px;padding:22px;text-align:right;margin-bottom:22px}
  .row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-bottom:1px solid rgba(255,255,255,.06)}
  .row:last-child{border-bottom:none}
  .row .k{color:#888}
  .row .v{color:#f0f0f0;font-weight:700}
  .status-pill{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700}
  .status-paid{background:rgba(72,199,116,.15);color:#48c774}
  .status-pending{background:rgba(212,175,55,.15);color:var(--gold)}
  .btn{display:inline-block;width:100%;padding:14px;border-radius:10px;font-weight:800;text-decoration:none;margin-top:8px}
  .btn-gold{background:var(--gold);color:#111}
  .btn-outline{border:1px solid rgba(255,255,255,.2);color:#f5f5f5}
  .note{color:#666;font-size:13px;margin-top:18px;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">✓</div>
  <h1>تم الأداء بنجاح</h1>
  <p class="sub">شكرا ليك على ثقتك فـ MAW9I3I.PRO. <strong>سيتواصل معك فريقنا خلال ساعة</strong> باش نبداو الخدمة.</p>

  <?php if ($payment): ?>
  <div class="card">
    <div class="row"><span class="k">رقم الطلب</span><span class="v"><?= h($payment['order_id']) ?></span></div>
    <div class="row"><span class="k">المبلغ المؤدى</span><span class="v"><?= h(number_format((float) $payment['amount_dh'], 2)) ?> DH</span></div>
    <div class="row"><span class="k">الحالة</span><span class="v">
      <span id="status-pill" class="status-pill <?= $payment['status'] === 'paid' ? 'status-paid' : 'status-pending' ?>">
        <?= $payment['status'] === 'paid' ? 'مؤكدة ✓' : 'قيد التأكيد...' ?>
      </span>
    </span></div>
  </div>
  <?php endif; ?>

  <a class="btn btn-gold" href="https://wa.me/<?= h(ADMIN_WHATSAPP_NUMBER) ?>?text=<?= urlencode('سلام، خلصت طلبي رقم ' . ($payment['order_id'] ?? '')) ?>" target="_blank" rel="noopener">تواصل معانا فالواتساب 📱</a>
  <a class="btn btn-outline" href="<?= h(SITE_URL) ?>/">الرجوع للموقع</a>

  <p class="note">إلا ما توصلتيش برسالة تأكيد ديال البريد فقريب، تأكد من مجلد السبام، أو تواصل معانا مباشرة.</p>
</div>

<?php if ($payment && $payment['status'] !== 'paid'): ?>
<script>
  // نتأكدو كل 3 ثواني (10 مرات) واش الـ webhook وصل وبدل الحالة لـ "مؤكدة"
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    fetch('status.php?order_id=<?= urlencode($payment['order_id']) ?>')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'paid') {
          var pill = document.getElementById('status-pill');
          pill.textContent = 'مؤكدة ✓';
          pill.className = 'status-pill status-paid';
          clearInterval(timer);
        } else if (data.status === 'failed' || tries >= 10) {
          clearInterval(timer);
        }
      }).catch(function () { clearInterval(timer); });
  }, 3000);
</script>
<?php endif; ?>
</body>
</html>
