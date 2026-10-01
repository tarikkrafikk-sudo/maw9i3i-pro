/**
 * server.js - Backend de paiement (YouCan Pay) - Maw9i3i.pro
 * =============================================================================
 * Deploye sur Render (maw9i3i-pro.onrender.com). Recoit les requetes AJAX du
 * modal de paiement (payment-modal.js) depuis www.maw9i3i-pro.com, appelle
 * l'API Tokenize de YouCan Pay, et renvoie du JSON propre (jamais une
 * redirection ni du HTML brut).
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

app.use('/api/pay/webhook', express.raw({ type: '*/*' }));
app.use(express.json());

const {
  YOUCAN_PRIVATE_KEY,
  YOUCAN_PUBLIC_KEY,
  YOUCAN_SANDBOX = 'true',
  ALLOWED_ORIGIN = 'https://www.maw9i3i-pro.com,https://maw9i3i-pro.com',
  SUCCESS_URL = 'https://www.maw9i3i-pro.com/payment-success',
  ERROR_URL = 'https://www.maw9i3i-pro.com/payment-failed',
  PORT = 3000,
  DATABASE_URL,
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_SECURE,
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
  console.error('[FATAL] YOUCAN_PRIVATE_KEY et/ou YOUCAN_PUBLIC_KEY manquants dans les variables d\'environnement !');
}

let pool = null;
let dbReady = false;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
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
      status                 TEXT NOT NULL DEFAULT 'pending',
      payment_type           TEXT NOT NULL DEFAULT 'full',
      remaining_dh           NUMERIC(10,2) NOT NULL DEFAULT 0,
      raw_webhook_payload    TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at                TIMESTAMPTZ
    );
  `);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'full';`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS remaining_dh NUMERIC(10,2) NOT NULL DEFAULT 0;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);`);
  dbReady = true;
  console.log('[DB] الجدول payments جاهز.');
}

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

const allowedOrigins = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed -> ' + origin));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
}));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index-fr.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index-fr.html')));
app.get('/index-en.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index-en.html')));

['script.js', 'style.css', 'robots.txt'].forEach((file) => {
  app.get('/' + file, (req, res, next) => {
    res.sendFile(path.join(PUBLIC_DIR, file), (err) => {
      if (err) next();
    });
  });
});

app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use('/docs', express.static(path.join(PUBLIC_DIR, 'docs')));

const PACKS = {
  bdaya:    { label: 'Pack BDAYA',           amount_dh: 499,  deposit_dh: 150,  allow_deposit: true  },
  mo9awala: { label: 'Pack MO9AWALA SGHIRA', amount_dh: 1499, deposit_dh: 450,  allow_deposit: true  },
  lkra:     { label: 'Pack L-KRA (mensuel)', amount_dh: 199,  deposit_dh: 199,  allow_deposit: false },
};

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
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',').pop().trim();
  return req.socket.remoteAddress || '0.0.0.0';
}

function safeString(v, max) {
  max = max || 150;
  return String(v == null ? '' : v).trim().slice(0, max);
}

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

  const requestedType = body.payment_type === 'deposit' && pack.allow_deposit ? 'deposit' : 'full';
  const amount_dh = requestedType === 'deposit' ? pack.deposit_dh : pack.amount_dh;
  const remaining_dh = requestedType === 'deposit' ? Math.round((pack.amount_dh - pack.deposit_dh) * 100) / 100 : 0;

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const amountCentimes = Math.round(amount_dh * 100);
  const customerName = customer.name ? safeString(customer.name) : null;
  const customerEmail = customer.email ? safeString(customer.email, 190) : null;
  const customerPhone = customer.phone ? safeString(customer.phone, 30) : null;

  try {
    const form = new FormData();
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

app.post('/api/pay/webhook', async (req, res) => {
  const signature = req.headers['x-youcanpay-signature'];
  const rawBody = req.body;

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
    return res.status(200).send('ok');
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

      const isDeposit = payment.payment_type === 'deposit';
      const remainingDh = Number(payment.remaining_dh || 0);

      if (payment.customer_email) {
        sendEmail(
          payment.customer_email,
          '🎉 تم تأكيد أدائك — ' + payment.pack_label,
          emailTemplate('تم الأداء بنجاح ✅', `
            <p>سلام ${escapeHtml(payment.customer_name || '')}،</p>
            <p>توصلنا بأداء ${isDeposit ? '<strong>العربون (30%)</strong>' : '<strong>الكامل</strong>'} ديال <strong>${escapeHtml(payment.pack_label)}</strong> (${Number(payment.amount_dh).toFixed(2)} DH).</p>
            ${isDeposit ? `<p>الباقي <strong>${remainingDh.toFixed(2)} DH</strong> غادي يتخلص عند تسليم المشروع.</p>` : ''}
            <p>سيتواصل معك فريقنا قريبا لبداية العمل. شكرا على ثقتك 🙏</p>
            <p style="color:#888;font-size:12px">رقم الطلب: ${escapeHtml(orderId)}</p>`)
        ).catch(() => {});
      }
      if (ADMIN_EMAIL) {
        sendEmail(
          ADMIN_EMAIL,
          '💰 أداء جديد (' + (isDeposit ? 'عربون 30%' : 'كامل') + ') — ' + payment.pack_label,
          emailTemplate('أداء جديد', `
            <p>الزبون: ${escapeHtml(payment.customer_name || '—')} — ${escapeHtml(payment.customer_email || '—')} — ${escapeHtml(payment.customer_phone || '—')}</p>
            <p>الباك: ${escapeHtml(payment.pack_label)} — نوع الأداء: ${isDeposit ? 'عربون 30%' : 'كامل'} — المبلغ المؤدى: ${Number(payment.amount_dh).toFixed(2)} DH</p>
            ${isDeposit ? `<p style="color:#D4AF37"><strong>⚠️ باقي خاص تتبع: ${remainingDh.toFixed(2)} DH</strong> — خاصك تتواصل مع الزبون عند التسليم باش يخلصها.</p>` : ''}
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
