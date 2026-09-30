<?php
/**
 * admin/index.php — لوحة التحكم الرئيسية
 * جدول كل الدفوعات + الإحصائيات + إدارة الـ70% الباقية + تذكيرات L-KRA
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/auth.php';

admin_require_login();

$pdo = db();

// -------------------------------------------------------------------
// إحصائيات
// -------------------------------------------------------------------
$totalCollected = (float) $pdo->query('SELECT COALESCE(SUM(amount_dh),0) FROM payments WHERE status = "paid"')->fetchColumn();

$pendingFinalRows = $pdo->query('
    SELECT p.id, p.pack_slug, p.customer_id, pk.final_price
    FROM payments p
    JOIN packs pk ON pk.slug = p.pack_slug
    WHERE p.payment_type = "deposit_30" AND p.status = "paid"
      AND NOT EXISTS (
          SELECT 1 FROM payments f
          WHERE f.parent_payment_id = p.id AND f.payment_type = "final_70" AND f.status = "paid"
      )
')->fetchAll();

$pendingFinalCount = count($pendingFinalRows);
$pendingFinalSum   = array_sum(array_map(fn($r) => (float) $r['final_price'], $pendingFinalRows));
$pendingFinalIds   = array_column($pendingFinalRows, 'id');

$activeSubsCount = (int) $pdo->query('SELECT COUNT(*) FROM subscriptions WHERE status = "active"')->fetchColumn();

$pendingReviewsCount = (int) $pdo->query('SELECT COUNT(*) FROM reviews WHERE status = "pending"')->fetchColumn();

// -------------------------------------------------------------------
// جدول الدفوعات (بترقيم صفحات بسيط)
// -------------------------------------------------------------------
$page    = max(1, (int) ($_GET['page'] ?? 1));
$perPage = 30;
$offset  = ($page - 1) * $perPage;

$totalPayments = (int) $pdo->query('SELECT COUNT(*) FROM payments')->fetchColumn();
$totalPages    = max(1, (int) ceil($totalPayments / $perPage));

$stmt = $pdo->prepare('
    SELECT p.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM payments p
    JOIN customers c ON c.id = p.customer_id
    ORDER BY p.created_at DESC
    LIMIT :limit OFFSET :offset
');
$stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
$stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
$stmt->execute();
$payments = $stmt->fetchAll();

// -------------------------------------------------------------------
// اشتراكات L-KRA (لمتابعة تواريخ الانتهاء)
// -------------------------------------------------------------------
$lkraSubs = $pdo->query('
    SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.pack_slug = "lkra"
    ORDER BY (s.expire_date IS NULL), s.expire_date ASC
')->fetchAll();

$statusLabels = [
    'pending' => ['قيد الانتظار', '#D4AF37'],
    'paid'    => ['مؤدّاة ✓', '#48c774'],
    'failed'  => ['فشلت ✕', '#e05252'],
];
$typeLabels = [
    'full_100'             => 'كامل 100%',
    'deposit_30'           => '30% بداية',
    'final_70'             => '70% باقي',
    'subscription_monthly' => 'اشتراك شهري',
];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>لوحة التحكم — MAW9I3I.PRO</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=Cairo:wght@700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a;--card:#141414}
  *{box-sizing:border-box}
  body{margin:0;background:var(--black);color:#f0f0f0;font-family:'Tajawal',Arial,sans-serif}
  header{display:flex;justify-content:space-between;align-items:center;padding:18px 26px;border-bottom:1px solid rgba(212,175,55,.25)}
  header .brand{color:var(--gold);font-family:'Cairo',sans-serif;font-weight:900;font-size:18px}
  header a{color:#aaa;text-decoration:none;font-size:13px;border:1px solid #333;padding:7px 14px;border-radius:8px}
  header a:hover{border-color:var(--gold);color:var(--gold)}
  main{padding:24px;max-width:1200px;margin:0 auto}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:28px}
  .stat{background:var(--card);border:1px solid rgba(212,175,55,.2);border-radius:12px;padding:18px}
  .stat .label{color:#999;font-size:12px;margin-bottom:6px}
  .stat .value{color:var(--gold);font-size:24px;font-weight:900}
  h2{font-family:'Cairo',sans-serif;font-size:17px;color:#eee;margin:32px 0 14px;border-right:3px solid var(--gold);padding-right:10px}
  .table-wrap{overflow-x:auto;background:var(--card);border-radius:12px;border:1px solid rgba(255,255,255,.06)}
  table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}
  th,td{padding:11px 14px;text-align:right;white-space:nowrap}
  thead th{color:#999;font-weight:700;border-bottom:1px solid rgba(255,255,255,.1);font-size:12px}
  tbody tr{border-bottom:1px solid rgba(255,255,255,.05)}
  tbody tr:hover{background:rgba(212,175,55,.04)}
  .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .btn-sm{display:inline-block;padding:6px 12px;border-radius:7px;background:var(--gold);color:#111;
          text-decoration:none;font-size:12px;font-weight:800}
  .btn-sm.outline{background:transparent;border:1px solid #444;color:#ccc}
  .pagination{display:flex;gap:8px;justify-content:center;margin-top:16px}
  .pagination a{color:#ccc;text-decoration:none;padding:6px 12px;border:1px solid #333;border-radius:6px;font-size:13px}
  .pagination a.active{background:var(--gold);color:#111;border-color:var(--gold)}
  .muted{color:#666}
</style>
</head>
<body>
<header>
  <div class="brand">MAW9I3I.PRO — لوحة التحكم</div>
  <div style="display:flex;gap:8px">
    <a href="reviews.php">آراء الزبناء <?= $pendingReviewsCount > 0 ? '(' . $pendingReviewsCount . ')' : '' ?> ⭐</a>
    <a href="logout.php">خروج ⏻</a>
  </div>
</header>
<main>

  <div class="stats">
    <div class="stat"><div class="label">إجمالي المبالغ المحصّلة</div><div class="value"><?= h(number_format($totalCollected, 2)) ?> DH</div></div>
    <div class="stat"><div class="label">فالانتظار (70% الباقية)</div><div class="value"><?= $pendingFinalCount ?> <span style="font-size:14px;color:#999">(<?= h(number_format($pendingFinalSum, 2)) ?> DH)</span></div></div>
    <div class="stat"><div class="label">اشتراكات/مشاريع نشيطة</div><div class="value"><?= $activeSubsCount ?></div></div>
    <div class="stat"><div class="label">عدد الدفوعات الكلي</div><div class="value"><?= $totalPayments ?></div></div>
    <div class="stat"><div class="label">آراء فالانتظار</div><div class="value"><?= $pendingReviewsCount ?> <a href="reviews.php" style="font-size:12px;color:#999;text-decoration:underline">راجعها</a></div></div>
  </div>

  <h2>كل الدفوعات</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>التاريخ</th><th>الزبون</th><th>الإيميل</th><th>الهاتف</th><th>الباك</th>
        <th>النوع</th><th>المبلغ</th><th>الحالة</th><th>Order ID</th><th>إجراء</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($payments as $p): ?>
      <tr>
        <td class="muted"><?= h(date('Y-m-d H:i', strtotime($p['created_at']))) ?></td>
        <td><?= h($p['customer_name']) ?></td>
        <td class="muted"><?= h($p['customer_email']) ?></td>
        <td class="muted" dir="ltr"><?= h($p['customer_phone']) ?></td>
        <td><?= h($p['pack_slug']) ?></td>
        <td><?= h($typeLabels[$p['payment_type']] ?? $p['payment_type']) ?></td>
        <td><?= h(number_format((float) $p['amount_dh'], 2)) ?> DH</td>
        <td><span class="pill" style="background:<?= h($statusLabels[$p['status']][1]) ?>22;color:<?= h($statusLabels[$p['status']][1]) ?>"><?= h($statusLabels[$p['status']][0]) ?></span></td>
        <td class="muted" dir="ltr"><?= h($p['order_id']) ?></td>
        <td>
          <?php if (in_array((int) $p['id'], $pendingFinalIds, true)): ?>
            <a class="btn-sm" href="actions/generate-final-link.php?payment_id=<?= (int) $p['id'] ?>">إنشاء رابط دفع 70% المتبقي</a>
          <?php elseif ($p['payment_type'] === 'final_70' && $p['status'] === 'paid'): ?>
            <span class="muted">مكتمل ✓</span>
          <?php else: ?>
            <span class="muted">—</span>
          <?php endif; ?>
        </td>
      </tr>
      <?php endforeach; ?>
      <?php if (!$payments): ?>
      <tr><td colspan="10" class="muted" style="text-align:center;padding:24px">ماكاين حتى دفعة بعد.</td></tr>
      <?php endif; ?>
    </tbody>
  </table>
  </div>

  <?php if ($totalPages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $totalPages; $i++): ?>
      <a href="?page=<?= $i ?>" class="<?= $i === $page ? 'active' : '' ?>"><?= $i ?></a>
    <?php endfor; ?>
  </div>
  <?php endif; ?>

  <h2>باكات L-KRA — تواريخ الانتهاء</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>الزبون</th><th>الإيميل</th><th>الهاتف</th><th>تاريخ البداية</th><th>تاريخ الانتهاء</th><th>الحالة</th><th>إجراء</th></tr>
    </thead>
    <tbody>
      <?php foreach ($lkraSubs as $s): ?>
      <?php
        $expired = $s['expire_date'] && strtotime($s['expire_date']) < strtotime('today');
        $subStatusLabel = $expired ? 'منتهي ✕' : ($s['status'] === 'active' ? 'نشيط ✓' : 'فالانتظار');
        $subStatusColor = $expired ? '#e05252' : ($s['status'] === 'active' ? '#48c774' : '#D4AF37');
      ?>
      <tr>
        <td><?= h($s['customer_name']) ?></td>
        <td class="muted"><?= h($s['customer_email']) ?></td>
        <td class="muted" dir="ltr"><?= h($s['customer_phone']) ?></td>
        <td class="muted"><?= h($s['start_date'] ?? '—') ?></td>
        <td><?= h($s['expire_date'] ?? '—') ?></td>
        <td><span class="pill" style="background:<?= $subStatusColor ?>22;color:<?= $subStatusColor ?>"><?= $subStatusLabel ?></span></td>
        <td><a class="btn-sm outline" href="actions/send-reminder.php?subscription_id=<?= (int) $s['id'] ?>">إرسال تذكير تجديد</a></td>
      </tr>
      <?php endforeach; ?>
      <?php if (!$lkraSubs): ?>
      <tr><td colspan="7" class="muted" style="text-align:center;padding:24px">ماكاين حتى اشتراك L-KRA بعد.</td></tr>
      <?php endif; ?>
    </tbody>
  </table>
  </div>

</main>
</body>
</html>
