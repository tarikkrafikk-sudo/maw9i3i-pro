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
// ⭐ reviews.js (الفرونت) كيصيفط POST /reviews/submit.php بـ
// Content-Type: application/x-www-form-urlencoded (ماشي JSON) - خاصنا هاد
// الـ middleware باش req.body يخدم فهاد الطلب.
app.use(express.urlencoded({ extended: false }));

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

  // ⭐ جدول آراء الزبناء (reviews.js فالفرونت كيستهدف /reviews/list.php و
  // /reviews/submit.php - الباكند القديم PHP تمسح، هادو العمود بديل Node).
  // status='pending' بالدفو: الرأي ما كيبانش فالموقع حتى تتصادق عليه من /admin
  // (نفس الرسالة لي كاينة فالفرونت: "رأيك غادي يبان فالموقع من بعد المراجعة").
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      comment       TEXT NOT NULL,
      rating        SMALLINT NOT NULL,
      pack_slug     TEXT,
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      submitter_ip  TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_submitter_ip ON reviews(submitter_ip);`);

  dbReady = true;
  console.log('[DB] الجداول payments و reviews جاهزين.');
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
  <body style="margin:0;background:#0a0a0a;font-family:Tajawal,Arial,sans-serif;color:#f5f5f5">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px">
      <div style="background:#141414;border:1px solid #D4AF37;border-radius:10px;padding:28px">
        <div style="color:#D4AF37;font-weight:700;font-size:20px;margin-bottom:18px">MAW9I3I.PRO</div>
        <h1 style="color:#D4AF37;font-size:20px;margin:0 0 16px">${title}</h1>
        ${bodyHtml}
      </div>
      <div style="margin-top:24px;color:#777;font-size:12px;text-align:center">MAW9I3I.PRO — Votre site web sur commande</div>
    </div>
  </body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!mailTransporter) {
    console.warn('[MAIL] تخطي إرسال إيميل لـ ' + to + ' (SMTP غير معمر): ' + subject);
    return false;
  }
  try {
    await mailTransporter.sendMail({
      from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error('[MAIL] فشل إرسال إيميل لـ ' + to + ':', err.message);
    return false;
  }
}

// -----------------------------------------------------------------------
// 2) CORS - uniquement votre domaine principal, jamais "*"
// -----------------------------------------------------------------------
const allowedOrigins = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // origin est undefined pour les requetes serveur-a-serveur (curl, Postman...) - on les autorise
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed -> ' + origin));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
}));

// -----------------------------------------------------------------------
// 2bis) Basic Auth ديال /admin - نفس طريقة timingSafeEqual لي مستعملة فالـ
//       webhook (تفادي "timing attack") باش محدش يقدر يخمن الباسوورد بسرعة.
// -----------------------------------------------------------------------
function requireAdminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin not configured: ADMIN_PASSWORD manquant dans Render.');
  }
  const header = req.headers['authorization'] || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) {
    res.set('WWW-Authenticate', 'Basic realm="Admin MAW9I3I.PRO"');
    return res.status(401).send('Authentication required.');
  }
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch (e) {
    res.set('WWW-Authenticate', 'Basic realm="Admin MAW9I3I.PRO"');
    return res.status(401).send('Authentication required.');
  }
  const sepIdx = decoded.indexOf(':');
  const password = sepIdx >= 0 ? decoded.slice(sepIdx + 1) : decoded;
  const passBuf = Buffer.from(password);
  const expBuf = Buffer.from(ADMIN_PASSWORD);
  const valid = passBuf.length === expBuf.length && crypto.timingSafeEqual(passBuf, expBuf);
  if (!valid) {
    res.set('WWW-Authenticate', 'Basic realm="Admin MAW9I3I.PRO"');
    return res.status(401).send('Invalid credentials.');
  }
  next();
}

// -----------------------------------------------------------------------
// 2ter) Site statique (index.html, index-fr.html, index-en.html, script.js,
//       assets/, images/, docs/...) - sert le vrai site en plus de l'API.
// -----------------------------------------------------------------------
// IMPORTANT : on ne monte PAS express.static sur tout le dossier du projet,
// parce que ce depot contient aussi un ancien backend PHP (config/, includes/,
// pay/, admin/, reviews/) qui ne doit JAMAIS etre servi tel quel en fichiers
// statiques (config/config.php contient potentiellement des identifiants de
// base de donnees - le servir en brut serait une fuite de securite). On
// autorise donc explicitement uniquement ce qui est public.
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index-fr.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index-fr.html')));
app.get('/index-en.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index-en.html')));

// ⭐ لوحة الإدارة (محمية بـ ADMIN_PASSWORD) + صفحة أداء الباقي (70%) - عمومية
// (أي واحد عندو الرابط السري يقدر يفتحها، بحال أي رابط أداء عادي).
app.get('/admin', requireAdminAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/admin.html', requireAdminAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/pay-final.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pay-final.html')));

['script.js', 'style.css', 'robots.txt'].forEach((file) => {
  app.get('/' + file, (req, res, next) => {
    res.sendFile(path.join(PUBLIC_DIR, file), (err) => {
      if (err) next(); // le fichier n'existe pas forcement (ex: pas de style.css) -> 404 normal
    });
  });
});

// Dossiers publics (feuilles de style, JS, images, docs) - eux, sans danger a exposer en entier
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use('/docs', express.static(path.join(PUBLIC_DIR, 'docs')));

// -----------------------------------------------------------------------
// 3) Prix des packs - definis COTE SERVEUR uniquement !
// -----------------------------------------------------------------------
// Ne jamais faire confiance a un montant envoye par le frontend
// (req.body.amount) : n'importe qui peut le modifier depuis DevTools et
// payer 1 DH au lieu de 1499 DH. Le prix est toujours lu ici, a partir du
// pack_slug envoye par le client.
// Modifiez/ajoutez des packs selon vos produits reels.
// ⭐ زدنا deposit_dh (30%) و allow_deposit: الزبون يقدر يختار يخلص عربون 30%
// (والباقي عند التسليم) ولا السعر الكامل دابا. L-KRA (اشتراك شهري) ماعندوش
// هاد الخيار — كيتخلص كامل كل مرة (allow_deposit:false).
const PACKS = {
  bdaya:    { label: 'Pack BDAYA',           amount_dh: 499,  deposit_dh: 150,  allow_deposit: true  },
  mo9awala: { label: 'Pack MO9AWALA SGHIRA', amount_dh: 1499, deposit_dh: 450,  allow_deposit: true  },
  lkra:     { label: 'Pack L-KRA (mensuel)', amount_dh: 199,  deposit_dh: 199,  allow_deposit: false },
};

// -----------------------------------------------------------------------
// 4) Rate limiting simple en memoire (20 requetes/minute par IP) - suffisant
//    contre le spam basique. Si le trafic est important, remplacez par Redis.
// -----------------------------------------------------------------------
const hits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60000;
  const entry = hits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > 20;
}

function getClientIp(req) {
  // ⚠️ مهم: كنقراو آخر IP فسلسلة X-Forwarded-For (اللي زادها Render نفسو)، ماشي
  // أول واحد. أول قيمة فهاد الهيدر كيقدر يزيدها الزبون نفسو (كتبعتو من عندو مع
  // الطلب)، يعني قابلة للتزوير بالكامل: بمجرد ما يبدل قيمتها فكل طلب، كان
  // كيقدر يدوّر الـ rate limit (كل "IP" مزيف كيبدا عداد جديد). القيمة الموثوقة
  // الوحيدة هي الأخيرة، لأنها هي لي Render ديالنا زادها بنفسها (بلا ما يقدر
  // الزبون يبدلها).
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',').pop().trim();
  return req.socket.remoteAddress || '0.0.0.0';
}

function safeString(v, max) {
  max = max || 150;
  return String(v == null ? '' : v).trim().slice(0, max);
}

// -----------------------------------------------------------------------
// 4bis) CSRF ديال فورم الآراء (/pay/csrf.php, /reviews/submit.php) - توكن
// موقع (HMAC) بلا حاجة لـ session/cookie-parser: التوكن فيه timestamp +
// توقيع، كنتحققو منو عند submit بلا ما نخزنو تا حاجة فالسيرفر. السر كيتولد
// عشوائي عند كل deploy (كافي لهاد الاستعمال - حماية ضد spam bots، ماشي
// معلومة حساسة بحال مفاتيح YouCan Pay).
// -----------------------------------------------------------------------
const REVIEWS_CSRF_SECRET = crypto.randomBytes(32).toString('hex');
const CSRF_MAX_AGE_MS = 2 * 60 * 60 * 1000; // ساعتين

function makeCsrfToken() {
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', REVIEWS_CSRF_SECRET).update(ts).digest('hex');
  return ts + '.' + sig;
}

function verifyCsrfToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return false;
  const [ts, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', REVIEWS_CSRF_SECRET).update(ts).digest('hex');
  const sigBuf = Buffer.from(sig || '');
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const tsNum = parseInt(ts, 36);
  if (!tsNum || Date.now() - tsNum > CSRF_MAX_AGE_MS) return false;
  return true;
}

// -----------------------------------------------------------------------
// 5) POST /api/pay - cree un token de paiement chez YouCan Pay
// -----------------------------------------------------------------------
app.post('/api/pay', async (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Trop de requetes. Reessayez dans un instant.' });
  }

  if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
    return res.status(500).json({ success: false, message: 'Le service n\'est pas encore configure. Contactez le support.' });
  }

  const body = req.body || {};
  const pack_slug = body.pack_slug;
  const customer = body.customer || {};
  const pack = PACKS[pack_slug];

  if (!pack) {
    return res.status(400).json({ success: false, message: 'Pack inconnu.' });
  }

  // ⭐ اختيار الزبون: عربون 30% ولا السعر الكامل. السعر ديما كيتحسب من هنا
  // (server-side) على حساب الـ pack، بلا ما نتاقو على أي مبلغ جاي من الفرونت.
  const requestedType = body.payment_type === 'deposit' && pack.allow_deposit ? 'deposit' : 'full';
  const amount_dh = requestedType === 'deposit' ? pack.deposit_dh : pack.amount_dh;
  const remaining_dh = requestedType === 'deposit' ? Math.round((pack.amount_dh - pack.deposit_dh) * 100) / 100 : 0;

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const amountCentimes = Math.round(amount_dh * 100); // Tokenize attend le montant en unite minimale (centimes)
  const customerName = customer.name ? safeString(customer.name) : null;
  const customerEmail = customer.email ? safeString(customer.email, 190) : null;
  const customerPhone = customer.phone ? safeString(customer.phone, 30) : null;

  try {
    const form = new FormData(); // FormData native (fetch) - Node 18+
    form.append('pri_key', YOUCAN_PRIVATE_KEY);
    form.append('order_id', orderId);
    form.append('amount', String(amountCentimes));
    form.append('currency', 'MAD');
    form.append('success_url', SUCCESS_URL);
    form.append('error_url', ERROR_URL);
    form.append('metadata[pack_slug]', pack_slug);
    form.append('metadata[payment_type]', requestedType);
    form.append('metadata[source]', 'maw9i3i-pro-website');

    if (customerName)  form.append('customer[name]', customerName);
    if (customerEmail) form.append('customer[email]', customerEmail);
    if (customerPhone) form.append('customer[phone]', customerPhone);

    const ycRes = await fetch(TOKENIZE_URL, { method: 'POST', body: form });
    const ycData = await ycRes.json().catch(() => ({}));

    if (!ycRes.ok || !ycData.token) {
      console.error('[YouCan Pay] Tokenize a echoue:', ycRes.status, ycData);
      return res.status(502).json({
        success: false,
        message: ycData.message || 'Impossible de demarrer le paiement chez YouCan Pay.',
      });
    }

    // تسجيل الدفعة "pending" فقاعدة البيانات — هادي لي كتخلي الـ webhook (تحت)
    // يقدر يلقى الطلب ويأكده من بعد. إلا فشل هاد التسجيل (مشكل عابر فالقاعدة)،
    // ما نوقفوش عملية الأداء الحقيقية (الزبون خاصو يقدر يأدي رغم ذلك) — غير
    // كنسجلو خطأ واضح فالـ log باش يتبان.
    if (dbReady) {
      try {
        await pool.query(
          `INSERT INTO payments
             (order_id, pack_slug, pack_label, amount_dh, customer_name, customer_email, customer_phone, youcan_token_id, youcan_transaction_id, status, payment_type, remaining_dh)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
          [orderId, pack_slug, pack.label, amount_dh, customerName, customerEmail, customerPhone, ycData.token, ycData.transaction_id || null, requestedType, remaining_dh]
        );
      } catch (dbErr) {
        console.error('[DB] تعذر تسجيل الطلب ' + orderId + ' (الأداء غادي يكمل رغم ذلك):', dbErr.message);
      }
    } else {
      console.error('[DB] القاعدة غير جاهزة — الطلب ' + orderId + ' ماتسجلش!');
    }

    // Log de la tentative de paiement
    console.log('[order] ' + orderId + ' - ' + pack.label + ' (' + requestedType + ') - ' + amount_dh + ' DH - transaction_id=' + ycData.transaction_id);

    return res.json({
      success: true,
      order_id: orderId,
      token: ycData.token,
      transaction_id: ycData.transaction_id,
      public_key: YOUCAN_PUBLIC_KEY,
      sandbox: IS_SANDBOX,
      amount_dh: amount_dh,
      remaining_dh: remaining_dh,
      payment_type: requestedType,
      pack_label: pack.label,
    });
  } catch (err) {
    console.error('[YouCan Pay] Erreur de connexion:', err);
    return res.status(502).json({ success: false, message: 'Impossible de contacter le service de paiement. Reessayez.' });
  }
});

// -----------------------------------------------------------------------
// 5bis) GET /api/pay/final/:token - صفحة أداء الباقي (70%) كتستعملها باش
//       تجيب token جديد ديال yp.js لنفس الطلب (parent). كنعاودو tokenize فـ
//       كل مرة (ماشي غير مرة وحدة من admin) باش ماتنتهيش صلاحية التوكن إلا
//       الزبون فتح الرابط من بعد شي يومين.
// -----------------------------------------------------------------------
app.get('/api/pay/final/:token', async (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Trop de requetes. Reessayez dans un instant.' });
  }
  if (!dbReady) {
    return res.status(503).json({ success: false, message: 'الخدمة غير جاهزة حاليا. حاول من بعد.' });
  }

  const token = safeString(req.params.token, 64);

  try {
    const { rows } = await pool.query(
      `SELECT * FROM payments WHERE final_link_token = $1 AND payment_type = 'final' LIMIT 1`,
      [token]
    );
    const payment = rows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'رابط الأداء غير صالح أو منتهي.' });
    }

    if (payment.status === 'paid') {
      return res.json({
        success: true,
        already_paid: true,
        pack_label: payment.pack_label,
        amount_dh: Number(payment.amount_dh),
      });
    }

    if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
      return res.status(500).json({ success: false, message: 'الخدمة غير معدة بعد. تواصل مع الدعم.' });
    }

    const amountCentimes = Math.round(Number(payment.amount_dh) * 100);
    const form = new FormData();
    form.append('pri_key', YOUCAN_PRIVATE_KEY);
    form.append('order_id', payment.order_id);
    form.append('amount', String(amountCentimes));
    form.append('currency', 'MAD');
    form.append('success_url', SUCCESS_URL);
    form.append('error_url', ERROR_URL);
    form.append('metadata[pack_slug]', payment.pack_slug);
    form.append('metadata[payment_type]', 'final');
    form.append('metadata[parent_order_id]', payment.parent_order_id || '');
    form.append('metadata[source]', 'maw9i3i-pro-website');
    if (payment.customer_name)  form.append('customer[name]', payment.customer_name);
    if (payment.customer_email) form.append('customer[email]', payment.customer_email);
    if (payment.customer_phone) form.append('customer[phone]', payment.customer_phone);

    const ycRes = await fetch(TOKENIZE_URL, { method: 'POST', body: form });
    const ycData = await ycRes.json().catch(() => ({}));

    if (!ycRes.ok || !ycData.token) {
      console.error('[YouCan Pay][final] Tokenize a echoue:', ycRes.status, ycData);
      return res.status(502).json({ success: false, message: 'تعذر تجهيز صفحة الأداء. حاول من جديد بعد قليل.' });
    }

    pool.query(`UPDATE payments SET youcan_token_id = $1 WHERE id = $2`, [ycData.token, payment.id]).catch(() => {});

    return res.json({
      success: true,
      already_paid: false,
      token: ycData.token,
      public_key: YOUCAN_PUBLIC_KEY,
      sandbox: IS_SANDBOX,
      amount_dh: Number(payment.amount_dh),
      pack_label: payment.pack_label,
      customer_name: payment.customer_name,
    });
  } catch (err) {
    console.error('[pay-final] خطأ:', err.message);
    return res.status(500).json({ success: false, message: 'خطأ فالسيرفر. حاول من جديد.' });
  }
});

// -----------------------------------------------------------------------
// 6) POST /api/pay/webhook - confirmation reelle du paiement
// -----------------------------------------------------------------------
// Ce que renvoie payment.confirm() cote frontend (result.status === 'succeeded')
// vient du navigateur du client : n'importe qui peut le falsifier depuis
// DevTools et pretendre avoir paye sans rien payer. La seule confirmation
// fiable est ce webhook, envoye par YouCan Pay serveur-a-serveur et signe en
// HMAC-SHA256. Ajoutez cette URL dans le Dashboard YouCan Pay :
//   https://maw9i3i-pro.onrender.com/api/pay/webhook
app.post('/api/pay/webhook', async (req, res) => {
  const signature = req.headers['x-youcanpay-signature'];
  const rawBody = req.body; // Buffer (grace a express.raw ci-dessus)

  if (!signature || !YOUCAN_PRIVATE_KEY) {
    return res.status(400).send('missing signature');
  }

  const expected = crypto
    .createHmac('sha256', YOUCAN_PRIVATE_KEY)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(String(signature));
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!valid) {
    console.warn('[webhook] Signature invalide - requete ignoree.');
    return res.status(403).send('invalid signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).send('invalid json');
  }

  console.log('[webhook] event:', event.event_name, JSON.stringify(event.payload));

  if (!dbReady) {
    console.error('[webhook] القاعدة غير جاهزة — ماقدرناش نأكدو الدفعة!');
    return res.status(200).send('ok'); // نأكدو الوصول لـ YouCan Pay باش ما يعاودش يبعث بلا توقف، لكن كنسجلو الخطأ
  }

  const transaction = (event.payload && event.payload.transaction) || event.payload || {};
  const orderId = transaction.order_id || event.order_id || null;
  const txnStatus = String(transaction.status || '').toLowerCase();
  const transactionId = transaction.id || event.transaction_id || null;

  if (!orderId) {
    console.error('[webhook] order_id غير موجود فالـ payload.');
    return res.status(400).send('missing order_id');
  }

  const isPaid = event.event_name === 'transaction.paid'
    || ['paid', 'succeeded', 'success', 'captured'].includes(txnStatus);
  const isFailed = event.event_name === 'transaction.failed'
    || ['failed', 'error', 'declined', 'cancelled', 'canceled'].includes(txnStatus);

  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1 LIMIT 1', [orderId]);
    const payment = rows[0];

    if (!payment) {
      console.error('[webhook] ماكاينش دفعة مسجلة بـ order_id=' + orderId);
      return res.status(404).send('payment not found');
    }

    // Idempotence: webhook مكرر (YouCan Pay كيعاود يبعث إلا ماوصلوش جواب 200) —
    // ما نعاودوش نبدلو الحالة ولا نصيفطو إيميلات زوج مرات.
    if (payment.status === 'paid') {
      return res.status(200).send('already processed');
    }

    if (isPaid) {
      await pool.query(
        `UPDATE payments SET status = 'paid', paid_at = now(),
           youcan_transaction_id = COALESCE($1, youcan_transaction_id),
           raw_webhook_payload = $2
         WHERE id = $3`,
        [transactionId, rawBody.toString('utf8').slice(0, 60000), payment.id]
      );

      // إيميل تأكيد للزبون + إشعار للإدارة (بلا ما نوقفو الجواب للـ webhook عليهم)
      const isDeposit = payment.payment_type === 'deposit';
      const isFinal = payment.payment_type === 'final';
      const remainingDh = Number(payment.remaining_dh || 0);
      const typeLabelAr = isFinal ? 'تكملة الباقي (70%)' : (isDeposit ? 'العربون (30%)' : 'الكامل');

      if (payment.customer_email) {
        sendEmail(
          payment.customer_email,
          (isFinal ? '🎉 تم تأكيد خلاص الباقي — ' : '🎉 تم تأكيد أدائك — ') + payment.pack_label,
          emailTemplate('تم الأداء بنجاح ✅', `
            <p>سلام ${escapeHtml(payment.customer_name || '')}،</p>
            <p>توصلنا بأداء <strong>${escapeHtml(typeLabelAr)}</strong> ديال <strong>${escapeHtml(payment.pack_label)}</strong> (${Number(payment.amount_dh).toFixed(2)} DH).</p>
            ${isDeposit ? `<p>الباقي <strong>${remainingDh.toFixed(2)} DH</strong> غادي يتخلص عند تسليم المشروع.</p>` : ''}
            ${isFinal ? `<p>بهاد الأداء كمّلتي خلاص <strong>${escapeHtml(payment.pack_label)}</strong> بالكامل. شكرا 🙏</p>` : ''}
            <p>سيتواصل معك فريقنا قريبا${isFinal ? ' لتسليم المشروع' : ' لبداية العمل'}. شكرا على ثقتك 🙏</p>
            <p style="color:#888;font-size:12px">رقم الطلب: ${escapeHtml(orderId)}</p>`)
        ).catch(() => {});
      }
      if (ADMIN_EMAIL) {
        sendEmail(
          ADMIN_EMAIL,
          '💰 أداء جديد (' + typeLabelAr + ') — ' + payment.pack_label,
          emailTemplate('أداء جديد', `
            <p>الزبون: ${escapeHtml(payment.customer_name || '—')} — ${escapeHtml(payment.customer_email || '—')} — ${escapeHtml(payment.customer_phone || '—')}</p>
            <p>الباك: ${escapeHtml(payment.pack_label)} — نوع الأداء: ${typeLabelAr} — المبلغ المؤدى: ${Number(payment.amount_dh).toFixed(2)} DH</p>
            ${isDeposit ? `<p style="color:#D4AF37"><strong>⚠️ باقي خاص تتبع: ${remainingDh.toFixed(2)} DH</strong> — خاصك تتواصل مع الزبون عند التسليم باش يخلصها (من لوحة /admin).</p>` : ''}
            ${isFinal ? `<p style="color:#4CAF50"><strong>✅ هادي تكملة الباقي ديال الطلب الأصلي: ${escapeHtml(payment.parent_order_id || '—')}</strong> — الزبون كمّل الخلاص بالكامل.</p>` : ''}
            <p>رقم الطلب: ${escapeHtml(orderId)}</p>`)
        ).catch(() => {});
      }
    } else if (isFailed) {
      await pool.query(
        `UPDATE payments SET status = 'failed', raw_webhook_payload = $1 WHERE id = $2`,
        [rawBody.toString('utf8').slice(0, 60000), payment.id]
      );
    } else {
      console.log('[webhook] حالة غير معالجة لـ order_id=' + orderId + ' status=' + txnStatus + ' event=' + event.event_name);
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('[webhook] خطأ أثناء المعالجة:', err.message);
    return res.status(500).send('processing error');
  }
});

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------
// 7) Health check (utile pour verifier que Render tourne bien)
// -----------------------------------------------------------------------
app.get('/api/pay/health', async (req, res) => {
  let dbStatus = 'disabled';
  if (pool) {
    try {
      await pool.query('SELECT 1');
      dbStatus = 'ok';
    } catch (err) {
      dbStatus = 'error: ' + err.message;
    }
  }
  res.json({
    ok: true,
    sandbox: IS_SANDBOX,
    tokenize_url: TOKENIZE_URL,
    db: dbStatus,
    mail_configured: Boolean(mailTransporter),
  });
});

// -----------------------------------------------------------------------
// 8) Admin API (محمي بـ requireAdminAuth) - تتبع الدفعات + توليد رابط أداء
//    الباقي (70%) على الدفعات لي فيهم عربون مخلص.
// -----------------------------------------------------------------------

// 8.1) GET /api/admin/payments - لائحة الدفعات (آخر 300)، بما فيهم صفوف
//      "final" (أداء الباقي) باش لوحة الإدارة تقدر تربطهم بالعربون الأصلي
//      عبر parent_order_id.
app.get('/api/admin/payments', requireAdminAuth, async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ success: false, message: 'القاعدة غير جاهزة حاليا.' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT id, order_id, pack_slug, pack_label, amount_dh, customer_name, customer_email,
             customer_phone, status, payment_type, remaining_dh, parent_order_id,
             final_link_token, created_at, paid_at
      FROM payments
      ORDER BY created_at DESC
      LIMIT 300
    `);
    res.json({ success: true, payments: rows, site_url: SITE_URL });
  } catch (err) {
    console.error('[admin] GET /api/admin/payments error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8.2) POST /api/admin/payments/:orderId/generate-final-link - كيولد رابط
//      سري (final_link_token) باش الزبون يخلص الباقي (70%) ديال عربون مخلص
//      من قبل. Idempotent: إلا كاين رابط pending من قبل لنفس الطلب،
//      كنعاودو نرجعوه بلا ما نديرو واحد جديد (ماشي نديرو tokenize دابا - غادي
//      يتدار tokenize فـ /api/pay/final/:token كل مرة الزبون يحل الرابط، باش
//      التوكن ديال yp.js ما يفوتوش الصلاحية إلا تسناو بزاف).
app.post('/api/admin/payments/:orderId/generate-final-link', requireAdminAuth, async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ success: false, message: 'القاعدة غير جاهزة حاليا.' });
  }
  const orderId = safeString(req.params.orderId, 80);

  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1 LIMIT 1', [orderId]);
    const payment = rows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود.' });
    }
    if (payment.payment_type !== 'deposit') {
      return res.status(400).json({ success: false, message: 'هاد الطلب ماشي عربون (deposit) — ماكاينش باقي خاص يتخلص.' });
    }
    if (payment.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'العربون ديال هاد الطلب مازال ماتخلصش.' });
    }
    const remainingDh = Math.round(Number(payment.remaining_dh || 0) * 100) / 100;
    if (remainingDh <= 0) {
      return res.status(400).json({ success: false, message: 'ماكاينش باقي خاص يتخلص لهاد الطلب.' });
    }

    // كاين ديجا رابط "final" لهاد الطلب؟
    const existing = await pool.query(
      `SELECT * FROM payments WHERE parent_order_id = $1 AND payment_type = 'final' ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (existing.rows[0]) {
      const ex = existing.rows[0];
      if (ex.status === 'paid') {
        return res.status(400).json({ success: false, message: 'الباقي ديال هاد الطلب متخلص من قبل.' });
      }
      return res.json({
        success: true,
        reused: true,
        link: SITE_URL + '/pay-final.html?t=' + ex.final_link_token,
        amount_dh: Number(ex.amount_dh),
        pack_label: payment.pack_label,
        customer_name: payment.customer_name,
      });
    }

    const finalOrderId = 'ORD-FINAL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const token = crypto.randomBytes(16).toString('hex');

    await pool.query(
      `INSERT INTO payments
         (order_id, pack_slug, pack_label, amount_dh, customer_name, customer_email, customer_phone,
          status, payment_type, remaining_dh, parent_order_id, final_link_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','final',0,$8,$9)`,
      [finalOrderId, payment.pack_slug, payment.pack_label, remainingDh, payment.customer_name,
       payment.customer_email, payment.customer_phone, orderId, token]
    );

    console.log('[admin] رابط أداء الباقي تولد: ' + finalOrderId + ' (parent=' + orderId + ', ' + remainingDh + ' DH)');

    return res.json({
      success: true,
      reused: false,
      link: SITE_URL + '/pay-final.html?t=' + token,
      amount_dh: remainingDh,
      pack_label: payment.pack_label,
      customer_name: payment.customer_name,
    });
  } catch (err) {
    console.error('[admin] generate-final-link error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------
// 9) آراء الزبناء (reviews.js) - الباكند PHP القديم (reviews/list.php،
//    reviews/submit.php، pay/csrf.php) تمسح نهائيا ومكاينش فهاد الـrepo
//    (Node فقط) - هادو الـroutes بديل، بنفس الأسماء/الـcontract بالضبط لي
//    كيستهدفهم reviews.js الحالي، باش ما نحتاجوش نبدلو تا والو فالفرونت.
// -----------------------------------------------------------------------

// 9.1) GET /pay/csrf.php - توكن مضاد للـ CSRF/bots، كيقرا reviews.js عند
//      فتح المودال وقبل submit.
app.get('/pay/csrf.php', (req, res) => {
  res.json({ csrf_token: makeCsrfToken() });
});

// 9.2) GET /reviews/list.php - غير الآراء المصادق عليها (status='approved')
//      + إحصائيات (معدل التقييم + العدد). reviews.js كيتسنى {ok, reviews, stats}.
app.get('/reviews/list.php', async (req, res) => {
  if (!dbReady) {
    return res.json({ ok: true, reviews: [], stats: { count: 0, avg_rating: 0 } });
  }
  try {
    const { rows } = await pool.query(
      `SELECT name, comment, rating, pack_slug AS pack
         FROM reviews
        WHERE status = 'approved'
        ORDER BY created_at DESC
        LIMIT 100`
    );
    const statsRow = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::float AS avg_rating
         FROM reviews WHERE status = 'approved'`
    );
    res.json({
      ok: true,
      reviews: rows,
      stats: { count: statsRow.rows[0].count, avg_rating: statsRow.rows[0].avg_rating },
    });
  } catch (err) {
    console.error('[reviews] list error:', err.message);
    res.json({ ok: true, reviews: [], stats: { count: 0, avg_rating: 0 } });
  }
});

// 9.3) POST /reviews/submit.php - استقبال رأي جديد (status='pending' حتى
//      تتصادق عليه من /admin). نفس error codes لي reviews.js كيعرفهم بالضبط
//      (t.errors.* فالفرونت): invalid_csrf, invalid_name, invalid_rating,
//      comment_too_short, comment_too_long, rate_limited, invalid_request, generic.
app.post('/reviews/submit.php', async (req, res) => {
  try {
    if (!dbReady) {
      return res.status(503).json({ ok: false, code: 'generic' });
    }

    const body = req.body || {};

    // ⭐ honeypot: حقل "website" مخفي بالكامل فالفورم (tabindex=-1، bla label) -
    // زبون حقيقي ماعمرو غايعمرو. إلا تعمر، معناها bot - كنرجعو "success" وهمي
    // بلا ما نسجلو تا حاجة، باش الـbot يحس أنو نجح وما يعاودش يحاول بطريقة أخرى.
    if (safeString(body.website, 200)) {
      return res.json({ ok: true });
    }

    if (!verifyCsrfToken(body.csrf_token)) {
      return res.status(400).json({ ok: false, code: 'invalid_csrf' });
    }

    const name = safeString(body.name, 80);
    const comment = safeString(body.comment, 1000);
    const rating = parseInt(body.rating, 10);
    let packSlug = safeString(body.pack_slug, 30);
    if (packSlug && !PACKS[packSlug]) packSlug = null; // قيمة غريبة -> كنتجاهلوها بدل ما نرفضو الرأي كامل

    if (!name) {
      return res.status(400).json({ ok: false, code: 'invalid_name' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, code: 'invalid_rating' });
    }
    if (comment.length < 10) {
      return res.status(400).json({ ok: false, code: 'comment_too_short' });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ ok: false, code: 'comment_too_long' });
    }

    const ip = getClientIp(req);

    // ⭐ حد أقصى: رأي وحد كل 24 ساعة لكل IP (نفس الرسالة اللي كاينة من قبل
    // فالفرونت: t.errors.rate_limited) - كنتحققو من القاعدة (ماشي من الذاكرة)
    // باش يبقى خدام حتى بعد إعادة تشغيل السيرفر.
    const last = await pool.query(
      `SELECT created_at FROM reviews WHERE submitter_ip = $1 ORDER BY created_at DESC LIMIT 1`,
      [ip]
    );
    if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < 24 * 60 * 60 * 1000) {
      return res.status(429).json({ ok: false, code: 'rate_limited' });
    }

    await pool.query(
      `INSERT INTO reviews (name, comment, rating, pack_slug, status, submitter_ip)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [name, comment, rating, packSlug, ip]
    );

    console.log('[reviews] رأي جديد فـ "pending" من ' + escapeHtml(name) + ' (' + rating + '★) - فانتظار المصادقة فـ /admin');

    return res.json({ ok: true });
  } catch (err) {
    console.error('[reviews] submit error:', err.message);
    return res.status(500).json({ ok: false, code: 'generic' });
  }
});

// -----------------------------------------------------------------------
// 9.4) مصادقة الآراء من /admin (محمية بـ ADMIN_PASSWORD، نفس نظام الدفعات)
// -----------------------------------------------------------------------
app.get('/api/admin/reviews', requireAdminAuth, async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ success: false, message: 'القاعدة غير جاهزة.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, comment, rating, pack_slug, status, created_at
         FROM reviews ORDER BY created_at DESC LIMIT 300`
    );
    res.json({ success: true, reviews: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/reviews/:id/approve', requireAdminAuth, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false, message: 'القاعدة غير جاهزة.' });
  try {
    await pool.query(`UPDATE reviews SET status = 'approved' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/reviews/:id/reject', requireAdminAuth, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false, message: 'القاعدة غير جاهزة.' });
  try {
    await pool.query(`UPDATE reviews SET status = 'rejected' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

ensureSchema()
  .catch((err) => console.error('[DB] فشل تجهيز الجدول (السيرفر غادي يخدم رغم ذلك، لكن الدفعات ماغاديش تتسجل):', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log('Payment backend listening on port ' + PORT + ' - sandbox=' + IS_SANDBOX + ' - db=' + (dbReady ? 'ready' : 'unavailable'));
    });
  });
