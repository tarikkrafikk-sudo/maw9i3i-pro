<?php
/**
 * pay/fail.php
 * -----------------------------------------------------------------------
 * صفحة فشل الأداء — كتعطي للزبون إمكانية إعادة المحاولة أو التواصل مباشرة.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

$orderId = trim((string) ($_GET['order_id'] ?? ''));
$packSlug = null;

if ($orderId !== '') {
    $stmt = db()->prepare('SELECT pack_slug FROM payments WHERE order_id = :order_id LIMIT 1');
    $stmt->execute(['order_id' => $orderId]);
    $row = $stmt->fetch();
    $packSlug = $row['pack_slug'] ?? null;
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>لم تتم عملية الأداء — MAW9I3I.PRO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=Cairo:wght@700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--black);color:#f5f5f5;font-family:'Tajawal',Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;padding:20px}
  .wrap{max-width:440px;width:100%;text-align:center}
  .badge{width:88px;height:88px;border-radius:50%;background:#2a1414;border:2px solid #e05252;
         display:flex;align-items:center;justify-content:center;margin:0 auto 22px;font-size:40px;color:#e05252}
  h1{font-family:'Cairo',sans-serif;font-size:24px;color:#f0f0f0;margin:0 0 10px}
  .sub{color:#aaa;font-size:15px;line-height:1.8;margin-bottom:28px}
  .btn{display:block;width:100%;padding:14px;border-radius:10px;font-weight:800;text-decoration:none;margin-top:10px}
  .btn-gold{background:var(--gold);color:#111}
  .btn-outline{border:1px solid rgba(255,255,255,.2);color:#f5f5f5}
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">✕</div>
  <h1>لم تتم عملية الأداء</h1>
  <p class="sub">صرا مشكل فعملية الأداء ولا لغيتيها. ما تقلقش، ما تخصمش عليك أي فلوس. جرب مرة أخرى أو تواصل معانا مباشرة.</p>

  <a class="btn btn-gold" href="<?= h(SITE_URL) ?>/#packs">إعادة المحاولة 🔁</a>
  <a class="btn btn-outline" href="https://wa.me/<?= h(ADMIN_WHATSAPP_NUMBER) ?>?text=<?= urlencode('سلام، صرا ليا مشكل فعملية الأداء' . ($packSlug ? ' ديال ' . $packSlug : '') . '، بغيت مساعدة.') ?>" target="_blank" rel="noopener">تواصل معانا فالواتساب 📱</a>
</div>
</body>
</html>
