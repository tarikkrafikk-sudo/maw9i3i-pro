<?php
/**
 * pay/cron.php
 * -----------------------------------------------------------------------
 * خاصو يتنفذ مرة فالنهار (Cron Job). ديرو:
 *   1) تحديد الاشتراكات (L-KRA) لي فات وقتها → expired + إيميل تجديد
 *   2) تذكير الزبناء لي خلصو 30% وما خلصوش 70% من كثر 7 أيام
 *
 * الاستعمال فـ cPanel (Cron Jobs):
 *   php /home/USER/public_html/pay/cron.php
 * أو عبر HTTP (إلا ماكانش SSH متوفر)، شرط تحدد CRON_SECRET فـ .env:
 *   wget -q -O /dev/null "https://www.maw9i3i-pro.com/pay/cron.php?secret=XXXXX"
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

$isCli = (PHP_SAPI === 'cli');

if (!$isCli) {
    $secret = $_GET['secret'] ?? '';
    if (CRON_SECRET === '' || !hash_equals(CRON_SECRET, (string) $secret)) {
        http_response_code(403);
        die('forbidden');
    }
    header('Content-Type: text/plain; charset=utf-8');
}

function cron_log(string $msg): void
{
    echo '[' . date('Y-m-d H:i:s') . '] ' . $msg . PHP_EOL;
}

$pdo = db();

// =========================================================================
// 1) تصفير اشتراكات L-KRA لي فات وقتها + إيميل تجديد
// =========================================================================
cron_log('بداية فحص اشتراكات L-KRA المنتهية...');

$expiredStmt = $pdo->query('
    SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.pack_slug = "lkra"
      AND s.status = "active"
      AND s.expire_date IS NOT NULL
      AND s.expire_date < CURDATE()
');
$expiredSubs = $expiredStmt->fetchAll();

foreach ($expiredSubs as $sub) {
    $pdo->prepare('UPDATE subscriptions SET status = "expired" WHERE id = :id')
        ->execute(['id' => $sub['id']]);

    send_email($sub['customer_email'], '⚠️ موقعك متوقف — جدد اشتراكك', email_template(
        'اشتراكك انتهى',
        '<p>سلام ' . h($sub['customer_name']) . '،</p>
         <p>اشتراك <strong>Pack L-KRA</strong> ديالك انتهى فـ ' . h((string) $sub['expire_date']) . ' وموقعك توقف دابا.</p>
         <p>جدد الاشتراك (199 DH/الشهر) باش يرجع موقعك خدام:</p>
         <p><a href="' . h(SITE_URL) . '/#packs" style="color:#D4AF37">جدد الآن</a></p>'
    ));

    send_email(ADMIN_EMAIL, '🔴 اشتراك L-KRA انتهى — ' . $sub['customer_name'], email_template(
        'اشتراك منتهي',
        '<p>' . h($sub['customer_name']) . ' — ' . h($sub['customer_phone']) . ' — انتهى فـ ' . h((string) $sub['expire_date']) . '</p>'
    ));

    cron_log('  → تصفير اشتراك #' . $sub['id'] . ' (' . $sub['customer_email'] . ') + إيميل تجديد مبعوث.');
}
cron_log(count($expiredSubs) . ' اشتراك(ات) تصفرو.');

// =========================================================================
// 2) تذكير بأداء الـ70% الباقية (باكات وحيدة، من كثر 7 أيام)
// =========================================================================
cron_log('بداية فحص الدفعات فالانتظار (70% الباقية)...');

$pendingStmt = $pdo->query('
    SELECT s.*, p.id AS deposit_payment_id, p.paid_at AS deposit_paid_at,
           c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
           pk.final_price, pk.name AS pack_name
    FROM subscriptions s
    JOIN payments p  ON p.id = s.last_payment_id
    JOIN customers c ON c.id = s.customer_id
    JOIN packs pk    ON pk.slug = s.pack_slug
    WHERE s.status = "pending_final_payment"
      AND p.payment_type = "deposit_30"
      AND p.paid_at IS NOT NULL
      AND p.paid_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND (s.final_reminder_sent_at IS NULL OR s.final_reminder_sent_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
');
$pendingFinal = $pendingStmt->fetchAll();

foreach ($pendingFinal as $row) {
    $link = build_final_payment_link((int) $row['deposit_payment_id']);

    send_email($row['customer_email'], 'تذكير: باقي 70% لإتمام مشروعك — ' . $row['pack_name'], email_template(
        'تذكير بالأداء ⏰',
        '<p>سلام ' . h($row['customer_name']) . '،</p>
         <p>خلصتي 30% ديال <strong>' . h($row['pack_name']) . '</strong> من ' . h(date('Y-m-d', strtotime($row['deposit_paid_at']))) . ' ومازال باقي 70% (' . h(number_format((float) $row['final_price'], 2)) . ' DH) باش نكملو ونسلموك الموقع.</p>
         <p><a href="' . h($link) . '" style="color:#D4AF37">أدي 70% الباقية دابا</a></p>'
    ));

    send_email(ADMIN_EMAIL, '⏰ تذكير 70% مبعوث — ' . $row['customer_name'], email_template(
        'تذكير مبعوث للزبون',
        '<p>' . h($row['customer_name']) . ' — ' . h($row['customer_phone']) . ' — الباك: ' . h($row['pack_name']) . '</p>'
    ));

    $pdo->prepare('UPDATE subscriptions SET final_reminder_sent_at = NOW() WHERE id = :id')
        ->execute(['id' => $row['id']]);

    cron_log('  → تذكير 70% مبعوث لـ ' . $row['customer_email'] . ' (dossier #' . $row['id'] . ').');
}
cron_log(count($pendingFinal) . ' تذكير(ات) مبعوتة.');

cron_log('انتهى.');
