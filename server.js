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
      raw_webhook_payload    TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at                TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);`);
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
// 2bis) Site statique (index.html, index-fr.html, index-en.html, script.js,
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
const PACKS = {
  bdaya:    { label: 'Pack BDAYA',           amount_dh: 499  },
  mo9awala: { label: 'Pack MO9AWALA SGHIRA', amount_dh: 1499 },
  lkra:     { label: 'Pack L-KRA (mensuel)', amount_dh: 199  },
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

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const amountCentimes = Math.round(pack.amount_dh * 100); // Tokenize attend le montant en unite minimale (centimes)
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
             (order_id, pack_slug, pack_label, amount_dh, customer_name, customer_email, customer_phone, youcan_token_id, youcan_transaction_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
          [orderId, pack_slug, pack.label, pack.amount_dh, customerName, customerEmail, customerPhone, ycData.token, ycData.transaction_id || null]
        );
      } catch (dbErr) {
        console.error('[DB] تعذر تسجيل الطلب ' + orderId + ' (الأداء غادي يكمل رغم ذلك):', dbErr.message);
      }
    } else {
      console.error('[DB] القاعدة غير جاهزة — الطلب ' + orderId + ' ماتسجلش!');
    }

    // Log de la tentative de paiement
    console.log('[order] ' + orderId + ' - ' + pack.label + ' - ' + pack.amount_dh + ' DH - transaction_id=' + ycData.transaction_id);

    return res.json({
      success: true,
      order_id: orderId,
      token: ycData.token,
      transaction_id: ycData.transaction_id,
      public_key: YOUCAN_PUBLIC_KEY,
      sandbox: IS_SANDBOX,
      amount_dh: pack.amount_dh,
      pack_label: pack.label,
    });
  } catch (err) {
    console.error('[YouCan Pay] Erreur de connexion:', err);
    return res.status(502).json({ success: false, message: 'Impossible de contacter le service de paiement. Reessayez.' });
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
      if (payment.customer_email) {
        sendEmail(
          payment.customer_email,
          '🎉 تم تأكيد أدائك — ' + payment.pack_label,
          emailTemplate('تم الأداء بنجاح ✅', `
            <p>سلام ${escapeHtml(payment.customer_name || '')}،</p>
            <p>توصلنا بأداء <strong>${escapeHtml(payment.pack_label)}</strong> بالكامل (${Number(payment.amount_dh).toFixed(2)} DH).</p>
            <p>سيتواصل معك فريقنا قريبا لبداية العمل. شكرا على ثقتك 🙏</p>
            <p style="color:#888;font-size:12px">رقم الطلب: ${escapeHtml(orderId)}</p>`)
        ).catch(() => {});
      }
      if (ADMIN_EMAIL) {
        sendEmail(
          ADMIN_EMAIL,
          '💰 أداء جديد — ' + payment.pack_label,
          emailTemplate('أداء جديد', `
            <p>الزبون: ${escapeHtml(payment.customer_name || '—')} — ${escapeHtml(payment.customer_email || '—')} — ${escapeHtml(payment.customer_phone || '—')}</p>
            <p>الباك: ${escapeHtml(payment.pack_label)} — المبلغ: ${Number(payment.amount_dh).toFixed(2)} DH</p>
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

ensureSchema()
  .catch((err) => console.error('[DB] فشل تجهيز الجدول (السيرفر غادي يخدم رغم ذلك، لكن الدفعات ماغاديش تتسجل):', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log('Payment backend listening on port ' + PORT + ' - sandbox=' + IS_SANDBOX + ' - db=' + (dbReady ? 'ready' : 'unavailable'));
    });
  });
