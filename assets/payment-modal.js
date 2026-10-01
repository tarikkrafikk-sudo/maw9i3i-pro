/**
 * payment-modal.js — المودال ديال الأداء (YouCan Pay) — Maw9i3i.pro
 */

(function () {
  'use strict';

  const API_BASE = 'https://maw9i3i-pro.onrender.com';
  const YP_SCRIPT_URL = 'https://youcanpay.com/yp.js';
  const LOCALE = document.documentElement.lang === 'fr' ? 'fr'
               : document.documentElement.lang === 'en' ? 'en' : 'ar';
  // yp.js كيدير RTL أوتوماتيك منين locale='ar' — هادشي هو لي كان كيقلب رقم
  // البطاقة. كنخليو نصوص المودال بالعربية، ونخصو widget البطاقة بوحدو LTR.
  const YP_WIDGET_LOCALE = LOCALE === 'ar' ? 'fr' : LOCALE;

  const TEXT = {
    ar: {
      loading: 'كنجهزو صفحة الأداء...', pay: 'أدي دابا', paying: 'كنأديو...',
      success: 'تم الأداء بنجاح! ✅ غادي نتواصلو معاك قريبا.', close: 'إغلاق',
      genericError: 'وقع مشكل. عاود المحاولة.', retryError: 'تفشل الأداء. جرب بطاقة أخرى.',
      infoTitle: 'معلوماتك أولا', infoSubtitle: 'باش نقدرو نتواصلو معاك ونبعتوك تأكيد الأداء بالإيميل.',
      labelName: 'الاسم الكامل', labelEmail: 'البريد الإلكتروني', labelPhone: 'رقم الهاتف',
      continueBtn: 'متابعة للأداء 💳',
      errRequired: 'خاصك تعمر جميع المعلومات.', errEmail: 'الإيميل غير صالح.', errPhone: 'رقم الهاتف غير صالح.',
    },
    fr: {
      loading: 'Préparation du paiement...', pay: 'Payer maintenant', paying: 'Paiement en cours...',
      success: 'Paiement réussi ! ✅ Nous vous contacterons bientôt.', close: 'Fermer',
      genericError: "Une erreur s'est produite. Réessayez.", retryError: 'Paiement refusé. Essayez une autre carte.',
      infoTitle: 'Vos informations', infoSubtitle: 'Pour vous contacter et vous envoyer la confirmation par email.',
      labelName: 'Nom complet', labelEmail: 'Adresse email', labelPhone: 'Numéro de téléphone',
      continueBtn: 'Continuer vers le paiement 💳',
      errRequired: 'Merci de remplir toutes les informations.', errEmail: 'Email invalide.', errPhone: 'Numéro de téléphone invalide.',
    },
    en: {
      loading: 'Preparing payment...', pay: 'Pay now', paying: 'Processing...',
      success: 'Payment successful! ✅ We will contact you soon.', close: 'Close',
      genericError: 'Something went wrong. Please try again.', retryError: 'Payment declined. Try another card.',
      infoTitle: 'Your information', infoSubtitle: 'So we can reach you and send your payment confirmation by email.',
      labelName: 'Full name', labelEmail: 'Email address', labelPhone: 'Phone number',
      continueBtn: 'Continue to payment 💳',
      errRequired: 'Please fill in all the fields.', errEmail: 'Invalid email address.', errPhone: 'Invalid phone number.',
    },
  }[LOCALE];

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

  function ensureModal() {
    let overlay = document.getElementById('yc-pay-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'yc-pay-overlay';
    overlay.innerHTML = `
      <div class="yc-pay-modal" role="dialog" aria-modal="true">
        <button type="button" class="yc-pay-close" aria-label="${TEXT.close}">&times;</button>
        <h3 class="yc-pay-title"></h3>

        <form id="yc-pay-info-form" class="yc-pay-state yc-pay-info" novalidate>
          <p class="yc-pay-info-subtitle">${TEXT.infoSubtitle}</p>
          <div class="yc-pay-field">
            <label for="yc-pay-name">${TEXT.labelName}</label>
            <input type="text" dir="ltr" id="yc-pay-name" name="name" required autocomplete="name">
          </div>
          <div class="yc-pay-field">
            <label for="yc-pay-email">${TEXT.labelEmail}</label>
            <input type="email" dir="ltr" id="yc-pay-email" name="email" required autocomplete="email">
          </div>
          <div class="yc-pay-field">
            <label for="yc-pay-phone">${TEXT.labelPhone}</label>
            <input type="tel" dir="ltr" id="yc-pay-phone" name="phone" placeholder="06XXXXXXXX" required autocomplete="tel">
          </div>
          <div class="yc-pay-info-error"></div>
          <button type="submit" class="yc-pay-confirm">${TEXT.continueBtn}</button>
        </form>

        <div class="yc-pay-state yc-pay-loading" style="display:none">${TEXT.loading}</div>
        <div class="yc-pay-state yc-pay-error" style="display:none"></div>
        <div class="yc-pay-state yc-pay-success" style="display:none">${TEXT.success}</div>
        <div id="yc-pay-form-container" dir="ltr" style="display:none; direction:ltr"></div>
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
      .yc-pay-info{padding:0;text-align:start}
      .yc-pay-info-subtitle{color:#999;font-size:13px;margin:0 0 16px;line-height:1.6}
      .yc-pay-field{margin-bottom:14px}
      .yc-pay-field label{display:block;font-size:12px;color:#999;margin-bottom:6px}
      .yc-pay-field input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;
        background:#1a1a1a;color:#fff;font-family:inherit;font-size:14px;box-sizing:border-box}
      .yc-pay-field input:focus{outline:none;border-color:#D4AF37}
      .yc-pay-info-error{color:#ff6b6b;font-size:13px;min-height:18px;margin-bottom:8px;text-align:center}
      #yc-pay-confirm-btn, .yc-pay-info .yc-pay-confirm{width:100%;margin-top:6px;border:none;border-radius:10px;padding:14px;
        background:linear-gradient(180deg,#e9cf6b,#D4AF37);color:#111;font-weight:900;
        font-size:15px;cursor:pointer;font-family:inherit}
      #yc-pay-confirm-btn:disabled, .yc-pay-info .yc-pay-confirm:disabled{opacity:.6;cursor:wait}
    `;
    document.head.appendChild(style);
  }

  function showState(overlay, state, message) {
    ['info', 'loading', 'error', 'success'].forEach((s) => {
      const el = overlay.querySelector('.yc-pay-' + s);
      if (!el) return;
      el.style.display = s === state ? (s === 'info' ? 'block' : 'block') : 'none';
    });
    if (message && state === 'error') {
      overlay.querySelector('.yc-pay-error').textContent = message;
    }
  }

  function closeModal() {
    const overlay = document.getElementById('yc-pay-overlay');
    if (overlay) overlay.remove();
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function openInfoStep(packSlug, prefill, packLabel) {
    const overlay = ensureModal();
    overlay.querySelector('.yc-pay-title').textContent = packLabel || packSlug.toUpperCase();
    showState(overlay, 'info');
    overlay.querySelector('#yc-pay-form-container').style.display = 'none';
    overlay.querySelector('#yc-pay-confirm-btn').style.display = 'none';

    const form = overlay.querySelector('#yc-pay-info-form');
    const nameInput  = overlay.querySelector('#yc-pay-name');
    const emailInput = overlay.querySelector('#yc-pay-email');
    const phoneInput = overlay.querySelector('#yc-pay-phone');
    const errorBox   = overlay.querySelector('.yc-pay-info-error');

    nameInput.value  = (prefill && prefill.name)  || '';
    emailInput.value = (prefill && prefill.email) || '';
    phoneInput.value = (prefill && prefill.phone) || '';
    errorBox.textContent = '';

    form.onsubmit = function (e) {
      e.preventDefault();
      const name  = nameInput.value.trim();
      const email = emailInput.value.trim();
      const phone = phoneInput.value.trim();

      if (!name || !email || !phone) {
        errorBox.textContent = TEXT.errRequired;
        return;
      }
      if (!isValidEmail(email)) {
        errorBox.textContent = TEXT.errEmail;
        return;
      }
      if (phone.replace(/[^0-9]/g, '').length < 9) {
        errorBox.textContent = TEXT.errPhone;
        return;
      }
      errorBox.textContent = '';

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      proceedToPayment(packSlug, { name, email, phone });
    };

    setTimeout(() => nameInput.focus(), 50);
  }

  async function proceedToPayment(packSlug, customer) {
    const overlay = ensureModal();
    showState(overlay, 'loading');

    try {
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

      const yp = await loadYpScript();
      const payment = yp(data.public_key, { locale: YP_WIDGET_LOCALE })
        .elements({ token: data.token, container: '#yc-pay-form-container' });

      payment.on('error', (err) => {
        showState(overlay, 'error', err && err.message ? err.message : TEXT.genericError);
      });

      payment.mount();
      overlay.querySelector('#yc-pay-form-container').style.display = 'block';

      const confirmBtn = overlay.querySelector('#yc-pay-confirm-btn');
      confirmBtn.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = TEXT.pay;

      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = TEXT.paying;
        try {
          const result = await payment.confirm();
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

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-yc-pack], [data-pack]');
    if (!btn) return;
    const packSlug = btn.getAttribute('data-yc-pack') || btn.getAttribute('data-pack');
    if (!packSlug) return;
    e.preventDefault();
    openInfoStep(packSlug, {
      name:  btn.getAttribute('data-yc-name')  || '',
      email: btn.getAttribute('data-yc-email') || '',
      phone: btn.getAttribute('data-yc-phone') || '',
    }, btn.getAttribute('data-name') || btn.getAttribute('data-yc-name') || null);
  });

  window.YcPay = { startPayment: openInfoStep, closeModal };
})();
