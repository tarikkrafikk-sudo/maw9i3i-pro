/**
 * payment-modal.js
 * -----------------------------------------------------------------------
 * كيدير المودال ديال الأداء الإلكتروني: كيقرا معلومات الباك من data-*
 * ديال الزر لي تكليكا عليه (.js-pay-btn)، كيبني الفورم، وكيبعثها بـ POST
 * لـ /pay/checkout.php.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  var CHECKOUT_URL = '/api/pay';
  var CSRF_URL     = '';

  var csrfToken = null;
  var csrfPromise = null;

function fetchCsrfToken() {
  csrfToken = null;
  return Promise.resolve(null);
}
  
  // نطلبو الرمز بكري (فتحميل الصفحة) باش يكون جاهز مل يحل الزبون المودال
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchCsrfToken);
  } else {
    fetchCsrfToken();
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  // -----------------------------------------------------------------
  // بناء المودال (مرة وحدة، كيتزاد لـ body)
  // -----------------------------------------------------------------
  var overlay = document.createElement('div');
  overlay.className = 'pm-overlay';
  overlay.innerHTML =
    '<div class="pm-modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="pm-close" aria-label="إغلاق">&times;</button>' +
      '<h3 class="pm-title" id="pm-pack-name">الأداء الإلكتروني</h3>' +
      '<p class="pm-subtitle" id="pm-pack-desc"></p>' +
      '<form id="pm-form" novalidate>' +
        '<div class="pm-field"><label for="pm-name">الاسم الكامل</label><input type="text" id="pm-name" name="name" required></div>' +
        '<div class="pm-field"><label for="pm-email">البريد الإلكتروني</label><input type="email" id="pm-email" name="email" required></div>' +
        '<div class="pm-field"><label for="pm-phone">رقم الهاتف</label><input type="tel" id="pm-phone" name="phone" placeholder="06XXXXXXXX" required></div>' +
        '<div class="pm-choices" id="pm-choices" style="display:none">' +
          '<label class="pm-choice">' +
            '<input type="radio" name="payment_choice" value="full_100" checked>' +
            '<span class="pm-choice-text"><span class="pm-choice-label">دفع كامل 100%</span></span>' +
            '<span class="pm-choice-amount" id="pm-amount-full"></span>' +
          '</label>' +
          '<label class="pm-choice">' +
            '<input type="radio" name="payment_choice" value="deposit_30">' +
            '<span class="pm-choice-text"><span class="pm-choice-label"><span class="pm-badge">مستحسن</span>دفع 30% فقط للبدء</span></span>' +
            '<span class="pm-choice-amount" id="pm-amount-deposit"></span>' +
          '</label>' +
        '</div>' +
        '<div class="pm-summary">' +
          '<span class="pm-summary-label" id="pm-summary-label">المبلغ المطلوب الآن</span>' +
          '<span class="pm-summary-amount" id="pm-summary-amount"></span>' +
        '</div>' +
        '<div class="pm-error" id="pm-error"></div>' +
        '<button type="submit" class="pm-submit" id="pm-submit">المتابعة للأداء 💳</button>' +
        '<div class="pm-secure">🔒 الأداء آمن عبر YouCan Pay</div>' +
      '</form>' +
    '</div>';
  document.body.appendChild(overlay);

  var els = {
    packName:      overlay.querySelector('#pm-pack-name'),
    packDesc:      overlay.querySelector('#pm-pack-desc'),
    form:          overlay.querySelector('#pm-form'),
    choices:       overlay.querySelector('#pm-choices'),
    amountFull:    overlay.querySelector('#pm-amount-full'),
    amountDeposit: overlay.querySelector('#pm-amount-deposit'),
    summaryLabel:  overlay.querySelector('#pm-summary-label'),
    summaryAmount: overlay.querySelector('#pm-summary-amount'),
    error:         overlay.querySelector('#pm-error'),
    submit:        overlay.querySelector('#pm-submit'),
    close:         overlay.querySelector('.pm-close'),
  };

  var currentPack = null;

  function updateSummary() {
    if (!currentPack) return;
    if (currentPack.type === 'subscription') {
      els.summaryLabel.textContent = 'أول دفعة (ثم ' + fmt(currentPack.total) + ' DH شهريا)';
      els.summaryAmount.textContent = fmt(currentPack.total) + ' DH';
      return;
    }
    var choice = els.form.querySelector('input[name="payment_choice"]:checked');
    var isDeposit = choice && choice.value === 'deposit_30';
    els.summaryLabel.textContent = isDeposit ? 'المبلغ المطلوب الآن (30%)' : 'المبلغ الكامل';
    els.summaryAmount.textContent = fmt(isDeposit ? currentPack.deposit : currentPack.total) + ' DH';
  }

  function openModal(pack) {
    currentPack = pack;
    els.packName.textContent = pack.name;
    els.error.className = 'pm-error';
    els.error.textContent = '';
    els.form.reset();

    if (pack.type === 'subscription') {
      els.choices.style.display = 'none';
      els.packDesc.textContent = 'اشتراك شهري — أول دفعة ' + fmt(pack.total) + ' DH، من بعد ' + fmt(pack.total) + ' DH كل شهر.';
    } else {
      els.choices.style.display = 'flex';
      els.packDesc.textContent = 'اختار طريقة الأداء المناسبة ليك.';
      els.amountFull.textContent = fmt(pack.total) + ' DH';
      els.amountDeposit.textContent = fmt(pack.deposit) + ' DH';
    }
    updateSummary();

    overlay.className = 'pm-overlay pm-open';
    document.body.style.overflow = 'hidden';
    fetchCsrfToken();
    setTimeout(function () { overlay.querySelector('#pm-name').focus(); }, 50);
  }

  function closeModal() {
    overlay.className = 'pm-overlay';
    document.body.style.overflow = '';
  }

  els.close.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('pm-open')) closeModal();
  });
  els.form.addEventListener('change', function (e) {
    if (e.target.name === 'payment_choice') updateSummary();
  });

  function showError(msg) {
    els.error.textContent = msg;
    els.error.className = 'pm-error pm-show';
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name  = overlay.querySelector('#pm-name').value.trim();
    var email = overlay.querySelector('#pm-email').value.trim();
    var phone = overlay.querySelector('#pm-phone').value.trim();

    if (!name || !email || !phone) {
      showError('خاصك تعمر جميع المعلومات.');
      return;
    }
    if (!isValidEmail(email)) {
      showError('الإيميل غير صالح.');
      return;
    }
    if (phone.replace(/[^0-9]/g, '').length < 9) {
      showError('رقم الهاتف غير صالح.');
      return;
    }

    els.submit.disabled = true;
    els.submit.textContent = 'جاري التوجيه...';

    fetchCsrfToken().then(function (token) {
      var choiceInput = els.form.querySelector('input[name="payment_choice"]:checked');
      var payload = {
        pack_slug: currentPack.slug,
        name: name,
        email: email,
        phone: phone,
        payment_choice: currentPack.type === 'subscription' ? 'full_100' : (choiceInput ? choiceInput.value : 'full_100'),
        csrf_token: token || ''
      };

      var f = document.createElement('form');
      f.method = 'POST';
      f.action = CHECKOUT_URL;
      f.style.display = 'none';
      Object.keys(payload).forEach(function (key) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = payload[key];
        f.appendChild(input);
      });
      document.body.appendChild(f);
      f.submit();
    });
  });

  // -----------------------------------------------------------------
  // ربط الأزرار .js-pay-btn بالمودال
  // -----------------------------------------------------------------
  function bindButtons() {
    var buttons = document.querySelectorAll('.js-pay-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal({
          slug: btn.getAttribute('data-pack'),
          name: btn.getAttribute('data-name') || btn.getAttribute('data-pack'),
          type: btn.getAttribute('data-type') || 'unique',
          total: parseFloat(btn.getAttribute('data-total') || '0'),
          deposit: parseFloat(btn.getAttribute('data-deposit') || '0'),
          final: parseFloat(btn.getAttribute('data-final') || '0'),
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtons);
  } else {
    bindButtons();
  }
})();
