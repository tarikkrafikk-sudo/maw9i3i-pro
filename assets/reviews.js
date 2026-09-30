/**
 * reviews.js
 * -----------------------------------------------------------------------
 * كيبني قسم "آراء الزبناء" بالكامل (العنوان، الشبكة، مودال الإضافة) جوا
 * <section id="reviews"></section>، ويحدد اللغة انطلاقا من <html lang="...">
 * باش نستعملو نفس الملف فـ index.html / index-fr.html / index-en.html.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  var LIST_URL   = '/reviews/list.php';
  var SUBMIT_URL = '/reviews/submit.php';
  var CSRF_URL   = '/pay/csrf.php';

  var I18N = {
    ar: {
      eyebrow: 'آراء زبنائنا',
      title: 'شنو كيقولو الزبناء ديالنا',
      subtitle: 'تجارب حقيقية ديال ناس وثقو فينا وخدمنا معاهم.',
      basedOn: function (count) {
        if (count === 0) return '';
        return 'بناءً على ' + count + (count === 1 ? ' رأي' : ' آراء');
      },
      empty: 'لا توجد آراء بعد. كن أول من يشارك رأيه معانا!',
      loading: 'جاري تحميل الآراء...',
      openBtn: '⭐ شارك رأيك معانا',
      modalTitle: 'شارك تجربتك معانا',
      ratingLabel: 'تقييمك',
      nameLabel: 'الاسم الكامل',
      commentLabel: 'تعليقك',
      commentPlaceholder: 'قوليا شنو عجبك فالخدمة ديالنا...',
      packLabel: 'الباك لي جربتي (اختياري)',
      packNone: '— اختار —',
      packs: { bdaya: 'Pack BDAYA', mo9awala: 'Pack MO9AWALA SGHIRA', lkra: 'Pack L-KRA' },
      submitBtn: 'إرسال الرأي',
      submitting: 'جاري الإرسال...',
      pickRatingFirst: 'اختار عدد النجوم أولاً.',
      success: 'شكرا ليك! رأيك غادي يبان فالموقع من بعد المراجعة.',
      close: 'إغلاق',
      errors: {
        invalid_csrf: 'انتهت صلاحية الجلسة. عاود تحميل الصفحة.',
        invalid_name: 'خاصك تكتب الاسم ديالك.',
        invalid_rating: 'اختار تقييم من 1 إلى 5 نجوم.',
        comment_too_short: 'خاص التعليق يكون أطول شوية (10 أحرف الأقل).',
        comment_too_long: 'التعليق طويل بزاف.',
        rate_limited: 'تقدر تبعث رأي وحد كل 24 ساعة.',
        invalid_request: 'طلب غير صالح.',
        generic: 'صرا مشكل. حاول مرة أخرى.',
      },
    },
    fr: {
      eyebrow: 'Avis de nos clients',
      title: 'Ce que disent nos clients',
      subtitle: 'Des retours authentiques de personnes qui nous ont fait confiance.',
      basedOn: function (count) {
        if (count === 0) return '';
        return 'Basé sur ' + count + (count === 1 ? ' avis' : ' avis');
      },
      empty: 'Aucun avis pour le moment. Soyez le premier à partager votre expérience !',
      loading: 'Chargement des avis...',
      openBtn: '⭐ Laisser un avis',
      modalTitle: 'Partagez votre expérience',
      ratingLabel: 'Votre note',
      nameLabel: 'Nom complet',
      commentLabel: 'Votre avis',
      commentPlaceholder: 'Dites-nous ce qui vous a plu dans notre service...',
      packLabel: 'Pack essayé (optionnel)',
      packNone: '— Choisir —',
      packs: { bdaya: 'Pack BDAYA', mo9awala: 'Pack MO9AWALA SGHIRA', lkra: 'Pack L-KRA' },
      submitBtn: "Envoyer l'avis",
      submitting: 'Envoi en cours...',
      pickRatingFirst: "Choisissez d'abord une note.",
      success: 'Merci ! Votre avis sera visible après validation.',
      close: 'Fermer',
      errors: {
        invalid_csrf: 'Session expirée. Rechargez la page.',
        invalid_name: 'Merci de renseigner votre nom.',
        invalid_rating: 'Choisissez une note de 1 à 5 étoiles.',
        comment_too_short: 'Votre avis doit contenir au moins 10 caractères.',
        comment_too_long: 'Votre avis est trop long.',
        rate_limited: 'Vous pouvez envoyer un avis toutes les 24 heures.',
        invalid_request: 'Requête invalide.',
        generic: "Une erreur s'est produite. Réessayez.",
      },
    },
    en: {
      eyebrow: 'Customer reviews',
      title: 'What our clients say',
      subtitle: 'Real feedback from people who trusted us with their project.',
      basedOn: function (count) {
        if (count === 0) return '';
        return 'Based on ' + count + (count === 1 ? ' review' : ' reviews');
      },
      empty: 'No reviews yet. Be the first to share your experience!',
      loading: 'Loading reviews...',
      openBtn: '⭐ Leave a review',
      modalTitle: 'Share your experience',
      ratingLabel: 'Your rating',
      nameLabel: 'Full name',
      commentLabel: 'Your review',
      commentPlaceholder: 'Tell us what you liked about our service...',
      packLabel: 'Pack you tried (optional)',
      packNone: '— Select —',
      packs: { bdaya: 'Pack BDAYA', mo9awala: 'Pack MO9AWALA SGHIRA', lkra: 'Pack L-KRA' },
      submitBtn: 'Submit review',
      submitting: 'Submitting...',
      pickRatingFirst: 'Please pick a star rating first.',
      success: 'Thank you! Your review will appear after moderation.',
      close: 'Close',
      errors: {
        invalid_csrf: 'Session expired. Please reload the page.',
        invalid_name: 'Please enter your name.',
        invalid_rating: 'Please pick a rating from 1 to 5 stars.',
        comment_too_short: 'Your review must be at least 10 characters.',
        comment_too_long: 'Your review is too long.',
        rate_limited: 'You can submit one review every 24 hours.',
        invalid_request: 'Invalid request.',
        generic: 'Something went wrong. Please try again.',
      },
    },
  };

  // ملاحظة: <html lang="..."> فهاد الموقع محدد بـ "ar" فالثلاث صفحات (حتى فـ
  // fr/en)، فما نقدروش نعتمدو عليه. كنحددو اللغة انطلاقا من اسم الملف بدلو.
  function detectLang() {
    var path = window.location.pathname.toLowerCase();
    if (path.indexOf('index-fr') !== -1) return 'fr';
    if (path.indexOf('index-en') !== -1) return 'en';
    return 'ar';
  }
  var t = I18N[detectLang()] || I18N.ar;

  var section = document.getElementById('reviews');
  if (!section) return;

  var csrfToken = null;
  var csrfPromise = null;
  function fetchCsrfToken() {
    if (csrfPromise) return csrfPromise;
    csrfPromise = fetch(CSRF_URL, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) { csrfToken = d.csrf_token; return csrfToken; })
      .catch(function () { return null; });
    return csrfPromise;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchCsrfToken);
  } else {
    fetchCsrfToken();
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  function starsHtml(rating) {
    var full = '★'.repeat(rating);
    var empty = '☆'.repeat(5 - rating);
    return full + empty;
  }

  // -----------------------------------------------------------------
  // بناء هيكلة القسم
  // -----------------------------------------------------------------
  section.innerHTML =
    '<div class="rv-wrap">' +
      '<div class="rv-head">' +
        '<span class="rv-eyebrow"><span class="line"></span> ' + esc(t.eyebrow) + '</span>' +
        '<h2 class="rv-title">' + esc(t.title) + '</h2>' +
        '<p class="rv-subtitle">' + esc(t.subtitle) + '</p>' +
      '</div>' +
      '<div class="rv-summary" id="rv-summary" style="display:none">' +
        '<span class="rv-score" id="rv-score"></span>' +
        '<span class="rv-stars" id="rv-avg-stars"></span>' +
        '<span class="rv-count" id="rv-count"></span>' +
      '</div>' +
      '<div class="rv-loading" id="rv-loading">' + esc(t.loading) + '</div>' +
      '<div class="rv-grid" id="rv-grid" style="display:none"></div>' +
      '<div class="rv-empty" id="rv-empty" style="display:none">' + esc(t.empty) + '</div>' +
      '<div class="rv-cta"><button type="button" class="rv-open-btn" id="rv-open-btn">' + esc(t.openBtn) + '</button></div>' +
    '</div>';

  var overlay = document.createElement('div');
  overlay.className = 'rv-overlay';
  overlay.innerHTML =
    '<div class="rv-modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="rv-close" aria-label="' + esc(t.close) + '">&times;</button>' +
      '<h3 class="rv-modal-title">' + esc(t.modalTitle) + '</h3>' +
      '<form id="rv-form" novalidate>' +
        '<label style="display:block;font-size:12px;color:rgba(255,255,255,.6);margin-bottom:8px;text-align:center">' + esc(t.ratingLabel) + '</label>' +
        '<div class="rv-star-picker" id="rv-star-picker">' +
          [1, 2, 3, 4, 5].map(function (n) {
            return '<button type="button" data-value="' + n + '" aria-label="' + n + '">★</button>';
          }).join('') +
        '</div>' +
        '<input type="hidden" name="rating" id="rv-rating-input" value="0">' +
        '<div class="rv-field"><label for="rv-name">' + esc(t.nameLabel) + '</label><input type="text" id="rv-name" name="name" required></div>' +
        '<div class="rv-field"><label for="rv-comment">' + esc(t.commentLabel) + '</label><textarea id="rv-comment" name="comment" placeholder="' + esc(t.commentPlaceholder) + '" required></textarea></div>' +
        '<div class="rv-field"><label for="rv-pack">' + esc(t.packLabel) + '</label>' +
          '<select id="rv-pack" name="pack_slug">' +
            '<option value="">' + esc(t.packNone) + '</option>' +
            '<option value="bdaya">' + esc(t.packs.bdaya) + '</option>' +
            '<option value="mo9awala">' + esc(t.packs.mo9awala) + '</option>' +
            '<option value="lkra">' + esc(t.packs.lkra) + '</option>' +
          '</select>' +
        '</div>' +
        '<input type="text" name="website" class="rv-hp" tabindex="-1" autocomplete="off">' +
        '<div class="rv-msg" id="rv-msg"></div>' +
        '<button type="submit" class="rv-submit" id="rv-submit">' + esc(t.submitBtn) + '</button>' +
      '</form>' +
    '</div>';
  document.body.appendChild(overlay);

  // -----------------------------------------------------------------
  // تحميل وعرض الآراء المصادق عليها
  // -----------------------------------------------------------------
  var elLoading = section.querySelector('#rv-loading');
  var elGrid    = section.querySelector('#rv-grid');
  var elEmpty   = section.querySelector('#rv-empty');
  var elSummary = section.querySelector('#rv-summary');

  fetch(LIST_URL, { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      elLoading.style.display = 'none';
      if (!data.ok) throw new Error('bad response');

      var reviews = data.reviews || [];
      var stats = data.stats || { count: 0, avg_rating: 0 };

      if (stats.count > 0) {
        section.querySelector('#rv-score').textContent = stats.avg_rating.toFixed(1) + '/5';
        section.querySelector('#rv-avg-stars').textContent = starsHtml(Math.round(stats.avg_rating));
        section.querySelector('#rv-count').textContent = t.basedOn(stats.count);
        elSummary.style.display = 'flex';
      }

      if (reviews.length === 0) {
        elEmpty.style.display = 'block';
        return;
      }

      elGrid.innerHTML = reviews.map(function (r) {
        var packBadge = '';
        if (r.pack && t.packs[r.pack]) {
          packBadge = '<span class="rv-card-pack">' + esc(t.packs[r.pack]) + '</span>';
        }
        return (
          '<div class="rv-card">' +
            '<div class="rv-card-stars">' + starsHtml(r.rating) + '</div>' +
            '<div class="rv-card-comment">' + esc(r.comment) + '</div>' +
            '<div class="rv-card-foot"><span class="rv-card-name">' + esc(r.name) + '</span>' + packBadge + '</div>' +
          '</div>'
        );
      }).join('');
      elGrid.style.display = 'grid';
    })
    .catch(function () {
      elLoading.style.display = 'none';
      elEmpty.style.display = 'block';
    });

  // -----------------------------------------------------------------
  // مودال: فتح/غلق + اختيار النجوم
  // -----------------------------------------------------------------
  var openBtn   = section.querySelector('#rv-open-btn');
  var closeBtn  = overlay.querySelector('.rv-close');
  var form      = overlay.querySelector('#rv-form');
  var starBtns  = Array.prototype.slice.call(overlay.querySelectorAll('#rv-star-picker button'));
  var ratingInput = overlay.querySelector('#rv-rating-input');
  var msgBox    = overlay.querySelector('#rv-msg');
  var submitBtn = overlay.querySelector('#rv-submit');

  function setStars(value) {
    ratingInput.value = value;
    starBtns.forEach(function (b) {
      var v = parseInt(b.getAttribute('data-value'), 10);
      b.classList.toggle('rv-star-on', v <= value);
    });
  }
  starBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      setStars(parseInt(b.getAttribute('data-value'), 10));
    });
  });

  function openModal() {
    form.reset();
    setStars(0);
    msgBox.className = 'rv-msg';
    msgBox.textContent = '';
    submitBtn.disabled = false;
    submitBtn.textContent = t.submitBtn;
    overlay.className = 'rv-overlay rv-open';
    document.body.style.overflow = 'hidden';
    fetchCsrfToken();
    setTimeout(function () { overlay.querySelector('#rv-name').focus(); }, 50);
  }
  function closeModal() {
    overlay.className = 'rv-overlay';
    document.body.style.overflow = '';
  }
  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('rv-open')) closeModal();
  });

  function showMsg(text, ok) {
    msgBox.textContent = text;
    msgBox.className = 'rv-msg rv-show ' + (ok ? 'rv-ok' : 'rv-err');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var rating = parseInt(ratingInput.value, 10);
    var name = overlay.querySelector('#rv-name').value.trim();
    var comment = overlay.querySelector('#rv-comment').value.trim();
    var pack = overlay.querySelector('#rv-pack').value;
    var website = overlay.querySelector('input[name="website"]').value;

    if (rating < 1) {
      showMsg(t.pickRatingFirst, false);
      return;
    }
    if (!name) {
      showMsg(t.errors.invalid_name, false);
      return;
    }
    if (comment.length < 10) {
      showMsg(t.errors.comment_too_short, false);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t.submitting;

    fetchCsrfToken().then(function (token) {
      var body = new URLSearchParams();
      body.set('name', name);
      body.set('rating', String(rating));
      body.set('comment', comment);
      body.set('pack_slug', pack);
      body.set('website', website);
      body.set('csrf_token', token || '');

      return fetch(SUBMIT_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        submitBtn.disabled = false;
        submitBtn.textContent = t.submitBtn;
        if (data.ok) {
          showMsg(t.success, true);
          form.reset();
          setStars(0);
          setTimeout(closeModal, 2200);
        } else {
          var errMsg = (data.code && t.errors[data.code]) ? t.errors[data.code] : t.errors.generic;
          showMsg(errMsg, false);
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = t.submitBtn;
        showMsg(t.errors.generic, false);
      });
  });
})();
