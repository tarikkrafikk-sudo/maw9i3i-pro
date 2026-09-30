
Server · JS
/**
 * server.js — Backend ديال الأداء (YouCan Pay) — Maw9i3i.pro
 * =============================================================================
 * يتنشر على Render (maw9i3i-pro.onrender.com). كيستقبل طلبات AJAX من
 * payment-modal.js اللي كاين فـ www.maw9i3i-pro.com، كيدير Tokenize عند
 * YouCan Pay، ويرجع JSON نظيف (❌ ماكايبقاش يرجع صفحة أو يريديريكت).
 *
 * ⚠️ تصحيح مهم بالنسبة للطلب الأصلي:
 * -----------------------------------------------------------------------
 * ما كاينة حتى وثيقة رسمية عند YouCan Pay فيها URL بحال
 * "https://youcanpay.com/sandbox/payment-form/{token}" باش نريديريكتيو
 * ليه الزبون. الفلو الرسمي (Tokenize → yp.js) كيعرض فورم الأداء **مباشرة
 * فداخل الصفحة ديالك** عبر widget اسمو yp.js — وهادشي فالواقع كيخدم
 * الهدف ديالك ("المودال يبقى فالدومين الرئيسي") بزاف حسن من أي redirect،
 * لأن الزبون ماكايخرجش من maw9i3i-pro.com والو، حتى ماشي لصفحة ديال
 * youcanpay.com.
 *
 * فهاد السيرفر: /api/pay كيرجع { token, public_key, ... } — وهو
 * payment-modal.js (فالفرونت) اللي كيمونطي فورم yp.js بهاد token داخل
 * المودال. شوف التوثيق فأسفل هاد الملف.
 *
 * المصادر (تحققت منهم فالتوثيق الرسمي ديال YouCan قبل ما نكتب هاد الكود):
 * - Tokenize endpoint + الحقول:  https://developer.youcan.shop/youcan-pay/payment/tokenize
 * - Payment flow:                https://developer.youcan.shop/youcan-pay/payment-flow
 * - yp.js (embed):                https://developer.youcan.shop/youcan-pay/yp-js/getting-started
 * - Webhooks (HMAC-SHA256):       https://developer.youcan.shop/youcan-pay/webhooks
 * =============================================================================
 */
 
'use strict';
 
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
 
const app = express();
 
// خاص raw body للـ webhook (باش نتحققو من التوقيع)، و JSON عادي للباقي
app.use('/api/pay/webhook', express.raw({ type: '*/*' }));
app.use(express.json());
 
// -----------------------------------------------------------------------
// 1) Configuration — عمر هاد المتغيرات فـ Render (Environment Variables)
// -----------------------------------------------------------------------
const {
  YOUCAN_PRIVATE_KEY,                  // pri_sandbox_xxx  (وإلا pri_live_xxx فالإنتاج)
  YOUCAN_PUBLIC_KEY,                   // pub_sandbox_xxx  (وإلا pub_live_xxx فالإنتاج)
  YOUCAN_SANDBOX = 'true',             // 'true' فالتجربة، 'false' فالإنتاج
  ALLOWED_ORIGIN = 'https://www.maw9i3i-pro.com,https://maw9i3i-pro.com',
  SUCCESS_URL = 'https://www.maw9i3i-pro.com/payment-success',
  ERROR_URL = 'https://www.maw9i3i-pro.com/payment-failed',
  PORT = 3000,
} = process.env;
 
const IS_SANDBOX = YOUCAN_SANDBOX !== 'false';
const TOKENIZE_URL = IS_SANDBOX
  ? 'https://youcanpay.com/sandbox/api/tokenize'
  : 'https://youcanpay.com/api/tokenize';
 
if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
  // ما كنوقفوش السيرفر (باش Render ما يديرش crash loop) ولكن كنسجلو error بارز
  console.error('[FATAL] YOUCAN_PRIVATE_KEY و/ولا YOUCAN_PUBLIC_KEY ماشي معمرين فـ env vars!');
}
 
// -----------------------------------------------------------------------
// 2) CORS — غير الدومين الرئيسي ديالك، بلا "*"
// -----------------------------------------------------------------------
const allowedOrigins = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
 
app.use(cors({
  origin(origin, callback) {
    // origin كيكون undefined فطلبات بحال curl/Postman أو server-to-server — نسمحو بيها
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed → ' + origin));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
}));
 
// -----------------------------------------------------------------------
// 3) أثمنة الباكات — محددة من جهة السيرفر فقط!
// -----------------------------------------------------------------------
// ⚠️ ماشي من اللوجيك تاخد المبلغ من الفرونت (req.body.amount) — أي واحد
// يقدر يبدلو من DevTools ويأدي 1 DH عوض 1499 DH. الثمن ديما كيتقرا من
// هاد اللائحة، على حساب الـ pack_slug لي بعث الزبون.
// بدّل/زيد باكات على حساب المنتجات الحقيقية ديالك.
const PACKS = {
  bdaya:    { label: 'Pack BDAYA',           amount_dh: 499  },
  mo9awala: { label: 'Pack MO9AWALA SGHIRA', amount_dh: 1499 },
  lkra:     { label: 'Pack L-KRA (شهري)',     amount_dh: 199  },
};
 
// -----------------------------------------------------------------------
// 4) Rate limiting بسيط فالذاكرة (20 طلب/دقيقة لكل IP) — يكفي لمنع السبام
//    البسيط. إلا كان عندك بزاف الترافيك، بدلو بـ Redis أو middleware مخصص.
// -----------------------------------------------------------------------
const hits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000;
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
  if (xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || '0.0.0.0';
}
 
function safeString(v, max = 150) {
  return String(v ?? '').trim().slice(0, max);
}
 
// -----------------------------------------------------------------------
// 5) POST /api/pay — كيخلق token عند YouCan Pay ويرجعو JSON نظيف
// -----------------------------------------------------------------------
app.post('/api/pay', async (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'طلبات بزاف. جرب من بعد شوية.' });
  }
 
  if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
    return res.status(500).json({ success: false, message: 'الخدمة ماشي معمرة مزيان دابا. تواصل مع الدعم.' });
  }
 
  const { pack_slug, customer = {} } = req.body || {};
  const pack = PACKS[pack_slug];
 
  if (!pack) {
    return res.status(400).json({ success: false, message: 'باك غير معروف.' });
  }
 
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amountCentimes = Math.round(pack.amount_dh * 100); // Tokenize كيخذ المبلغ بالوحدة الصغرى (centimes)
 
  try {
    const form = new FormData(); // native fetch/FormData — Node 18+
    form.append('pri_key', YOUCAN_PRIVATE_KEY);
    form.append('order_id', orderId);
    form.append('amount', String(amountCentimes));
    form.append('currency', 'MAD');
    form.append('success_url', SUCCESS_URL);
    form.append('error_url', ERROR_URL);
    form.append('metadata[pack_slug]', pack_slug);
    form.append('metadata[source]', 'maw9i3i-pro-website');
 
    if (customer.name)  form.append('customer[name]', safeString(customer.name));
    if (customer.email) form.append('customer[email]', safeString(customer.email, 190));
    if (customer.phone) form.append('customer[phone]', safeString(customer.phone, 30));
 
    const ycRes = await fetch(TOKENIZE_URL, { method: 'POST', body: form });
    const ycData = await ycRes.json().catch(() => ({}));
 
    if (!ycRes.ok || !ycData.token) {
      console.error('[YouCan Pay] Tokenize فشل:', ycRes.status, ycData);
      return res.status(502).json({
        success: false,
        message: ycData.message || 'تعذر بداية عملية الأداء عند YouCan Pay.',
      });
    }
 
    // كنسجلو محاولة الأداء (اختياري — بدلها بقاعدة البيانات ديالك الحقيقية)
    console.log(`[order] ${orderId} — ${pack.label} — ${pack.amount_dh} DH — transaction_id=${ycData.transaction_id}`);
 
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
    console.error('[YouCan Pay] خطأ فالاتصال:', err);
    return res.status(502).json({ success: false, message: 'تعذر الاتصال بخدمة الأداء. جرب مرة أخرى.' });
  }
});
 
// -----------------------------------------------------------------------
// 6) (موصى بيه بزاف) POST /api/pay/webhook — تأكيد الأداء الحقيقي
// -----------------------------------------------------------------------
// ⚠️ اللي كيرجعه payment.confirm() فالفرونت (result.status === 'succeeded')
// كايجي من المتصفح ديال الزبون — حتى واحد يقدر يبدلو فـ DevTools ويقول
// "نجح" بلا ما يأدي والو. التأكيد الحقيقي الوحيد هو الـ webhook اللي
// كيبعثو YouCan Pay من server إلى server، موقع بـ HMAC-SHA256.
// خاصك تزيد هاد الرابط فـ Dashboard ديال YouCan Pay:
//   https://maw9i3i-pro.onrender.com/api/pay/webhook
app.post('/api/pay/webhook', (req, res) => {
  const signature = req.headers['x-youcanpay-signature'];
  const rawBody = req.body; // Buffer (بسبب express.raw فوق)
 
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
    console.warn('[webhook] توقيع غير صحيح — تجاهلنا الطلب.');
    return res.status(403).send('invalid signature');
  }
 
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('invalid json');
  }
 
  console.log('[webhook] event:', event.event_name, JSON.stringify(event.payload));
 
  // TODO: بدّل هادشي بالمنطق الحقيقي ديالك (تحديث قاعدة البيانات، بعث
  // إيميل تأكيد، تفعيل الخدمة...) على حساب event.event_name:
  //   - "transaction.paid"   → أدى بنجاح
  //   - "transaction.failed" → فشل الأداء
 
  res.status(200).send('ok');
});
 
// -----------------------------------------------------------------------
// 7) Health check (مفيد باش تتأكد Render شغال)
// -----------------------------------------------------------------------
app.get('/api/pay/health', (req, res) => {
  res.json({ ok: true, sandbox: IS_SANDBOX, tokenize_url: TOKENIZE_URL });
});
 
app.listen(PORT, () => {
  console.log(`✅ Payment backend listening on port ${PORT} — sandbox=${IS_SANDBOX}`);
});
 
