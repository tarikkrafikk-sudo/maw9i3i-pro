
Payment modal · JS
/**
 * payment-modal.js — المودال ديال الأداء (YouCan Pay) — Maw9i3i.pro
 * =============================================================================
 * يتحط فـ www.maw9i3i-pro.com (فـ YouCan Shop: Code Editor → Assets/Custom JS،
 * أو <script src="payment-modal.js" defer></script> فوسط الصفحة).
 *
 * الفلو:
 *  1) الزبون كيدوس على بوطون فيه data-yc-pack="bdaya|mo9awala|lkra"
 *  2) كيتفتح مودال فداخل الصفحة ديالك (www.maw9i3i-pro.com) — بلا navigation والو
 *  3) fetch (AJAX) لـ API_BASE + /api/pay عند Render → كيرجع JSON (token + public_key)
 *  4) yp.js (ديال YouCan Pay) كيعرض فورم الأداء مباشرة داخل المودال
 *  5) الزبون كيعمر بطاقتو ويدوس "أدي دابا" → payment.confirm() → النتيجة كتبان
 *     فنفس المودال، بلا ما الزبون يخرج من الدومين ديالك أبدا.
 *
 * ⚠️ هادشي كيصلح المشكل اللي كنت عندك: قبل، كان عندك <form action="...onrender.com">
 * كتدير submit عادي → المتصفح كيخرج للدومين ديال Render ويعرض JSON خام.
 * دابا: كلشي عبر fetch()، والفورم ديال الأداء كيتبنى جوا المودال ديالك.
 * =============================================================================
 */
 
(function () {
  'use strict';
 
  // ============================ إعدادات ============================
  const API_BASE = 'https://maw9i3i-pro.onrender.com'; // دومين الباكند فـ Render
  const YP_SCRIPT_URL = 'https://youcanpay.com/yp.js';
  const LOCALE = document.documentElement.lang === 'fr' ? 'fr'
               : document.documentElement.lang === 'en' ? 'en' : 'ar';
 
  const TEXT = {
    ar: { loading: 'كنجهزو صفحة الأداء...', pay: 'أدي دابا', paying: 'كنأديو...',
          success: 'تم الأداء بنجاح! ✅ غادي نتواصلو معاك قريبا.', close: 'إغلاق',
          genericError: 'وقع مشكل. عاود المحاولة.', retryError: 'تفشل الأداء. جرب بطاقة أخرى.' },
    fr: { loading: 'Préparation du paiement...', pay: 'Payer maintenant', paying: 'Paiement en cours...',
          success: 'Paiement réussi ! ✅ Nous vous contacterons bientôt.', close: 'Fermer',
          genericError: "Une erreur s'est produite. Réessayez.", retryError: 'Paiement refusé. Essayez une autre carte.' },
    en: { loading: 'Preparing payment...', pay: 'Pay now', paying: 'Processing...',
          success: 'Payment successful! ✅ We will contact you soon.', close: 'Close',
          genericError: 'Something went wrong. Please try again.', retryError: 'Payment declined. Try another card.' },
  }[LOCALE];
 
  // ============================ تحميل yp.js مرة وحدة ============================
  let ypScriptPromise = null;
  function loadYpScript() {
    if (ypScriptPromise) return ypScriptPromise;
    ypScriptPromise = new Promise((resolve, reject) => {
      if (window.yp) return resolve(window.yp);
      const s = document.createElement('script');
      s.src = YP_SCRIPT_URL;
      s.onload = () => resolve(window.yp);
      s.onerror = () => reject(new Error(TEXT.genericError));
      document.head.appendChild(s);
    });
    return ypScriptPromise;
  }
 
  // ============================ بناء/جلب المودال ============================
  function ensureModal() {
    let overlay = document.getElementById('yc-pay-overlay');
    if (overlay) return overlay;
 
    overlay = document.createElement('div');
    overlay.id = 'yc-pay-overlay';
    overlay.innerHTML = `
      <div class="yc-pay-modal" role="dialog" aria-modal="true">
        <button type="button" class="yc-pay-close" aria-label="${TEXT.close}">&times;</button>
        <h3 class="yc-pay-title"></h3>
        <div class="yc-pay-state yc-pay-loading">${TEXT.loading}</div>
        <div class="yc-pay-state yc-pay-error" style="display:none"></div>
        <div class="yc-pay-state yc-pay-success" style="display:none">${TEXT.success}</div>
        <div id="yc-pay-form-container" style="display:none"></div>
        <button type="button" id="yc-pay-confirm-btn" class="yc-pay-confirm" style="display:none">${TEXT.pay}</button>
      </div>`;
    document.body.appendChild(overlay);
    injectStyles();
 
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('yc-pay-close')) closeModal();
    });
 
    return overlay;
  }
 
  function injectStyles() {
    if (document.getElementById('yc-pay-styles')) return;
    const style = document.createElement('style');
    style.id = 'yc-pay-styles';
    style.textContent = `
      #yc-pay-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
        display:flex;align-items:center;justify-content:center;padding:16px}
      .yc-pay-modal{background:#0f0f0f;border:1px solid rgba(212,175,55,.35);border-radius:14px;
        padding:26px;width:100%;max-width:460px;max-height:92vh;overflow-y:auto;
        color:#f0f0f0;font-family:Tajawal,Arial,sans-serif;position:relative}
      .yc-pay-close{position:absolute;top:12px;inset-inline-start:14px;background:none;border:none;
        color:rgba(255,255,255,.5);font-size:22px;cursor:pointer;line-height:1}
      .yc-pay-close:hover{color:#D4AF37}
      .yc-pay-title{color:#D4AF37;font-weight:900;margin:0 0 16px;font-size:18px}
      .yc-pay-state{font-size:14px;text-align:center;padding:20px 0}
      .yc-pay-error{color:#ff6b6b}
      .yc-pay-success{color:#48c774;font-weight:700}
      #yc-pay-confirm-btn{width:100%;margin-top:14px;border:none;border-radius:10px;padding:14px;
        background:linear-gradient(180deg,#e9cf6b,#D4AF37);color:#111;font-weight:900;
        font-size:15px;cursor:pointer;font-family:inherit}
      #yc-pay-confirm-btn:disabled{opacity:.6;cursor:wait}
    `;
    document.head.appendChild(style);
  }
 
  function showState(overlay, state, message) {
    ['loading', 'error', 'success'].forEach((s) => {
      const el = overlay.querySelector('.yc-pay-' + s);
      if (!el) return;
      el.style.display = s === state ? 'block' : 'none';
    });
    if (message && state === 'error') {
      overlay.querySelector('.yc-pay-error').textContent = message;
    }
  }
 
  function closeModal() {
    const overlay = document.getElementById('yc-pay-overlay');
    if (overlay) overlay.remove(); // كنمسحو المودال كاملة (فيها فورم yp.js) باش ما يبقاش معلق
  }
 
  // ============================ الدالة الرئيسية ============================
  async function startPayment(packSlug, customer) {
    const overlay = ensureModal();
    overlay.querySelector('.yc-pay-title').textContent = packSlug.toUpperCase();
    showState(overlay, 'loading');
    overlay.querySelector('#yc-pay-form-container').style.display = 'none';
    overlay.querySelector('#yc-pay-confirm-btn').style.display = 'none';
 
    try {
      // 1) نطلبو token من الباكند ديالنا (Render) — fetch AJAX، بلا أي navigation
      const res = await fetch(API_BASE + '/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_slug: packSlug, customer: customer || {} }),
      });
      const data = await res.json().catch(() => ({}));
 
      if (!res.ok || !data.success) {
        throw new Error(data.message || TEXT.genericError);
      }
 
      overlay.querySelector('.yc-pay-title').textContent = data.pack_label || packSlug;
 
      // 2) نحملو yp.js ونمونطيو فورم الأداء مباشرة جوا المودال
      const yp = await loadYpScript();
      const payment = yp(data.public_key, { locale: LOCALE })
        .elements({ token: data.token, container: '#yc-pay-form-container' });
 
      payment.on('error', (err) => {
        showState(overlay, 'error', err && err.message ? err.message : TEXT.genericError);
      });
 
      payment.mount();
      overlay.querySelector('#yc-pay-form-container').style.display = 'block';
      overlay.querySelector('.yc-pay-loading').style.display = 'none';
 
      const confirmBtn = overlay.querySelector('#yc-pay-confirm-btn');
      confirmBtn.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = TEXT.pay;
 
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = TEXT.paying;
        try {
          const result = await payment.confirm(); // كيرجع دائما { status }, ماكايرفوزيش (reject)
          if (result.status === 'succeeded') {
            overlay.querySelector('#yc-pay-form-container').style.display = 'none';
            confirmBtn.style.display = 'none';
            showState(overlay, 'success');
          } else {
            showState(overlay, 'error', (result.error && result.error.message) || TEXT.retryError);
            confirmBtn.disabled = false;
            confirmBtn.textContent = TEXT.pay;
          }
        } catch (e) {
          showState(overlay, 'error', TEXT.genericError);
          confirmBtn.disabled = false;
          confirmBtn.textContent = TEXT.pay;
        }
      };
    } catch (err) {
      showState(overlay, 'error', err.message || TEXT.genericError);
    }
  }
 
  // ============================ ربط الأزرار ============================
  // زيد فأي بوطون: data-yc-pack="bdaya" (أو "mo9awala" / "lkra")
  // واختياري: data-yc-name / data-yc-email / data-yc-phone
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-yc-pack]');
    if (!btn) return;
    e.preventDefault(); // كيوقف أي submit/navigation ديال الفورم القديم
    startPayment(btn.getAttribute('data-yc-pack'), {
      name: btn.getAttribute('data-yc-name') || '',
      email: btn.getAttribute('data-yc-email') || '',
      phone: btn.getAttribute('data-yc-phone') || '',
    });
  });
 
  // API عمومي (اختياري) — تقدر تدير YcPay.startPayment('bdaya') يدويا
  window.YcPay = { startPayment, closeModal };
})();
 
