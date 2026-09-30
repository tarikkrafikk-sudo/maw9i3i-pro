<?php
/**
 * reviews/list.php
 * -----------------------------------------------------------------------
 * كيرجع الآراء المصادق عليها (JSON) باش تعرضهم reviews.js فالصفحة الرئيسية.
 * -----------------------------------------------------------------------
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/functions.php';

header('Access-Control-Allow-Origin: ' . SITE_URL);
header('Cache-Control: public, max-age=60'); // كاش خفيف (دقيقة) باش ما نثقلوش السيرفر

$reviews = get_approved_reviews(50);
$stats   = get_review_stats();

$out = array_map(function ($r) {
    return [
        'name'    => $r['customer_name'],
        'rating'  => (int) $r['rating'],
        'comment' => $r['comment'],
        'pack'    => $r['pack_slug'],
        'date'    => date('Y-m-d', strtotime($r['created_at'])),
    ];
}, $reviews);

json_response(['ok' => true, 'reviews' => $out, 'stats' => $stats]);
