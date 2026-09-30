<?php
/**
 * pay/status.php
 * -----------------------------------------------------------------------
 * نقطة API صغيرة (JSON) كتستعملها success.php عبر JavaScript باش تتأكد
 * واش الـ webhook وصل وبدل حالة الدفعة لـ "paid" (تفادي مشكل السباق:
 * المتصفح يرجع للموقع قبل ما يوصل الـ webhook بشوية).
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

$orderId = trim((string) ($_GET['order_id'] ?? ''));

if ($orderId === '') {
    json_response(['status' => 'unknown'], 400);
}

$stmt = db()->prepare('SELECT status, amount_dh, pack_slug FROM payments WHERE order_id = :order_id LIMIT 1');
$stmt->execute(['order_id' => $orderId]);
$payment = $stmt->fetch();

if (!$payment) {
    json_response(['status' => 'unknown']);
}

json_response([
    'status'    => $payment['status'],
    'amount_dh' => $payment['amount_dh'],
    'pack_slug' => $payment['pack_slug'],
]);
