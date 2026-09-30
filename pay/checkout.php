<?php
/**
 * pay/checkout.php
 * -----------------------------------------------------------------------
 * نقطة البداية ديال كل عملية أداء:
 *   1) POST من المودال (index.html) → خطوة أداء جديدة (100% أو 30%، أو اشتراك L-KRA)
 *   2) GET ?final=ID&sig=... → أداء الـ70% الباقية (الرابط لي كيتولد من /admin)
 *
 * الخطوات: نحسبو المبلغ بالسنتيم → Tokenize عند YouCan Pay → نسجلو الدفعة
 * "pending" فقاعدة البيانات → نعرضو صفحة الأداء (ycpay.js المدمج).
 * التفعيل الحقيقي ديال أي دفعة كيتم فـ webhook.php غير — هادي مجرد بداية.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/YouCanPay.php';

$pdo = db();
$youcan = new YouCanPay(YOUCAN_PRIVATE_KEY, YOUCAN_PUBLIC_KEY, YOUCAN_SANDBOX);

/**
 * دالة صغيرة كتعرض رسالة خطأ بسيطة (بالتصميم ديال الموقع) وتوقف التنفيذ.
 */
function checkout_die(string $message): never
{
    http_response_code(400);
    echo '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
    <title>خطأ — MAW9I3I.PRO</title>
    <style>body{background:#0a0a0a;color:#f5f5f5;font-family:Tajawal,Arial,sans-serif;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
    .box{border:1px solid #D4AF37;padding:32px 40px;border-radius:10px;max-width:420px}
    a{color:#D4AF37}</style></head><body><div class="box">
    <h2 style="color:#D4AF37">تعذر إتمام العملية</h2>
    <p>' . h($message) . '</p>
    <p><a href="' . h(SITE_URL) . '/">الرجوع للموقع</a></p>
    </div></body></html>';
    exit;
}

$orderId  = null;
$amount   = null; // بالسنتيم
$type     = null; // payment_type
$packSlug = null;
$customerId = null;
$parentPaymentId = null;
$customerName = $customerEmail = $customerPhone = '';

// =========================================================================
// الوضع 1: أداء الـ70% الباقية (رابط جاهز من /admin)
// =========================================================================
if (isset($_GET['final'])) {
    $depositId = (int) $_GET['final'];
    $sig       = $_GET['sig'] ?? '';

    if ($depositId <= 0 || !verify_final_link($depositId, $sig)) {
        checkout_die('الرابط غير صالح أو منتهي الصلاحية.');
    }

    $stmt = $pdo->prepare('SELECT p.*, c.name, c.email, c.phone FROM payments p
                            JOIN customers c ON c.id = p.customer_id
                            WHERE p.id = :id AND p.payment_type = "deposit_30" LIMIT 1');
    $stmt->execute(['id' => $depositId]);
    $deposit = $stmt->fetch();

    if (!$deposit) {
        checkout_die('ماكايناش هاد الدفعة.');
    }
    if ($deposit['status'] !== 'paid') {
        checkout_die('خاص تأدي 30% الأولى قبل ما تأدي الباقي.');
    }

    // واش كاين ديجا أداء 70% مؤدي بنجاح مرتبط بهاد الدفعة؟
    $already = $pdo->prepare('SELECT id FROM payments WHERE parent_payment_id = :pid AND payment_type = "final_70" AND status = "paid" LIMIT 1');
    $already->execute(['pid' => $depositId]);
    if ($already->fetch()) {
        checkout_die('هاد الطلب متأدي بالكامل ديجا. شكرا ليك.');
    }

    $pack = get_pack($deposit['pack_slug']);
    if (!$pack || $pack['final_price'] === null) {
        checkout_die('الباك غير موجود.');
    }

    $amount           = dh_to_centimes((float) $pack['final_price']);
    $type             = 'final_70';
    $packSlug         = $deposit['pack_slug'];
    $customerId       = (int) $deposit['customer_id'];
    $parentPaymentId  = (int) $deposit['id'];
    $customerName     = $deposit['name'];
    $customerEmail    = $deposit['email'];
    $customerPhone    = $deposit['phone'];
    $orderId          = generate_order_id($packSlug . '-FINAL');

// =========================================================================
// الوضع 2: أداء جديد (POST من المودال فالصفحة الرئيسية)
// =========================================================================
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {

    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        checkout_die('انتهت صلاحية الجلسة. رجع للصفحة وعاود المحاولة.');
    }

    $packSlug      = trim((string) ($_POST['pack_slug'] ?? ''));
    $customerName  = trim((string) ($_POST['name'] ?? ''));
    $customerEmail = trim((string) ($_POST['email'] ?? ''));
    $customerPhone = sanitize_phone((string) ($_POST['phone'] ?? ''));
    $choice        = trim((string) ($_POST['payment_choice'] ?? 'full_100')); // full_100 | deposit_30

    if ($packSlug === '' || $customerName === '' || $customerEmail === '' || $customerPhone === '') {
        checkout_die('خاصك تعمر جميع المعلومات (الاسم، الإيميل، الهاتف).');
    }
    if (!is_valid_email($customerEmail)) {
        checkout_die('الإيميل غير صالح.');
    }

    $pack = get_pack($packSlug);
    if (!$pack) {
        checkout_die('الباك غير موجود.');
    }

    if ($pack['type'] === 'subscription') {
        $amount = dh_to_centimes((float) $pack['total_price']);
        $type   = 'subscription_monthly';
    } else {
        if ($choice === 'deposit_30' && $pack['deposit_price'] !== null) {
            $amount = dh_to_centimes((float) $pack['deposit_price']);
            $type   = 'deposit_30';
        } else {
            $amount = dh_to_centimes((float) $pack['total_price']);
            $type   = 'full_100';
        }
    }

    $customerId = find_or_create_customer($customerName, $customerEmail, $customerPhone);
    $orderId    = generate_order_id($packSlug);

} else {
    checkout_die('طلب غير صالح.');
}

// =========================================================================
// Tokenize عند YouCan Pay + تسجيل الدفعة pending
// =========================================================================
try {
    $tokenData = $youcan->tokenize(
        $orderId,
        $amount,
        SITE_URL . '/pay/success.php?order_id=' . urlencode($orderId),
        SITE_URL . '/pay/fail.php?order_id=' . urlencode($orderId),
        [
            'name'         => $customerName,
            'email'        => $customerEmail,
            'phone'        => $customerPhone,
            'country_code' => 'MA',
        ],
        [
            'pack_slug'    => $packSlug,
            'payment_type' => $type,
        ]
    );
} catch (YouCanPayException $e) {
    error_log('[CHECKOUT] YouCanPay tokenize error: ' . $e->getMessage());
    checkout_die('تعذر تجهيز عملية الأداء حاليا. حاول من بعد شوية أو تواصل معانا فالواتساب.');
}

$stmt = $pdo->prepare('INSERT INTO payments
    (customer_id, pack_slug, amount_centimes, amount_dh, payment_type, order_id, youcan_transaction_id, youcan_token_id, status, parent_payment_id)
    VALUES (:customer_id, :pack_slug, :amount_centimes, :amount_dh, :payment_type, :order_id, :txn_id, :token_id, "pending", :parent_id)');
$stmt->execute([
    'customer_id'     => $customerId,
    'pack_slug'       => $packSlug,
    'amount_centimes' => $amount,
    'amount_dh'       => centimes_to_dh($amount),
    'payment_type'    => $type,
    'order_id'        => $orderId,
    'txn_id'          => $tokenData['transaction_id'],
    'token_id'        => $tokenData['token_id'],
    'parent_id'       => $parentPaymentId,
]);

$tokenId = $tokenData['token_id'];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إتمام الأداء — MAW9I3I.PRO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--black);color:#f5f5f5;font-family:'Tajawal',Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .wrap{max-width:440px;width:100%}
  .brand{text-align:center;color:var(--gold);font-weight:900;font-size:22px;margin-bottom:18px;letter-spacing:.5px}
  .card{background:#141414;border:1px solid rgba(212,175,55,.35);border-radius:14px;padding:26px}
  .summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.08)}
  .summary .label{color:#999;font-size:13px}
  .summary .amount{color:var(--gold);font-weight:900;font-size:26px}
  #payment-card{min-height:120px;margin-bottom:16px}
  #error-container{color:#ff6b6b;font-size:14px;margin-top:10px;min-height:18px}
  button#pay{width:100%;background:var(--gold);color:#111;border:none;padding:14px;border-radius:10px;font-weight:900;font-size:16px;cursor:pointer;font-family:inherit}
  button#pay:disabled{opacity:.6;cursor:wait}
  .loading{text-align:center;color:#999;padding:30px 0}
  .secure{text-align:center;color:#666;font-size:12px;margin-top:14px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">MAW9I3I.PRO</div>
  <div class="card">
    <div class="summary">
      <div>
        <div class="label">Order <?= h($orderId) ?></div>
        <div style="font-size:14px;color:#ccc;margin-top:4px"><?= h($packSlug) ?></div>
      </div>
      <div class="amount"><?= h(number_format(centimes_to_dh($amount), 2)) ?> DH</div>
    </div>
    <div id="payment-card"><div class="loading">جاري تحميل صفحة الأداء الآمنة...</div></div>
    <button id="pay" type="button" disabled>أداء الآن 💳</button>
    <div id="error-container"></div>
  </div>
  <div class="secure">🔒 الأداء آمن ومشفّر عبر YouCan Pay</div>
</div>

<script src="https://pay.youcan.shop/js/ycpay.js"></script>
<script>
  var ycPay = new YCPay("<?= h(YOUCAN_PUBLIC_KEY) ?>", {
    formContainer: "#payment-card",
    locale: "ar",
    isSandbox: <?= YOUCAN_SANDBOX ? 'true' : 'false' ?>,
    errorContainer: "#error-container"
  });

  try {
    ycPay.renderAvailableGateways(["CreditCard", "CashPlus"]);
  } catch (e) { console.error(e); }

  document.getElementById('pay').disabled = false;

  document.getElementById('pay').addEventListener('click', function () {
    var btn = document.getElementById('pay');
    btn.disabled = true;
    btn.textContent = 'جاري المعالجة...';

    ycPay.pay("<?= h($tokenId) ?>").then(function (transactionId) {
      window.location.href = "success.php?order_id=<?= urlencode($orderId) ?>&txn=" + encodeURIComponent(transactionId);
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'أداء الآن 💳';
      var box = document.getElementById('error-container');
      box.textContent = (err && err.message) ? err.message : 'تعذر إتمام الأداء. حاول مرة أخرى.';
      setTimeout(function(){
        window.location.href = "fail.php?order_id=<?= urlencode($orderId) ?>";
      }, 3500);
    });
  });
</script>
</body>
</html>
