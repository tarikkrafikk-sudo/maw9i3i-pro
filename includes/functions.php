<?php
/**
 * includes/functions.php
 * -----------------------------------------------------------------------
 * دوال مساعدة عامة: تحويل المبالغ، البريد، واتساب، CSRF، الباكات...
 * Fonctions utilitaires partagées par tout le projet.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/db.php';

/** htmlspecialchars مختصرة — استعملها فكل مرة كتطبع بيانات المستخدم فـ HTML */
function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** تحويل سنتيم -> درهم (للعرض فقط) */
function centimes_to_dh(int $centimes): float
{
    return round($centimes / 100, 2);
}

/** تحويل درهم -> سنتيم (لي كيتبعت لـ YouCan Pay) */
function dh_to_centimes(float $dh): int
{
    return (int) round($dh * 100);
}

/** توليد order_id فريد */
function generate_order_id(string $packSlug): string
{
    return strtoupper($packSlug) . '-' . date('Ymd-His') . '-' . strtoupper(bin2hex(random_bytes(3)));
}

/**
 * رابط واتساب جاهز بريسالة معبأة مسبقًا.
 */
function whatsapp_link(string $phone, string $message): string
{
    $phone = preg_replace('/[^0-9]/', '', $phone);
    return 'https://wa.me/' . $phone . '?text=' . rawurlencode($message);
}

/**
 * إرسال بريد إلكتروني بسيط (PHP mail()) بتصميم متبع للهوية البصرية ديال الموقع.
 * ملاحظة: mail() كيخدم فأغلب استضافات cPanel/FTP، لكن إلا كان عندك SMTP خاص
 * (Mailgun/SendGrid...)، بدّل هاد الدالة باش تستعملو.
 */
function send_email(string $to, string $subject, string $htmlBody): bool
{
    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= 'From: ' . MAIL_FROM_NAME . ' <' . MAIL_FROM . ">\r\n";
    $headers .= 'Reply-To: ' . ADMIN_EMAIL . "\r\n";

    $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $htmlBody, $headers);

    if (!$ok) {
        error_log('[MAIL] فشل إرسال البريد لـ ' . $to . ' — الموضوع: ' . $subject);
    }

    return $ok;
}

/** قالب HTML بسيط للإيميلات (أسود/ذهبي، Cairo) */
function email_template(string $title, string $bodyHtml): string
{
    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
    <style>
      body{margin:0;background:#0a0a0a;font-family:Tajawal,Cairo,Arial,sans-serif;color:#f5f5f5}
      .wrap{max-width:520px;margin:0 auto;padding:32px 24px}
      .card{background:#141414;border:1px solid #D4AF37;border-radius:10px;padding:28px}
      .logo{color:#D4AF37;font-weight:700;font-size:20px;margin-bottom:18px}
      h1{color:#D4AF37;font-size:20px;margin:0 0 16px}
      p{line-height:1.8;color:#dcdcdc;font-size:15px}
      .footer{margin-top:24px;color:#777;font-size:12px;text-align:center}
    </style></head><body><div class="wrap"><div class="card">
      <div class="logo">MAW9I3I.PRO</div>
      <h1>' . h($title) . '</h1>' . $bodyHtml . '
    </div><div class="footer">MAW9I3I.PRO — Votre site web sur commande</div></div></body></html>';
}

/** رمز CSRF ديال الجلسة الحالية */
function csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/** التحقق من رمز CSRF المرسل من فورم */
function csrf_verify(?string $token): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    return !empty($_SESSION['csrf_token']) && is_string($token) && hash_equals($_SESSION['csrf_token'], $token);
}

/** إرسال جواب JSON وإيقاف التنفيذ */
function json_response(array $data, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * كيرجع معلومات الباك (السعر، النوع...) من قاعدة البيانات.
 */
function get_pack(string $slug): ?array
{
    $stmt = db()->prepare('SELECT * FROM packs WHERE slug = :slug AND is_active = 1 LIMIT 1');
    $stmt->execute(['slug' => $slug]);
    $pack = $stmt->fetch();
    return $pack ?: null;
}

/**
 * كيلقى الزبون بالإيميل، أو كيخلق واحد جديد إلا ماكانش موجود.
 * يرجع customer_id.
 */
function find_or_create_customer(string $name, string $email, string $phone): int
{
    $pdo = db();

    $stmt = $pdo->prepare('SELECT id FROM customers WHERE email = :email LIMIT 1');
    $stmt->execute(['email' => $email]);
    $existing = $stmt->fetch();

    if ($existing) {
        // نحدثو الاسم/الهاتف إلا تبدلو
        $upd = $pdo->prepare('UPDATE customers SET name = :name, phone = :phone WHERE id = :id');
        $upd->execute(['name' => $name, 'phone' => $phone, 'id' => $existing['id']]);
        return (int) $existing['id'];
    }

    $ins = $pdo->prepare('INSERT INTO customers (name, email, phone) VALUES (:name, :email, :phone)');
    $ins->execute(['name' => $name, 'email' => $email, 'phone' => $phone]);
    return (int) $pdo->lastInsertId();
}

/** تنظيف/التحقق البسيط من بريد إلكتروني */
function is_valid_email(string $email): bool
{
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/** تنظيف بسيط لرقم الهاتف (كيبقاو غير الأرقام و +) */
function sanitize_phone(string $phone): string
{
    return preg_replace('/[^0-9+]/', '', $phone);
}

// =========================================================================
// آراء الزبناء (Reviews)
// =========================================================================

/** عنوان IP ديال الزائر (يدعم proxy/cPanel العادي، بلا ثقة عمياء فـ headers قابلين للتزوير) */
function get_client_ip(): string
{
    // ملاحظة: X-Forwarded-For قابل للتزوير من الزائر، كنستعملوه غير كـ fallback
    // خفيف لـ rate-limiting (ماشي لأمان حساس)، REMOTE_ADDR هو الأساسي.
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/**
 * حد بسيط ضد السبام: نفس الـ IP ما يقدرش يبعث كثر من رأي وحد كل 24 ساعة.
 */
function review_rate_limit_ok(string $ip): bool
{
    $stmt = db()->prepare('SELECT COUNT(*) FROM reviews WHERE ip_address = :ip AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)');
    $stmt->execute(['ip' => $ip]);
    return ((int) $stmt->fetchColumn()) === 0;
}

/** الآراء المصادق عليها فقط (للعرض فالموقع) */
function get_approved_reviews(int $limit = 50): array
{
    $stmt = db()->prepare('SELECT id, customer_name, rating, comment, pack_slug, created_at
                            FROM reviews WHERE status = "approved"
                            ORDER BY created_at DESC LIMIT :lim');
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    return $stmt->fetchAll();
}

/** معدل التقييم العام + عدد الآراء (للعرض: "4.9/5 على أساس 23 رأي") */
function get_review_stats(): array
{
    $row = db()->query('SELECT COUNT(*) AS cnt, COALESCE(AVG(rating),0) AS avg_rating
                         FROM reviews WHERE status = "approved"')->fetch();
    return [
        'count'      => (int) $row['cnt'],
        'avg_rating' => round((float) $row['avg_rating'], 1),
    ];
}

/**
 * توقيع بسيط (HMAC) لروابط أداء الـ70% الباقية — باش حتى حد ما يقدر يبدل
 * payment_id فالرابط ويأدي بحال شي حد آخر.
 */
function sign_final_link(int $depositPaymentId): string
{
    return hash_hmac('sha256', (string) $depositPaymentId, APP_SECRET);
}

function verify_final_link(int $depositPaymentId, ?string $signature): bool
{
    if (!is_string($signature) || $signature === '') {
        return false;
    }
    return hash_equals(sign_final_link($depositPaymentId), $signature);
}

/** رابط أداء الـ70% الباقية الجاهز باش نبعثوه للزبون */
function build_final_payment_link(int $depositPaymentId): string
{
    return SITE_URL . '/pay/checkout.php?final=' . $depositPaymentId . '&sig=' . sign_final_link($depositPaymentId);
}
