/* ============================================================
   mawqi3i.ma — script.js
   ============================================================
   1) CONFIG: بدل رقم الواتساب والاثمنة هنا، غادي يتبدلو
      اوتوماتيكيا فكامل الصفحة.
   2) Smooth scroll ديال روابط المنيو (بحساب ارتفاع الهيدر الثابت).
   3) منيو الموبايل (فتح/سد).
   ============================================================ */

const CONFIG = {
  // رقم الواتساب بصيغة دولية بلا "+" وبلا مسافات.
  whatsapp: "212698905967",
  prices: {
    vitrine: 2490,
    wordpress: 4990,
    wordpressYear: 600,
    ecommerce: 8990,
    saas: 16900,
    blog: 3490,
    landing: 1290
  }
};

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- 1) تحديث الاثمنة انطلاقا من CONFIG.prices ---------- */
  document.querySelectorAll("[data-price]").forEach((el) => {
    const key = el.getAttribute("data-price");
    if (CONFIG.prices[key] !== undefined) {
      el.textContent = CONFIG.prices[key].toLocaleString("fr-FR");
    }
  });

  /* ---------- 2) تفعيل ازرار الواتساب برقم ورسالة كل واحد ---------- */
  const DEFAULT_WA_MSG =
    "Bienvenue sur la plateforme MAW9I3I ✨\n\n" +
    "Merci de nous avoir contactés.\n" +
    "Nous sommes spécialisés dans la création de tous types de sites web professionnels : vitrines, e-commerce, portfolio, landing page, blog et plus.\n\n" +
    "Comment pouvons-nous vous aider aujourd'hui ?";

  document.querySelectorAll(".js-wa").forEach((el) => {
    const msg = el.getAttribute("data-msg") || DEFAULT_WA_MSG;
    // .replace(/'/g, "%27") : encodeURIComponent وحدو ما كيبدلش الأبوستروف
    // (') لأنها محسوبة "unreserved" فـ JS، بصح باش وتساب يقرا الرسالة
    // كاملة بلا قطع خاصنا نكودياها يدويا هي الوحيدة.
    const encoded = encodeURIComponent(msg).replace(/'/g, "%27");
    el.setAttribute("href", `https://wa.me/${CONFIG.whatsapp}?text=${encoded}`);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener");
  });

  /* ---------- 3) Smooth scroll لروابط المنيو (Header + Mobile) ---------- */
  const header = document.querySelector("header");
  const getHeaderOffset = () => (header ? header.offsetHeight : 0) + 12;

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.pageYOffset - getHeaderOffset();
      window.scrollTo({ top, behavior: "smooth" });

      // سد منيو الموبايل اذا كان مفتوح بعد الضغط على رابط
      const mobileMenu = document.getElementById("mobileMenu");
      if (mobileMenu && mobileMenu.classList.contains("open")) {
        mobileMenu.classList.remove("open");
        document.body.classList.remove("menu-open");
      }
    });
  });

  /* ---------- 4) منيو الموبايل: فتح / سد ---------- */
  const burgerBtn = document.getElementById("burgerBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  if (burgerBtn && mobileMenu) {
    burgerBtn.setAttribute("aria-expanded", "false");
    burgerBtn.addEventListener("click", () => {
      const isOpen = mobileMenu.classList.toggle("open");
      burgerBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      document.documentElement.style.overflow = isOpen ? "hidden" : "";
      // .menu-open كتخبي شريط الـCTA الثابت فقعر الشاشة، باش ما
      // يتقطعش مع منيو الموبايل المفتوحة (الجوج فيهم fixed bottom).
      document.body.classList.toggle("menu-open", isOpen);
    });
  }

  /* ---------- 5) السنة الحالية فالفوتر ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- 6) الهيدر: زجاج كيتكثف منين كيبدا السكرول ---------- */
  if (header) {
    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 10);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- 7) Scroll reveal — GSAP + ScrollTrigger إلا كانت
     متوفرة (مزادة بـ<script> فـ<head>)، وإلا IntersectionObserver
     كـ fallback. فالجوج الحالات، غير كلاس is-visible هو اللي
     كيتزاد — CSS (transition + transition-delay) هو اللي كيدير
     الحركة ديال fade-up، باش التصميم يبقى واحد فالجوج الطرق. ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  const hasGsapScroll =
    typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  if (hasGsapScroll && revealEls.length) {
    try {
      window.gsap.registerPlugin(window.ScrollTrigger);
      revealEls.forEach((el) => {
        window.ScrollTrigger.create({
          trigger: el,
          start: "top 88%",
          once: true,
          onEnter: () => el.classList.add("is-visible")
        });
      });
    } catch (e) {
      // إلا طاح شي حاجة فـ GSAP (نسخة قديمة، تعارض...)، نرجعو
      // لـ IntersectionObserver باش الصفحة ما تبقاش بلا reveal.
      revealEls.forEach((el) => el.classList.add("is-visible"));
    }
  } else if ("IntersectionObserver" in window && revealEls.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- 8) شريط اقتراح اللغة — إلا navigator.language ما
     كيطابقش لغة الصفحة الحالية، كنبينو شريط صغير فوق كيقترح
     النسخة المناسبة (بلا hard redirect، باش ما نأثروش على SEO).
     كيختفي ديفينيتيف إلا المستخدم سدو (localStorage). ---------- */
  (function langSuggestBanner() {
    const banner = document.getElementById("langBanner");
    if (!banner) return;

    const DISMISS_KEY = "m9_lang_banner_dismissed";
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch (e) {
      /* localStorage غير متوفر (تصفح خاص...) — نكملو بلا تخزين */
    }

    const currentLang = (document.documentElement.getAttribute("lang") || "ar").toLowerCase();
    const browserLang = ((navigator.language || navigator.userLanguage || "ar").slice(0, 2)).toLowerCase();

    const PAGE_BY_LANG = { ar: "index.html", fr: "index-fr.html", en: "index-en.html" };
    const COPY = {
      ar: { text: "يبان أن متصفحك مهيأ بالعربية؟ الصفحة ديالنا بالعربية متوفرة.", link: "شوف بالعربية", close: "سد" },
      fr: { text: "Il semble que votre navigateur est en français. Une version française est disponible.", link: "Voir en français", close: "Fermer" },
      en: { text: "Looks like your browser is set to English. An English version of this page is available.", link: "View in English", close: "Close" }
    };

    if (!PAGE_BY_LANG[browserLang] || browserLang === currentLang) return;

    const copy = COPY[browserLang];
    const targetPage = PAGE_BY_LANG[browserLang];
    if (!copy || !targetPage) return;

    banner.innerHTML =
      '<span>' + copy.text + '</span>' +
      '<a href="' + targetPage + '" class="lang-banner-link">' + copy.link + '</a>' +
      '<button type="button" class="lang-banner-close" aria-label="' + copy.close + '">×</button>';
    banner.hidden = false;

    const closeBtn = banner.querySelector(".lang-banner-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        banner.hidden = true;
        try {
          localStorage.setItem(DISMISS_KEY, "1");
        } catch (e) {
          /* ignore */
        }
      });
    }
  })();
});
