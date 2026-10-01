/**
 * server.js - Backend de paiement (YouCan Pay) - Maw9i3i.pro
 * =============================================================================
 * Deploye sur Render (maw9i3i-pro.onrender.com). Recoit les requetes AJAX du
 * modal de paiement (payment-modal.js) depuis www.maw9i3i-pro.com, appelle
 * l'API Tokenize de YouCan Pay, et renvoie du JSON propre (jamais une
 * redirection ni du HTML brut).
 *
 * IMPORTANT - correction par rapport a la demande initiale :
 * -----------------------------------------------------------------------
 * YouCan Pay ne documente aucune URL du type
 * "https://youcanpay.com/sandbox/payment-form/{token}" vers laquelle
 * rediriger le client. Le flux officiel (Tokenize -> yp.js) affiche le
 * formulaire de paiement directement DANS votre page via le widget embarque
 * yp.js - ce qui sert encore mieux votre besoin ("le modal reste sur le
 * domaine principal"), puisque le client ne quitte jamais maw9i3i-pro.com,
 * meme pas pour une redirection vers youcanpay.com.
 *
 * Ce serveur renvoie donc { token, public_key, ... } et c'est
 * payment-modal.js (cote frontend) qui monte le formulaire yp.js avec ce
 * token, a l'interieur du modal.
 *
 * Sources verifiees dans la documentation officielle avant d'ecrire ce code :
 * - Tokenize endpoint + champs :  https://developer.youcan.shop/youcan-pay/payment/tokenize
 * - Payment flow:                 https://developer.youcan.shop/youcan-pay/payment-flow
 * - yp.js (embed):                https://developer.youcan.shop/youcan-pay/yp-js/getting-started
 * - Webhooks (HMAC-SHA256):       https://developer.youcan.shop/youcan-pay/webhooks
 *
 * =============================================================================
 * زيادة (طلب ديال الزبون): تسجيل الدفعات فقاعدة بيانات + إيميل تأكيد حقيقي
 * -----------------------------------------------------------------------
 * قبل، الـ webhook كان غير كيدير console.log بلا ما يسجل والو ولا يصيفط
 * إيميل — يعني الزبون كيخلص وحتى واحد ما كيبقى ليه أثر. دابا:
 *   - كل طلب أداء كيتسجل فجدول `payments` (PostgreSQL) بحالة "pending".
 *   - webhook.php (هنا JS) كيبدل الحالة لـ "paid"/"failed" وكيصيفط إيميل
 *     تأكيد للزبون + إشعار للإدارة (ADMIN_EMAIL) عبر SMTP.
 *   - Idempotence: webhook مكرر (retry) ما كيعاودش يصيفط إيميلات.
 * إعدادات جديدة خاصها فـ Render (Environment Variables):
 *   - DATABASE_URL   (كتزاد وحدها إلا ربطتي PostgreSQL database فنفس الخدمة)
 *   - SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS  (أي مزود SMTP: Brevo،
 *     Mailgun، Gmail SMTP...) — إلا ماكانوش معمرين، الإيميلات غادي تتخطى
 *     (كيبقى غير log فـ console) بلا ما يوقف السيرفر.
 *   - MAIL_FROM / MAIL_FROM_NAME / ADMIN_EMAIL
 * =============================================================================
 */

'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const PUBLIC_DIR = __dirname;

// Raw body pour le webhook (necessaire pour verifier la signature), JSON normal pour le reste
app.use('/api/pay/webhook', express.raw({ type: '*/*' }));
app.use(express.json());

// -----------------------------------------------------------------------
// 1) Configuration - a definir dans Render (Environment Variables)
// -----------------------------------------------------------------------
const {
  YOUCAN_PRIVATE_KEY,                  // pri_sandbox_xxx (ou pri_live_xxx en production)
  YOUCAN_PUBLIC_KEY,                   // pub_sandbox_xxx (ou pub_live_xxx en production)
  YOUCAN_SANDBOX = 'true',             // 'true' en test, 'false' en production
  ALLOWED_ORIGIN = 'https://www.maw9i3i-pro.com,https://maw9i3i-pro.com',
  SUCCESS_URL = 'https://www.maw9i3i-pro.com/payment-success',
  ERROR_URL = 'https://www.maw9i3i-pro.com/payment-failed',
  SITE_URL = 'https://www.maw9i3i-pro.com', // ⭐ كنستعملوه باش نبنيو رابط pay-final.html
  PORT = 3000,
  DATABASE_URL,
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_SECURE,                         // 'true' إلا كان SMTP_PORT=465
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM = 'no-reply@maw9i3i-pro.com',
  MAIL_FROM_NAME = 'MAW9I3I.PRO',
  ADMIN_EMAIL,
  ADMIN_PASSWORD, // ⭐ كلمة السر ديال /admin — خاصك تزيدها فـ Render Environment Variables
} = process.env;

const IS_SANDBOX = YOUCAN_SANDBOX !== 'false';
const TOKENIZE_URL = IS_SANDBOX
  ? 'https://youcanpay.com/sandbox/api/tokenize'
  : 'https://youcanpay.com/api/tokenize';

if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
  // On ne bloque pas le demarrage (pour eviter une boucle de crash sur Render),
  // mais on log une erreur bien visible.
  console.error('[FATAL] YOUCAN_PRIVATE_KEY et/ou YOUCAN_PUBLIC_KEY manquants dans les variables d\'environnement !');
}

// -----------------------------------------------------------------------
// 1bis) قاعدة البيانات (PostgreSQL) — تسجيل الدفعات
// -----------------------------------------------------------------------
let pool = null;
let dbReady = false;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Render كيحتاج SSL للاتصالات الخارجية، ماشي بالضرورة للاتصال الداخلي
    // (بين خدمتين فنفس الحساب). كنخليو rejectUnauthorized:false باش يخدم فالحالتين
    // بلا ما نحتاجو شهادة CA زايدة.
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => console.error('[DB] خطأ غير متوقع فالـ pool:', err.message));
} else {
  console.error('[FATAL] DATABASE_URL غير محدد — الدفعات ماغاديش تتسجل!');
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                     SERIAL PRIMARY KEY,
      order_id               TEXT UNIQUE NOT NULL,
      pack_slug              TEXT NOT NULL,
      pack_label             TEXT NOT NULL,
      amount_dh              NUMERIC(10,2) NOT NULL,
      customer_name          TEXT,
      customer_email         TEXT,
      customer_phone         TEXT,
      youcan_token_id        TEXT,
      youcan_transaction_id  TEXT,
      status                 TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
      payment_type           TEXT NOT NULL DEFAULT 'full',    -- full | deposit (30%)
      remaining_dh           NUMERIC(10,2) NOT NULL DEFAULT 0, -- الباقي لي خاصو يتخلص (غير إلا deposit)
      raw_webhook_payload    TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at                TIMESTAMPTZ
    );
  `);
  // ⭐ الجدول ممكن كان كاين من قبل (الموقع live دابا) بلا هاد الأعمدة الجداد —
  // ALTER ... IF NOT EXISTS أمان: ما كيأثرش على الصفوف القديمة ولا كيرمي خطأ
  // إلا كانت الأعمدة موجودة من قبل.
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'full';`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS remaining_dh NUMERIC(10,2) NOT NULL DEFAULT 0;`);
  // ⭐ لتتبع "رابط أداء الباقي" (70%): parent_order_id كيربط صف "final" بالعربون
  // الأصلي، final_link_token هو السر اللي كيبان فرابط الأداء (ماشي order_id
  // مباشرة، باش ما يكونش سهل التخمين).
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS parent_order_id TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_link_token TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_final_link_token ON payments(final_link_token) WHERE final_link_token IS NOT NULL;`);
  dbReady = true;
  console.log('[DB] الجدول payments جاهز.');
}

// -----------------------------------------------------------------------
// 1ter) البريد الإلكتروني (SMTP عبر nodemailer) — إيميل تأكيد + إشعار إدارة
// -----------------------------------------------------------------------
let mailTransporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn('[MAIL] SMTP_HOST/SMTP_USER/SMTP_PASS غير معمرين — الإيميلات غادي تتخطى (غير log).');
}

function emailTemplate(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"></head>
  <body style="margin:0;background:#0a0a0a;font-family:Tajawal,Arial,sans-
