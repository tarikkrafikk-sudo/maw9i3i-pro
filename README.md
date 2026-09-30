# MAW9I3I.PRO — نظام الأداء الإلكتروني (YouCan Pay)

نظام أداء كامل بـ PHP نتيف (بلا WordPress، بلا Laravel، بلا أي framework) +
MySQL، مبني فوق الموقع الحالي ديالك، كيدعم:

- **Pack BDAYA** (499 DH، دفعة وحدة، أو 30%/70%)
- **Pack MO9AWALA SGHIRA** (1499 DH، دفعة وحدة، أو 30%/70%)
- **Pack L-KRA** (199 DH/الشهر، اشتراك متجدد)

كل الملفات فهاد المجلد جاهزين للرفع بالـ FTP مباشرة فجذر الموقع ديالك
(نفس المجلد لي فيه `index.html` الحالي).

---

## 1) هيكلة الملفات

```
/                       ← جذر الموقع (public_html أو www)
├── index.html          ← الصفحة الرئيسية (تبدلات: زوج أزرار بحال باك)
├── index-fr.html
├── index-en.html
├── style.css / script.js / images/ / docs/   ← بحالهم بلا تبديل
├── assets/
│   ├── payment-modal.css   ← جديد: تصميم المودال
│   ├── payment-modal.js    ← جديد: منطق المودال + إرسال الفورم
│   ├── reviews.css          ← جديد: تصميم قسم آراء الزبناء
│   └── reviews.js            ← جديد: منطق قسم آراء الزبناء (عرض + فورم + 3 لغات)
├── reviews/
│   ├── submit.php        ← جديد: استقبال رأي جديد
│   └── list.php           ← جديد: الآراء المصادق عليها (JSON)
├── database.sql        ← استورد هاد الملف فقاعدة البيانات ديالك
├── .env.example         ← نسخو لـ .env وعمرو بالمعلومات ديالك
├── .htaccess            ← حماية .env من الوصول المباشر
├── config/
│   └── config.php       ← يقرا .env ويحدد الثوابت
├── includes/
│   ├── db.php            ← اتصال PDO
│   ├── YouCanPay.php      ← عميل YouCan Pay API (Tokenize + توقيع الـ webhook)
│   ├── functions.php      ← دوال مساعدة (بريد، واتساب، CSRF...)
│   └── auth.php           ← حماية لوحة التحكم
├── pay/
│   ├── checkout.php        ← بداية عملية الأداء
│   ├── webhook.php         ← استقبال نتيجة الأداء من YouCan Pay (الأهم!)
│   ├── success.php         ← صفحة النجاح
│   ├── fail.php             ← صفحة الفشل
│   ├── status.php           ← API صغير لتحديث الحالة (polling)
│   ├── csrf.php              ← يرجع رمز CSRF للفورم الثابت (index.html)
│   └── cron.php               ← مهمة يومية (تجديد/تذكيرات)
├── admin/
│   ├── login.php / logout.php
│   ├── index.php            ← لوحة التحكم الرئيسية
│   ├── reviews.php           ← جديد: مصادقة آراء الزبناء
│   └── actions/
│       ├── generate-final-link.php  ← رابط أداء الـ70% الباقية
│       └── send-reminder.php         ← تذكير تجديد L-KRA
└── storage/               ← ملف error.log (محمي بـ .htaccess)
```

---

## 2) التنصيب — خطوة بخطوة

### أ) قاعدة البيانات

1. خلق قاعدة بيانات MySQL جديدة (من cPanel → MySQL Databases)، بـ charset `utf8mb4`.
2. استورد `database.sql`:
   ```bash
   mysql -u USER -p DB_NAME < database.sql
   ```
   أو عبر phpMyAdmin: Import → اختار `database.sql`.
   هاد الملف كيخلق الجداول (`packs`, `customers`, `payments`, `subscriptions`)
   وكيعمر جدول `packs` بالباكات الثلاثة تلقائيا.

### ب) ملف `.env`

1. نسخ `.env.example` إلى `.env` (نفس المجلد، فجذر الموقع).
2. عمر:
   - `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASS` (من cPanel).
   - `SITE_URL` (بلا `/` فالأخير).
   - `YOUCAN_PRIVATE_KEY` / `YOUCAN_PUBLIC_KEY` (شوف القسم 3 تحت).
   - `YOUCAN_SANDBOX=true` للتجربة، `false` للإنتاج.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` (لوحة التحكم).
   - `CRON_SECRET` (رمز عشوائي طويل، لحماية `pay/cron.php`).

⚠️ **تأكد** أن `.htaccess` رفع معاه (بعض عملاء FTP كيخبيو الملفات لي كتبدا
بنقطة). جرب تفتح `https://www.maw9i3i-pro.com/.env` فالمتصفح — خاصها تعطي
"Forbidden"، ماشي المحتوى ديال الملف.

### ج) الرفع بالـ FTP

رفع **كل** محتوى هاد المجلد فجذر الموقع ديالك (نفس المستوى ديال
`index.html` الحالي). الملفات الجديدة غادي تنضاف، والملفات المشتركة
(`index.html`, `index-fr.html`, `index-en.html`) غادي تبدل النسخة القديمة
— فيهم التبديل الوحيد هو زوج الأزرار فكل باك، الباقي بحالو.

### د) اختبار سريع

1. `https://www.maw9i3i-pro.com/` → دوز لقسم الباكات → دوس "الدفع الإلكتروني 💳" → خاص يبان المودال.
2. عمر معلومات وهمية وأدي (فوضع sandbox) → خاصك توصل لصفحة الأداء.
3. `https://www.maw9i3i-pro.com/admin/login.php` → دخل بالمعلومات لي حطيتي فـ `.env`.

---

## 3) YouCan Pay — الإعداد

1. خلق حساب فـ [youcanpay.com](https://youcanpay.com) وفعل حسابك (KYC).
2. جيب `YOUCAN_PRIVATE_KEY` و`YOUCAN_PUBLIC_KEY` من الداشبورد.
3. **الـ Webhook** (خطوة ضرورية — بلاها ما غاديش يتفعل أي أداء تلقائيا!):
   من داشبورد YouCan Pay → Webhooks → زيد:
   ```
   URL: https://www.maw9i3i-pro.com/pay/webhook.php
   Event: transaction.paid (و transaction.failed إلا كانت متوفرة)
   ```
4. خدم فوضع **Sandbox** أول (`YOUCAN_SANDBOX=true`) وجرب بطاقات تجريبية
   (شوف "Sandbox & Testing" فالتوثيق الرسمي)، من بعد بدل لـ `false` مع
   مفاتيح **live** حقيقيين.

### ⚠️ ملاحظة مهمة على التكامل التقني

هاد المشروع كيستعمل:
- **Tokenize API** (`POST https://youcanpay.com/api/tokenize`) باش يخلق
  عملية أداء — موثق رسميا.
- **ycpay.js** (`https://pay.youcan.shop/js/ycpay.js`) باش يعرض فورم
  الأداء مباشرة فصفحة `pay/checkout.php` — هادي الطريقة الموثقة رسميا
  ومضمونة تخدم 100%.
- تفعيل الدفعة **الحقيقي** كيتم غير عبر `pay/webhook.php` (توقيع
  HMAC-SHA256)، ماشي عبر رجوع المتصفح لصفحة success.php.

إلا بغيتي تستعمل التكامل الرسمي زيادة (SDK كامل بـ Composer)، عندك
الخيار: `composer require youcanpay/payment-sdk` وتبدل `includes/YouCanPay.php`
باش يستعملو — الكود ديالنا مبني بنفس المنطق باش يكون التبديل سهل.
**ننصحوك تجرب فوضع sandbox قبل ما تفعّل فالإنتاج**، ولإلا صرا أي مشكل فـ
Tokenize، تواصل مع دعم YouCan Pay (support@youcan.shop) للتأكد من آخر
تحديث فالـ API.

---

## 4) CRON — المهام اليومية

خاص `pay/cron.php` يتشغل **مرة فالنهار** (تفضل الصباح باكر).

### من cPanel (الطريقة المفضلة — SSH/PHP CLI)

Cron Jobs → زيد سطر جديد:
```
0 6 * * * php /home/USERNAME/public_html/pay/cron.php >> /home/USERNAME/public_html/storage/cron.log 2>&1
```

### إلا ماكانش SSH/CLI متوفر (استضافة بسيطة)

استعمل رابط HTTP (تأكد `CRON_SECRET` معمر فـ `.env`):
```
0 6 * * * wget -q -O /dev/null "https://www.maw9i3i-pro.com/pay/cron.php?secret=CRON_SECRET_DIALEK"
```

هاد المهمة كتدير:
- تصفير اشتراكات L-KRA لي فات وقتها (`expire_date < NOW()`) + إيميل تجديد.
- تذكير الزبناء لي خلصو 30% وما خلصوش الـ70% الباقية من كثر 7 أيام.

---

## 5) لوحة التحكم `/admin`

- `admin/login.php` — الدخول بـ `ADMIN_USERNAME` / `ADMIN_PASSWORD` ديال `.env`.
- جدول بكل الدفوعات (الإيميل، الباك، النوع، المبلغ، الحالة، التاريخ).
- إحصائيات: المجموع المحصّل، عدد/مبلغ الدفعات فالانتظار (70%)، الاشتراكات النشيطة.
- لكل زبون خلص 30% فقط: زر **"إنشاء رابط دفع 70% المتبقي"** → كيولد رابط
  أداء جاهز + رسالة واتساب معبأة (تقدر تديها مباشرة من الزر "فتح فواتساب").
- لقسم L-KRA: تواريخ الانتهاء + زر **"إرسال تذكير تجديد"** (كيبعث إيميل
  مباشرة + كيجهز رسالة واتساب).

**نصيحة أمان:** بدل `ADMIN_PASSWORD` بـ bcrypt hash عوض نص عادي:
```bash
php -r "echo password_hash('كلمة_السر_ديالك', PASSWORD_BCRYPT);"
```
وحط الناتج (كيبدا بـ `$2y$`) فـ `ADMIN_PASSWORD` فـ `.env`.

---

## 6) قسم آراء الزبناء ⭐ (Reviews)

قسم جديد فالصفحة الرئيسية (الثلاث لغات) كيسمح للزوار يبعثو رأي ديالهم
(اسم + تقييم من 1 إلى 5 نجوم + تعليق)، وما كيبانش فالموقع حتى تصادق عليه
من لوحة التحكم — هادشي باش نمنعو السبام أو تعليقات مسيئة.

### هيكلة الملفات الجديدة

```
├── reviews/
│   ├── submit.php        ← استقبال رأي جديد (POST) — CSRF + honeypot + rate-limit
│   └── list.php           ← يرجع الآراء المصادق عليها (JSON) للعرض فالصفحة
├── assets/
│   ├── reviews.css         ← تصميم القسم + المودال
│   └── reviews.js           ← منطق كامل (عرض + فورم + i18n عربي/فرنسي/انجليزي)
└── admin/
    └── reviews.php          ← مصادقة/رفض/حذف الآراء (فالانتظار / مصادق عليها / مرفوضة)
```

الجدول `reviews` مزاد فـ `database.sql` (خاصك تعاود تستورد هاد الملف، أو
غير تخلق الجدول يدويا إلا كانت قاعدة البيانات ديالك مزال ماكاينش عندها).

### كيفاش خدام

1. الزائر كيدوس "⭐ شارك رأيك معانا" → كتبان مودال فيها: نجوم (1-5)، الاسم،
   التعليق، وباك اختياري (BDAYA / MO9AWALA / L-KRA).
2. الرأي كيتسجل بحالة `pending` + إيميل إشعار لـ `ADMIN_EMAIL`.
3. من `admin/reviews.php` (رابط "آراء الزبناء ⭐" فأعلى لوحة التحكم، مع
   عداد الآراء فالانتظار) — تقدر توافق، ترفض، ولا تحذف نهائيا.
4. غير الآراء المصادق عليها (`approved`) هوما لي كيبانو فقسم "آراء الزبناء"
   فالصفحة الرئيسية، مرتبين من الأجدد للأقدم.

### حماية من السبام

- **Honeypot**: حقل مخفي (`website`) — البوتات كيعمروه، الزوار الحقيقيين لا.
- **Rate limiting**: رأي وحد كل 24 ساعة لكل IP.
- **CSRF token**: نفس النظام ديال فورم الأداء.
- **مصادقة يدوية**: حتى رأي ما كيبان مباشرة، خاص Admin يوافق عليه.

### زيادة آراء حقيقية يدويا (اختياري)

إلا بغيتي تزيد آراء ديال زبناء حقيقيين مباشرة (بلا ما يعبيو الفورم)، تقدر
تديرها مباشرة فقاعدة البيانات (كتبان فالموقع مباشرة لأنها `approved`):
```sql
INSERT INTO reviews (customer_name, rating, comment, pack_slug, status, approved_at)
VALUES ('اسم الزبون', 5, 'نص التعليق...', 'bdaya', 'approved', NOW());
```

---

## 7) البريد الإلكتروني (mail())

الكود كيستعمل دالة `mail()` الأصلية ديال PHP (كتخدم فأغلب استضافات
cPanel بلا إعداد زائد). إلا كانت الإيميلات كتوصل للسبام أو ما كتوصلش:
- تأكد أن `MAIL_FROM` فيه نفس الدومين ديال الموقع (`no-reply@maw9i3i-pro.com`).
- زيد سجلات **SPF/DKIM** للدومين من cPanel → Email Deliverability.
- إلا بقا المشكل، بدل `send_email()` فـ `includes/functions.php` باش
  تستعمل SMTP (Mailgun/SendGrid/PHPMailer) عوض `mail()`.

---

## 8) الأمان

- ملف `.env` محمي بـ `.htaccess` (403 Forbidden عند الوصول المباشر).
- `config/` و `includes/` محميين بـ `.htaccess` (`Require all denied`).
- كل الاستعلامات SQL مبنية بـ PDO Prepared Statements (حماية من SQL Injection).
- توقيع الـ webhook متحقق منه بـ HMAC-SHA256 (`hash_equals` — مقاوم لـ timing attacks).
- روابط أداء الـ70% موقعة (HMAC) — ما يقدرش حد يبدل `payment_id` فالرابط.
- CSRF token فكل الفورمات (المودال الرئيسي + لوحة التحكم).
- كلمة سر لوحة التحكم عبر `hash_equals`/`password_verify` (بلا مقارنة `==` مباشرة).

---

## 9) الدعم / المشاكل الشائعة

| المشكل | الحل |
|---|---|
| صفحة بيضاء عند `checkout.php` | تحقق من `storage/error.log` وتأكد المعلومات ديال `.env` (خصوصا `YOUCAN_PRIVATE_KEY`) |
| الأداء كيمشي لكن الحالة كتبقى "قيد الانتظار" | الـ webhook ماوصلش — تحقق من تسجيله فداشبورد YouCan Pay وتأكد الرابط قابل للوصول من برا (بلا حماية htpasswd) |
| `admin/login.php` ما كيقبلش كلمة السر | تأكد `ADMIN_PASSWORD` فـ `.env` بلا مسافات زائدة، وتأكد الملف `.env` كايتقرا (رخص 644) |
| البريد ما كيوصلش | شوف القسم 6 فوق |

---

**MAW9I3I.PRO** — Votre site web sur commande 🖤💛
