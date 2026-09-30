<?php
/**
 * admin/login.php — صفحة دخول لوحة التحكم
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/auth.php';

admin_session_start();

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        $error = 'انتهت صلاحية الجلسة. عاود المحاولة.';
    } else {
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if (hash_equals(ADMIN_USERNAME, $username) && admin_check_password($password)) {
            // منع session fixation
            session_regenerate_id(true);
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_username']  = $username;
            header('Location: index.php');
            exit;
        }
        $error = 'المعلومات غير صحيحة.';
        sleep(1); // تبطيء بسيط ضد محاولات التخمين المتكررة
    }
}

if (admin_is_logged_in()) {
    header('Location: index.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>دخول لوحة التحكم — MAW9I3I.PRO</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  :root{--gold:#D4AF37;--black:#0a0a0a}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--black);color:#f5f5f5;font-family:'Tajawal',Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;padding:20px}
  form{background:#141414;border:1px solid rgba(212,175,55,.3);border-radius:14px;padding:32px;max-width:360px;width:100%}
  h1{color:var(--gold);font-size:20px;text-align:center;margin:0 0 24px}
  label{display:block;font-size:13px;color:#999;margin-bottom:6px}
  input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#1c1c1c;color:#fff;margin-bottom:16px;font-family:inherit}
  input:focus{outline:none;border-color:var(--gold)}
  button{width:100%;padding:13px;background:var(--gold);color:#111;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit}
  .error{background:rgba(224,82,82,.12);color:#e05252;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;text-align:center}
</style>
</head>
<body>
<form method="post" autocomplete="off">
  <h1>لوحة تحكم MAW9I3I.PRO</h1>
  <?php if ($error): ?><div class="error"><?= h($error) ?></div><?php endif; ?>
  <input type="hidden" name="csrf_token" value="<?= h(csrf_token()) ?>">
  <label>اسم المستخدم</label>
  <input type="text" name="username" required autofocus>
  <label>كلمة السر</label>
  <input type="password" name="password" required>
  <button type="submit">دخول</button>
</form>
</body>
</html>
