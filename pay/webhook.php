<?php
/**
 * pay/webhook.php
 * -----------------------------------------------------------------------
 * هنا كيوصل الإشعار الحقيقي من YouCan Pay بنتيجة الأداء. هاد الملف هو
 * المصدر الوحيد الموثوق لتفعيل أي دفعة — الصفحة success.php هي غير للعرض،
 * ماشي للتفعيل.
 *
 * سجّل هاد الرابط عند YouCan Pay (Dashboard → Webhooks):
 *   https://www.maw9i3i-pro.com/pay/webhook.php
 *
 * التوقيع: هيدر X-YOUCANPAY-SIGNATURE = HMAC-SHA256(raw_body, PRIVATE_KEY)
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/YouCanPay.php';

$pdo    = db();
$youcan = new YouCanPay(YOUCAN_PRIVATE_KEY, YOUCAN_PUBLIC_KEY, YOUCAN_SANDBOX);

/** إرسال جواب ووقف التنفيذ (بلا JSON معقد باش يبقى خفيف للـ webhook) */
function webhook_respond(int $code, string $message): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => $code < 300, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

// -------------------------------------------------------------------
// 1) قراءة الـ body الخام + هيدر التوقيع (بلا أي تعديل — مهم جدا للتحقق)
// -------------------------------------------------------------------
$rawBody = file_get_contents('php://input') ?: '';

$signature = '';
if (function_exists('getallheaders')) {
    foreach (getallheaders() as $name => $value) {
        if (strcasecmp($name, 'X-YOUCANPAY-SIGNATURE') === 0) {
            $signature = $value;
            break;
        }
    }
}
if ($signature === '') {
    $signature = $_SERVER['HTTP_X_YOUCANPAY_SIGNATURE'] ?? '';
}

if (!$youcan->verifyWebhookSignature($rawBody, $signature)) {
    error_log('[WEBHOOK] توقيع غير صالح! body=' . substr($rawBody, 0, 300));
    webhook_respond(401, 'invalid signature');
}

$data = json_decode($rawBody, true);
if (!is_array($data)) {
    webhook_respond(400, 'invalid json');
}

// -------------------------------------------------------------------
// 2) استخراج معطيات الـ transaction من الـ payload
//    الشكل الحقيقي: { id, event_name, sandbox, payload: { transaction: {...} } }
// -------------------------------------------------------------------
$eventName   = $data['event_name'] ?? '';
$transaction = $data['payload']['transaction'] ?? $data['transaction'] ?? $data['payload'] ?? [];

$orderId       = $transaction['order_id'] ?? $data['order_id'] ?? null;
$txnStatus     = strtolower((string) ($transaction['status'] ?? ''));
$transactionId = $transaction['id'] ?? $data['transaction_id'] ?? null;

if (!$orderId) {
    error_log('[WEBHOOK] order_id غير موجود فالـ payload: ' . $rawBody);
    webhook_respond(400, 'missing order_id');
}

$isPaid = ($eventName === 'transaction.paid')
    || in_array($txnStatus, ['paid', 'succeeded', 'success', 'captured'], true);

$isFailed = ($eventName === 'transaction.failed')
    || in_array($txnStatus, ['failed', 'error', 'declined', 'cancelled', 'canceled'], true);

// -------------------------------------------------------------------
// 3) جلب الدفعة المرتبطة بهاد order_id
// -------------------------------------------------------------------
$stmt = $pdo->prepare('SELECT * FROM payments WHERE order_id = :order_id LIMIT 1');
$stmt->execute(['order_id' => $orderId]);
$payment = $stmt->fetch();

if (!$payment) {
    error_log('[WEBHOOK] payment غير موجودة لـ order_id=' . $orderId);
    webhook_respond(404, 'payment not found');
}

// Idempotence: إلا كانت الدفعة متأدية ديجا، ما نعاودوش المعالجة (تفادي تكرار البريد/تمديد الاشتراك)
if ($payment['status'] === 'paid') {
    webhook_respond(200, 'already processed');
}

$pdo->beginTransaction();
try {
    if ($isPaid) {
        $upd = $pdo->prepare('UPDATE payments SET status = "paid", paid_at = NOW(),
            youcan_transaction_id = COALESCE(:txn_id, youcan_transaction_id),
            raw_webhook_payload = :raw
            WHERE id = :id');
        $upd->execute([
            'txn_id' => $transactionId,
            'raw'    => substr($rawBody, 0, 60000),
            'id'     => $payment['id'],
        ]);

        handle_paid_payment($pdo, $payment);
    } elseif ($isFailed) {
        $upd = $pdo->prepare('UPDATE payments SET status = "failed", raw_webhook_payload = :raw WHERE id = :id');
        $upd->execute(['raw' => substr($rawBody, 0, 60000), 'id' => $payment['id']]);
    } else {
        // حالة غير معروفة (pending، processing...) — نسجلوها فقط بلا ما نبدلو الحالة
        error_log('[WEBHOOK] حالة غير معالجة لـ order_id=' . $orderId . ' status=' . $txnStatus . ' event=' . $eventName);
    }

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    error_log('[WEBHOOK] خطأ أثناء المعالجة: ' . $e->getMessage());
    webhook_respond(500, 'processing error');
}

webhook_respond(200, 'ok');

// =========================================================================
// منطق التفعيل حسب نوع الدفعة
// =========================================================================
function handle_paid_payment(PDO $pdo, array $payment): void
{
    $customerStmt = $pdo->prepare('SELECT * FROM customers WHERE id = :id');
    $customerStmt->execute(['id' => $payment['customer_id']]);
    $customer = $customerStmt->fetch();
    if (!$customer) {
        return;
    }

    $pack = get_pack($payment['pack_slug']);
    $packName = $pack['name'] ?? $payment['pack_slug'];
    $waLink = whatsapp_link($customer['phone'], 'سلام ' . $customer['name'] . '، توصلنا بأداء ديالك ✅');

    switch ($payment['payment_type']) {

        // -----------------------------------------------------------
        // 30% دفعة البداية → الحالة: pending_final_payment
        // -----------------------------------------------------------
        case 'deposit_30':
            upsert_subscription($pdo, (int) $customer['id'], $payment['pack_slug'], [
                'status'          => 'pending_final_payment',
                'last_payment_id' => $payment['id'],
            ]);

            send_email($customer['email'], 'تم تأكيد دفعتك — ' . $packName, email_template(
                'تم دفع 30% بنجاح ✅',
                '<p>سلام ' . h($customer['name']) . '،</p>
                 <p>توصلنا بأداء 30% ديال <strong>' . h($packName) . '</strong> (' . h((string) $payment['amount_dh']) . ' DH).</p>
                 <p><strong>سنبدأ العمل فمشروعك من دابا.</strong> باقي عليك أداء 70% الباقية من بعد ما نسلموك الموقع.</p>
                 <p>شكرا على ثقتك 🙏</p>'
            ));

            send_email(ADMIN_EMAIL, '💰 دفعة 30% جديدة — ' . $packName, email_template(
                'دفعة 30% جديدة',
                '<p>الزبون: ' . h($customer['name']) . ' — ' . h($customer['email']) . ' — ' . h($customer['phone']) . '</p>
                 <p>الباك: ' . h($packName) . ' — المبلغ: ' . h((string) $payment['amount_dh']) . ' DH</p>
                 <p><a href="' . h($waLink) . '" style="color:#D4AF37">تواصل معاه فالواتساب</a></p>'
            ));
            break;

        // -----------------------------------------------------------
        // 70% الباقية → المشروع كامل، الاشتراك (dossier) active
        // -----------------------------------------------------------
        case 'final_70':
            upsert_subscription($pdo, (int) $customer['id'], $payment['pack_slug'], [
                'status'          => 'active',
                'start_date'      => date('Y-m-d'),
                'last_payment_id' => $payment['id'],
            ]);

            send_email($customer['email'], '🎉 تم تسليم موقعك — ' . $packName, email_template(
                'تم الأداء بالكامل ✅',
                '<p>سلام ' . h($customer['name']) . '،</p>
                 <p>توصلنا بالـ70% الباقية. <strong>مشروعك الآن مكتمل الأداء</strong> وفريقنا غادي يتواصل معاك لتسليم الموقع.</p>'
            ));

            send_email(ADMIN_EMAIL, '✅ أداء كامل (70% الباقية) — ' . $packName, email_template(
                'أداء كامل — سلّم الموقع',
                '<p>الزبون: ' . h($customer['name']) . ' — ' . h($customer['email']) . ' — ' . h($customer['phone']) . '</p>
                 <p>الباك: ' . h($packName) . '</p>
                 <p><a href="' . h($waLink) . '" style="color:#D4AF37">تواصل معاه فالواتساب</a></p>'
            ));
            break;

        // -----------------------------------------------------------
        // اشتراك L-KRA شهري → تمديد/تفعيل expire_date
        // -----------------------------------------------------------
        case 'subscription_monthly':
            $sub = get_subscription($pdo, (int) $customer['id'], $payment['pack_slug']);

            // إلا كان الاشتراك مازال نشيط وماخداش لعافيتو، نمديو من expire_date الحالي، وإلا من اليوم
            $base = ($sub && $sub['status'] === 'active' && $sub['expire_date'] && strtotime($sub['expire_date']) > time())
                ? $sub['expire_date']
                : date('Y-m-d');

            $newExpire = date('Y-m-d', strtotime($base . ' +30 days'));

            upsert_subscription($pdo, (int) $customer['id'], $payment['pack_slug'], [
                'status'                   => 'active',
                'start_date'               => $sub['start_date'] ?? date('Y-m-d'),
                'expire_date'              => $newExpire,
                'last_payment_id'          => $payment['id'],
                'renewal_reminder_sent_at' => null,
            ]);

            send_email($customer['email'], 'تم تفعيل/تجديد موقعك — Pack L-KRA', email_template(
                'تم الأداء ✅',
                '<p>سلام ' . h($customer['name']) . '،</p>
                 <p>موقعك فعّال إلى غاية <strong>' . h($newExpire) . '</strong>.</p>
                 <p>باش يبقى موقعك خدام، خاص التجديد الشهري ديال 199 DH.</p>'
            ));

            send_email(ADMIN_EMAIL, '🔁 دفعة اشتراك L-KRA — ' . h($customer['name']), email_template(
                'دفعة اشتراك جديدة',
                '<p>الزبون: ' . h($customer['name']) . ' — ' . h($customer['phone']) . '</p>
                 <p>فعّال إلى: ' . h($newExpire) . '</p>'
            ));
            break;

        // -----------------------------------------------------------
        // أداء كامل 100% دفعة وحدة → active فورا
        // -----------------------------------------------------------
        case 'full_100':
            upsert_subscription($pdo, (int) $customer['id'], $payment['pack_slug'], [
                'status'          => 'active',
                'start_date'      => date('Y-m-d'),
                'last_payment_id' => $payment['id'],
            ]);

            send_email($customer['email'], '🎉 تم تأكيد أدائك — ' . $packName, email_template(
                'تم الأداء بالكامل ✅',
                '<p>سلام ' . h($customer['name']) . '،</p>
                 <p>توصلنا بأداء <strong>' . h($packName) . '</strong> بالكامل (' . h((string) $payment['amount_dh']) . ' DH).</p>
                 <p>سيتواصل معك فريقنا خلال ساعة لبداية العمل. شكرا على ثقتك 🙏</p>'
            ));

            send_email(ADMIN_EMAIL, '💰 أداء كامل جديد — ' . $packName, email_template(
                'أداء كامل 100%',
                '<p>الزبون: ' . h($customer['name']) . ' — ' . h($customer['email']) . ' — ' . h($customer['phone']) . '</p>
                 <p>الباك: ' . h($packName) . ' — المبلغ: ' . h((string) $payment['amount_dh']) . ' DH</p>
                 <p><a href="' . h($waLink) . '" style="color:#D4AF37">تواصل معاه فالواتساب</a></p>'
            ));
            break;
    }
}

/** كيرجع صف الاشتراك (dossier) ديال زبون + باك معين، أو null */
function get_subscription(PDO $pdo, int $customerId, string $packSlug): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM subscriptions WHERE customer_id = :cid AND pack_slug = :slug LIMIT 1');
    $stmt->execute(['cid' => $customerId, 'slug' => $packSlug]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/** كيخلق أو كيحدث صف الاشتراك (dossier) ديال زبون + باك معين */
function upsert_subscription(PDO $pdo, int $customerId, string $packSlug, array $fields): void
{
    $existing = get_subscription($pdo, $customerId, $packSlug);

    $allowed = ['status', 'start_date', 'expire_date', 'last_payment_id', 'renewal_reminder_sent_at', 'final_reminder_sent_at'];
    $fields  = array_intersect_key($fields, array_flip($allowed));

    if ($existing) {
        $sets = [];
        $params = ['id' => $existing['id']];
        foreach ($fields as $col => $val) {
            $sets[] = "`$col` = :$col";
            $params[$col] = $val;
        }
        if ($sets) {
            $pdo->prepare('UPDATE subscriptions SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
        }
        return;
    }

    $fields['customer_id'] = $customerId;
    $fields['pack_slug']   = $packSlug;
    $cols = array_keys($fields);
    $placeholders = array_map(fn($c) => ":$c", $cols);
    $pdo->prepare('INSERT INTO subscriptions (' . implode(',', $cols) . ') VALUES (' . implode(',', $placeholders) . ')')
        ->execute($fields);
}
