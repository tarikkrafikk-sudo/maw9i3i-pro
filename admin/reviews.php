<?php
/**
 * admin/reviews.php — مصادقة آراء الزبناء قبل ما يبانو فالموقع
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/auth.php';

admin_require_login();

$pdo = db();

// -------------------------------------------------------------------
// إجراءات: موافقة / رفض / حذف
// -------------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        http_response_code(400);
        die('انتهت صلاحية الجلسة. رجع للصفحة وعاود.');
    }

    $reviewId = (int) ($_POST['review_id'] ?? 0);
    $action   = (string) ($_POST['action'] ?? '');

    if ($reviewId > 0 && in_array($action, ['approve', 'reject', 'delete'], true)) {
        if ($action === 'approve') {
            $pdo->prepare('UPDATE reviews SET status = "approved", approved_at = NOW() WHERE id = :id')
                ->execute(['id' => $reviewId]);
        } elseif ($action === 'reject') {
            $pdo->prepare('UPDATE reviews SET status = "rejected", approved_at = NULL WHERE id = :id')
                ->execute(['id' => $reviewId]);
        } elseif ($action === 'delete') {
            $pdo->prepare('DELETE FROM reviews WHERE id = :id')->execute(['id' => $reviewId]);
        }
    }

    header('Location: reviews.php?status=' . urlencode((string) ($_GET['status'] ?? 'pending')));
    exit;
}

// -------------------------------------------------------------------
// عرض القائمة (مفلترة بالحالة)
// -------------------------------------------------------------------
$status = $_GET['status'] ?? 'pending';
if (!in_array($status, ['pending', 'approved', 'rejected', 'all'], true)) {
    $status = 'pending';
}

$sql = 'SELECT * FROM reviews';
$params = [];
if ($status !== 'all') {
    $sql .= ' WHERE status = :status';
    $params['status'] = $status;
}
$sql .= ' ORDER BY created_at DESC LIMIT 200';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$reviews = $stmt->fetchAll();

$counts = $pdo->query('SELECT status, COUNT(*) AS cnt FROM reviews GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);

$csrf = csrf_token();
$packLabels = ['bdaya' => 'BDAYA', 'mo9awala' => 'MO9AWALA', 'lkra' => 'L-KRA'];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>آراء الزبناء — لوحة التحكم MAW9I3I.PRO</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=Cairo:wght@700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a;--card:#141414}
  *{box-sizing:border-box}
  body{margin:0;background:var(--black);color:#f0f0f0;font-family:'Tajawal',Arial,sans-serif}
  header{display:flex;justify-content:space-between;align-items:center;padding:18px 26px;border-bottom:1px solid rgba(212,175,55,.25)}
  header .brand{color:var(--gold);font-family:'Cairo',sans-serif;font-weight:900;font-size:18px}
  header nav a{color:#aaa;text-decoration:none;font-size:13px;border:1px solid #333;padding:7px 14px;border-radius:8px;margin-inline-start:8px}
  header nav a:hover, header nav a.active{border-color:var(--gold);color:var(--gold)}
  main{padding:24px;max-width:980px;margin:0 auto}
  .tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
  .tabs a{padding:8px 16px;border-radius:20px;border:1px solid #333;color:#ccc;text-decoration:none;font-size:13px}
  .tabs a.active{background:var(--gold);color:#111;border-color:var(--gold);font-weight:800}
  .review{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px;margin-bottom:14px}
  .review-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px}
  .name{font-weight:800;font-size:15px}
  .stars{color:var(--gold);font-size:15px;letter-spacing:2px}
  .meta{color:#777;font-size:12px}
  .comment{color:#ddd;font-size:14px;line-height:1.8;margin-bottom:14px;white-space:pre-wrap}
  .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .status-pending{background:rgba(212,175,55,.15);color:var(--gold)}
  .status-approved{background:rgba(72,199,116,.15);color:#48c774}
  .status-rejected{background:rgba(224,82,82,.15);color:#e05252}
  .actions{display:flex;gap:8px}
  .actions button{border:none;border-radius:7px;padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit}
  .btn-approve{background:#48c774;color:#062;}
  .btn-reject{background:#3a2020;color:#e88;border:1px solid #5a2c2c !important}
  .btn-delete{background:transparent;color:#888;border:1px solid #333 !important}
  .empty{text-align:center;color:#666;padding:40px}
</style>
</head>
<body>
<header>
  <div class="brand">MAW9I3I.PRO — آراء الزبناء</div>
  <nav>
    <a href="index.php">لوحة التحكم</a>
    <a href="logout.php">خروج ⏻</a>
  </nav>
</header>
<main>
  <div class="tabs">
    <a href="?status=pending" class="<?= $status === 'pending' ? 'active' : '' ?>">فالانتظار (<?= (int) ($counts['pending'] ?? 0) ?>)</a>
    <a href="?status=approved" class="<?= $status === 'approved' ? 'active' : '' ?>">مصادق عليها (<?= (int) ($counts['approved'] ?? 0) ?>)</a>
    <a href="?status=rejected" class="<?= $status === 'rejected' ? 'active' : '' ?>">مرفوضة (<?= (int) ($counts['rejected'] ?? 0) ?>)</a>
    <a href="?status=all" class="<?= $status === 'all' ? 'active' : '' ?>">الكل</a>
  </div>

  <?php foreach ($reviews as $r): ?>
  <div class="review">
    <div class="review-head">
      <div>
        <div class="name"><?= h($r['customer_name']) ?>
          <span class="pill status-<?= h($r['status']) ?>"><?= ['pending' => 'فالانتظار', 'approved' => 'مصادق عليه', 'rejected' => 'مرفوض'][$r['status']] ?></span>
        </div>
        <div class="stars"><?= str_repeat('★', (int) $r['rating']) . str_repeat('☆', 5 - (int) $r['rating']) ?></div>
        <div class="meta">
          <?= h(date('Y-m-d H:i', strtotime($r['created_at']))) ?>
          <?php if ($r['pack_slug']): ?> — <?= h($packLabels[$r['pack_slug']] ?? $r['pack_slug']) ?><?php endif; ?>
          — IP: <span dir="ltr"><?= h($r['ip_address'] ?? '—') ?></span>
        </div>
      </div>
    </div>
    <div class="comment"><?= h($r['comment']) ?></div>
    <div class="actions">
      <?php if ($r['status'] !== 'approved'): ?>
      <form method="post" style="display:inline">
        <input type="hidden" name="csrf_token" value="<?= h($csrf) ?>">
        <input type="hidden" name="review_id" value="<?= (int) $r['id'] ?>">
        <input type="hidden" name="action" value="approve">
        <button type="submit" class="btn-approve">✓ موافقة</button>
      </form>
      <?php endif; ?>
      <?php if ($r['status'] !== 'rejected'): ?>
      <form method="post" style="display:inline">
        <input type="hidden" name="csrf_token" value="<?= h($csrf) ?>">
        <input type="hidden" name="review_id" value="<?= (int) $r['id'] ?>">
        <input type="hidden" name="action" value="reject">
        <button type="submit" class="btn-reject">✕ رفض</button>
      </form>
      <?php endif; ?>
      <form method="post" style="display:inline" onsubmit="return confirm('متأكد بغيتي تحذف هاد الرأي نهائيا؟');">
        <input type="hidden" name="csrf_token" value="<?= h($csrf) ?>">
        <input type="hidden" name="review_id" value="<?= (int) $r['id'] ?>">
        <input type="hidden" name="action" value="delete">
        <button type="submit" class="btn-delete">🗑 حذف نهائي</button>
      </form>
    </div>
  </div>
  <?php endforeach; ?>

  <?php if (!$reviews): ?>
  <div class="empty">ماكاين حتى رأي فهاد القسم.</div>
  <?php endif; ?>
</main>
</body>
</html>
