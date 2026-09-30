-- ============================================================================
-- MAW9I3I.PRO — Système de paiement (YouCan Pay)
-- قاعدة البيانات ديال نظام الأداء
-- ============================================================================
-- استعمال: استورد هاد الملف عبر phpMyAdmin أو mysql CLI:
--   mysql -u USER -p DB_NAME < database.sql
-- Charset: utf8mb4 (يدعم العربية والفرنسية بلا مشاكل)
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1) packs — الباكات المتوفرة (بداية، مقاولة صغيرة، الكراء)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `packs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL COMMENT 'اسم الباك للعرض (Pack BDAYA...)',
  `slug` VARCHAR(50) NOT NULL COMMENT 'bdaya, mo9awala, lkra',
  `total_price` INT UNSIGNED NOT NULL COMMENT 'السعر الكامل بالدرهم (DH)',
  `deposit_price` INT UNSIGNED NULL DEFAULT NULL COMMENT '30% للبدء بالدرهم (NULL إلا كان subscription)',
  `final_price` INT UNSIGNED NULL DEFAULT NULL COMMENT '70% الباقي بالدرهم (NULL إلا كان subscription)',
  `type` ENUM('unique','subscription') NOT NULL DEFAULT 'unique' COMMENT 'unique = مرة وحدة, subscription = كراء شهري',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_packs_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2) customers — الزبائن
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customers_email` (`email`),
  KEY `idx_customers_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3) payments — كل عمليات الأداء (كاملة، 30%، 70%، شهرية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `pack_slug` VARCHAR(50) NOT NULL,
  `amount_centimes` INT UNSIGNED NOT NULL COMMENT 'المبلغ بالسنتيم (MAD * 100) — هو لي كيتبعت لـ YouCan Pay',
  `amount_dh` DECIMAL(10,2) NOT NULL COMMENT 'المبلغ بالدرهم (amount_centimes / 100) — للعرض فقط',
  `payment_type` ENUM('full_100','deposit_30','final_70','subscription_monthly') NOT NULL,
  `order_id` VARCHAR(100) NOT NULL COMMENT 'معرف الطلب الفريد المرسل لـ YouCan Pay',
  `youcan_transaction_id` VARCHAR(150) NULL DEFAULT NULL COMMENT 'transaction_id الراجع من YouCan Pay',
  `youcan_token_id` VARCHAR(150) NULL DEFAULT NULL COMMENT 'token id ديال العملية (tokenize)',
  `status` ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` DATETIME NULL DEFAULT NULL,
  `parent_payment_id` INT UNSIGNED NULL DEFAULT NULL COMMENT 'كيربط final_70 بـ deposit_30 ديالو',
  `raw_webhook_payload` TEXT NULL DEFAULT NULL COMMENT 'نسخة من آخر webhook (للتتبع/الدعم)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payments_order_id` (`order_id`),
  KEY `idx_payments_customer` (`customer_id`),
  KEY `idx_payments_status` (`status`),
  KEY `idx_payments_pack` (`pack_slug`),
  KEY `idx_payments_parent` (`parent_payment_id`),
  CONSTRAINT `fk_payments_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_payments_parent` FOREIGN KEY (`parent_payment_id`) REFERENCES `payments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4) subscriptions — تتبع الحالة ديال كل مشروع/كراء (dossier ديال الزبون)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `pack_slug` VARCHAR(50) NOT NULL,
  `start_date` DATE NULL DEFAULT NULL,
  `expire_date` DATE NULL DEFAULT NULL COMMENT 'كيتستعمل غير مع L-KRA (subscription)',
  `status` ENUM('active','expired','pending_final_payment') NOT NULL DEFAULT 'pending_final_payment',
  `last_payment_id` INT UNSIGNED NULL DEFAULT NULL,
  `renewal_reminder_sent_at` DATETIME NULL DEFAULT NULL,
  `final_reminder_sent_at` DATETIME NULL DEFAULT NULL COMMENT 'آخر تذكير تسديد 70%',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subscriptions_customer` (`customer_id`),
  KEY `idx_subscriptions_status` (`status`),
  KEY `idx_subscriptions_expire` (`expire_date`),
  CONSTRAINT `fk_subscriptions_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_subscriptions_last_payment` FOREIGN KEY (`last_payment_id`) REFERENCES `payments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5) reviews — آراء/تقييمات الزبناء (نجوم + تعليق) — تحتاج موافقة الإدارة قبل ما تبان
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_name` VARCHAR(150) NOT NULL,
  `rating` TINYINT UNSIGNED NOT NULL COMMENT 'من 1 إلى 5',
  `comment` TEXT NOT NULL,
  `pack_slug` VARCHAR(50) NULL DEFAULT NULL COMMENT 'الباك لي جرب (اختياري)',
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `ip_address` VARCHAR(45) NULL DEFAULT NULL COMMENT 'لتفادي السبام (rate limiting)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reviews_status` (`status`),
  KEY `idx_reviews_created` (`created_at`),
  CONSTRAINT `chk_reviews_rating` CHECK (`rating` BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- بيانات أولية — الباكات الثلاثة (طابق مع ما تصرح به maw9i3i-pro.com)
-- ----------------------------------------------------------------------------
INSERT INTO `packs` (`name`, `slug`, `total_price`, `deposit_price`, `final_price`, `type`) VALUES
  ('Pack BDAYA',           'bdaya',    499,  150, 349, 'unique'),
  ('Pack MO9AWALA SGHIRA', 'mo9awala', 1499, 450, 1049, 'unique'),
  ('Pack L-KRA',           'lkra',     199, NULL, NULL, 'subscription')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `total_price` = VALUES(`total_price`),
  `deposit_price` = VALUES(`deposit_price`),
  `final_price` = VALUES(`final_price`),
  `type` = VALUES(`type`);

-- ----------------------------------------------------------------------------
-- آراء الزبناء الحقيقية — زيد هنا الأسطر ديال الآراء الحقيقية (status='approved'
-- باش يبانو مباشرة بلا ما تحتاج تصادق عليهم من /admin/reviews.php).
-- مثال:
-- INSERT INTO `reviews` (`customer_name`, `rating`, `comment`, `pack_slug`, `status`, `approved_at`) VALUES
--   ('اسم الزبون', 5, 'نص التعليق ديالو هنا...', 'bdaya', 'approved', NOW());
-- ----------------------------------------------------------------------------
